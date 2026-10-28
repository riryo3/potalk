using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Potalker;

/// <summary>ひとこと（テキストチャット）の小窓。</summary>
public sealed class ChatWindow : Window
{
    readonly AppModel M;
    readonly StackPanel log = new() { Margin = new Thickness(10, 8, 10, 8) };
    readonly ScrollViewer sv;
    readonly TextBox input = Ui.Input("", 60);

    public ChatWindow(AppModel m)
    {
        M = m;
        Title = "ひとこと"; Width = 340; Height = 480; MinWidth = 260; MinHeight = 240; Topmost = true;
        Background = Ui.Bg; Foreground = Ui.Fg; FontFamily = new FontFamily("Yu Gothic UI, Segoe UI, Meiryo UI");
        var wa = SystemParameters.WorkArea; Left = Math.Max(wa.Left, wa.Right - 380 - 20 - Width - 8); Top = wa.Top + 40;
        WindowStartupLocation = WindowStartupLocation.Manual;
        sv = new ScrollViewer { Content = log, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        var send = Ui.Btn("送る", Send, Ui.Accent, Ui.White, bold: true);
        var bar = new DockPanel { Margin = new Thickness(8) };
        DockPanel.SetDock(send, Dock.Right); send.Margin = new Thickness(6, 0, 0, 0); bar.Children.Add(send); var cc = Ui.Counter(input, 60); DockPanel.SetDock(cc, Dock.Right); bar.Children.Add(cc); bar.Children.Add(input);
        input.KeyDown += (_, e) => { if (e.Key == System.Windows.Input.Key.Enter) Send(); };
        var dock = new DockPanel(); DockPanel.SetDock(bar, Dock.Bottom); dock.Children.Add(bar); dock.Children.Add(sv);
        Content = dock;
        M.ChatChanged += Refresh;
        Closed += (_, _) => { M.ChatChanged -= Refresh; M.Chat = null; M.ChatOpen = false; M.Unread = 0; };
        M.S.Remember(this, "chat"); Snap.Attach(this, M);
        Loaded += (_, _) => input.Focus();
        Refresh();
    }

    /// <summary>シングルペイン用：窓から中身だけを取り出す（窓は表示しない）。</summary>
    public UIElement Detach() { var c = (UIElement)Content; Content = null; return c; }

    void Send() { var t = input.Text.Trim(); if (t.Length == 0) return; M.SendChat(t); input.Text = ""; }

    void Refresh()
    {
        if (M.ChatOpen) M.Unread = 0;
        log.Children.Clear();
        foreach (var l in M.Past.Concat(M.ChatLines))
        {
            if (l.Sys) { var s = Ui.Txt("", 11, Ui.Dim, wrap: true); Links.Fill(s, l.Text, u => M.ConfirmOpen(u, this)); s.Margin = new Thickness(0, 4, 0, 4); log.Children.Add(s); continue; }
            var tb = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 2, 0, 2), FontSize = 13, Foreground = l.Hist ? Ui.Dim : Ui.Fg };
            tb.Inlines.Add(new System.Windows.Documents.Run(l.Em + " ") { FontSize = 15 });
            tb.Inlines.Add(new System.Windows.Documents.Run(l.Who + "  ") { FontWeight = FontWeights.SemiBold, Foreground = Ui.Dim, FontSize = 12 });
            Links.Fill(tb, l.Text, u => M.ConfirmOpen(u, this), clear: false);      // 絵文字と名前の Run を消さない
            log.Children.Add(tb);
        }
        sv.ScrollToBottom();
    }
}

/// <summary>部屋の設定（音量・BGM・通知音など）。ページ側の設定欄をそのまま写して操作する。</summary>
public sealed class SettingsWindow : Window
{
    readonly AppModel M;
    readonly StackPanel body = new() { Margin = new Thickness(14) };
    string key = "";
    /// <summary>シングルペイン用：窓から中身だけを取り出す（窓は表示しない）。</summary>
    public UIElement Detach() { var c = (UIElement)Content; Content = null; return c; }


    public SettingsWindow(AppModel m)
    {
        M = m;
        Title = "部屋の設定"; Width = 340; Height = 460; MinWidth = 280; MinHeight = 240; Topmost = true;
        Background = Ui.Bg; Foreground = Ui.Fg; FontFamily = new FontFamily("Yu Gothic UI, Segoe UI, Meiryo UI");
        Content = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        M.S.Remember(this, "settings"); Snap.Attach(this, M);
        Closed += (_, _) => M.Sett = null;
    }

    public void Refresh()
    {
        var items = M.E.Room.A("settings").ToList();
        // 並びが変わったときだけ作り直す（つまみを動かしている最中に、作り直さない）
        var k = string.Join("|", items.Select(i => i.S("k") + i.S("id") + i.S("text") + string.Join(",", i.A("items").Select(r => r.S("id")))));
        if (k == key) return;
        key = k; body.Children.Clear();
        foreach (var i in items)
        {
            switch (i.S("k"))
            {
                case "range":
                {
                    var id = i.S("id");
                    double.TryParse(i.S("min"), out var mn); double.TryParse(i.S("max"), out var mx); double.TryParse(i.S("step"), out var st); double.TryParse(i.S("value"), out var v);
                    body.Children.Add(Ui.Txt(i.S("label"), 12, Ui.Dim));
                    var sl = new Slider { Minimum = mn, Maximum = mx <= mn ? mn + 1 : mx, Value = v, Margin = new Thickness(0, 2, 0, 12) };
                    if (st > 0) { sl.TickFrequency = st; sl.IsSnapToTickEnabled = true; }
                    sl.ValueChanged += (_, e) => M.E.Cmd(new { type = "set", id, value = e.NewValue.ToString(System.Globalization.CultureInfo.InvariantCulture) });
                    body.Children.Add(sl); break;
                }
                case "radios":
                {
                    var sp = new StackPanel { Margin = new Thickness(0, 0, 0, 12) };
                    foreach (var r in i.A("items"))
                    {
                        var id = r.S("id");
                        var rb = new RadioButton { Content = r.S("label"), IsChecked = r.B("checked"), GroupName = "g" + i.S("items").Length + k.GetHashCode(), Margin = new Thickness(0, 2, 0, 2) };
                        rb.Checked += (_, _) => M.E.Cmd(new { type = "set", id, value = true });
                        sp.Children.Add(rb);
                    }
                    body.Children.Add(sp); break;
                }
                case "check":
                {
                    var id = i.S("id");
                    var cb = new CheckBox { Content = new TextBlock { Text = i.S("label"), TextWrapping = TextWrapping.Wrap }, IsChecked = i.B("checked"), Margin = new Thickness(0, 2, 0, 8) };
                    cb.Click += (_, _) => M.E.Cmd(new { type = "set", id, value = cb.IsChecked == true });
                    body.Children.Add(cb); break;
                }
                case "note":
                    body.Children.Add(Ui.Txt(i.S("text"), 11, Ui.Dim, wrap: true)); break;
            }
        }
        // 通話の設定
        var mutes = new StackPanel { Margin = new Thickness(0, 14, 0, 0) };
        mutes.Children.Add(Ui.Txt("このアプリの設定", 12, Ui.Dim, bold: true));
        var c1 = new CheckBox { Content = "部屋を作ったときは、ミュートで始める", IsChecked = M.S.MuteOnCreate, Margin = new Thickness(0, 6, 0, 2) };
        c1.Click += (_, _) => { M.S.MuteOnCreate = c1.IsChecked == true; M.S.Save(); };
        var c2 = new CheckBox { Content = "部屋に入ったときは、ミュートで始める", IsChecked = M.S.MuteOnJoin, Margin = new Thickness(0, 2, 0, 2) };
        c2.Click += (_, _) => { M.S.MuteOnJoin = c2.IsChecked == true; M.S.Save(); };
        mutes.Children.Add(c1); mutes.Children.Add(c2); body.Children.Add(mutes);
    }
}

/// <summary>初期設定：名前とアイコン。</summary>
public sealed class ProfileWindow : Window
{
    readonly AppModel M;
    readonly TextBox name = Ui.Input("", 20);
    readonly WrapPanel avatars = new() { Margin = new Thickness(0, 8, 0, 0) };
    readonly TextBlock ver = Ui.Txt("", 11, Ui.Dim);
    string avKey = "";

    public ProfileWindow(AppModel m)
    {
        M = m;
        Title = "初期設定"; Width = 400; Height = 600; ResizeMode = ResizeMode.NoResize;
        Background = Ui.Bg; Foreground = Ui.Fg; FontFamily = new FontFamily("Yu Gothic UI, Segoe UI, Meiryo UI");
        WindowStartupLocation = WindowStartupLocation.CenterOwner; Owner = M.Main;
        var sp = new StackPanel { Margin = new Thickness(18) };
        sp.Children.Add(Ui.Txt("名前（20文字まで）", 12, Ui.Dim));
        var nrow = new DockPanel { Margin = new Thickness(0, 4, 0, 14) }; var nc = Ui.Counter(name, 20); DockPanel.SetDock(nc, Dock.Right); nrow.Children.Add(nc); nrow.Children.Add(name);
        name.KeyDown += (_, e) => { if (e.Key == System.Windows.Input.Key.Enter) Apply(); };
        name.LostFocus += (_, _) => Apply();
        sp.Children.Add(nrow);
        sp.Children.Add(Ui.Txt("アイコン", 12, Ui.Dim));
        sp.Children.Add(avatars);
        var card = Ui.Btn("📇 名刺（プロフィールカード）を設定…", () => M.E.Cmd(new { type = "cardEdit" })); card.Margin = new Thickness(0, 12, 0, 0);
        sp.Children.Add(card);
        sp.Children.Add(Ui.Txt("名前・アイコンを変えると、次に入る部屋から反映されます。", 11, Ui.Dim, wrap: true));
        var shortLink = new CheckBox { Content = "部屋のURLをコピーするとき、部屋名の部分（&name=…）を省く", IsChecked = M.S.ShortLinks, Margin = new Thickness(0, 14, 0, 0) };
        shortLink.Click += (_, _) => { M.S.ShortLinks = shortLink.IsChecked == true; M.S.Save(); };
        sp.Children.Add(shortLink);
        sp.Children.Add(Ui.Txt("ひとこと欄は60文字までなので、長いURLは途中で切れます。省いても、同じ部屋に入れます。", 11, Ui.Dim, wrap: true));
        var single = new CheckBox { Content = "1つの窓にまとめる（シングルペイン）", IsChecked = M.S.SinglePane, Margin = new Thickness(0, 14, 0, 0) };
        single.Click += (_, _) => M.SetSinglePane(single.IsChecked == true);
        sp.Children.Add(single);
        sp.Children.Add(Ui.Txt("画面の小さなPC向けです。入室前は一覧、入室すると、上のタブ（部屋・おたより・設定）と、下のひとこと欄に変わります。通話は、そのまま続きます。", 11, Ui.Dim, wrap: true));
        var scaleRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 10, 0, 0) };
        scaleRow.Children.Add(Ui.Txt("表示サイズ", 12, Ui.Dim)); var scaleBox = new ComboBox { Width = 80, Margin = new Thickness(10, 0, 0, 0) };
        foreach (var p in new[] { 100, 90, 80, 70, 60, 50 }) { var it = new ComboBoxItem { Content = p + "%", Tag = p }; scaleBox.Items.Add(it); if (Math.Abs(M.S.SingleScale * 100 - p) < 1) scaleBox.SelectedItem = it; }
        scaleBox.SelectionChanged += (_, _) => { if (scaleBox.SelectedItem is ComboBoxItem ci) M.SetSingleScale((int)ci.Tag / 100.0); };
        scaleRow.Children.Add(scaleBox); sp.Children.Add(scaleRow);
        var banned = Ui.Btn("🛡 自衛ワードを登録…", M.OpenBanned); banned.Margin = new Thickness(0, 14, 0, 0); sp.Children.Add(banned);
        sp.Children.Add(Ui.Txt("見たくない部屋に近づかないための機能です。登録した言葉を含む部屋は、一覧に出ません。", 11, Ui.Dim, wrap: true));
        var reset = Ui.Btn("🪟 ウィンドウの位置と大きさを初期に戻す", () =>
        {
            M.S.Windows.Clear(); M.S.Save();
            MessageBox.Show(this, "次にウィンドウを開くときから、初期の配置に戻ります。", "Potalker");
        }, size: 12);
        reset.Margin = new Thickness(0, 12, 0, 8); sp.Children.Add(reset);
        sp.Children.Add(ver);
        Content = new ScrollViewer { Content = sp, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        M.S.Remember(this, "profile"); Snap.Attach(this, M);
        Closed += (_, _) => { Apply(); M.Prof = null; };
        Refresh();
    }

    void Apply() { if (name.Text != M.E.Profile.S("input")) M.E.Cmd(new { type = "setName", name = name.Text }); }

    public void Refresh()
    {
        var p = M.E.Profile;
        if (!name.IsKeyboardFocused) name.Text = p.S("input");
        ver.Text = p.S("version");
        var list = p.A("avatars").ToList();
        var k = string.Join("", list.Select(a => a.S("em") + (a.B("on") ? "*" : "")));
        if (k == avKey) return;
        avKey = k; avatars.Children.Clear();
        int idx = 0;
        foreach (var a in list)
        {
            int i = idx++;
            var b = Ui.Btn(a.S("em"), () => M.E.Cmd(new { type = "setAvatar", i }), a.B("on") ? Ui.TealSoft : Ui.Chip, size: 20);
            b.Width = 44; b.Height = 40; b.Margin = new Thickness(0, 0, 6, 6); b.Padding = new Thickness(0);
            if (a.B("on")) b.BorderBrush = Ui.Teal;
            avatars.Children.Add(b);
        }
    }
}
