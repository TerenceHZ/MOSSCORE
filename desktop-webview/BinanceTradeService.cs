using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace MossCore;

/// <summary>
/// 币安 U 本位合约（USDⓈ-M Futures）接口封装。
/// 密钥只存在本机 DPAPI 加密文件中，不经过云端。
/// </summary>
internal static class BinanceTradeService
{
    private const string FuturesLive = "https://fapi.binance.com";
    private const string FuturesTestOld = "https://testnet.binancefuture.com";
    private const string FuturesTestNew = "https://demo-fapi.binance.com";

    /// <summary>测试网基址：新老两套并存，按 API Key 来源自动切换</summary>
    private static string TestHost = FuturesTestNew;
    private const string SpotBase = "https://api.binance.com";

    /// <summary>true = 连币安合约测试网（testnet.binancefuture.com）</summary>
    public static bool UseTestnet { get; set; }

    private static string FuturesBase => UseTestnet ? TestHost : FuturesLive;

    /// <summary>当前实际使用的基址（自检显示用）</summary>
    public static string CurrentHost => UseTestnet ? TestHost : FuturesLive;

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };

    /// <summary>交易审计日志：%LOCALAPPDATA%\MossCore\trade-log.jsonl</summary>
    private static readonly object LogLock = new();
    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "MossCore", "trade-log.jsonl");

    public static void WriteLog(string evt, object? data = null)
    {
        try
        {
            var dir = Path.GetDirectoryName(LogPath)!;
            Directory.CreateDirectory(dir);
            var line = JsonSerializer.Serialize(new
            {
                ts = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff"),
                env = UseTestnet ? "testnet" : "live",
                evt,
                data
            });
            lock (LogLock) File.AppendAllText(LogPath, line + Environment.NewLine);
        }
        catch { }
    }

    public static string? ApiKey { get; private set; }
    public static string? ApiSecret { get; private set; }
    public static bool Configured => !string.IsNullOrWhiteSpace(ApiKey) && !string.IsNullOrWhiteSpace(ApiSecret);

    public static void SetKeys(string key, string secret)
    {
        ApiKey = (key ?? "").Trim();
        ApiSecret = (secret ?? "").Trim();
    }

    private static string Sign(string query)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(ApiSecret ?? ""));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(query));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static async Task<JsonDocument> SignedAsync(string baseUrl, string path, IEnumerable<KeyValuePair<string, string>>? args = null)
    {
        if (!Configured) throw new InvalidOperationException("未配置币安 API 密钥");
        var list = new List<KeyValuePair<string, string>>(args ?? Array.Empty<KeyValuePair<string, string>>());
        list.Add(new("timestamp", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture)));
        list.Add(new("recvWindow", "10000"));
        var query = string.Join("&", list.Select(kv => $"{kv.Key}={Uri.EscapeDataString(kv.Value)}"));
        var url = $"{baseUrl}{path}?{query}&signature={Sign(query)}";
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Add("X-MBX-APIKEY", ApiKey);
        using var res = await Http.SendAsync(req);
        var body = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
        {
            // 测试网有两套域名（demo-fapi / testnet.binancefuture），Key 来源不同；
            // 鉴权失败时自动换另一套重试一次。
            var isAuthErr = body.Contains("-2015") || body.Contains("-1022") || body.Contains("Invalid API-key");
            if (UseTestnet && isAuthErr && baseUrl != FuturesLive)
            {
                var alt = baseUrl.Contains("demo-fapi") ? FuturesTestOld : FuturesTestNew;
                TestHost = alt;
                var url2 = $"{alt}{path}?{query}&signature={Sign(query)}";
                using var req2 = new HttpRequestMessage(HttpMethod.Get, url2);
                req2.Headers.Add("X-MBX-APIKEY", ApiKey);
                using var res2 = await Http.SendAsync(req2);
                var body2 = await res2.Content.ReadAsStringAsync();
                if (!res2.IsSuccessStatusCode)
                    throw new InvalidOperationException($"币安接口错误 {(int)res2.StatusCode}: {body2}");
                WriteLog("testnet_host_switch", new { host = alt });
                return JsonDocument.Parse(body2);
            }
            throw new InvalidOperationException($"币安接口错误 {(int)res.StatusCode}: {body}");
        }
        return JsonDocument.Parse(body);
    }

    public static async Task<(bool Ok, string Message, double FuturesEquity, double AvailableBalance, double SpotFree)> GetBalancesAsync()
    {
        try
        {
            double equity = 0, avail = 0, spot = 0;
            using (var fut = await SignedAsync(FuturesBase, "/fapi/v2/account"))
            {
                var r = fut.RootElement;
                if (r.TryGetProperty("totalMarginBalance", out var tm) &&
                    double.TryParse(tm.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var e))
                    equity = e;
                if (r.TryGetProperty("availableBalance", out var ab) &&
                    double.TryParse(ab.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var a))
                    avail = a;
            }
            try
            {
                using var spotDoc = await SignedAsync(SpotBase, "/api/v3/account");
                if (spotDoc.RootElement.TryGetProperty("balances", out var arr))
                {
                    foreach (var b in arr.EnumerateArray())
                    {
                        if (b.TryGetProperty("asset", out var asset) && asset.GetString() == "USDT")
                        {
                            if (b.TryGetProperty("free", out var free) &&
                                double.TryParse(free.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var f))
                                spot = f;
                        }
                    }
                }
            }
            catch { /* 现货权限缺失时忽略 */ }
            return (true, "ok", equity, avail, spot);
        }
        catch (Exception ex)
        {
            return (false, ex.Message, 0, 0, 0);
        }
    }

    /// <summary>读取合约持仓（只含非零仓位）</summary>
    public static async Task<List<object>> GetPositionsAsync()
    {
        var list = new List<object>();
        using var doc = await SignedAsync(FuturesBase, "/fapi/v2/positionRisk");
        foreach (var p in doc.RootElement.EnumerateArray())
        {
            if (!p.TryGetProperty("symbol", out var symEl)) continue;
            if (!p.TryGetProperty("positionAmt", out var amtEl)) continue;
            var amtText = amtEl.GetString() ?? "0";
            if (!double.TryParse(amtText, NumberStyles.Any, CultureInfo.InvariantCulture, out var amt) || amt == 0) continue;
            var entry = p.TryGetProperty("entryPrice", out var e) ? e.GetString() : "0";
            var pnl = p.TryGetProperty("unRealizedProfit", out var u) ? u.GetString() : "0";
            list.Add(new { symbol = symEl.GetString(), amount = amt, entryPrice = entry, pnl });
        }
        return list;
    }

    private static readonly Dictionary<string, SymbolInfo> InfoCache = new();

    private sealed class SymbolInfo
    {
        public int QtyPrecision;
        public decimal StepSize = 1m;
        public decimal MinQty = 0m;
        public decimal MaxQty = 0m;
        public decimal TickSize = 0.0001m;
        public decimal MinNotional = 5m;
        public int PricePrecision;
    }

    private static async Task<SymbolInfo> GetSymbolInfoAsync(string symbol)
    {
        if (InfoCache.TryGetValue(symbol, out var cached)) return cached;
        using var res = await Http.GetAsync($"{FuturesBase}/fapi/v1/exchangeInfo");
        var body = await res.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        foreach (var s in doc.RootElement.GetProperty("symbols").EnumerateArray())
        {
            var name = s.GetProperty("symbol").GetString();
            if (name == null) continue;
            var info = new SymbolInfo
            {
                QtyPrecision = s.GetProperty("quantityPrecision").GetInt32(),
                PricePrecision = s.GetProperty("pricePrecision").GetInt32()
            };
            foreach (var f in s.GetProperty("filters").EnumerateArray())
            {
                var type = f.GetProperty("filterType").GetString();
                if (type == "LOT_SIZE")
                {
                    info.StepSize = decimal.Parse(f.GetProperty("stepSize").GetString() ?? "1", CultureInfo.InvariantCulture);
                    if (f.TryGetProperty("minQty", out var mn) &&
                        decimal.TryParse(mn.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var mnv))
                        info.MinQty = mnv;
                    if (f.TryGetProperty("maxQty", out var mx) &&
                        decimal.TryParse(mx.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var mxv))
                        info.MaxQty = mxv;
                }
                else if (type == "PRICE_FILTER")
                    info.TickSize = decimal.Parse(f.GetProperty("tickSize").GetString() ?? "0.0001", CultureInfo.InvariantCulture);
                else if (type == "MIN_NOTIONAL")
                    info.MinNotional = decimal.Parse(f.GetProperty("notional").GetString() ?? "5", CultureInfo.InvariantCulture);
            }
            InfoCache[name] = info;
        }
        if (!InfoCache.TryGetValue(symbol, out var found)) throw new InvalidOperationException($"找不到交易对 {symbol}");
        return found;
    }

    public static async Task<double> GetPriceAsync(string symbol)
    {
        using var res = await Http.GetAsync($"{FuturesBase}/fapi/v1/ticker/price?symbol={symbol}");
        var body = await res.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        if (!doc.RootElement.TryGetProperty("price", out var priceEl))
        {
            // 测试网没有这个交易对时，接口返回 {}（空对象）
            throw new InvalidOperationException(
                UseTestnet
                    ? $"该交易对不在币安测试网（测试网只有 700 多个交易对），请换一个币测试"
                    : $"读取价格失败：{body.Substring(0, Math.Min(120, body.Length))}");
        }
        return double.Parse(priceEl.GetString() ?? "0", CultureInfo.InvariantCulture);
    }

    /// <summary>当前环境下可交易的交易对（测试网与主网币种不同）</summary>
    public static async Task<List<string>> ListSymbolsAsync()
    {
        var list = new List<string>();
        try
        {
            using var res = await Http.GetAsync($"{FuturesBase}/fapi/v1/exchangeInfo");
            var body = await res.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("symbols", out var arr))
            {
                foreach (var s in arr.EnumerateArray())
                {
                    if (s.TryGetProperty("symbol", out var sym) &&
                        s.TryGetProperty("status", out var st) && st.GetString() == "TRADING")
                        list.Add(sym.GetString() ?? "");
                }
            }
        }
        catch { }
        return list;
    }

    public static decimal RoundDown(decimal value, decimal step)
        => step <= 0 ? value : Math.Floor(value / step) * step;

    /// <summary>市价平掉某币的仓位（回滚用），返回是否成功</summary>
    public static async Task<(bool Ok, string Message)> ClosePositionAsync(string symbol, string side)
    {
        try
        {
            if (!Configured) return (false, "未配置币安 API 密钥");
            var closeSide = side == "long" ? "SELL" : "BUY";
            await SignedAsync(FuturesBase, "/fapi/v1/order", new[]
            {
                new KeyValuePair<string, string>("symbol", symbol),
                new KeyValuePair<string, string>("side", closeSide),
                new KeyValuePair<string, string>("type", "MARKET"),
                new KeyValuePair<string, string>("closePosition", "true")
            });
            WriteLog("close", new { symbol, side, ok = true });
            return (true, "已市价平仓");
        }
        catch (Exception ex)
        {
            WriteLog("close", new { symbol, side, ok = false, error = ex.Message });
            return (false, ex.Message);
        }
    }

    /// <summary>
    /// 市价下单 + 止盈止损。
    /// 安全策略：止盈或止损任一创建失败 → 立即市价平仓回滚，并返回失败原因。
    /// </summary>
    public static async Task<(bool Ok, string Message, double Qty)> PlaceMarketOrderAsync(
        string symbol, string side, double equity, double equityPercent, int leverage,
        double tpPercent, double slPercent, double maxNotional = 0)
    {
        string? openSideDone = null;
        try
        {
            if (!Configured) return (false, "未配置币安 API 密钥", 0);

            var info = await GetSymbolInfoAsync(symbol);
            var price = await GetPriceAsync(symbol);
            if (price <= 0) return (false, "价格无效", 0);

            var margin = equity * equityPercent;
            var notional = margin * leverage;
            if (maxNotional > 0 && notional > maxNotional)
            {
                WriteLog("blocked_max_notional", new { symbol, notional, maxNotional });
                return (false, $"名义价值 {notional:F2} 超过安全上限 {maxNotional:F0} USDT（可在面板调整）", 0);
            }
            if (notional < (double)info.MinNotional)
                return (false, $"名义价值 {notional:F2} 低于最小下单 {info.MinNotional:F2}", 0);

            var rawQty = (decimal)(notional / price);
            var qty = RoundDown(rawQty, info.StepSize);
            if (qty <= 0) return (false, "可下单数量为 0", 0);
            if (info.MinQty > 0 && qty < info.MinQty)
                return (false, $"数量 {qty} 小于最小下单量 {info.MinQty}（名义价值需更大）", 0);
            if (info.MaxQty > 0 && qty > info.MaxQty)
                return (false, $"数量 {qty} 超过单笔上限 {info.MaxQty}", 0);

            var qtyText = qty.ToString("0.############################", CultureInfo.InvariantCulture);

            // 1) 设置杠杆：失败直接中止（避免用错误杠杆开仓）
            try
            {
                using var levDoc = await SignedAsync(FuturesBase, "/fapi/v1/leverage", new[]
                {
                    new KeyValuePair<string, string>("symbol", symbol),
                    new KeyValuePair<string, string>("leverage", leverage.ToString(CultureInfo.InvariantCulture))
                });
            }
            catch (Exception ex)
            {
                WriteLog("leverage_fail", new { symbol, leverage, error = ex.Message });
                return (false, $"设置 {leverage}x 杠杆失败（该币可能不支持该杠杆）：{ex.Message}", 0);
            }

            var orderSide = side == "long" ? "BUY" : "SELL";
            var closeSide = side == "long" ? "SELL" : "BUY";

            // 2) 市价开仓
            string orderId;
            using (var od = await SignedAsync(FuturesBase, "/fapi/v1/order", new[]
            {
                new KeyValuePair<string, string>("symbol", symbol),
                new KeyValuePair<string, string>("side", orderSide),
                new KeyValuePair<string, string>("type", "MARKET"),
                new KeyValuePair<string, string>("quantity", qtyText)
            }))
            {
                orderId = od.RootElement.TryGetProperty("orderId", out var oid) ? oid.GetRawText() : "0";
            }
            openSideDone = side;
            WriteLog("open", new { symbol, side, qty = qtyText, price, leverage, orderId });

            // 3) 止盈止损（任一失败 → 回滚）
            var tpPrice = RoundDown((decimal)(price * (1 + (side == "long" ? tpPercent : -tpPercent) / 100.0)), info.TickSize);
            var slPrice = RoundDown((decimal)(price * (1 + (side == "long" ? -slPercent : slPercent) / 100.0)), info.TickSize);
            var tpText = tpPrice.ToString("0.############################", CultureInfo.InvariantCulture);
            var slText = slPrice.ToString("0.############################", CultureInfo.InvariantCulture);

            string? protectError = null;

            try
            {
                using var tpDoc = await SignedAsync(FuturesBase, "/fapi/v1/order", new[]
                {
                    new KeyValuePair<string, string>("symbol", symbol),
                    new KeyValuePair<string, string>("side", closeSide),
                    new KeyValuePair<string, string>("type", "TAKE_PROFIT_MARKET"),
                    new KeyValuePair<string, string>("stopPrice", tpText),
                    new KeyValuePair<string, string>("closePosition", "true"),
                    new KeyValuePair<string, string>("workingType", "MARK_PRICE")
                });
            }
            catch (Exception ex)
            {
                protectError = "止盈创建失败: " + ex.Message;
            }

            if (protectError == null)
            {
                try
                {
                    using var slDoc = await SignedAsync(FuturesBase, "/fapi/v1/order", new[]
                    {
                        new KeyValuePair<string, string>("symbol", symbol),
                        new KeyValuePair<string, string>("side", closeSide),
                        new KeyValuePair<string, string>("type", "STOP_MARKET"),
                        new KeyValuePair<string, string>("stopPrice", slText),
                        new KeyValuePair<string, string>("closePosition", "true"),
                        new KeyValuePair<string, string>("workingType", "MARK_PRICE")
                    });
                }
                catch (Exception ex)
                {
                    protectError = "止损创建失败: " + ex.Message;
                }
            }

            if (protectError != null)
            {
                WriteLog("protect_fail", new { symbol, orderId, error = protectError });
                var closed = await ClosePositionAsync(symbol, side);
                openSideDone = null;
                WriteLog("rollback", new { symbol, ok = closed.Ok, closed.Message });
                var tail = closed.Ok
                    ? "已自动市价平仓回滚，本次未留仓位"
                    : $"自动回滚也失败（{closed.Message}），请立刻去币安手动平仓！";
                return (false, $"{protectError} → {tail}", 0);
            }

            WriteLog("protect_ok", new { symbol, tp = tpText, sl = slText });
            openSideDone = null;
            return (true, $"下单成功 orderId={orderId}", (double)qty);
        }
        catch (Exception ex)
        {
            WriteLog("order_error", new { symbol, side, error = ex.Message });
            if (openSideDone != null)
            {
                var closed = await ClosePositionAsync(symbol, openSideDone);
                WriteLog("rollback", new { symbol, ok = closed.Ok, closed.Message });
                if (!closed.Ok)
                    return (false, $"{ex.Message}；回滚失败（{closed.Message}），请立刻去币安手动平仓！", 0);
                return (false, $"{ex.Message}（已自动平仓回滚）", 0);
            }
            return (false, ex.Message, 0);
        }
    }

    /// <summary>合约 → 现货 划转 USDT</summary>
    public static async Task<(bool Ok, string Message)> TransferToSpotAsync(double amount)
    {
        try
        {
            if (!Configured) return (false, "未配置币安 API 密钥");
            if (UseTestnet) return (false, "测试网不支持资金划转，已跳过");
            if (amount <= 0) return (false, "划转金额无效");
            using var doc = await SignedAsync(FuturesBase, "/sapi/v1/futures/transfer", new[]
            {
                new KeyValuePair<string,string>("asset", "USDT"),
                new KeyValuePair<string,string>("amount", amount.ToString("0.########", CultureInfo.InvariantCulture)),
                new KeyValuePair<string,string>("type", "2")
            });
            return (true, $"已划转 {amount:F2} USDT 到现货");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }
}
