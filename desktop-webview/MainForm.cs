using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
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
    private readonly HttpClient _liveHttp = new() { Timeout = TimeSpan.FromSeconds(25) };
    private System.Windows.Forms.Timer? _liveTimer;
    private bool _liveBusy;
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
        public double Pullback { get; set; }
        public double Score { get; set; }
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

            var env = await CoreWebView2Environment.CreateAsync(null, userData);
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

            var uri = new Uri(page).AbsoluteUri + "?v=20261102-snapshot#neural";
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
        _ = LoadCachedLiveAsync();
        _ = PullLiveAsync();
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

    private async Task PullLiveAsync()
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


