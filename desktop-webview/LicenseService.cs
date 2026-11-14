using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace MossCore;

internal static class LicenseService
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private static readonly string LicensePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "MossCore", "license.dat");

    public static string? LicenseKey { get; private set; }
    public static bool TradeEnabled { get; private set; }
    public static string DeviceId { get; } = BuildDeviceId();

    private static void ApplyFeatures(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("features", out var feats) && feats.ValueKind == JsonValueKind.Object)
            {
                var on = feats.TryGetProperty("trade", out var t) && t.ValueKind == JsonValueKind.True;
                TradeEnabled = on;
            }
        }
        catch { }
    }

    private sealed class StoredLicense
    {
        public string License { get; set; } = "";
        public string DeviceId { get; set; } = "";
        public string ExpiresAt { get; set; } = "";
    }

    private static string BuildDeviceId()
    {
        string input = Environment.MachineName;
        try
        {
            var guid = Registry.GetValue(
                @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography",
                "MachineGuid", null)?.ToString();
            if (!string.IsNullOrWhiteSpace(guid)) input = guid;
        }
        catch { }
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes("MOSS-CORE:" + input));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string BaseUrl()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "data-source.json");
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var url = doc.RootElement.TryGetProperty("url", out var u) ? u.GetString() : null;
        if (string.IsNullOrWhiteSpace(url)) throw new InvalidOperationException("data-source.json missing url");
        return url.TrimEnd('/');
    }

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

    public static bool TryLoad()
    {
        try
        {
            if (!File.Exists(LicensePath)) return false;
            var stored = JsonSerializer.Deserialize<StoredLicense>(Unprotect(File.ReadAllText(LicensePath)));
            if (stored == null || string.IsNullOrWhiteSpace(stored.License)) return false;
            if (!string.Equals(stored.DeviceId, DeviceId, StringComparison.OrdinalIgnoreCase)) return false;
            LicenseKey = stored.License;
            return true;
        }
        catch
        {
            return false;
        }
    }

    public static void Clear()
    {
        LicenseKey = null;
        try { File.Delete(LicensePath); } catch { }
    }

    private static void Save(string license, string expiresAt)
    {
        var data = new StoredLicense { License = license, DeviceId = DeviceId, ExpiresAt = expiresAt };
        var dir = Path.GetDirectoryName(LicensePath)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(LicensePath, Protect(JsonSerializer.Serialize(data)));
    }

    public static async Task<(bool Ok, string Error)> ActivateAsync(string code)
    {
        try
        {
            var url = BaseUrl() + "/license/activate";
            var payload = new
            {
                code = code.Trim(),
                device_id = DeviceId,
                device_name = Environment.MachineName
            };
            using var resp = await Http.PostAsJsonAsync(url, payload);
            var body = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode)
            {
                try
                {
                    using var doc = JsonDocument.Parse(body);
                    var err = doc.RootElement.TryGetProperty("error", out var e) ? e.GetString() : null;
                    if (err == "already_bound") return (false, "邀请码已绑定其他电脑，请先在旧电脑解绑或联系管理员。");
                    if (err == "invalid_code") return (false, "邀请码无效。");
                    if (err == "code_expired_or_revoked") return (false, "邀请码已过期或被停用。");
                }
                catch { }
                return (false, $"激活失败：HTTP {(int)resp.StatusCode}");
            }
            using var okDoc = JsonDocument.Parse(body);
            var license = okDoc.RootElement.GetProperty("license").GetString();
            var expires = okDoc.RootElement.TryGetProperty("expires_at", out var exp) ? exp.GetString() ?? "" : "";
            if (string.IsNullOrWhiteSpace(license)) return (false, "服务器没有返回许可证。");
            Save(license, expires);
            LicenseKey = license;
            return (true, "");
        }
        catch (Exception ex)
        {
            return (false, "无法连接激活服务器：" + ex.Message);
        }
    }

    public static async Task<(bool Ok, string Error)> ValidateAsync()
    {
        if (!TryLoad()) return (false, "本机尚未激活。");
        try
        {
            var url = BaseUrl() + "/license/validate";
            using var resp = await Http.PostAsJsonAsync(url, new { license = LicenseKey, device_id = DeviceId });
            if (resp.IsSuccessStatusCode)
            {
                ApplyFeatures(await resp.Content.ReadAsStringAsync());
                return (true, "");
            }
            if (resp.StatusCode == HttpStatusCode.Unauthorized)
            {
                Clear();
                TradeEnabled = false;
                return (false, "许可证已失效，需要重新激活。");
            }
            return (false, $"许可证验证失败：HTTP {(int)resp.StatusCode}");
        }
        catch (Exception ex)
        {
            return (false, "无法连接验证服务器：" + ex.Message);
        }
    }
}
