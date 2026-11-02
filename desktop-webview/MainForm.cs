using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
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
    private int _savedW;
    private int _savedH;

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

            var uri = new Uri(page).AbsoluteUri + "?v=20261102b#neural";
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
}

