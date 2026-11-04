using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MossCore;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        var log = Path.Combine(AppContext.BaseDirectory, "boot.log");
        try
        {
            File.AppendAllText(log, $"[{DateTime.Now:O}] main start\r\n");
            ApplicationConfiguration.Initialize();
            Application.ThreadException += (_, e) =>
            {
                try { File.AppendAllText(log, $"[{DateTime.Now:O}] thread: {e.Exception}\r\n"); } catch { }
            };
            AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            {
                try { File.AppendAllText(log, $"[{DateTime.Now:O}] domain: {e.ExceptionObject}\r\n"); } catch { }
            };
            Application.Run(new MainForm());
            File.AppendAllText(log, $"[{DateTime.Now:O}] main end\r\n");
        }
        catch (Exception ex)
        {
            try { File.AppendAllText(log, $"[{DateTime.Now:O}] fatal: {ex}\r\n"); } catch { }
        }
    }
}

internal sealed class MainForm : Form
{
    private readonly WebView2 _web = new();
    private readonly HttpClient _liveHttp = new() { Timeout = TimeSpan.FromSeconds(90) };
    private System.Windows.Forms.Timer? _liveTimer;
    private bool _liveBusy;
    private HashSet<string>? _binanceSymbols;
    private int _savedW;
    private int _savedH;

    private sealed class LiveRow
    {
        public string Symbol { get; set; } = "";
        public string BaseAsset { get; set; } = "";
        public double Price { get; set; }
        public double Change24h { get; set; }
        public double Change1m { get; set; }
        public double Change5m { get; set; }
        public double QuoteVolume24h { get; set; }
        public double OiNotional { get; set; }
        public double Oi5m { get; set; }
        public double Oi15m { get; set; }
        public double Oi24h { get; set; }
        public double Oi24hDelta { get; set; }
        public double Pullback { get; set; }
        public double Score { get; set; }
        public double VolRatio3m { get; set; }
        public double Change3m { get; set; }
        public string LargeSide { get; set; } = "";
        public double LargeUsdt { get; set; }
        public double LargeMultiple { get; set; }
        public double Change30s { get; set; }
        public string Stage { get; set; } = "low";
        public string StageLabel { get; set; } = "";
        public bool Focus { get; set; }
        public string StateLabel { get; set; } = "";
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    public MainForm()
    {
        Text = "MOSS CORE · 异动监测";
        Width = 1600;
        Height = 900;
        MinimumSize = new Size(1280, 720);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(4, 6, 10);
        DoubleBuffered = true;

        try
        {
            var state = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "MossCore", "window.txt");
            var packagedDefault = Path.Combine(AppContext.BaseDirectory, "window-default.txt");
            if (!File.Exists(state) && File.Exists(packagedDefault))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(state)!);
                File.Copy(packagedDefault, state);
            }
            if (File.Exists(state))
            {
                var parts = File.ReadAllText(state).Trim().Split('x');
                if (parts.Length == 2
                    && int.TryParse(parts[0], out var w)
                    && int.TryParse(parts[1], out var h)
                    && w >= 1280 && h >= 720)
                {
                    _savedW = w;
                    _savedH = h;
                }
            }
        }
        catch
        {
            // A missing or invalid state file falls back to the default size.
        }

        FormClosing += (_, _) =>
        {
            try
            {
                if (WindowState != FormWindowState.Normal) return;
                if (!GetWindowRect(Handle, out var r)) return;
                var w = r.Right - r.Left;
                var h = r.Bottom - r.Top;
                if (w < 1280 || h < 720) return;
                var state = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "MossCore", "window.txt");
                Directory.CreateDirectory(Path.GetDirectoryName(state)!);
                File.WriteAllText(state, $"{w}x{h}");
            }
            catch
            {
                // Size persistence must never block closing.
            }
        };

        try
        {
            var iconPath = Path.Combine(AppContext.BaseDirectory, "icon.ico");
            if (File.Exists(iconPath)) Icon = new Icon(iconPath);
        }
        catch
        {
            // The default form icon is acceptable if the file cannot be read.
        }

        _web.Dock = DockStyle.Fill;
        _web.DefaultBackgroundColor = Color.Black;
        Controls.Add(_web);
        Load += OnLoad;
        Shown += (_, _) =>
        {
            if (WindowState == FormWindowState.Normal)
            {
                Left = 40;
                Top = 40;
            }
        };
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        try
        {
            var dark = 1;
            if (DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int)) != 0)
                DwmSetWindowAttribute(Handle, 19, ref dark, sizeof(int));

            // Windows 11 native chrome, tuned to the 550C black/gold palette.
            var caption = unchecked((int)0x00030405); // COLORREF: #050403
            var text = unchecked((int)0x00E8F0F2);    // COLORREF: #F2F0E8
            var border = unchecked((int)0x003A7A9A);  // COLORREF: dark gold #9A7A3A
            var corner = 2;                            // rounded
            DwmSetWindowAttribute(Handle, 35, ref caption, sizeof(int));
            DwmSetWindowAttribute(Handle, 36, ref text, sizeof(int));
            DwmSetWindowAttribute(Handle, 34, ref border, sizeof(int));
            DwmSetWindowAttribute(Handle, 33, ref corner, sizeof(int));

            if (_savedW >= 1280 && _savedH >= 720)
            {
                SetWindowPos(Handle, IntPtr.Zero, 0, 0, _savedW, _savedH, 0x0002 | 0x0004 | 0x0010);
                CenterToScreen();
            }
        }
        catch
        {
            // Older Windows builds do not support the immersive chrome attributes.
        }
    }

    private async void OnLoad(object? sender, EventArgs e)
    {
        try
        {
            var userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "MossCore", "WebView2");
            Directory.CreateDirectory(userData);

            var env = await CoreWebView2Environment.CreateAsync(
                null,
                userData,
                new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required"));
            await _web.EnsureCoreWebView2Async(env);
            _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            _web.CoreWebView2.Settings.AreDevToolsEnabled = false;
            _web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            _web.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = true;
            _web.CoreWebView2.Settings.IsZoomControlEnabled = true;

            var log = Path.Combine(AppContext.BaseDirectory, "boot.log");
            _web.CoreWebView2.NavigationStarting += (_, args) =>
            {
                try { File.AppendAllText(log, $"[{DateTime.Now:O}] nav start {args.Uri}\r\n"); } catch { }
            };
            _web.CoreWebView2.NavigationCompleted += (_, args) =>
            {
                try { File.AppendAllText(log, $"[{DateTime.Now:O}] nav done ok={args.IsSuccess} err={args.WebErrorStatus}\r\n"); } catch { }
                try { _web.ZoomFactor = 1.0; } catch { }
                if (args.IsSuccess) StartLiveBridge();
            };
            _web.CoreWebView2.ProcessFailed += (_, args) =>
            {
                try { File.AppendAllText(log, $"[{DateTime.Now:O}] web process failed {args.ProcessFailedKind}\r\n"); } catch { }
            };

            var page = Path.Combine(AppContext.BaseDirectory, "index.html");
            if (!File.Exists(page))
            {
                File.WriteAllText(Path.Combine(AppContext.BaseDirectory, "startup.log"),
                    $"missing index.html: {page}\r\n");
                Close();
                return;
            }

            var demo = Environment.GetCommandLineArgs().Any(a => string.Equals(a, "--demo", StringComparison.OrdinalIgnoreCase) || string.Equals(a, "--demo-short", StringComparison.OrdinalIgnoreCase))
                || (Environment.ProcessPath ?? string.Empty).IndexOf("DEMO", StringComparison.OrdinalIgnoreCase) >= 0;
            var shortDemo = Environment.GetCommandLineArgs().Any(a => string.Equals(a, "--demo-short", StringComparison.OrdinalIgnoreCase))
                || (Environment.ProcessPath ?? string.Empty).IndexOf("SHORT", StringComparison.OrdinalIgnoreCase) >= 0;
            var uri = new Uri(page).AbsoluteUri + (demo ? (shortDemo ? "?v=20261102-alerts&demo=short#neural" : "?v=20261102-alerts&demo=1#neural") : "?v=20261102-alerts#neural");
            File.AppendAllText(log, $"[{DateTime.Now:O}] navigating {uri}\r\n");
            _web.CoreWebView2.Navigate(uri);
        }
        catch (Exception ex)
        {
            try
            {
                File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "startup.log"),
                    $"[{DateTime.Now:O}] {ex}\r\n");
            }
            catch
            {
                // Never show a launch dialog; close silently if WebView2 is unavailable.
            }
            Close();
        }
    }

    private void StartLiveBridge()
    {
        if (_liveTimer != null) return;
        _liveTimer = new System.Windows.Forms.Timer { Interval = 60000 };
        _liveTimer.Tick += async (_, _) => await PullLiveAsync();
        _liveTimer.Start();
        _ = ResetZoomAsync();
        _ = LoadCachedLiveAsync();
        _ = PullLiveAsync();
    }

    private async Task ResetZoomAsync()
    {
        try
        {
            await Task.Delay(1200);
            _web.ZoomFactor = 1.0;
        }
        catch { }
    }

    private static string LiveCachePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "MossCore", "live-snapshot.json");

    private async Task LoadCachedLiveAsync()
    {
        try
        {
            var cache = LiveCachePath;
            var file = File.Exists(cache) ? cache : Path.Combine(AppContext.BaseDirectory, "live-seed.json");
            if (!File.Exists(file)) return;
            var json = await File.ReadAllTextAsync(file);
            await _web.ExecuteScriptAsync("window.__MOSS_LIVE=" + json + ";window.dispatchEvent(new Event('moss:live'));");
        }
        catch
        {
            // The seed is optional; live fetch continues.
        }
    }

    private static string S(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? "") : "";

    private static double D(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d) ? d : 0;

    private static bool B(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    private static double DStr(JsonElement e, string name)
        => double.TryParse(S(e, name), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : 0;

    private static double Num(JsonElement e, int index)
    {
        if (e.ValueKind != JsonValueKind.Array || e.GetArrayLength() <= index) return 0;
        var v = e[index];
        if (v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d)) return d;
        if (v.ValueKind == JsonValueKind.String
            && double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s)) return s;
        return 0;
    }

    private async Task<JsonDocument> GetJsonAsync(string url)
    {
        using var response = await _liveHttp.GetAsync(url);
        response.EnsureSuccessStatusCode();
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    }

    private async Task<LiveRow?> FetchBinanceRowAsync(string symbol, double price, double change24h, double quoteVolume)
    {
        double oi = 0, oi5 = 0, oi15 = 0, oiNotional = 0;
        try
        {
            using var oiDoc = await GetJsonAsync(
                $"https://fapi.binance.com/fapi/v1/openInterest?symbol={symbol}");
            oi = DStr(oiDoc.RootElement, "openInterest");
        }
        catch { }

        try
        {
            using var histDoc = await GetJsonAsync(
                $"https://fapi.binance.com/futures/data/openInterestHist?symbol={symbol}&period=5m&limit=4");
            var arr = histDoc.RootElement;
            if (arr.ValueKind == JsonValueKind.Array && arr.GetArrayLength() > 0)
            {
                var len = arr.GetArrayLength();
                var current = DStr(arr[len - 1], "sumOpenInterestValue");
                if (current > 0) oiNotional = current;
                if (len >= 2)
                {
                    var prev = DStr(arr[len - 2], "sumOpenInterestValue");
                    if (prev > 0) oi5 = (current - prev) / prev * 100.0;
                }
                if (len >= 4)
                {
                    var prev = DStr(arr[0], "sumOpenInterestValue");
                    if (prev > 0) oi15 = (current - prev) / prev * 100.0;
                }
            }
        }
        catch { }

        if (oiNotional <= 0 && oi > 0) oiNotional = oi * price;
        if (double.IsNaN(oi5) || double.IsInfinity(oi5)) oi5 = 0;
        if (double.IsNaN(oi15) || double.IsInfinity(oi15)) oi15 = 0;

        double oi24h = 0, oi24hDelta = 0;
        try
        {
            using var d24 = await GetJsonAsync(
                $"https://fapi.binance.com/futures/data/openInterestHist?symbol={symbol}&period=1h&limit=25");
            var arr24 = d24.RootElement;
            if (arr24.ValueKind == JsonValueKind.Array && arr24.GetArrayLength() >= 2)
            {
                var len24 = arr24.GetArrayLength();
                var now24 = DStr(arr24[len24 - 1], "sumOpenInterestValue");
                var prev24 = DStr(arr24[0], "sumOpenInterestValue");
                if (prev24 > 0)
                {
                    oi24h = (now24 - prev24) / prev24 * 100;
                    oi24hDelta = now24 - prev24;
                }
            }
        }
        catch { }

        double volRatio3m = 0, change3m = 0, largeUsdt = 0, largeMultiple = 0, change30s = 0;
        var largeSide = "";
        try
        {
            using var kDoc = await GetJsonAsync(
                $"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval=1m&limit=48");
            var arr = kDoc.RootElement;
            if (arr.ValueKind == JsonValueKind.Array && arr.GetArrayLength() >= 48)
            {
                var current3 = Num(arr[45], 5) + Num(arr[46], 5) + Num(arr[47], 5);
                var avg3 = 0.0;
                for (var w = 0; w < 15; w++)
                    avg3 += Num(arr[w * 3], 5) + Num(arr[w * 3 + 1], 5) + Num(arr[w * 3 + 2], 5);
                avg3 /= 15;
                if (avg3 > 0) volRatio3m = current3 / avg3;
                var c0 = Num(arr[44], 4);
                if (c0 > 0) change3m = (Num(arr[47], 4) - c0) / c0 * 100;
            }
        }
        catch { }

        try
        {
            using var aDoc = await GetJsonAsync(
                $"https://fapi.binance.com/fapi/v1/aggTrades?symbol={symbol}&limit=1000");
            var arr = aDoc.RootElement;
            if (arr.ValueKind == JsonValueKind.Array && arr.GetArrayLength() > 0)
            {
                var n = arr.GetArrayLength();
                var sum = 0.0;
                var max = 0.0;
                var maxSide = "";
                var lastT = 0L;
                for (var i = 0; i < n; i++)
                {
                    var notional = DStr(arr[i], "p") * DStr(arr[i], "q");
                    sum += notional;
                    if (notional > max)
                    {
                        max = notional;
                        maxSide = B(arr[i], "m") ? "sell" : "buy";
                    }
                    if (arr[i].TryGetProperty("T", out var tv) && tv.TryGetInt64(out var ts)) lastT = Math.Max(lastT, ts);
                }
                var avg = sum / n;
                largeUsdt = max;
                if (avg > 0) largeMultiple = max / avg;
                largeSide = maxSide;
                if (lastT > 0)
                {
                    var lastPrice = DStr(arr[n - 1], "p");
                    var firstPrice = 0.0;
                    for (var i = 0; i < n; i++)
                        if (arr[i].TryGetProperty("T", out var tv) && tv.TryGetInt64(out var ts) && ts >= lastT - 30000)
                        { firstPrice = DStr(arr[i], "p"); break; }
                    if (firstPrice > 0) change30s = (lastPrice - firstPrice) / firstPrice * 100;
                }
            }
        }
        catch { }

        var score = Math.Clamp(50 + change24h * 0.7 + oi15 * 0.6 + (quoteVolume >= 1e8 ? 8 : 4), 0, 100);
        var stage = score >= 72 ? "entry" : score >= 55 ? "watch" : "low";
        var label = stage == "entry" ? "开仓信号" : stage == "watch" ? "重点候选" : "观察";
        return new LiveRow
        {
            Symbol = symbol,
            BaseAsset = symbol.Replace("USDT", ""),
            Price = price,
            Change24h = change24h,
            Change1m = 0,
            Change5m = 0,
            QuoteVolume24h = quoteVolume,
            OiNotional = oiNotional,
            Oi5m = oi5,
            Oi15m = oi15,
            Oi24h = oi24h,
            Oi24hDelta = oi24hDelta,
            Pullback = 0,
            Score = score,
            VolRatio3m = volRatio3m,
            Change3m = change3m,
            LargeSide = largeSide,
            LargeUsdt = largeUsdt,
            LargeMultiple = largeMultiple,
            Change30s = change30s,
            Stage = stage,
            StageLabel = label,
            Focus = false,
            StateLabel = label
        };
    }

    private static (HashSet<string> Focus, HashSet<string> All) LoadWatchlist()
    {
        var focus = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var all = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var path = Path.Combine(AppContext.BaseDirectory, "watchlist.json");
            if (!File.Exists(path)) return (focus, all);
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            if (doc.RootElement.TryGetProperty("focus", out var f) && f.ValueKind == JsonValueKind.Array)
                foreach (var x in f.EnumerateArray())
                    if (x.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(x.GetString()))
                    { var s = x.GetString()!.ToUpperInvariant(); focus.Add(s); all.Add(s); }
            if (doc.RootElement.TryGetProperty("imported", out var im) && im.ValueKind == JsonValueKind.Array)
                foreach (var x in im.EnumerateArray())
                    if (x.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(x.GetString()))
                        all.Add(x.GetString()!.ToUpperInvariant());
        }
        catch { }
        return (focus, all);
    }

    private async Task<object?> FetchFearGreedAsync()
    {
        try
        {
            using var doc = await GetJsonAsync("https://api.alternative.me/fng/?limit=2");
            if (!doc.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array || data.GetArrayLength() == 0)
                return null;
            var today = data[0];
            var value = (int)DStr(today, "value");
            var label = S(today, "value_classification");
            var previous = data.GetArrayLength() > 1 ? (int)DStr(data[1], "value") : value;
            var ts = 0L;
            if (today.TryGetProperty("timestamp", out var tv)) tv.TryGetInt64(out ts);
            var date = ts > 0 ? DateTimeOffset.FromUnixTimeSeconds(ts).ToLocalTime().ToString("MM-dd") : "";
            return new { value, label, previous, date };
        }
        catch { return null; }
    }

    private async Task<object?> FetchSmartAsync(string? symbol, double price)
    {
        if (string.IsNullOrWhiteSpace(symbol)) return null;
        double ReadLast(JsonElement root, string field)
        {
            if (root.ValueKind != JsonValueKind.Array || root.GetArrayLength() == 0) return 0;
            return DStr(root[root.GetArrayLength() - 1], field);
        }

        double topPosLong = 0, topPosShort = 0, topAccLong = 0, topAccShort = 0;
        double globalLong = 0, globalShort = 0, buyVol = 0, sellVol = 0, buySellRatio = 0;
        try
        {
            using var d = await GetJsonAsync($"https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol={symbol}&period=15m&limit=2");
            topPosLong = ReadLast(d.RootElement, "longAccount") * 100;
            topPosShort = ReadLast(d.RootElement, "shortAccount") * 100;
        }
        catch { }
        try
        {
            using var d = await GetJsonAsync($"https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol={symbol}&period=15m&limit=2");
            topAccLong = ReadLast(d.RootElement, "longAccount") * 100;
            topAccShort = ReadLast(d.RootElement, "shortAccount") * 100;
        }
        catch { }
        try
        {
            using var d = await GetJsonAsync($"https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol={symbol}&period=15m&limit=2");
            globalLong = ReadLast(d.RootElement, "longAccount") * 100;
            globalShort = ReadLast(d.RootElement, "shortAccount") * 100;
        }
        catch { }
        try
        {
            using var d = await GetJsonAsync($"https://fapi.binance.com/futures/data/takerlongshortRatio?symbol={symbol}&period=15m&limit=2");
            buyVol = ReadLast(d.RootElement, "buyVol") * price;
            sellVol = ReadLast(d.RootElement, "sellVol") * price;
            buySellRatio = ReadLast(d.RootElement, "buySellRatio");
        }
        catch { }

        return new
        {
            symbol,
            topPosLong,
            topPosShort,
            topAccLong,
            topAccShort,
            globalLong,
            globalShort,
            buyUsdt = buyVol,
            sellUsdt = sellVol,
            buySellRatio
        };
    }

    private async Task PullLiveAsync()
    {
        if (_liveBusy) return;
        _liveBusy = true;
        try
        {
            using var tickerDoc = await GetJsonAsync("https://fapi.binance.com/fapi/v1/ticker/24hr");
            if (_binanceSymbols == null)
            {
                try
                {
                    using var infoDoc = await GetJsonAsync("https://fapi.binance.com/fapi/v1/exchangeInfo");
                    _binanceSymbols = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var s in infoDoc.RootElement.GetProperty("symbols").EnumerateArray())
                    {
                        if (S(s, "contractType") == "PERPETUAL"
                            && S(s, "quoteAsset") == "USDT"
                            && S(s, "status") == "TRADING")
                            _binanceSymbols.Add(S(s, "symbol"));
                    }
                }
                catch { }
            }

            var candidates = new List<(string Symbol, double Price, double Change, double Volume)>();
            foreach (var t in tickerDoc.RootElement.EnumerateArray())
            {
                var symbol = S(t, "symbol");
                if (string.IsNullOrWhiteSpace(symbol) || !symbol.EndsWith("USDT", StringComparison.OrdinalIgnoreCase) || symbol.Contains('_')) continue;
                if (_binanceSymbols != null && !_binanceSymbols.Contains(symbol)) continue;
                var volume = DStr(t, "quoteVolume");
                if (volume <= 0) continue;
                candidates.Add((symbol, DStr(t, "lastPrice"), DStr(t, "priceChangePercent"), volume));
            }

            var watchlist = LoadWatchlist();
            if (watchlist.All.Count > 0)
                candidates = candidates.Where(c => watchlist.All.Contains(c.Symbol)).ToList();
            else
                candidates = candidates.OrderByDescending(c => c.Volume).Take(24).ToList();

            var selected = candidates
                .OrderByDescending(x => watchlist.Focus.Contains(x.Symbol))
                .ThenByDescending(x => x.Volume)
                .Take(400)
                .ToList();

            var focusSymbols = watchlist.Focus.Count > 0
                ? watchlist.Focus
                : new HashSet<string>(candidates.OrderByDescending(x => x.Volume).Take(8).Select(x => x.Symbol), StringComparer.OrdinalIgnoreCase);
            var movers = candidates.OrderByDescending(x => x.Change).Take(3)
                .Concat(candidates.OrderBy(x => x.Change).Take(3));
            var oiSymbols = new HashSet<string>(focusSymbols, StringComparer.OrdinalIgnoreCase);
            foreach (var m in movers) oiSymbols.Add(m.Symbol);
            var selectedSymbols = new HashSet<string>(selected.Select(x => x.Symbol), StringComparer.OrdinalIgnoreCase);
            oiSymbols.IntersectWith(selectedSymbols);

            using var gate = new SemaphoreSlim(6);
            var tasks = oiSymbols.Select(async symbol =>
            {
                var t = selected.First(x => x.Symbol == symbol);
                await gate.WaitAsync();
                try { return await FetchBinanceRowAsync(t.Symbol, t.Price, t.Change, t.Volume); }
                finally { gate.Release(); }
            }).ToList();

            var fetched = await Task.WhenAll(tasks);
            var oiMap = fetched.Where(r => r != null).Select(r => r!).ToDictionary(r => r.Symbol, StringComparer.OrdinalIgnoreCase);
            var rows = selected.Select(t =>
            {
                if (oiMap.TryGetValue(t.Symbol, out var row))
                {
                    row.Focus = focusSymbols.Contains(t.Symbol);
                    return row;
                }
                var score = Math.Clamp(50 + t.Change * 0.7 + (t.Volume >= 1e8 ? 8 : 4), 0, 100);
                var stage = score >= 72 ? "entry" : score >= 55 ? "watch" : "low";
                var label = stage == "entry" ? "开仓信号" : stage == "watch" ? "重点候选" : "观察";
                return new LiveRow
                {
                    Symbol = t.Symbol,
                    BaseAsset = t.Symbol.Replace("USDT", ""),
                    Price = t.Price,
                    Change24h = t.Change,
                    Change1m = 0,
                    Change5m = 0,
                    QuoteVolume24h = t.Volume,
                    OiNotional = 0,
                    Oi5m = 0,
                    Oi15m = 0,
                    Pullback = 0,
                    Score = score,
                    Stage = stage,
                    StageLabel = label,
                    Focus = focusSymbols.Contains(t.Symbol),
                    StateLabel = label
                };
            }).ToList();

            var fearGreed = await FetchFearGreedAsync();
            var payload = new
            {
                updatedAt = DateTime.Now.ToString("HH:mm:ss"),
                source = "BINANCE USDⓈ-M FUTURES",
                rows,
                fearGreed
            };
            var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LiveCachePath)!);
                await File.WriteAllTextAsync(LiveCachePath, json);
            }
            catch { }
            await _web.ExecuteScriptAsync("window.__MOSS_LIVE=" + json + ";window.dispatchEvent(new Event('moss:live'));");
        }
        catch (Exception ex)
        {
            try { File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "boot.log"), $"[{DateTime.Now:O}] binance: {ex.Message}\r\n"); } catch { }
        }
        finally
        {
            _liveBusy = false;
        }
    }

    private async Task PullLegacyLiveAsync()
    {
        if (_liveBusy) return;
        _liveBusy = true;
        try
        {
            const string url = "http://43.106.19.243:8765/api/specified-anomaly-watch?view=page&initial=1";
            using var response = await _liveHttp.GetAsync(url);
            response.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var root = doc.RootElement;
            if (!root.TryGetProperty("rows", out var rowsElement) || rowsElement.ValueKind != JsonValueKind.Array) return;

            var watched = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (root.TryGetProperty("self_selected_watchlist", out var watchElement) && watchElement.ValueKind == JsonValueKind.Array)
                foreach (var item in watchElement.EnumerateArray())
                    if (item.ValueKind == JsonValueKind.String) watched.Add(item.GetString() ?? "");

            var rows = new List<LiveRow>();
            foreach (var r in rowsElement.EnumerateArray().Take(24))
            {
                var symbol = S(r, "symbol");
                if (string.IsNullOrWhiteSpace(symbol)) continue;
                var oi = 0.0;
                if (r.TryGetProperty("oi_focus_signal", out var oiFocus)) oi = D(oiFocus, "open_interest_notional_usdt");
                if (oi <= 0 && r.TryGetProperty("cross_exchange_positioning", out var cross)
                    && cross.TryGetProperty("exchanges", out var exchanges)
                    && exchanges.TryGetProperty("binance", out var binance))
                    oi = D(binance, "current_oi_notional_usdt");

                var oi5 = D(r, "oi_5m_change_pct");
                var oi15 = 0.0;
                if (r.TryGetProperty("oi_horizon_changes_pct", out var horizon) && horizon.ValueKind == JsonValueKind.Object)
                {
                    if (oi5 == 0) oi5 = D(horizon, "5m");
                    oi15 = D(horizon, "15m");
                }

                var rawStage = S(r, "signal_level").ToLowerInvariant();
                var stage = rawStage is "entry" or "watch" ? rawStage : "low";
                var label = S(r, "state_label");
                var focus = watched.Contains(symbol) || B(r, "user_selected_watch")
                    || (r.TryGetProperty("focus_attention_signal", out var fa) && B(fa, "active"));
                rows.Add(new LiveRow
                {
                    Symbol = symbol,
                    BaseAsset = string.IsNullOrWhiteSpace(S(r, "base_asset")) ? symbol.Replace("USDT", "") : S(r, "base_asset"),
                    Price = D(r, "price"),
                    Change24h = D(r, "change_24h_pct"),
                    Change1m = D(r, "change_1m_pct"),
                    Change5m = D(r, "change_5m_pct"),
                    QuoteVolume24h = D(r, "quote_volume_24h_usdt"),
                    OiNotional = oi,
                    Oi5m = oi5,
                    Oi15m = oi15,
                    Pullback = D(r, "pullback_pct"),
                    Score = D(r, "score"),
                    Stage = stage,
                    StageLabel = label,
                    Focus = focus,
                    StateLabel = S(r, "state_label")
                });
            }

            var payload = new { updatedAt = DateTime.Now.ToString("HH:mm:ss"), rows };
            var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LiveCachePath)!);
                await File.WriteAllTextAsync(LiveCachePath, json);
            }
            catch { }
            await _web.ExecuteScriptAsync("window.__MOSS_LIVE=" + json + ";window.dispatchEvent(new Event('moss:live'));");
        }
        catch (Exception ex)
        {
            try { File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "boot.log"), $"[{DateTime.Now:O}] live: {ex.Message}\r\n"); } catch { }
        }
        finally
        {
            _liveBusy = false;
        }
    }
}




