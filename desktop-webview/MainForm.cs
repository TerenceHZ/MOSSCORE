using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
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
    private DateTime _binanceCooldownUntil = DateTime.MinValue;
    private HashSet<string>? _binanceSymbols;
    private DateTime _lastInjectUtc = DateTime.MinValue;
    private DateTime _lastRecoveryUtc = DateTime.MinValue;
    private System.Threading.Timer? _watchdog;
    private bool _gateBusy;
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
                // 页面内 fetch 也会继承系统代理；Clash 未运行时会连接失败，因此对自家服务器强制直连。
                new CoreWebView2EnvironmentOptions(
                    "--autoplay-policy=no-user-gesture-required " +
                    "--proxy-bypass-list=43.160.232.254;*.sslip.io;*.moss-core.com;localhost;127.0.0.1"));
            await _web.EnsureCoreWebView2Async(env);
            _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            _web.CoreWebView2.Settings.AreDevToolsEnabled = false;
            _web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            _web.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = true;
            _web.CoreWebView2.Settings.IsZoomControlEnabled = true;
            _web.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            _web.CoreWebView2.NavigationCompleted += async (_, _) => {
            try { MaybeRunAcceptance(); } catch { } await Task.Delay(600); await ApplyEntitlementToPageAsync(); };
            TradeConfig.Load();
            StartTransferTimer();

            var log = Path.Combine(AppContext.BaseDirectory, "boot.log");
            _web.CoreWebView2.NavigationStarting += (_, args) =>
            {
                try { File.AppendAllText(log, $"[{DateTime.Now:O}] nav start {args.Uri}\r\n"); } catch { }
            };
            _web.CoreWebView2.NavigationCompleted += (_, args) =>
            {
                try { File.AppendAllText(log, $"[{DateTime.Now:O}] nav done ok={args.IsSuccess} err={args.WebErrorStatus}\r\n"); } catch { }
                try { _web.ZoomFactor = 1.0; } catch { }
                if (args.IsSuccess) _ = BeginActivationGateAsync();
            };
            _web.CoreWebView2.ProcessFailed += (_, args) =>
            {
                try { File.AppendAllText(log, $"[{DateTime.Now:O}] web process failed {args.ProcessFailedKind}\r\n"); } catch { }
                try { _web.BeginInvoke(new Action(() => RecoverWebView("renderer failure"))); } catch { }
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
            var uri = new Uri(page).AbsoluteUri + (demo ? (shortDemo ? "?v=20261104-focus&demo=short#neural" : "?v=20261104-focus&demo=1#neural") : "?v=20261104-focus#neural");
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

    private async Task BeginActivationGateAsync()
    {
        if (_gateBusy) return;
        _gateBusy = true;
        try
        {
            var hasLocal = LicenseService.TryLoad();
            var result = hasLocal
                ? await LicenseService.ValidateAsync()
                : (Ok: false, Error: "本机尚未激活。");
            if (result.Ok)
            {
                await SendActivationState(false, "");
                StartLiveBridge();
                StartEntitlementRefresh();
            }
            else
            {
                await SendActivationState(true, hasLocal ? result.Error : "");
            }
        }
        finally
        {
            _gateBusy = false;
        }
    }

    private async Task SendActivationState(bool show, string error, bool loading = false)
    {
        try
        {
            if (_web.CoreWebView2 == null) return;
            var json = JsonSerializer.Serialize(new { type = "activation-state", show, error, loading });
            _web.CoreWebView2.PostWebMessageAsJson(json);
            await Task.CompletedTask;
        }
        catch (Exception ex)
        {
            try { File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "boot.log"), $"[{DateTime.Now:O}] activation ui: {ex.Message}\r\n"); } catch { }
        }
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            string? raw = null;
            try { raw = e.TryGetWebMessageAsString(); } catch { /* 对象消息会抛异常，走下面的 JSON 分支 */ }
            if (string.IsNullOrWhiteSpace(raw)) raw = e.WebMessageAsJson;

            // 页面可能发对象，也可能发 JSON 字符串，这里统一解码一次
            if (!string.IsNullOrWhiteSpace(raw) && raw.TrimStart().StartsWith("\""))
            {
                try
                {
                    var inner = JsonSerializer.Deserialize<string>(raw);
                    if (!string.IsNullOrWhiteSpace(inner)) raw = inner;
                }
                catch { }
            }

            // 诊断：把收到的消息类型写日志，便于排查“点了没反应”
            try
            {
                // 只记录 type/action，绝不落盘 Key/Secret
                string tag = "?";
                try
                {
                    using var dd = JsonDocument.Parse(raw ?? "{}");
                    var ty = dd.RootElement.TryGetProperty("type", out var t0) ? t0.GetString() : "";
                    var ac = dd.RootElement.TryGetProperty("action", out var a0) ? a0.GetString() : "";
                    tag = (ty ?? "") + (string.IsNullOrEmpty(ac) ? "" : "/" + ac);
                }
                catch { }
                File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "msg.log"),
                    $"[{DateTime.Now:HH:mm:ss}] {tag}\r\n");
            }
            catch { }

            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return;
            var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
            if (type == "quit")
            {
                BeginInvoke(new Action(Close));
                return;
            }
            if (type == "activate")
            {
                var code = root.TryGetProperty("code", out var c) ? c.GetString() ?? "" : "";
                _ = HandleActivationAsync(code);
            }
            if (type == "uitest_report")
            {
                try
                {
                    var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MossCore");
                    Directory.CreateDirectory(dir);
                    var okAll = true;
                    if (root.TryGetProperty("log", out var lg) && lg.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var it in lg.EnumerateArray())
                            if (it.TryGetProperty("ok", out var okEl) && okEl.ValueKind == JsonValueKind.False) okAll = false;
                    }
                    var report = new { ok = okAll, mode = "ui", finishedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"), steps = root.GetProperty("log") };
                    File.WriteAllText(Path.Combine(dir, "autotest-report.json"),
                        JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
                }
                catch { }
            }
            if (type == "trade") _ = HandleTradeAsync(root);
            if (type == "tradeConfig") _ = HandleTradeConfigAsync(root);
        }
        catch (Exception ex)
        {
            try
            {
                File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "msg.log"),
                    $"[{DateTime.Now:HH:mm:ss}] ERROR {ex.Message}\r\n");
            }
            catch { }
        }
    }

    private async void PostToWeb(object payload)
    {
        try
        {
            if (_web.CoreWebView2 == null) return;
            var json = JsonSerializer.Serialize(payload);
            await _web.CoreWebView2.ExecuteScriptAsync(
                $"window.dispatchEvent(new CustomEvent('moss:trade',{{detail:{json}}}));");
        }
        catch { }
    }


    // ================= 自动验收（由 %LOCALAPPDATA%\MossCore\autotest.flag 触发）=================
    private async Task RunAcceptanceSuiteAsync()
    {
        var rep = new System.Collections.Generic.List<object>();
        var okAll = true;
        void Add(string phase, bool ok, string msg)
        {
            rep.Add(new { phase, ok, msg, ts = DateTime.Now.ToString("HH:mm:ss") });
            if (!ok) okAll = false;
            BinanceTradeService.WriteLog("accept", new { phase, ok, msg });
        }

        try
        {
            if (!BinanceTradeService.UseTestnet) { Add("guard", false, "未开启测试网，拒绝执行"); throw new InvalidOperationException("testnet required"); }
            if (!BinanceTradeService.Configured) { Add("guard", false, "未配置 API Key"); throw new InvalidOperationException("no key"); }

            // 清场：平掉所有仓位
            var pos0 = await BinanceTradeService.GetPositionsAsync();
            foreach (var po in pos0)
            {
                var t = po.GetType();
                var sy = t.GetProperty("symbol")?.GetValue(po) as string;
                var am = t.GetProperty("amount")?.GetValue(po);
                if (sy == null || am == null) continue;
                var d = Convert.ToDouble(am);
                await BinanceTradeService.ClosePositionAsync(sy, d > 0 ? "long" : "short");
                await BinanceTradeService.CancelAlgoOrdersAsync(sy);
            }
            await Task.Delay(1500);
            var posClear = await BinanceTradeService.GetPositionsAsync();
            Add("0-清场", posClear.Count == 0, $"剩余持仓 {posClear.Count} 个");

            var bal = await BinanceTradeService.GetBalancesAsync();
            if (!bal.Ok) throw new InvalidOperationException(bal.Message);
            var equity = bal.FuturesEquity;

            // ---------- 阶段 1：手动单 ----------
            var sym1 = "BTCUSDT";
            await BinanceTradeService.CancelAlgoOrdersAsync(sym1);
            var r1 = await BinanceTradeService.PlaceMarketOrderAsync(sym1, "long", equity, 0.05, 5, 15, 15, 1000000);
            Add("1-手动开仓", r1.Ok, r1.Message);

            var amt1 = await BinanceTradeService.GetPositionAmountAsync(sym1);
            Add("1-仓位存在", amt1 > 0, $"{sym1} 数量 {amt1}");

            var orders1 = await BinanceTradeService.ListAlgoOrdersAsync(sym1);
            var hasTp = orders1.Exists(o => o.OrderType == "TAKE_PROFIT_MARKET");
            var hasSl = orders1.Exists(o => o.OrderType == "STOP_MARKET");
            Add("1-止盈止损各一条", orders1.Count == 2 && hasTp && hasSl, $"条件单 {orders1.Count} 条（TP={hasTp}, SL={hasSl}）");

            // 校验触发价相对开仓价约 ±15%
            try
            {
                var price1 = await BinanceTradeService.GetPriceAsync(sym1);
                var tpO = orders1.Find(o => o.OrderType == "TAKE_PROFIT_MARKET");
                var slO = orders1.Find(o => o.OrderType == "STOP_MARKET");
                var tpD = Math.Abs(double.Parse(tpO!.TriggerPrice) / price1 - 1);
                var slD = Math.Abs(double.Parse(slO!.TriggerPrice) / price1 - 1);
                Add("1-止损止盈距离", tpD > 0.10 && tpD < 0.20 && slD > 0.10 && slD < 0.20,
                    $"TP {tpD:P1} / SL {slD:P1}（应约 15%）");
            }
            catch (Exception ex) { Add("1-距离校验", false, ex.Message); }

            // ---------- 阶段 2：自动开满 5 单 ----------
            var pool = new[] { "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "BNBUSDT", "ADAUSDT", "LINKUSDT", "AVAXUSDT" };
            var want = 5;
            foreach (var cand in pool)
            {
                var posNow = await BinanceTradeService.GetPositionsAsync();
                if (posNow.Count >= want) break;
                if (await BinanceTradeService.GetPositionAmountAsync(cand) > 0) continue;
                await BinanceTradeService.CancelAlgoOrdersAsync(cand);
                var rr = await BinanceTradeService.PlaceMarketOrderAsync(cand, "long", equity, 0.05, 5, 15, 15, 1000000);
                var oo = await BinanceTradeService.ListAlgoOrdersAsync(cand);
                var tpOk = oo.Exists(o => o.OrderType == "TAKE_PROFIT_MARKET");
                var slOk = oo.Exists(o => o.OrderType == "STOP_MARKET");
                Add("2-自动开仓 " + cand, rr.Ok && oo.Count == 2 && tpOk && slOk,
                    rr.Ok ? $"条件单 {oo.Count} 条（TP={tpOk}, SL={slOk}）" : rr.Message);
                if (rr.Ok) await Task.Delay(800);
            }

            var pos5 = await BinanceTradeService.GetPositionsAsync();
            Add("2-达到 5 单", pos5.Count >= 5, $"当前 {pos5.Count} 个持仓");

            // ---------- 阶段 3：把每个仓位的止损止盈贴到 ±0.05%，等触发 ----------
            var syms = new System.Collections.Generic.List<(string sym, double amt)>();
            foreach (var po in pos5)
            {
                var t = po.GetType();
                var sy = t.GetProperty("symbol")?.GetValue(po) as string;
                var am = t.GetProperty("amount")?.GetValue(po);
                if (sy != null && am != null) syms.Add((sy, Convert.ToDouble(am)));
            }

            foreach (var item in syms)
            {
                var placed = false;
                var lastErr = "";
                // 依次尝试越来越宽的价差
                var bands = new[] { 0.0002, 0.0004, 0.0008, 0.0015 };
                var usedBand = 0.0;
                foreach (var band in bands)
                {
                    await BinanceTradeService.CancelAlgoOrdersAsync(item.sym);
                    var qty = Math.Abs(item.amt).ToString("0.############################", System.Globalization.CultureInfo.InvariantCulture);
                    var closeSide = item.amt > 0 ? "SELL" : "BUY";

                    // 先挂止损（保护腿）
                    var p1 = await BinanceTradeService.GetPriceAsync(item.sym);
                    if (p1 <= 0) { lastErr = "价格无效"; break; }
                    var slPrice = item.amt > 0 ? p1 * (1 - band) : p1 * (1 + band);
                    var slText = await BinanceTradeService.FormatPriceAsync(item.sym, (decimal)slPrice);
                    var okSl = false;
                    try { await BinanceTradeService.PlaceConditionalForTestAsync(item.sym, closeSide, "STOP_MARKET", slText, qty); okSl = true; }
                    catch (Exception ex) { lastErr = "止损:" + ex.Message; }

                    // 再挂止盈（重新取价，且比止损略宽，避免撞价）
                    var p2 = await BinanceTradeService.GetPriceAsync(item.sym);
                    if (p2 <= 0) { lastErr = "价格无效"; break; }
                    var tpPrice = item.amt > 0 ? p2 * (1 + band * 1.5) : p2 * (1 - band * 1.5);
                    var tpText = await BinanceTradeService.FormatPriceAsync(item.sym, (decimal)tpPrice);
                    var okTp = false;
                    try { await BinanceTradeService.PlaceConditionalForTestAsync(item.sym, closeSide, "TAKE_PROFIT_MARKET", tpText, qty); okTp = true; }
                    catch (Exception ex) { lastErr = "止盈:" + ex.Message; }

                    if (okSl && okTp)
                    {
                        placed = true;
                        usedBand = band;
                        Add("3-" + item.sym + "-挂单", true,
                            $"价差 {band * 100:0.##}%｜止损 {slText}｜止盈 {tpText}");
                        break;
                    }
                    await BinanceTradeService.CancelAlgoOrdersAsync(item.sym);
                }
                if (!placed)
                {
                    Add("3-" + item.sym + "-挂单", false, "所有价差都被拒绝：" + lastErr);
                    continue;
                }

                var closed = false; var waited = 0;
                var waitMs = usedBand <= 0.0004 ? 300000 : 480000;
                while (waited < waitMs)
                {
                    await Task.Delay(4000);
                    waited += 4000;
                    if (await BinanceTradeService.GetPositionAmountAsync(item.sym) <= 0) { closed = true; break; }
                }
                var nowPrice = await BinanceTradeService.GetPriceAsync(item.sym);
                Add("3-" + item.sym + "-触发", closed,
                    closed ? $"{waited / 1000} 秒内被触发平仓" : $"{waited / 1000} 秒未触发（现价 {nowPrice:F4}）");
                await BinanceTradeService.CancelAlgoOrdersAsync(item.sym);
            }

            // 收尾：把没被触发的仓位强制平掉，保证下一轮从干净状态开始
            var leftover = await BinanceTradeService.GetPositionsAsync();
            foreach (var po in leftover)
            {
                var t = po.GetType();
                var sy = t.GetProperty("symbol")?.GetValue(po) as string;
                var am = t.GetProperty("amount")?.GetValue(po);
                if (sy == null || am == null) continue;
                var d = Convert.ToDouble(am);
                await BinanceTradeService.ClosePositionAsync(sy, d > 0 ? "long" : "short");
                await BinanceTradeService.CancelAlgoOrdersAsync(sy);
            }

            var endPos = await BinanceTradeService.GetPositionsAsync();
            Add("4-收尾", endPos.Count == 0, $"剩余持仓 {endPos.Count} 个（触发测试应全部平掉）");
        }
        catch (Exception ex)
        {
            Add("fatal", false, ex.Message);
        }

        try
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MossCore");
            Directory.CreateDirectory(dir);
            var json = JsonSerializer.Serialize(new { ok = okAll, finishedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"), steps = rep },
                new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
            File.WriteAllText(Path.Combine(dir, "autotest-report.json"), json);
        }
        catch { }
    }

    private void MaybeRunAcceptance()
    {
        try
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MossCore");
            var flag = Path.Combine(dir, "autotest.flag");
            if (!File.Exists(flag)) return;
            File.Delete(flag);
            // 走客户端真实 UI 路径（页面里点按钮/走自动分支）
            // 必须在 UI 线程里访问 CoreWebView2
            var t = new System.Windows.Forms.Timer { Interval = 4000 };
            t.Tick += async (_, _) =>
            {
                t.Stop(); t.Dispose();
                try
                {
                    if (_web.CoreWebView2 == null) return;
                    await _web.CoreWebView2.ExecuteScriptAsync("window.__MOSS_UITEST && window.__MOSS_UITEST(); true");
                }
                catch (Exception ex)
                {
                    try { File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "msg.log"), "[uitest] " + ex.Message + Environment.NewLine); } catch { }
                }
            };
            t.Start();
        }
        catch { }
    }

    private async Task HandleTradeConfigAsync(JsonElement root)
    {
        if (!LicenseService.TradeEnabled)
        {
            PostToWeb(new { type = "config", ok = false, message = "未授权：自动下单功能未开通", entitled = false, preview = false });
            return;
        }
        try
        {
            var action = root.TryGetProperty("action", out var a) ? a.GetString() : "";
            if (action == "mode")
            {
                var mode = root.TryGetProperty("mode", out var m) ? m.GetString() ?? "manual" : "manual";
                var auto = mode == "auto";
                // 只切换“自动/手动”，不改“真实下单总开关”
                TradeConfig.Current.AutoMode = auto;
                TradeConfig.Save();
                PostToWeb(new { type = "config", ok = true, message = auto ? "已切换为自动下单" : "已切换为手动下单", autoTrade = TradeConfig.Current.AutoTrade, autoMode = auto, entitled = LicenseService.TradeEnabled, preview = false, configured = BinanceTradeService.Configured });
                return;
            }
            if (action == "test")
            {
                var tk = root.TryGetProperty("apiKey", out var k1) ? k1.GetString() ?? "" : "";
                var ts = root.TryGetProperty("apiSecret", out var s1) ? s1.GetString() ?? "" : "";
                var wantTest = root.TryGetProperty("useTestnet", out var ut) && ut.ValueKind == JsonValueKind.True;
                var prevKey = BinanceTradeService.ApiKey;
                var prevSecret = BinanceTradeService.ApiSecret;
                var prevTest = BinanceTradeService.UseTestnet;
                BinanceTradeService.SetKeys(tk, ts);
                BinanceTradeService.UseTestnet = wantTest;
                var bal = await BinanceTradeService.GetBalancesAsync();
                BinanceTradeService.SetKeys(prevKey ?? "", prevSecret ?? "");
                BinanceTradeService.UseTestnet = prevTest;
                await _web.CoreWebView2.ExecuteScriptAsync(
                    $"window.dispatchEvent(new CustomEvent('moss:binance',{{detail:{System.Text.Json.JsonSerializer.Serialize(new { type = "test", ok = bal.Ok, message = bal.Message, equity = bal.FuturesEquity })}}}));");
                return;
            }
            if (action == "save")
            {
                var key = root.TryGetProperty("apiKey", out var k) ? k.GetString() ?? "" : "";
                var secret = root.TryGetProperty("apiSecret", out var sec) ? sec.GetString() ?? "" : "";
                var auto = root.TryGetProperty("autoTrade", out var au) && au.ValueKind == JsonValueKind.True;
                var useTestnet = root.TryGetProperty("useTestnet", out var utv) && utv.ValueKind == JsonValueKind.True;
                var autoTransfer = root.TryGetProperty("autoTransfer", out var atv) && atv.ValueKind == JsonValueKind.True;
                TradeConfig.Current.ApiKey = key;
                TradeConfig.Current.ApiSecret = secret;
                TradeConfig.Current.AutoTrade = true;   // “保存并启用”＝打开真实下单总开关
                TradeConfig.Current.AutoMode = auto;
                TradeConfig.Current.UseTestnet = useTestnet;
                TradeConfig.Current.AutoTransfer = autoTransfer;
                if (root.TryGetProperty("maxNotional", out var mn) && mn.TryGetDouble(out var mnv) && mnv > 0)
                    TradeConfig.Current.MaxNotional = mnv;
                TradeConfig.Save();
                var bal2 = await BinanceTradeService.GetBalancesAsync();
                if (bal2.Ok) TradeConfig.EnsureBaseline(bal2.FuturesEquity);
                PostToWeb(new { type = "config", ok = true, message = "密钥已加密保存到本机", entitled = LicenseService.TradeEnabled, preview = false, configured = BinanceTradeService.Configured, equity = bal2.FuturesEquity });
                return;
            }
            if (action == "status")
            {
                var bal = await BinanceTradeService.GetBalancesAsync();
                if (bal.Ok) TradeConfig.EnsureBaseline(bal.FuturesEquity);
                var positions = bal.Ok ? await BinanceTradeService.GetPositionsAsync() : new System.Collections.Generic.List<object>();
                PostToWeb(new
                {
                    type = "account",
                    entitled = LicenseService.TradeEnabled,
                    preview = false,
                    ok = bal.Ok,
                    message = bal.Message,
                    equity = bal.FuturesEquity,
                    available = bal.AvailableBalance,
                    spot = bal.SpotFree,
                    baseline = TradeConfig.Current.BaselineEquity,
                    positions,
                    configured = BinanceTradeService.Configured,
                    autoTrade = TradeConfig.Current.AutoTrade,
                    autoMode = TradeConfig.Current.AutoMode,
                    useTestnet = TradeConfig.Current.UseTestnet,
                    autoTransfer = TradeConfig.Current.AutoTransfer
                });
                return;
            }
            if (action == "selftest")
            {
                // 自检按“当前表单里填的值”跑，不要求先保存
                var sk = root.TryGetProperty("apiKey", out var kk) ? kk.GetString() ?? "" : "";
                var ss = root.TryGetProperty("apiSecret", out var vv) ? vv.GetString() ?? "" : "";
                var st = root.TryGetProperty("useTestnet", out var tt) && tt.ValueKind == JsonValueKind.True;
                var prevKey = BinanceTradeService.ApiKey;
                var prevSecret = BinanceTradeService.ApiSecret;
                var prevTest = BinanceTradeService.UseTestnet;
                if (!string.IsNullOrWhiteSpace(sk)) BinanceTradeService.SetKeys(sk, ss);
                BinanceTradeService.UseTestnet = st;

                var checks = new System.Collections.Generic.List<object>();
                bool pingOk = false; string pingMsg = "";
                try
                {
                    using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
                    var baseUrl = BinanceTradeService.UseTestnet ? "https://testnet.binancefuture.com" : "https://fapi.binance.com";
                    var sw = System.Diagnostics.Stopwatch.StartNew();
                    var pr = await http.GetAsync(baseUrl + "/fapi/v1/time");
                    sw.Stop();
                    pingOk = pr.IsSuccessStatusCode;
                    pingMsg = $"{(BinanceTradeService.UseTestnet ? "测试网" : "主网")} HTTP {(int)pr.StatusCode}，{sw.ElapsedMilliseconds}ms";
                }
                catch (Exception ex) { pingMsg = ex.Message; }
                checks.Add(new { name = "网络连通", ok = pingOk, msg = pingMsg });
                checks.Add(new { name = "API 密钥", ok = BinanceTradeService.Configured, msg = BinanceTradeService.Configured ? "已配置（本次填写）" : "未填写" });
                checks.Add(new { name = "运行环境", ok = true, msg = (BinanceTradeService.UseTestnet ? "测试网（模拟盘）" : "主网（真实资金）") + " · " + BinanceTradeService.CurrentHost });

                var bal = await BinanceTradeService.GetBalancesAsync();
                var balMsg = bal.Ok ? $"权益 {bal.FuturesEquity:F2} USDT / 可用 {bal.AvailableBalance:F2}" : bal.Message;
                if (!bal.Ok && !BinanceTradeService.UseTestnet && balMsg.Contains("-2015"))
                    balMsg += "（像是测试网 Key 用在了主网，请勾选「测试网」再试）";
                checks.Add(new { name = "合约账户", ok = bal.Ok, msg = balMsg });

                System.Collections.Generic.List<object> pos = new();
                if (bal.Ok)
                {
                    try { pos = await BinanceTradeService.GetPositionsAsync(); } catch { }
                }
                checks.Add(new { name = "读取持仓", ok = bal.Ok, msg = bal.Ok ? $"当前 {pos.Count} 个持仓（上限 5）" : "账户不可用" });

                var maxNotional = BinanceTradeService.UseTestnet ? 1000000 : TradeConfig.Current.MaxNotional;
                var margin = bal.FuturesEquity * 0.05;
                var estNotional = margin * 5;
                checks.Add(new
                {
                    name = "单笔仓位测算",
                    ok = estNotional > 0 && (maxNotional <= 0 || estNotional <= maxNotional),
                    msg = $"保证金 {margin:F2} × 5x = 名义 {estNotional:F2} USDT（上限 {maxNotional:F0}）"
                });
                checks.Add(new { name = "授权状态", ok = LicenseService.TradeEnabled, msg = LicenseService.TradeEnabled ? "已开通自动下单" : "未开通" });

                BinanceTradeService.WriteLog("selftest", new { testnet = BinanceTradeService.UseTestnet, ok = bal.Ok });

                // 还原（自检不应该改变真实配置）
                BinanceTradeService.SetKeys(prevKey ?? "", prevSecret ?? "");
                BinanceTradeService.UseTestnet = prevTest;
                var payload = new { type = "selftest", ok = pingOk && bal.Ok, checks };
                await _web.CoreWebView2.ExecuteScriptAsync(
                    $"window.dispatchEvent(new CustomEvent('moss:binance',{{detail:{System.Text.Json.JsonSerializer.Serialize(payload)}}}));");
                return;
            }
            if (action == "cleanup")
            {
                var sym = root.TryGetProperty("symbol", out var sy) ? (sy.GetString() ?? "BTCUSDT") : "BTCUSDT";
                var n = await BinanceTradeService.CancelAlgoOrdersAsync(sym);
                var payloadC = new { type = "cleanup", ok = true, symbol = sym, cancelled = n };
                await _web.CoreWebView2.ExecuteScriptAsync(
                    $"window.dispatchEvent(new CustomEvent('moss:binance',{{detail:{System.Text.Json.JsonSerializer.Serialize(payloadC)}}}));");
                return;
            }
            if (action == "tptest")
            {
                var steps = new System.Collections.Generic.List<object>();
                try
                {
                    var want = root.TryGetProperty("symbol", out var sy) ? (sy.GetString() ?? "") : "";

                    // 读取现有持仓，挑一个来测（不改别人仓位）
                    var open = new System.Collections.Generic.List<(string sym, double amt)>();
                    try
                    {
                        var pr = await BinanceTradeService.GetPositionsAsync();
                        foreach (var o in pr)
                        {
                            var t = o.GetType();
                            var symV = t.GetProperty("symbol")?.GetValue(o) as string;
                            var amtV = t.GetProperty("amount")?.GetValue(o);
                            if (symV == null || amtV == null) continue;
                            var d = Convert.ToDouble(amtV);
                            if (Math.Abs(d) > 0) open.Add((symV, d));
                        }
                    }
                    catch (Exception ex) { steps.Add(new { name = "读取持仓", ok = false, msg = ex.Message }); }

                    (string sym, double amt) target;
                    if (!string.IsNullOrEmpty(want))
                    {
                        var found = open.Find(x => x.sym.Equals(want, StringComparison.OrdinalIgnoreCase));
                        if (found.sym == null) throw new InvalidOperationException(want + " 当前没有持仓");
                        target = found;
                    }
                    else
                    {
                        if (open.Count == 0) throw new InvalidOperationException("当前没有任何持仓，先用冒烟测试或手动建仓开一个");
                        target = open[0];
                    }

                    var sym = target.sym;
                    var amt = Math.Abs(target.amt);
                    var isLong = target.amt > 0;
                    var qtyText = amt.ToString("0.############################", System.Globalization.CultureInfo.InvariantCulture);
                    var closeSide = isLong ? "SELL" : "BUY";
                    steps.Add(new { name = "目标仓位", ok = true, msg = $"{sym} {(isLong ? "多" : "空")} {qtyText}" });

                    var price = await BinanceTradeService.GetPriceAsync(sym);
                    if (price <= 0) throw new InvalidOperationException("价格无效");

                    // 撤掉旧的条件单，挂一对离现价 0.1% 的
                    var cancelled = await BinanceTradeService.CancelAlgoOrdersAsync(sym);
                    steps.Add(new { name = "撤销旧委托", ok = true, msg = $"撤掉 {cancelled} 条" });

                    var up = price * (1 + 0.0005);
                    var dn = price * (1 - 0.0005);
                    var tpPrice = isLong ? up : dn;
                    var slPrice = isLong ? dn : up;

                    var okTp = false; var okSl = false;
                    try
                    {
                        var tpv = await BinanceTradeService.FormatPriceAsync(sym, (decimal)tpPrice);
                        await BinanceTradeService.PlaceConditionalForTestAsync(sym, closeSide, "TAKE_PROFIT_MARKET", tpv, qtyText);
                        okTp = true;
                    }
                    catch (Exception ex) { steps.Add(new { name = "挂止盈失败", ok = false, msg = ex.Message }); }

                    try
                    {
                        var slv = await BinanceTradeService.FormatPriceAsync(sym, (decimal)slPrice);
                        await BinanceTradeService.PlaceConditionalForTestAsync(sym, closeSide, "STOP_MARKET", slv, qtyText);
                        okSl = true;
                    }
                    catch (Exception ex) { steps.Add(new { name = "挂止损失败", ok = false, msg = ex.Message }); }

                    steps.Add(new { name = "挂近距离条件单", ok = okTp && okSl,
                        msg = $"现价 {price:F4}｜止盈 {tpPrice:F4}｜止损 {slPrice:F4}（距现价 0.05%）" });

                    // 立刻回传一次，让界面显示"已挂上、正在等触发"
                    try
                    {
                        var prog = new { type = "tptest_progress", symbol = sym, entry = price,
                            tp = tpPrice, sl = slPrice, qty = qtyText };
                        await _web.CoreWebView2.ExecuteScriptAsync(
                            $"window.dispatchEvent(new CustomEvent('moss:binance',{{detail:{System.Text.Json.JsonSerializer.Serialize(prog)}}}));");
                    }
                    catch { }

                    // 等触发：最多 100 秒
                    var closed = false; var waited = 0;
                    while (waited < 180000)
                    {
                        await Task.Delay(4000);
                        waited += 4000;
                        if (await BinanceTradeService.GetPositionAmountAsync(sym) <= 0) { closed = true; break; }
                    }

                    var last = await BinanceTradeService.GetPriceAsync(sym);
                    if (closed)
                    {
                        var hitTp = isLong ? last >= tpPrice : last <= tpPrice;
                        steps.Add(new { name = "已触发", ok = true,
                            msg = hitTp ? $"止盈被打掉（价格 {last:F4}），仓位已平" : $"止损被打掉（价格 {last:F4}），仓位已平" });
                    }
                    else
                    {
                        steps.Add(new { name = "等待超时", ok = false, msg = $"180 秒内价格没走 0.05%（现价 {last:F4}），可再点一次" });
                    }

                    var left = await BinanceTradeService.CancelAlgoOrdersAsync(sym);
                    if (left > 0) steps.Add(new { name = "清理剩余", ok = true, msg = $"撤掉 {left} 条" });
                }
                catch (Exception ex)
                {
                    steps.Add(new { name = "中断", ok = false, msg = ex.Message });
                }
                BinanceTradeService.WriteLog("tptest", new { steps = steps.Count });
                var payloadT = new { type = "tptest", ok = true, steps };
                await _web.CoreWebView2.ExecuteScriptAsync(
                    $"window.dispatchEvent(new CustomEvent('moss:binance',{{detail:{System.Text.Json.JsonSerializer.Serialize(payloadT)}}}));");
                return;
            }
            if (action == "smoke")
            {
                var steps = new System.Collections.Generic.List<object>();
                var sym = "BTCUSDT";
                try
                {
                    var bal0 = await BinanceTradeService.GetBalancesAsync();
                    steps.Add(new { name = "读取账户", ok = bal0.Ok, msg = bal0.Ok ? $"权益 {bal0.FuturesEquity:F2} USDT" : bal0.Message });
                    if (!bal0.Ok) throw new InvalidOperationException("账户不可用，先修账户问题");

                    var price0 = await BinanceTradeService.GetPriceAsync(sym);
                    steps.Add(new { name = "读取价格", ok = price0 > 0, msg = $"{sym} = {price0}" });

                    var res = await BinanceTradeService.PlaceMarketOrderAsync(
                        sym, "long", bal0.FuturesEquity, 0.02, 5, 2, 2, 0);
                    steps.Add(new { name = "开仓 + 止盈止损", ok = res.Ok, msg = res.Message + (res.Ok ? $" 数量 {res.Qty}" : "") });

                    var pos = await BinanceTradeService.GetPositionsAsync();
                    steps.Add(new { name = "查询持仓", ok = pos.Count > 0, msg = $"当前 {pos.Count} 个持仓" });

                    var closed = await BinanceTradeService.ClosePositionAsync(sym, "long");
                    steps.Add(new { name = "平仓回滚", ok = closed.Ok, msg = closed.Message });

                    var pos2 = await BinanceTradeService.GetPositionsAsync();
                    steps.Add(new { name = "确认已平", ok = pos2.Count == 0, msg = $"剩余 {pos2.Count} 个持仓" });
                }
                catch (Exception ex)
                {
                    steps.Add(new { name = "中断", ok = false, msg = ex.Message });
                }
                BinanceTradeService.WriteLog("smoke", new { testnet = BinanceTradeService.UseTestnet, steps = steps.Count });
                var payloadSmoke = new { type = "smoke", ok = true, symbol = sym, steps };
                await _web.CoreWebView2.ExecuteScriptAsync(
                    $"window.dispatchEvent(new CustomEvent('moss:binance',{{detail:{System.Text.Json.JsonSerializer.Serialize(payloadSmoke)}}}));");
                return;
            }
            if (action == "symbols")
            {
                var list = await BinanceTradeService.ListSymbolsAsync();
                BinanceTradeService.WriteLog("symbols", new { testnet = BinanceTradeService.UseTestnet, count = list.Count });
                var p2 = new { type = "symbols", testnet = BinanceTradeService.UseTestnet, list };
                await _web.CoreWebView2.ExecuteScriptAsync(
                    $"window.dispatchEvent(new CustomEvent('moss:binance',{{detail:{System.Text.Json.JsonSerializer.Serialize(p2)}}}));");
                return;
            }
            if (action == "transfer")
            {
                var bal = await BinanceTradeService.GetBalancesAsync();
                var res = await RunTransferAsync(bal.FuturesEquity, bal.Ok);
                PostToWeb(new { type = "transfer", ok = res.Ok, message = res.Message });
                return;
            }
        }
        catch (Exception ex)
        {
            PostToWeb(new { type = "error", message = ex.Message });
        }
    }

    private async Task HandleTradeAsync(JsonElement root)
    {
        if (!LicenseService.TradeEnabled)
        {
            PostToWeb(new { type = "order", ok = false, message = "未授权：自动下单功能未开通" });
            return;
        }
        try
        {
            var action = root.TryGetProperty("action", out var a) ? a.GetString() : "";
            if (action != "market") return;
            if (!TradeConfig.Current.AutoTrade)
            {
                PostToWeb(new { type = "order", ok = false, message = "真实下单未开启，请在设置里启用" });
                return;
            }
            var symbol = root.TryGetProperty("symbol", out var s1) ? s1.GetString() ?? "" : "";
            var side = root.TryGetProperty("side", out var s2) ? s2.GetString() ?? "long" : "long";
            var bal = await BinanceTradeService.GetBalancesAsync();
            if (!bal.Ok)
            {
                PostToWeb(new { type = "order", ok = false, message = bal.Message });
                return;
            }
            TradeConfig.EnsureBaseline(bal.FuturesEquity);
            var positions = await BinanceTradeService.GetPositionsAsync();
            if (positions.Count >= 5)
            {
                PostToWeb(new { type = "order", ok = false, message = "已满 5 个持仓，暂停新开仓" });
                return;
            }
            var already = positions.Any(p =>
            {
                var t = p.GetType();
                var sp = t.GetProperty("symbol");
                var v = sp?.GetValue(p) as string;
                return string.Equals(v, symbol, StringComparison.OrdinalIgnoreCase);
            });
            if (already)
            {
                BinanceTradeService.WriteLog("skip_duplicate", new { symbol });
                PostToWeb(new { type = "order", ok = false, message = $"已持有 {symbol}，不重复开仓" });
                return;
            }
            var result = await BinanceTradeService.PlaceMarketOrderAsync(
                symbol, side, bal.FuturesEquity, 0.05, 5, 15, 15,
                BinanceTradeService.UseTestnet ? 1000000 : TradeConfig.Current.MaxNotional);
            PostToWeb(new { type = "order", ok = result.Ok, message = result.Message, symbol, qty = result.Qty });
        }
        catch (Exception ex)
        {
            PostToWeb(new { type = "order", ok = false, message = ex.Message });
        }
    }

    private static async Task<(bool Ok, string Message)> RunTransferAsync(double equity, bool hasBalance)
    {
        try
        {
            if (!hasBalance) return (false, "无法读取合约权益");
            var baseline = TradeConfig.Current.BaselineEquity;
            if (baseline <= 0) return (false, "尚未记录初始权益");
            if (equity <= baseline) return (false, "当前未超过初始权益，无需划转");
            if (equity <= baseline * 1.10) return (false, "未达到 10% 盈利线");
            // 只划走超出部分，但始终保留当前权益的 50% 作为保证金缓冲，避免划穿保证金
            var keep = Math.Max(baseline, equity * 0.5);
            var amount = Math.Round(equity - keep, 2);
            if (amount < 1) return (false, "超出部分不足以划转（需保留 50% 权益作保证金缓冲）");
            return await BinanceTradeService.TransferToSpotAsync(amount);
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    private System.Threading.Timer? _transferTimer;

    private void StartTransferTimer()
    {
        _transferTimer ??= new System.Threading.Timer(async _ =>
        {
            try
            {
                if (!BinanceTradeService.Configured) return;
                if (!TradeConfig.Current.AutoTrade || !TradeConfig.Current.AutoTransfer) return;
                var bal = await BinanceTradeService.GetBalancesAsync();
                if (!bal.Ok) return;
                var res = await RunTransferAsync(bal.FuturesEquity, true);
                PostToWeb(new { type = "transfer", auto = true, ok = res.Ok, message = res.Message });
            }
            catch { }
        }, null, TimeSpan.FromMinutes(2), TimeSpan.FromHours(2));
    }

    private async Task HandleActivationAsync(string code)
    {
        if (_gateBusy) return;
        _gateBusy = true;
        try
        {
            await SendActivationState(true, "", true);
            var result = await LicenseService.ActivateAsync(code);
            if (result.Ok)
            {
                await SendActivationState(false, "");
                StartLiveBridge();
            }
            else
            {
                await SendActivationState(true, result.Error);
            }
        }
        finally
        {
            _gateBusy = false;
        }
    }

    private System.Windows.Forms.Timer? _entTimer;

    // 每 5 分钟向服务端确认一次功能授权（自动下单等），断了就降级
        private async Task ApplyEntitlementToPageAsync()
        {
            try
            {
                if (_web.CoreWebView2 == null) return;
                bool on = LicenseService.TradeEnabled;
                string flag = on ? "true" : "false";
                string script = @"
(() => {
  const deep = (id) => {
    const walk = (root) => {
      try {
        if (root.getElementById) { const el = root.getElementById(id); if (el) return el; }
        const el2 = root.querySelector ? root.querySelector('#' + id) : null;
        if (el2) return el2;
        const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
        for (const h of all) { if (h.shadowRoot) { const r = walk(h.shadowRoot); if (r) return r; } }
      } catch (e) {}
      return null;
    };
    return walk(document);
  };
  const setup = deep('nvBinanceSetup');
  const key = deep('nvBsKey');
  const sec = deep('nvBsSecret');
  const test = deep('nvBsTest');
  const save = deep('nvBsSave');
        const selfTest = deep('nvBsSelfTest');
  const lock = deep('nvBsLockPage');
  const note = deep('nvBsNote') || (setup && setup.querySelector('.nv-bs-note'));
  const on = FLAG;
  [key, sec].forEach(el => { if (el) { el.disabled = !on; el.readOnly = !on; } });
  [test, save, selfTest].forEach(el => { if (el) el.disabled = !on; });
  if (setup) setup.classList.toggle('locked', !on);
  const rows = setup ? setup.querySelectorAll('.nv-bs-row, .nv-bs-status, .nv-bs-actions, .nv-bs-tip') : [];
  rows.forEach(el => { el.style.display = on ? '' : 'none'; });
  if (lock) lock.style.display = on ? 'none' : 'block';
  if (note) {
    note.textContent = on ? '密钥只保存在本机加密文件，不会上传云端。' : '';
    note.style.display = on ? '' : 'none';
  }
  window.__MOSS_ENTITLED = on;
})();";
                script = script.Replace("FLAG", flag);
                await _web.ExecuteScriptAsync(script);

                PostToWeb(new
                {
                    type = "config",
                    entitled = on,
                    preview = false,
                    configured = BinanceTradeService.Configured,
                    autoTrade = TradeConfig.Current.AutoTrade,
                    autoMode = TradeConfig.Current.AutoMode,
                    useTestnet = TradeConfig.Current.UseTestnet,
                    autoTransfer = TradeConfig.Current.AutoTransfer
                });
            }
            catch { }
        }
    private void StartEntitlementRefresh()
    {
        if (_entTimer != null) return;
        _entTimer = new System.Windows.Forms.Timer { Interval = 5 * 60 * 1000 };
        _entTimer.Tick += async (_, _) =>
        {
            try
            {
                await LicenseService.ValidateAsync();
                await ApplyEntitlementToPageAsync();
                PostToWeb(new
                {
                    type = "config",
                    entitled = LicenseService.TradeEnabled,
                    preview = false,
                    configured = BinanceTradeService.Configured,
                    autoTrade = TradeConfig.Current.AutoTrade,
                    autoMode = TradeConfig.Current.AutoMode,
                    useTestnet = TradeConfig.Current.UseTestnet,
                    autoTransfer = TradeConfig.Current.AutoTransfer
                });
            }
            catch { }
        };
        _entTimer.Start();
        _ = ApplyEntitlementToPageAsync();
        _ = Task.Run(async () => { await Task.Delay(3000); await ApplyEntitlementToPageAsync(); });
}

    private void StartLiveBridge()
    {
        if (_liveTimer == null)
        {
            _liveTimer = new System.Windows.Forms.Timer { Interval = 60000 };
            _liveTimer.Tick += async (_, _) => await PullLiveAsync();
            _liveTimer.Start();
        }
        _watchdog ??= new System.Threading.Timer(_ => WatchdogTick(), null, 30000, 30000);
        _ = ResetZoomAsync();
        _ = LoadCachedLiveAsync();
        _ = PullLiveAsync();
    }

    private void WatchdogTick()
    {
        try
        {
            if (_web.IsDisposed || _web.CoreWebView2 == null) return;
            if (_lastInjectUtc == DateTime.MinValue) return;
            if ((DateTime.UtcNow - _lastInjectUtc).TotalMinutes < 5) return;
            if ((DateTime.UtcNow - _lastRecoveryUtc).TotalMinutes < 5) return;
            _lastRecoveryUtc = DateTime.UtcNow;
            _web.BeginInvoke(new Action(() => RecoverWebView("stale data watchdog")));
        }
        catch { }
    }

    private void RecoverWebView(string reason)
    {
        try
        {
            if (_web.IsDisposed || _web.CoreWebView2 == null) return;
            File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "boot.log"),
                $"[{DateTime.Now:O}] recover webview: {reason}\r\n");
            _lastInjectUtc = DateTime.UtcNow;
            _web.Reload();
        }
        catch (Exception ex)
        {
            try
            {
                File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "boot.log"),
                    $"[{DateTime.Now:O}] recover failed: {ex.Message}\r\n");
            }
            catch { }
        }
    }

    private async Task InjectLiveAsync(string json, string source)
    {
        if (_web.IsDisposed || _web.CoreWebView2 == null) return;
        try
        {
            await _web.ExecuteScriptAsync(
                "window.__MOSS_LIVE=" + json + ";window.dispatchEvent(new Event('moss:live'));window.__MOSS_LAST_APPLY=Date.now();")
                .WaitAsync(TimeSpan.FromSeconds(12));
            _lastInjectUtc = DateTime.UtcNow;
        }
        catch (Exception ex)
        {
            try
            {
                File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "boot.log"),
                    $"[{DateTime.Now:O}] inject {source}: {ex.Message}\r\n");
            }
            catch { }
            RecoverWebView("inject timeout/error");
        }
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
            await InjectLiveAsync(json, "cache");
        }
        catch { }
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

    private static (string Url, string Token)? LoadRemoteSource()
    {
        try
        {
            var path = Path.Combine(AppContext.BaseDirectory, "data-source.json");
            if (!File.Exists(path)) return null;
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;
            if (root.TryGetProperty("mode", out var mode) && mode.GetString() != "remote") return null;
            var url = root.TryGetProperty("url", out var u) ? u.GetString()?.Trim() : null;
            var token = root.TryGetProperty("token", out var t) ? t.GetString()?.Trim() : "";
            if (string.IsNullOrWhiteSpace(url)) return null;
            return (url.TrimEnd('/'), token ?? "");
        }
        catch { return null; }
    }

    private async Task PullRemoteLiveAsync((string Url, string Token) source)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, source.Url + "/snapshot");
        var bearer = LicenseService.LicenseKey;
        if (!string.IsNullOrWhiteSpace(bearer))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        else if (!string.IsNullOrWhiteSpace(source.Token))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", source.Token);
        using var resp = await _liveHttp.SendAsync(req);
        resp.EnsureSuccessStatusCode();
        var json = await resp.Content.ReadAsStringAsync();
        if (string.IsNullOrWhiteSpace(json) || json[0] != '{') throw new InvalidOperationException("invalid remote snapshot");
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LiveCachePath)!);
            await File.WriteAllTextAsync(LiveCachePath, json);
        }
        catch { }
        await InjectLiveAsync(json, "remote");
    }

    private async Task PullLiveAsync()
    {
        if (DateTime.Now < _binanceCooldownUntil) return;
        if (_liveBusy) return;
        _liveBusy = true;
        var remote = LoadRemoteSource();
        if (remote != null)
        {
            try
            {
                await PullRemoteLiveAsync(remote.Value);
                return;
            }
            catch (Exception ex)
            {
                try { File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "boot.log"), $"[{DateTime.Now:O}] remote: {ex.Message}\r\n"); } catch { }
                return;
            }
            finally
            {
                _liveBusy = false;
            }
        }
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
                .Take(520)
                .ToList();

            var focusSymbols = watchlist.Focus.Count > 0
                ? watchlist.Focus
                : new HashSet<string>(candidates.OrderByDescending(x => x.Volume).Take(8).Select(x => x.Symbol), StringComparer.OrdinalIgnoreCase);
            var movers = candidates.OrderByDescending(x => x.Change).Take(3)
                .Concat(candidates.OrderBy(x => x.Change).Take(3));
            var detailFocus = focusSymbols
                .Select(s => candidates.FirstOrDefault(x => x.Symbol == s))
                .Where(x => x.Symbol != null)
                .OrderByDescending(x => x.Volume)
                .Take(12)
                .Select(x => x.Symbol);
            var oiSymbols = new HashSet<string>(detailFocus, StringComparer.OrdinalIgnoreCase);
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
            await InjectLiveAsync(json, "live");
        }
        catch (Exception ex)
        {
            if (ex.Message.Contains("418") || ex.Message.Contains("429"))
                _binanceCooldownUntil = DateTime.Now.AddMinutes(15);
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
            await InjectLiveAsync(json, "live");
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




