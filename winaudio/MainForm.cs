using System.Diagnostics;
using System.Drawing;

namespace F88TiviAudio;

sealed class MainForm : Form
{
    static readonly Color Green = ColorTranslator.FromHtml("#18745C");
    readonly WsServer _server = new();
    readonly ComboBox _apps = new() { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill };
    readonly Button _refresh = new() { Text = "Làm mới", AutoSize = true };
    readonly Button _toggle = new() { Text = "Bắt đầu", Height = 40, Dock = DockStyle.Fill, BackColor = Green, ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
    readonly ProgressBar _level = new() { Maximum = 100, Dock = DockStyle.Fill, Height = 12 };
    readonly Label _status = new() { AutoSize = true, MaximumSize = new Size(440, 0) };
    readonly System.Windows.Forms.Timer _timer = new() { Interval = 80 };
    ProcessLoopbackCapture? _cap;

    record AppItem(uint Pid, string Name, string Title) { public override string ToString() => $"{Name} — {(Title.Length > 48 ? Title[..48] + "…" : Title)}"; }

    public MainForm()
    {
        Text = "F88Tivi Audio";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        AutoScaleDimensions = new SizeF(96f, 96f);
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoSize = true; AutoSizeMode = AutoSizeMode.GrowAndShrink;
        MinimumSize = new Size(480, 0);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedSingle; MaximizeBox = false;
        Font = new Font("Segoe UI", 9.5f);
        BackColor = Color.White;

        var intro = new Label
        {
            AutoSize = true, MaximumSize = new Size(440, 0),
            Text = "Gửi riêng tiếng của một ứng dụng sang TV. Sau khi bấm Bắt đầu, bạn có thể tắt hoặc hạ loa máy tính xuống 0 mà TV vẫn có tiếng.\r\n\r\n" +
                   "Cách dùng: chọn ứng dụng đang phát tiếng (ví dụ Chrome/Edge) → Bắt đầu → mở trang gửi F88Tivi, tích \"Dùng app F88Tivi Audio\" rồi chiếu như bình thường."
        };
        _toggle.FlatAppearance.BorderSize = 0;

        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(20), ColumnCount = 2, RowCount = 6 };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        panel.Controls.Add(intro, 0, 0); panel.SetColumnSpan(intro, 2);
        panel.Controls.Add(new Label { Text = "Ứng dụng phát tiếng:", AutoSize = true, Margin = new Padding(0, 14, 0, 2) }, 0, 1);
        panel.SetColumnSpan(panel.GetControlFromPosition(0, 1)!, 2);
        panel.Controls.Add(_apps, 0, 2); panel.Controls.Add(_refresh, 1, 2);
        panel.Controls.Add(_level, 0, 3); panel.SetColumnSpan(_level, 2); _level.Margin = new Padding(0, 10, 0, 10);
        panel.Controls.Add(_toggle, 0, 4); panel.SetColumnSpan(_toggle, 2);
        panel.Controls.Add(_status, 0, 5); panel.SetColumnSpan(_status, 2); _status.Margin = new Padding(0, 10, 0, 0);
        Controls.Add(panel);

        _refresh.Click += (_, _) => LoadApps();
        _toggle.Click += async (_, _) => await Toggle();
        _timer.Tick += (_, _) => { _level.Value = _cap == null ? 0 : Math.Min(100, (int)(_cap.Peak * 140)); };
        _timer.Start();
        _server.ClientsChanged += () => BeginInvoke(UpdateStatus);
        FormClosing += (_, _) => { Stop(); _server.Dispose(); };

        LoadApps();
        try { _server.Start(); UpdateStatus(); }
        catch { _status.Text = "Không mở được cổng " + WsServer.Port + " (có thể đang chạy một bản F88Tivi Audio khác)."; _toggle.Enabled = false; }
    }

    void LoadApps()
    {
        string? last = _apps.SelectedItem is AppItem a ? a.Name : null;
        var self = Environment.ProcessId;
        var items = Process.GetProcesses()
            .Where(p => { try { return p.Id != self && p.MainWindowHandle != IntPtr.Zero && p.MainWindowTitle.Length > 0; } catch { return false; } })
            .GroupBy(p => p.ProcessName)
            .Select(g => new AppItem((uint)g.First().Id, g.Key, g.First().MainWindowTitle))
            .OrderBy(i => i.Name is "chrome" or "msedge" ? 0 : 1).ThenBy(i => i.Name)
            .ToArray();
        _apps.Items.Clear(); _apps.Items.AddRange(items);
        if (items.Length > 0) _apps.SelectedIndex = Math.Max(0, Array.FindIndex(items, i => i.Name == last));
    }

    async Task Toggle()
    {
        if (_cap != null) { Stop(); UpdateStatus(); return; }
        if (_apps.SelectedItem is not AppItem app) { _status.Text = "Hãy chọn một ứng dụng."; return; }
        _toggle.Enabled = false;
        try
        {
            var cap = await ProcessLoopbackCapture.StartAsync(app.Pid);
            cap.Data += _server.Broadcast;
            cap.Failed += msg => BeginInvoke(() => { Stop(); _status.Text = "Lỗi bắt âm thanh: " + msg; });
            _cap = cap;
            _apps.Enabled = _refresh.Enabled = false;
            _toggle.Text = "Dừng";
            UpdateStatus();
        }
        catch (Exception ex) { _status.Text = "Không bắt được âm thanh của \"" + app.Name + "\": " + ex.Message + "\r\n(Cần Windows 10 bản 2004 trở lên.)"; }
        finally { _toggle.Enabled = true; }
    }

    void Stop()
    {
        _cap?.Dispose(); _cap = null;
        _toggle.Text = "Bắt đầu"; _apps.Enabled = _refresh.Enabled = true;
    }

    void UpdateStatus()
    {
        int n = _server.ClientCount;
        string link = n > 0 ? "Trang gửi đã kết nối." : "Chưa có trang gửi nào kết nối.";
        _status.Text = _cap == null ? "Đang tắt. " + link : "🟢 Đang bắt tiếng. " + link;
    }
}
