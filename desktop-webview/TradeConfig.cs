using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MossCore;

/// <summary>
/// 币安密钥与交易配置的本机加密存储（DPAPI，仅当前 Windows 用户可解密）。
/// </summary>
internal static class TradeConfig
{
    private static readonly string ConfigPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "MossCore", "trade-config.dat");

    public sealed class Settings
    {
        public string ApiKey { get; set; } = "";
        public string ApiSecret { get; set; } = "";
        public double BaselineEquity { get; set; }
        /// <summary>真实下单总开关（保存并启用后为 true）</summary>
        public bool AutoTrade { get; set; }
        /// <summary>下单方式：true=自动，false=手动</summary>
        public bool AutoMode { get; set; }
        /// <summary>true = 使用币安合约测试网（模拟盘）</summary>
        public bool UseTestnet { get; set; }
        /// <summary>自动把超额盈利划转到现货（默认关闭，需用户显式开启）</summary>
        public bool AutoTransfer { get; set; }
        /// <summary>单笔名义价值安全上限（USDT），防止误下单</summary>
        public double MaxNotional { get; set; } = 200;
        public string BaselineDate { get; set; } = "";
    }

    public static Settings Current { get; private set; } = new();

    private static string Protect(string text)
    {
        var bytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(text), null, DataProtectionScope.CurrentUser);
        return Convert.ToBase64String(bytes);
    }

    private static string Unprotect(string text)
    {
        var bytes = ProtectedData.Unprotect(Convert.FromBase64String(text), null, DataProtectionScope.CurrentUser);
        return Encoding.UTF8.GetString(bytes);
    }

    public static void Load()
    {
        try
        {
            if (!File.Exists(ConfigPath)) { Current = new Settings(); return; }
            var json = Unprotect(File.ReadAllText(ConfigPath));
            Current = JsonSerializer.Deserialize<Settings>(json) ?? new Settings();
            BinanceTradeService.SetKeys(Current.ApiKey, Current.ApiSecret);
            BinanceTradeService.UseTestnet = Current.UseTestnet;
            // 每次启动都从手动开始，自动模式必须由用户本次主动开启
            Current.AutoMode = false;
        }
        catch
        {
            Current = new Settings();
        }
    }

    public static void Save()
    {
        try
        {
            var dir = Path.GetDirectoryName(ConfigPath)!;
            Directory.CreateDirectory(dir);
            File.WriteAllText(ConfigPath, Protect(JsonSerializer.Serialize(Current)));
            BinanceTradeService.SetKeys(Current.ApiKey, Current.ApiSecret);
            BinanceTradeService.UseTestnet = Current.UseTestnet;
            // 每次启动都从手动开始，自动模式必须由用户本次主动开启
            Current.AutoMode = false;
        }
        catch { }
    }

    /// <summary>首次运行时记录基线权益</summary>
    public static void EnsureBaseline(double equity)
    {
        if (Current.BaselineEquity > 0 || equity <= 0) return;
        Current.BaselineEquity = equity;
        Current.BaselineDate = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
        Save();
    }
}
