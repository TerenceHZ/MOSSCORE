using System;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace MossCore;

internal sealed class ActivationForm : Form
{
    private readonly TextBox _code = new();
    private readonly Button _activate = new();
    private readonly Label _status = new();
    private bool _busy;
    private bool _finished;

    public ActivationForm()
    {
        Text = "MOSS CORE · 激活";
        Width = 520;
        Height = 330;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        BackColor = Color.FromArgb(6, 8, 12);
        ForeColor = Color.FromArgb(235, 228, 210);
        Font = new Font("Microsoft YaHei UI", 9F);

        var accent = Color.FromArgb(232, 160, 32);
        var title = new Label
        {
            Text = "MOSS CORE",
            Left = 30, Top = 24, Width = 440, Height = 32,
            Font = new Font("Microsoft YaHei UI", 20F, FontStyle.Bold),
            ForeColor = accent
        };
        var sub = new Label
        {
            Text = "首次使用请输入邀请码，激活后此电脑才能进入监控界面。",
            Left = 32, Top = 66, Width = 440, Height = 24,
            ForeColor = Color.FromArgb(150, 140, 120)
        };
        var label = new Label
        {
            Text = "邀请码",
            Left = 32, Top = 108, Width = 60, Height = 22,
            ForeColor = Color.FromArgb(190, 178, 155)
        };
        _code.Left = 32; _code.Top = 132; _code.Width = 440; _code.Height = 32;
        _code.Font = new Font("Consolas", 14F);
        _code.BackColor = Color.FromArgb(14, 16, 18);
        _code.ForeColor = Color.FromArgb(245, 240, 228);
        _code.BorderStyle = BorderStyle.FixedSingle;
        _code.CharacterCasing = CharacterCasing.Upper;
        _code.PlaceholderText = "MOSS-XXXX-XXXX-XXXX";
        _code.KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; _ = ActivateAsync(); }
        };

        _activate.Text = "激活";
        _activate.Left = 32; _activate.Top = 180; _activate.Width = 440; _activate.Height = 38;
        _activate.BackColor = Color.FromArgb(232, 160, 32);
        _activate.ForeColor = Color.FromArgb(20, 16, 8);
        _activate.FlatStyle = FlatStyle.Flat;
        _activate.FlatAppearance.BorderSize = 0;
        _activate.Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Bold);
        _activate.Click += async (_, _) => await ActivateAsync();

        _status.Left = 32; _status.Top = 230; _status.Width = 440; _status.Height = 40;
        _status.ForeColor = Color.FromArgb(160, 145, 120);

        var exit = new Button
        {
            Text = "退出",
            Left = 32, Top = 270, Width = 90, Height = 28,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(18, 20, 24),
            ForeColor = Color.FromArgb(170, 160, 140)
        };
        exit.FlatAppearance.BorderColor = Color.FromArgb(60, 55, 45);
        exit.Click += (_, _) => { DialogResult = DialogResult.Cancel; Close(); };

        Controls.AddRange(new Control[] { title, sub, label, _code, _activate, _status, exit });
        AcceptButton = _activate;
        Shown += async (_, _) =>
        {
            if (LicenseService.TryLoad())
            {
                _status.Text = "正在验证本机许可证...";
                var result = await LicenseService.ValidateAsync();
                if (result.Ok)
                {
                    _finished = true;
                    DialogResult = DialogResult.OK;
                    Close();
                    return;
                }
                _status.Text = result.Error;
            }
            _code.Focus();
        };
    }

    private async Task ActivateAsync()
    {
        if (_busy || _finished) return;
        var code = _code.Text.Trim();
        if (code.Length < 8)
        {
            _status.Text = "请输入完整的邀请码。";
            _code.Focus();
            return;
        }
        _busy = true;
        _activate.Enabled = false;
        _code.Enabled = false;
        _status.Text = "正在连接激活服务器...";
        var result = await LicenseService.ActivateAsync(code);
        if (result.Ok)
        {
            _finished = true;
            DialogResult = DialogResult.OK;
            Close();
            return;
        }
        _busy = false;
        _activate.Enabled = true;
        _code.Enabled = true;
        _status.Text = result.Error;
        _code.Focus();
        _code.SelectAll();
    }
}
