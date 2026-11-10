using System;
using System.Collections.Generic;
using System.Globalization;
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
    private const string FuturesBase = "https://fapi.binance.com";
    private const string SpotBase = "https://api.binance.com";

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };

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
            throw new InvalidOperationException($"币安接口错误 {(int)res.StatusCode}: {body}");
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
                    info.StepSize = decimal.Parse(f.GetProperty("stepSize").GetString() ?? "1", CultureInfo.InvariantCulture);
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
        return double.Parse(doc.RootElement.GetProperty("price").GetString() ?? "0", CultureInfo.InvariantCulture);
    }

    public static decimal RoundDown(decimal value, decimal step)
        => step <= 0 ? value : Math.Floor(value / step) * step;

    /// <summary>市价下单 + 止盈止损</summary>
    public static async Task<(bool Ok, string Message, double Qty)> PlaceMarketOrderAsync(
        string symbol, string side, double equity, double equityPercent, int leverage,
        double tpPercent, double slPercent)
    {
        try
        {
            if (!Configured) return (false, "未配置币安 API 密钥", 0);
            var info = await GetSymbolInfoAsync(symbol);
            var price = await GetPriceAsync(symbol);
            if (price <= 0) return (false, "价格无效", 0);

            var margin = equity * equityPercent;
            var notional = margin * leverage;
            if (notional < (double)info.MinNotional)
                return (false, $"名义价值 {notional:F2} 低于最小下单 {info.MinNotional}", 0);

            var rawQty = (decimal)(notional / price);
            var qty = RoundDown(rawQty, info.StepSize);
            if (qty <= 0) return (false, "可下单数量为 0", 0);
            var qtyText = qty.ToString("0.############################", CultureInfo.InvariantCulture);

            // 设置杠杆
            try
            {
                using var levDoc = await SignedAsync(FuturesBase, "/fapi/v1/leverage", new[]
                {
                    new KeyValuePair<string,string>("symbol", symbol),
                    new KeyValuePair<string,string>("leverage", leverage.ToString(CultureInfo.InvariantCulture))
                });
            }
            catch { /* 已有持仓时杠杆不可改，忽略 */ }

            var orderSide = side == "long" ? "BUY" : "SELL";
            var closeSide = side == "long" ? "SELL" : "BUY";

            string orderId;
            using (var od = await SignedAsync(FuturesBase, "/fapi/v1/order", new[]
            {
                new KeyValuePair<string,string>("symbol", symbol),
                new KeyValuePair<string,string>("side", orderSide),
                new KeyValuePair<string,string>("type", "MARKET"),
                new KeyValuePair<string,string>("quantity", qtyText)
            }))
            {
                orderId = od.RootElement.TryGetProperty("orderId", out var oid) ? oid.GetRawText() : "0";
            }

            // 止盈止损
            var tpPrice = RoundDown((decimal)(price * (1 + (side == "long" ? tpPercent : -tpPercent) / 100.0)), info.TickSize);
            var slPrice = RoundDown((decimal)(price * (1 + (side == "long" ? -slPercent : slPercent) / 100.0)), info.TickSize);
            var tpText = tpPrice.ToString("0.############################", CultureInfo.InvariantCulture);
            var slText = slPrice.ToString("0.############################", CultureInfo.InvariantCulture);

            try
            {
                using var tpDoc = await SignedAsync(FuturesBase, "/fapi/v1/order", new[]
                {
                    new KeyValuePair<string,string>("symbol", symbol),
                    new KeyValuePair<string,string>("side", closeSide),
                    new KeyValuePair<string,string>("type", "TAKE_PROFIT_MARKET"),
                    new KeyValuePair<string,string>("stopPrice", tpText),
                    new KeyValuePair<string,string>("closePosition", "true"),
                    new KeyValuePair<string,string>("workingType", "MARK_PRICE")
                });
            }
            catch { }

            try
            {
                using var slDoc = await SignedAsync(FuturesBase, "/fapi/v1/order", new[]
                {
                    new KeyValuePair<string,string>("symbol", symbol),
                    new KeyValuePair<string,string>("side", closeSide),
                    new KeyValuePair<string,string>("type", "STOP_MARKET"),
                    new KeyValuePair<string,string>("stopPrice", slText),
                    new KeyValuePair<string,string>("closePosition", "true"),
                    new KeyValuePair<string,string>("workingType", "MARK_PRICE")
                });
            }
            catch { }

            return (true, $"下单成功 orderId={orderId}", (double)qty);
        }
        catch (Exception ex)
        {
            return (false, ex.Message, 0);
        }
    }

    /// <summary>合约 → 现货 划转 USDT</summary>
    public static async Task<(bool Ok, string Message)> TransferToSpotAsync(double amount)
    {
        try
        {
            if (!Configured) return (false, "未配置币安 API 密钥");
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
