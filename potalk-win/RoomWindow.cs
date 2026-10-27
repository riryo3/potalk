using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace Potalker;

/// <summary>入室中の小窓：参加者・ミュート・リアクションなど。</summary>
public sealed class RoomWindow : Window
{
    readonly AppModel M;
    Engine E => M.E;
    readonly TextBlock state = Ui.Txt("", 13, bold: true), count = Ui.Txt("", 12, Ui.Dim), tagText = Ui.Txt("", 12, Ui.Dim);
    readonly TextBlock mailCap = Ui.Txt("", 11, Ui.Dim), mailBody = Ui.Txt("", 14, wrap: true);
    readonly System.Windows.Controls.Primitives.UniformGrid eq = new() { Rows = 1, Height = 26, Margin = new Thickness(10, 2, 10, 2) };
    readonly StackPanel legend = new() { HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 6, 0, 0) };
    readonly Border mailBanner, tagRow;
    readonly Button pin, tagBtn, chatBtn, mailBtn, muteBtn, shareBtn, leaveBtn;
    readonly TextBox tagInput = Ui.Input("", 30);
    readonly StackPanel members = new() { Margin = new Thickness(10, 6, 10, 6) }, reactions = new() { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 8, 0, 8) };
    readonly Grid root = new();
    readonly Canvas fx = new() { IsHitTestVisible = false };
    readonly Border overlay = new() { Background = new SolidColorBrush(Color.FromArgb(150, 0, 0, 0)), Visibility = Visibility.Collapsed };
    readonly ComboBox mic = new() { FontSize = 12, MaxWidth = 150 };
    string lastOverlay = "", lastReact = "";
    bool micBusy;

    public RoomWindow(AppModel m)
    {
        M = m;
        Title = "部屋"; Width = 380; Height = 720; MinWidth = 340; MinHeight = 600; Topmost = M.PinRoom;
        Background = Ui.Bg; Foreground = Ui.Fg; FontFamily = new FontFamily("Yu Gothic UI, Segoe UI, Meiryo UI");
        WindowStartupLocation = WindowStartupLocation.Manual;
        var wa = SystemParameters.WorkArea; Left = Math.Max(wa.Left, wa.Right - Width - 20); Top = wa.Top + 30; Height = Math.Min(Height, wa.Height - 60);

        // 上：状態
        pin = Ui.Btn("📌 最前面", () => { M.PinRoom = !M.PinRoom; Topmost = M.PinRoom; UpdatePin(); }, size: 12);
        var settings = Ui.Btn("⚙ 設定", M.OpenSettings, size: 12);
        if (M.S.SinglePane) { pin.Visibility = Visibility.Collapsed; settings.Visibility = Visibility.Collapsed; }
        mic.SelectionChanged += (_, _) => { if (!micBusy && mic.SelectedIndex >= 0) M.SwitchMic(mic.SelectedIndex == 0 ? "" : (string)mic.SelectedItem); };
        var head2 = new DockPanel { Margin = new Thickness(0, 6, 0, 0) };
        DockPanel.SetDock(pin, Dock.Right); DockPanel.SetDock(settings, Dock.Right); settings.Margin = new Thickness(0, 0, 6, 0);
        head2.Children.Add(pin); head2.Children.Add(settings); head2.Children.Add(mic); mic.HorizontalAlignment = HorizontalAlignment.Left; mic.Margin = new Thickness(0, 0, 6, 0);
        var head = new StackPanel { Margin = new Thickness(12, 8, 12, 8) };
        head.Children.Add(state); var cr = new StackPanel { Orientation = Orientation.Horizontal }; cr.Children.Add(count); head.Children.Add(cr); head.Children.Add(head2);

        mailBanner = new Border { Background = Ui.TealSoft, Padding = new Thickness(12, 8, 12, 8), Visibility = Visibility.Collapsed };
        var mb = new StackPanel(); mb.Children.Add(mailCap); mb.Children.Add(mailBody); mailBanner.Child = mb;

        tagBtn = Ui.Btn("つける", null, size: 12);
        var tagSend = Ui.Btn("確定", SendTag, size: 12);
        var tagEdit = new DockPanel { Visibility = Visibility.Collapsed, Margin = new Thickness(0, 4, 0, 0) };
        DockPanel.SetDock(tagSend, Dock.Right); tagSend.Margin = new Thickness(6, 0, 0, 0); tagEdit.Children.Add(tagSend); var tagC = Ui.Counter(tagInput, 30); DockPanel.SetDock(tagC, Dock.Right); tagEdit.Children.Add(tagC); tagEdit.Children.Add(tagInput);
        tagInput.KeyDown += (_, e) => { if (e.Key == System.Windows.Input.Key.Enter) SendTag(); };
        tagBtn.Click += (_, _) => { tagEdit.Visibility = tagEdit.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible; tagInput.Focus(); };
        var th = new DockPanel(); DockPanel.SetDock(tagBtn, Dock.Right); th.Children.Add(tagBtn); th.Children.Add(tagText);
        var tp = new StackPanel(); tp.Children.Add(th); tp.Children.Add(tagEdit);
        tagRow = new Border { Child = tp, Padding = new Thickness(12, 6, 12, 6), Visibility = Visibility.Collapsed, BorderBrush = Ui.Line, BorderThickness = new Thickness(0, 1, 0, 0) };

        // 下：操作
        chatBtn = Ui.Btn("💬 ひとこと", M.ToggleChat, size: 13, bold: true); chatBtn.Padding = new Thickness(10, 8, 10, 8);
        mailBtn = Ui.Btn("📮 おたより", M.OpenMail, size: 13, bold: true); mailBtn.Padding = new Thickness(10, 8, 10, 8);
        muteBtn = Ui.Btn("🎤 ミュート", null, size: 13, bold: true); muteBtn.Padding = new Thickness(10, 8, 10, 8);
        shareBtn = Ui.Btn("🔗 URLを共有", ShareUrl, size: 13, bold: true); shareBtn.Padding = new Thickness(10, 8, 10, 8);
        leaveBtn = Ui.Btn("🚪 退出", () => M.RequestLeave(this), Ui.Red, Ui.White, 13, true); leaveBtn.Padding = new Thickness(10, 8, 10, 8);
        var row1 = new System.Windows.Controls.Primitives.UniformGrid { Columns = 2, Margin = new Thickness(0, 0, 0, 6) };
        chatBtn.Margin = new Thickness(0, 0, 3, 0); mailBtn.Margin = new Thickness(3, 0, 0, 0); row1.Children.Add(chatBtn); row1.Children.Add(mailBtn);
        var row3 = new System.Windows.Controls.Primitives.UniformGrid { Columns = 2, Margin = new Thickness(0, 6, 0, 0) };
        shareBtn.Margin = new Thickness(0, 0, 3, 0); leaveBtn.Margin = new Thickness(3, 0, 0, 0); row3.Children.Add(shareBtn); row3.Children.Add(leaveBtn);
        var actions = new StackPanel { Margin = new Thickness(10, 0, 10, 12) };
        actions.Children.Add(row1); actions.Children.Add(muteBtn); actions.Children.Add(row3);

        var bottom = new StackPanel();
        BuildLegend(false);
        bottom.Children.Add(legend); bottom.Children.Add(eq); bottom.Children.Add(reactions); bottom.Children.Add(actions);

        var dock = new DockPanel();
        var top = new StackPanel(); top.Children.Add(head); top.Children.Add(mailBanner); top.Children.Add(tagRow);
        DockPanel.SetDock(top, Dock.Top); dock.Children.Add(top);
        DockPanel.SetDock(bottom, Dock.Bottom); dock.Children.Add(bottom);
        dock.Children.Add(new ScrollViewer { Content = members, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        root.Children.Add(dock); root.Children.Add(fx); root.Children.Add(overlay);
        Content = root;

        members.SizeChanged += (_, _) => FitNames();
        E.OnEq += UpdateEq;
        UpdateEq();
        M.Fly += FlyEmoji;
        M.ChatChanged += UpdateChatBtn;
        M.MicsChanged += RefreshMicList;
        M.S.Remember(this, "room"); Snap.Attach(this, M);
        Closing += OnClosing;
        Closed += (_, _) => { M.Fly -= FlyEmoji; M.ChatChanged -= UpdateChatBtn; M.MicsChanged -= RefreshMicList; };
        UpdatePin(); RefreshMicList();
    }

    // ---- 経路の説明（イコライザーの上）と、イコライザー ----
    static string ConnGlyph(string conn) => conn == "relay" ? "" : conn == "direct" ? "" : "";

    static TextBlock Glyph(string g, Brush color) => new()
    {
        Text = g, FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12, Foreground = color, VerticalAlignment = VerticalAlignment.Center,
    };

    /// <summary>閉じているときは、小さなカプセル。押すと、2行の説明に変わり、その2行を押すと、カプセルに戻る。</summary>
    void BuildLegend(bool open)
    {
        legend.Children.Clear();
        if (open)
        {
            var box = new StackPanel { Cursor = System.Windows.Input.Cursors.Hand, Background = Brushes.Transparent };
            StackPanel Line(string glyph, Brush c, string text)
            {
                var r = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 1, 0, 1) };
                r.Children.Add(Glyph(glyph, c)); var t = Ui.Txt(text, 11); t.Margin = new Thickness(6, 0, 0, 0); r.Children.Add(t);
                return r;
            }
            box.Children.Add(Line("", Ui.Orange, "中継 ＝ その人のIPアドレスは隠れています"));
            box.Children.Add(Line("", Ui.Teal, "直接 ＝ その人のIPアドレスが見えています"));
            box.MouseLeftButtonUp += (_, _) => BuildLegend(false);
            legend.Children.Add(box);
            return;
        }
        var row = new StackPanel { Orientation = Orientation.Horizontal };
        TextBlock T(string s, Brush c = null) { var t = Ui.Txt(s, 11, c); t.Margin = new Thickness(4, 0, 0, 0); return t; }
        row.Children.Add(Glyph("", Ui.Orange)); row.Children.Add(T("中継")); row.Children.Add(T("／", Ui.Dim));
        row.Children.Add(Glyph("", Ui.Teal)); row.Children.Add(T("直接")); row.Children.Add(T("詳細…", Ui.Dim));
        var chip = new Border
        {
            Child = row, Background = Ui.Chip, BorderBrush = Ui.Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12),
            Padding = new Thickness(9, 2, 9, 2), Cursor = System.Windows.Input.Cursors.Hand,
        };
        chip.MouseLeftButtonUp += (_, _) => BuildLegend(true);
        legend.Children.Add(chip);
    }

    /// <summary>#eq の文字を、横幅いっぱいに、均等に並べる（約80msごとに届く）。</summary>
    void UpdateEq()
    {
        var chars = E.Eq.EnumerateRunes().Select(r => r.ToString()).ToList();
        if (chars.Count != eq.Children.Count)
        {
            eq.Children.Clear();
            foreach (var _ in chars)
                eq.Children.Add(new TextBlock
                {
                    FontFamily = new FontFamily("Consolas"), FontSize = 20, Foreground = Ui.Teal, HorizontalAlignment = HorizontalAlignment.Center,
                    Effect = new System.Windows.Media.Effects.DropShadowEffect { Color = ((SolidColorBrush)Ui.Teal).Color, BlurRadius = 5, ShadowDepth = 0, Opacity = 0.5 },
                });
        }
        for (int i = 0; i < chars.Count; i++) ((TextBlock)eq.Children[i]).Text = chars[i];
    }

    /// <summary>シングルペイン用：窓から中身だけを取り出す（窓は表示しない）。</summary>
    public UIElement Detach() { var c = (UIElement)Content; Content = null; return c; }

    void UpdatePin() { pin.Background = M.PinRoom ? Ui.TealSoft : Ui.Chip; }

    void OnClosing(object s, CancelEventArgs e)
    {
        if (M.ForceClose) return;
        e.Cancel = true;
        M.RequestLeave(this);
    }

    void RefreshMicList()
    {
        micBusy = true; mic.Items.Clear(); mic.Items.Add("🎤 既定のマイク");
        foreach (var n in M.Mics) mic.Items.Add(n);
        mic.SelectedIndex = M.S.MicLabel.Length == 0 ? 0 : Math.Max(0, M.Mics.IndexOf(M.S.MicLabel) + 1);
        micBusy = false;
    }

    void UpdateChatBtn()
    {
        chatBtn.Content = M.Unread > 0 ? $"💬 ひとこと 新着 {M.Unread}" : "💬 ひとこと";
        chatBtn.Background = M.Unread > 0 ? Ui.Teal : M.ChatOpen ? Ui.TealSoft : Ui.Chip;
        chatBtn.Foreground = M.Unread > 0 ? Ui.White : Ui.Fg;
    }

    void SendTag() { E.Cmd(new { type = "tag", text = tagInput.Text }); tagInput.Text = ""; tagBtn.Tag = null; ((UIElement)((DockPanel)tagInput.Parent)).Visibility = Visibility.Collapsed; }

    void ShareUrl()
    {
        try { var s = E.Room.S("share"); Clipboard.SetText(M.S.ShortLinks ? Links.StripName(s) : s); } catch { return; }
        shareBtn.Content = "✓ コピーしました";
        var t = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(1.5) };
        t.Tick += (_, _) => { shareBtn.Content = "🔗 URLを共有"; t.Stop(); }; t.Start();
    }

    // ---- 状態の反映 ----
    public void Refresh()
    {
        var r = E.Room;
        var all = r.A("members").ToList();
        state.Text = r.S("state").Length == 0 ? "未参加" : r.S("state");
        count.Text = $"{all.Count}人";

        var mn = r.P("mailNow");
        mailBanner.Visibility = mn.Has() ? Visibility.Visible : Visibility.Collapsed;
        if (mn.Has()) { mailCap.Text = mn.S("cap"); mailBody.Text = $"{mn.S("who")} {mn.S("text")}"; }

        var tag = r.P("tag");
        tagRow.Visibility = tag.B("show") ? Visibility.Visible : Visibility.Collapsed;
        Links.Fill(tagText, "🏷 " + (tag.S("text").Length == 0 ? "話題はまだありません" : tag.S("text")), u => M.ConfirmOpen(u, this));
        tagBtn.Content = tag.S("btn").Length == 0 ? "つける" : tag.S("btn");

        members.Children.Clear(); nameFits.Clear();
        int Rank(JsonElement m) => m.S("mark") == "📣" ? 0 : (m.S("mark").Length == 0 ? 2 : 1);
        foreach (var (m, idx) in all.Select((m, i) => (m, i)).OrderBy(x => Rank(x.m)).ThenBy(x => x.i)) members.Children.Add(MemberRow(m, idx));
        if (r.S("more").Length > 0) members.Children.Add(Ui.Txt(r.S("more"), 12, Ui.Dim));
        FitNames();

        reactions.Children.Clear();
        int ri = 0;
        foreach (var e in r.A("reactions"))
        {
            int i = ri++;
            var b = Ui.Btn(e.GetString(), () => E.Cmd(new { type = "react", i }), size: 17);
            b.Width = 36; b.Height = 32; b.Padding = new Thickness(0); b.Margin = new Thickness(2, 0, 2, 0);
            reactions.Children.Add(b);
        }
        var key = string.Join("|", r.A("reactions").Select(x => x.GetString()));
        lastReact = key;

        // ミュート／通話希望／マイクを使う
        var raise = r.P("raise"); var speak = r.P("speak");
        muteBtn.Padding = new Thickness(10, 8, 10, 8);
        void Set(string text, Action act, bool enabled, Brush bg = null, Brush fg = null)
        {
            muteBtn.Content = text; muteBtn.IsEnabled = enabled; muteBtn.Background = bg ?? Ui.Chip; muteBtn.Foreground = fg ?? Ui.Fg;
            muteBtn.Click -= MuteHandler; MuteHandler = (_, _) => act(); muteBtn.Click += MuteHandler;
        }
        if (raise.B("show")) Set("🙋 " + (raise.S("label").Length == 0 ? "通話希望" : raise.S("label")), () => E.Cmd(new { type = "raise" }), true);
        else if (speak.B("show")) Set("🎙 " + (speak.S("label").Length == 0 ? "マイクを使う" : speak.S("label")), () => E.Cmd(new { type = "speak" }), !speak.B("disabled"));
        else
        {
            bool muted = r.B("muted");
            Set(muted ? "🔇 ミュート解除" : "🎤 ミュート", () => E.Cmd(new { type = "mute" }), r.B("canMute"), muted ? Ui.Orange : Ui.Chip, muted ? Ui.White : Ui.Fg);
        }
        shareBtn.IsEnabled = r.S("share").Length > 0;
        mailBtn.Visibility = r.B("bcast") ? Visibility.Visible : Visibility.Collapsed;
        bool hot = r.B("mailOpen") && !M.MailOpen;
        int mails = r.P("mail").A("body").Count(b => b.B("item"));
        mailBtn.Content = (hot ? "📮 おたより募集中" : "📮 おたより") + (mails > 0 ? $" ({mails})" : "");
        mailBtn.Background = hot ? Ui.Orange : M.MailOpen ? Ui.TealSoft : Ui.Chip;
        mailBtn.Foreground = hot ? Ui.White : Ui.Fg;
        UpdateChatBtn();
        RefreshOverlay(r);
    }
    RoutedEventHandler MuteHandler = (_, _) => { };

    readonly List<Action<double>> nameFits = new();

    /// <summary>一覧の幅から、各行の名前の最大幅を決める（行の左右の余白・罫線の分を引く）。</summary>
    void FitNames()
    {
        double avail = members.ActualWidth - 20 - 16 - 2;
        if (avail <= 0) return;
        foreach (var f in nameFits) f(avail);
    }

    UIElement MemberRow(JsonElement m, int idx)
    {
        var g = new DockPanel();
        var em = Ui.Txt(m.S("em"), 20); em.Width = 30; em.Opacity = m.B("muted") ? 0.55 : 1;
        // ミュート中は、赤い丸（マイクに斜線）のバッジ
        var mute = new Border { Width = 22, Height = 22, VerticalAlignment = VerticalAlignment.Center };
        if (m.B("muted"))
        {
            mute.CornerRadius = new CornerRadius(11); mute.Background = Ui.Red;
            var mic = new Grid();
            mic.Children.Add(new TextBlock { Text = "", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12, Foreground = Ui.White, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center });
            mic.Children.Add(new System.Windows.Shapes.Line { X1 = 5, Y1 = 5, X2 = 17, Y2 = 17, Stroke = Ui.White, StrokeThickness = 1.6, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round });
            mute.Child = mic;
        }
        // 経路のマーク：雲＝中継、両端が矢印＝直接。不明のときは、何も出さない
        var conn = m.S("conn");
        var cn = Ui.Txt(ConnGlyph(conn), 13, conn == "relay" ? Ui.Orange : Ui.Teal, bold: true); cn.Width = 18;
        cn.FontFamily = new FontFamily("Segoe MDL2 Assets");
        // 名前は、長ければ省略する。成長の草花（と「あなた」）は、省略しない
        var name = new Grid { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Stretch };
        for (int i = 0; i < 3; i++) name.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        name.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var mark = m.S("mark"); var you = m.B("you");
        var nm = Ui.Txt((mark.Length == 0 ? "" : mark + " ") + m.S("name"), 15, you ? Ui.Dim : Ui.Fg, !you);
        name.Children.Add(nm);
        var suffix = new List<FrameworkElement>();
        if (you) { var y = Ui.Txt("（あなた）", 12, Ui.Dim); y.Margin = new Thickness(2, 0, 0, 0); Grid.SetColumn(y, 1); name.Children.Add(y); suffix.Add(y); }
        if (m.S("stage").Length > 0) { var st = Ui.Txt(m.S("stage"), 15); st.Margin = new Thickness(4, 0, 0, 0); Grid.SetColumn(st, 2); name.Children.Add(st); suffix.Add(st); }

        var right = new StackPanel { Orientation = Orientation.Horizontal };
        var grant = m.P("grant");
        if (grant.Has())
        {
            var gb = Ui.Btn(grant.B("on") ? "🎙 登壇中" : "🎙 登壇", () => E.Cmd(new { type = "grant", i = idx }), grant.B("on") ? Ui.TealSoft : Ui.Chip, size: 11);
            gb.ToolTip = grant.S("title"); gb.Margin = new Thickness(4, 0, 4, 0); right.Children.Add(gb);
        }
        var ig = m.P("ig");
        if (ig.Has())
        {
            bool off = ig.B("off");
            var ib = Ui.Btn(off ? "🤍" : "❤", () => E.Cmd(new { type = "ignoreRow", i = idx }), Brushes.Transparent, off ? Ui.Dim : Ui.Red, 14);
            ib.BorderThickness = new Thickness(0); ib.ToolTip = ig.S("title"); right.Children.Add(ib);
        }
        DockPanel.SetDock(right, Dock.Right); g.Children.Add(right);
        DockPanel.SetDock(em, Dock.Left); DockPanel.SetDock(mute, Dock.Left); DockPanel.SetDock(cn, Dock.Left);
        g.Children.Add(em); g.Children.Add(mute); g.Children.Add(cn); g.Children.Add(name);

        var speaking = m.B("speaking");
        var b = new Border { Child = g, Padding = new Thickness(8, 3, 8, 3), MinHeight = 34, CornerRadius = new CornerRadius(10), Margin = new Thickness(0, 1, 0, 1),
            Background = speaking ? Ui.TealSoft : Brushes.Transparent, BorderBrush = speaking ? Ui.Teal : Brushes.Transparent, BorderThickness = new Thickness(1) };
        if (m.B("tap"))
        {
            b.Cursor = System.Windows.Input.Cursors.Hand;
            b.MouseLeftButtonUp += (_, e) => { if (e.OriginalSource is not System.Windows.Controls.Primitives.ButtonBase) E.Cmd(new { type = "card", i = idx }); };
        }
        // 名前は、行の幅に収まらなければ省略する（成長の草花と「（あなた）」は、省略しない）
        nameFits.Add(avail =>
        {
            right.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
            double sfx = 0;
            foreach (var s in suffix) { s.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity)); sfx += s.DesiredSize.Width; }
            nm.MaxWidth = Math.Max(24, avail - 30 - 22 - 18 - right.DesiredSize.Width - sfx);
        });
        return b;
    }

    // ---- 名刺・「無視」の確認 ----
    void RefreshOverlay(JsonElement r)
    {
        var card = r.P("card"); var ask = r.P("ignoreAsk");
        var key = card.Has() ? "c" + card.GetRawText() : ask.Has() ? "a" + ask.GetRawText() : "";
        if (key == lastOverlay) return;
        lastOverlay = key;
        if (key.Length == 0) { overlay.Visibility = Visibility.Collapsed; overlay.Child = null; return; }
        overlay.Child = card.Has() ? CardView(card) : AskView(ask);
        overlay.Visibility = Visibility.Visible;
    }

    UIElement Modal(UIElement inner, Action dismiss)
    {
        var host = new Border { Child = inner, MaxWidth = 340, Margin = new Thickness(14), VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center };
        var g = new Grid { Background = Brushes.Transparent };
        g.MouseLeftButtonDown += (_, e) => { if (e.OriginalSource == g) dismiss?.Invoke(); };
        g.Children.Add(host);
        return g;
    }

    UIElement CardView(JsonElement c)
    {
        var sp = new StackPanel();
        var head = new DockPanel();
        FrameworkElement av = new TextBlock { Text = c.S("emoji"), FontSize = 30, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        var img = c.S("img");
        if (img.Length > 0)
        {
            var src = Img.Load(img); if (src != null) av = new Image { Source = src, Stretch = Stretch.UniformToFill };
        }
        var avBox = new Border { Child = av, Width = 52, Height = 52, CornerRadius = new CornerRadius(14), Background = Ui.Chip, ClipToBounds = true };
        DockPanel.SetDock(avBox, Dock.Left); head.Children.Add(avBox);
        var close = Ui.Btn("✕", () => E.Cmd(new { type = "cardClose" }), size: 12); DockPanel.SetDock(close, Dock.Right); head.Children.Add(close);
        var nm = new StackPanel { Margin = new Thickness(12, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center };
        nm.Children.Add(Ui.Txt(c.S("name"), 18, bold: true, wrap: true)); nm.Children.Add(Ui.Txt(c.S("state"), 12, Ui.Dim));
        head.Children.Add(nm);
        sp.Children.Add(head);
        if (c.S("bio").Length > 0) { var bio = Ui.Txt("", 14, wrap: true); Links.Fill(bio, c.S("bio"), u => M.ConfirmOpen(u, this)); bio.Margin = new Thickness(0, 12, 0, 0); sp.Children.Add(bio); }
        var soc = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
        foreach (var s in c.A("socials"))
        {
            var u = s.S("u");
            var tb = new TextBlock { Margin = new Thickness(0, 0, 10, 2), FontSize = 13 };
            var hl = new System.Windows.Documents.Hyperlink(new System.Windows.Documents.Run(s.S("t").Length == 0 ? u : s.S("t")));
            hl.Click += (_, _) => M.ConfirmOpen(u, this); Links.CopyMenu(hl, u); tb.Inlines.Add(hl); soc.Children.Add(tb);
        }
        sp.Children.Add(soc);
        var foot = Ui.Txt(c.S("foot"), 12, bold: true, wrap: true); foot.Margin = new Thickness(0, 10, 0, 0); sp.Children.Add(foot);
        if (c.B("edit")) { var eb = Ui.Btn("✏️ 自分の名刺を編集する", () => E.Cmd(new { type = "cardEditFromCard" })); eb.Margin = new Thickness(0, 10, 0, 0); sp.Children.Add(eb); }
        var ig = c.P("ignore");
        if (ig.Has())
        {
            var ib = Ui.Btn("❤ " + ig.S("text"), () => E.Cmd(new { type = "cardIgnore" }), Ui.Card, Ui.Red, bold: true);
            ib.BorderBrush = Ui.Red; ib.Padding = new Thickness(10, 9, 10, 9); ib.Margin = new Thickness(0, 10, 0, 0); ib.IsEnabled = !ig.B("disabled"); sp.Children.Add(ib);
        }
        return Modal(Ui.Panel(sp, Ui.Card, 18, new Thickness(18)), () => E.Cmd(new { type = "cardClose" }));
    }

    UIElement AskView(JsonElement a)
    {
        var sp = new StackPanel();
        sp.Children.Add(Ui.Txt(a.S("title"), 16, bold: true, wrap: true));
        foreach (var t in a.A("items")) { var tb = Ui.Txt("• " + t.GetString(), 13, wrap: true); tb.Margin = new Thickness(0, 6, 0, 0); sp.Children.Add(tb); }
        var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 14, 0, 0) };
        var yes = Ui.Btn(a.S("yes"), () => E.Cmd(new { type = "ignoreYes" }), Ui.Red, Ui.White, bold: true); yes.Margin = new Thickness(0, 0, 8, 0);
        row.Children.Add(yes); row.Children.Add(Ui.Btn(a.S("no"), () => E.Cmd(new { type = "ignoreNo" })));
        sp.Children.Add(row);
        return Modal(Ui.Panel(sp, Ui.Card, 18, new Thickness(18)), null);
    }

    // ---- 飛ぶ絵文字 ----
    void FlyEmoji(string emoji, string who, bool self)
    {
        if (fx.Children.Count >= 12) return;
        var sp = new StackPanel();
        sp.Children.Add(new TextBlock { Text = emoji, FontSize = 26, HorizontalAlignment = HorizontalAlignment.Center });
        if (who.Length > 0) sp.Children.Add(new TextBlock { Text = who, FontSize = 10, Foreground = Ui.Dim, HorizontalAlignment = HorizontalAlignment.Center });
        var rnd = Random.Shared;
        var x = self ? 40 + rnd.Next(-8, 8) : Math.Max(40, rnd.NextDouble() * Math.Max(60, fx.ActualWidth - 100));
        var y = Math.Max(120, fx.ActualHeight * 0.6);
        Canvas.SetLeft(sp, x); Canvas.SetTop(sp, y);
        fx.Children.Add(sp);
        var dur = TimeSpan.FromSeconds(1.4);
        var up = new DoubleAnimation(y, y - 110, dur) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } };
        var fade = new DoubleAnimation(1, 0, dur);
        fade.Completed += (_, _) => fx.Children.Remove(sp);
        sp.BeginAnimation(Canvas.TopProperty, up); sp.BeginAnimation(OpacityProperty, fade);
    }
}
