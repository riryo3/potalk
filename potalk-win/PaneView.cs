using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace Potalker;

public enum PaneTab { Room, Chat, Mail, Settings }

/// <summary>シングルペインで、入室中に出す画面。タブ（部屋・ひとこと・おたより・設定）と、左の取っ手から出る部屋一覧（☰）。</summary>
public sealed class PaneView : UserControl
{
    readonly AppModel M;
    readonly RoomWindow roomW; readonly ChatWindow chatW; readonly MailWindow mailW; readonly SettingsWindow settW;
    readonly UIElement roomBody, chatBody, mailBody, settBody;
    readonly StackPanel tabBar = new() { Orientation = Orientation.Horizontal };
    readonly Grid tabGrid = new();
    readonly Grid content = new();
    readonly Border handle;
    readonly Border miniBar;
    readonly Button mute, leave, pin, spk, share;
    readonly Border chatBodyHost, chatHead; readonly TextBlock chatTitle, chatArrow;
    readonly System.Windows.Controls.Primitives.Thumb divider;
    readonly Grid body = new();
    Action muteAction = () => { };
    bool drawerShown;
    const double HandleW = 16;

    public PaneView(AppModel m)
    {
        M = m;
        roomW = M.Room; chatW = M.Chat; mailW = M.Mail; settW = M.Sett;
        roomBody = roomW.Detach(); chatBody = chatW.Detach(); mailBody = mailW.Detach(); settBody = settW.Detach();
        Background = Ui.Bg; Foreground = Ui.Fg; FontFamily = new FontFamily("Yu Gothic UI, Segoe UI, Meiryo UI");

        foreach (var b in new[] { roomBody, mailBody, settBody }) content.Children.Add(b);

        // 左端の取っ手：押すと、部屋の一覧が左から出入りする
        var hs = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        hs.Children.Add(new TextBlock { Text = "‹", FontSize = 14, FontWeight = FontWeights.Bold, Foreground = Ui.Dim, HorizontalAlignment = HorizontalAlignment.Center, Name = "chev" });
        foreach (var c in "部屋一覧") hs.Children.Add(new TextBlock { Text = c.ToString(), FontSize = 10, Foreground = Ui.Dim, HorizontalAlignment = HorizontalAlignment.Center });
        handle = new Border { Width = HandleW, Background = Ui.Chip, Child = hs, Cursor = System.Windows.Input.Cursors.Hand, ToolTip = "部屋の一覧を開く／閉じる" };
        handle.MouseLeftButtonUp += (_, _) => M.ToggleDrawer();

        // 部屋の画面を見ていないときも、ミュートと退出が手元にあるように
        // 部屋のタブの下のボタンと同じ並び・同じ位置（ミュート・スピーカー／URL共有・退出）
        mute = Ui.Btn("", () => muteAction(), size: 13, bold: true); mute.Padding = new Thickness(10, 8, 10, 8);
        leave = Ui.Btn("🚪 退出", () => M.RequestLeave(Window.GetWindow(this) ?? M.Main), Ui.Red, Ui.White, 13, true); leave.Padding = new Thickness(10, 8, 10, 8); leave.Margin = new Thickness(3, 0, 0, 0);
        share = Ui.Btn("🔗 URLを共有", ShareUrl, size: 13, bold: true); share.Padding = new Thickness(10, 8, 10, 8); share.Margin = new Thickness(0, 0, 3, 0);
        var mb = new StackPanel { Margin = new Thickness(10, 6, 10, 12) };
        spk = Ui.Btn("🔈", M.ToggleSpeaker, size: 15, bold: true); spk.Padding = new Thickness(12, 5, 12, 5); spk.Margin = new Thickness(6, 0, 0, 0);
        void SyncSpk() { spk.Content = M.SpeakerMuted ? "🔇" : "🔈"; spk.Background = M.SpeakerMuted ? Ui.Orange : Ui.Chip; spk.Foreground = M.SpeakerMuted ? Ui.White : Ui.Fg; spk.ToolTip = M.SpeakerMuted ? "スピーカーのミュートを解除" : "スピーカーをミュート"; }
        M.SpeakerChanged += SyncSpk; Unloaded += (_, _) => M.SpeakerChanged -= SyncSpk; Loaded += (_, _) => { M.SpeakerChanged -= SyncSpk; M.SpeakerChanged += SyncSpk; SyncSpk(); };
        var muteRow = new DockPanel(); DockPanel.SetDock(spk, Dock.Right); muteRow.Children.Add(spk); muteRow.Children.Add(mute);
        var row3 = new System.Windows.Controls.Primitives.UniformGrid { Columns = 2, Margin = new Thickness(0, 6, 0, 0) };
        row3.Children.Add(share); row3.Children.Add(leave);
        mb.Children.Add(muteRow); mb.Children.Add(row3);
        miniBar = new Border { Child = mb, Visibility = Visibility.Collapsed };

        // 下の「ひとこと」ドロワー：仕切りの帯（6）と見出し（30）は、閉じていても同じ高さで置く。開くと、窓がその分だけ下に伸びる
        chatBodyHost = new Border { Child = chatBody, Height = M.S.SingleChatH, Visibility = Visibility.Collapsed, BorderBrush = Ui.Line, BorderThickness = new Thickness(0, 1, 0, 0) };
        chatTitle = new TextBlock { Text = "💬 ひとこと", FontSize = 13, FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0, 0, 0) };
        chatArrow = new TextBlock { Text = "▲", FontSize = 11, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 12, 0), Foreground = Ui.Dim };
        var hd = new DockPanel(); DockPanel.SetDock(chatArrow, Dock.Right); hd.Children.Add(chatArrow); hd.Children.Add(chatTitle);
        chatHead = new Border { Child = hd, Height = 30, Cursor = System.Windows.Input.Cursors.Hand, Background = Ui.Card };
        chatHead.MouseLeftButtonUp += (_, _) => M.ToggleChat();
        divider = new System.Windows.Controls.Primitives.Thumb { Height = 6, Cursor = System.Windows.Input.Cursors.SizeNS, Template = DividerTemplate() };
        divider.DragDelta += (_, e) => { if (M.ChatDrawer) M.DragDivider(e.VerticalChange); };
        var chatDock = new DockPanel { Background = Ui.Bg };
        DockPanel.SetDock(divider, Dock.Top); DockPanel.SetDock(chatHead, Dock.Top);
        chatDock.Children.Add(divider); chatDock.Children.Add(chatHead); chatDock.Children.Add(chatBodyHost);

        pin = Ui.Btn("📌", M.TogglePinSingle, Brushes.Transparent, size: 12); pin.BorderThickness = new Thickness(0); pin.ToolTip = "最前面にする／しない"; pin.Padding = new Thickness(6, 4, 6, 4);

        var bodyDock = new DockPanel();
        DockPanel.SetDock(handle, M.DrawerRight ? Dock.Right : Dock.Left); bodyDock.Children.Add(handle);
        DockPanel.SetDock(miniBar, Dock.Bottom); bodyDock.Children.Add(miniBar);
        bodyDock.Children.Add(content);
        body.Children.Add(bodyDock);

        var tb = new DockPanel { Background = Ui.Card };
        DockPanel.SetDock(pin, Dock.Right); tb.Children.Add(pin); tb.Children.Add(tabGrid);
        var bar = new Border { Child = tb, BorderBrush = Ui.Line, BorderThickness = new Thickness(0, 0, 0, 1) };

        var root = new DockPanel();
        DockPanel.SetDock(bar, Dock.Top); root.Children.Add(bar);
        DockPanel.SetDock(chatDock, Dock.Bottom); root.Children.Add(chatDock);
        root.Children.Add(body);
        Content = root;

        Loaded += (_, _) => { M.PaneChanged += Refresh; M.ChatChanged += Refresh; M.ChatHeightChanged += SyncChatH; Refresh(); SyncChatH(); };
        Unloaded += (_, _) => { M.PaneChanged -= Refresh; M.ChatChanged -= Refresh; M.ChatHeightChanged -= SyncChatH; };
    }

    /// <summary>仕切りの帯：ふだんは目立たない線、さわると色がつく。</summary>
    static System.Windows.Controls.ControlTemplate DividerTemplate()
    {
        var f = new FrameworkElementFactory(typeof(Border));
        f.SetValue(Border.BackgroundProperty, Ui.Line);
        var t = new System.Windows.Controls.ControlTemplate(typeof(System.Windows.Controls.Primitives.Thumb)) { VisualTree = f };
        return t;
    }

    void SyncChatH() { chatBodyHost.Height = M.S.SingleChatH; }

    void ShareUrl()
    {
        try { var s = M.E.Room.S("share"); Clipboard.SetText(M.S.ShortLinks ? Links.StripName(s) : s); } catch { return; }
        share.Content = "✓ コピーしました";
        var t = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(1.5) };
        t.Tick += (_, _) => { share.Content = "🔗 URLを共有"; t.Stop(); }; t.Start();
    }

    /// <summary>いまの部屋の部品から作ったものか</summary>
    public bool Matches(AppModel m) => ReferenceEquals(roomW, m.Room) && ReferenceEquals(chatW, m.Chat) && ReferenceEquals(mailW, m.Mail) && ReferenceEquals(settW, m.Sett);

    void Refresh()
    {
        var r = M.E.Room;
        bool bcast = r.B("bcast");
        if (!bcast && M.Tab == PaneTab.Mail) { M.Tab = PaneTab.Room; return; }

        // 見出し：窓の幅いっぱいに等分。選んでいるタブは下に線。新着があるタブは色がつく
        var tabs = new List<(string, PaneTab, bool, Brush)>
        {
            ("部屋", PaneTab.Room, M.RoomHot, Ui.Teal),
        };
        if (bcast) tabs.Add(("おたより", PaneTab.Mail, r.B("mailOpen") && M.Tab != PaneTab.Mail, Ui.Orange));
        tabs.Add(("設定", PaneTab.Settings, false, Ui.Teal));
        tabGrid.Children.Clear(); tabGrid.ColumnDefinitions.Clear();
        for (int i = 0; i < tabs.Count; i++)
        {
            tabGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var (title, t, hot, hc) = tabs[i];
            bool on = M.Tab == t;
            var label = new TextBlock
            {
                Text = title, FontSize = 13, FontWeight = on || hot ? FontWeights.SemiBold : FontWeights.Normal, HorizontalAlignment = HorizontalAlignment.Center,
                Foreground = hot ? Ui.White : on ? Ui.Accent : Ui.Fg, Margin = new Thickness(0, 10, 0, 10), TextTrimming = TextTrimming.CharacterEllipsis,
            };
            var line = new Border { Height = 2.5, Background = on ? Ui.Accent : Brushes.Transparent };
            var cell = new StackPanel(); cell.Children.Add(new Border { Child = label, Background = hot ? hc : Brushes.Transparent }); cell.Children.Add(line);
            var hit = new Border { Child = cell, Background = Brushes.Transparent, Cursor = System.Windows.Input.Cursors.Hand };
            var tt = t; hit.MouseLeftButtonUp += (_, _) => M.Tab = tt;
            Grid.SetColumn(hit, i); tabGrid.Children.Add(hit);
        }
        pin.Background = M.S.PinSingle ? Ui.TealSoft : Brushes.Transparent;

        // 中身
        roomBody.Visibility = M.Tab == PaneTab.Room ? Visibility.Visible : Visibility.Collapsed;
        chatBodyHost.Visibility = M.ChatDrawer ? Visibility.Visible : Visibility.Collapsed;
        chatArrow.Text = M.ChatDrawer ? "▼" : "▲";
        bool unreadHot = M.Unread > 0 && !M.ChatDrawer;
        chatHead.Background = unreadHot ? Ui.Teal : Ui.Card; chatTitle.Foreground = unreadHot ? Ui.White : Ui.Fg;
        chatTitle.Text = unreadHot ? $"💬 ひとこと 新着 {M.Unread}" : "💬 ひとこと";
        mailBody.Visibility = M.Tab == PaneTab.Mail ? Visibility.Visible : Visibility.Collapsed;
        settBody.Visibility = M.Tab == PaneTab.Settings ? Visibility.Visible : Visibility.Collapsed;

        // 部屋の画面を見ていないときの、ミュートと退出
        miniBar.Visibility = M.Tab == PaneTab.Room ? Visibility.Collapsed : Visibility.Visible;
        UpdateMute(r);

        SetDrawer(M.DrawerOpen);
    }

    void UpdateMute(System.Text.Json.JsonElement r)
    {
        var raise = r.P("raise"); var speak = r.P("speak");
        void Set(string text, Action act, bool enabled, Brush bg = null, Brush fg = null)
        {
            mute.Content = text; mute.IsEnabled = enabled; mute.Background = bg ?? Ui.Chip; mute.Foreground = fg ?? Ui.Fg; muteAction = act;
        }
        if (raise.B("show")) Set("🙋 " + (raise.S("label").Length == 0 ? "通話希望" : raise.S("label")), () => M.E.Cmd(new { type = "raise" }), true);
        else if (speak.B("show")) Set("🎙 " + (speak.S("label").Length == 0 ? "マイクを使う" : speak.S("label")), () => M.E.Cmd(new { type = "speak" }), !speak.B("disabled"));
        else
        {
            bool muted = r.B("muted");
            Set(muted ? "🔇 ミュート解除" : "🎤 ミュート", () => M.E.Cmd(new { type = "mute" }), r.B("canMute"), muted ? Ui.Orange : Ui.Chip, muted ? Ui.White : Ui.Fg);
        }
    }

    /// <summary>取っ手の矢印：左に出すときは、閉じているとき「‹」・開いているとき「›」（右に出すときは逆）。ドロワー本体は、本体の窓の左に出る別窓（MainWindow が出し入れする）。</summary>
    void SetDrawer(bool open)
    {
        drawerShown = open;
        DockPanel.SetDock(handle, M.DrawerRight ? Dock.Right : Dock.Left);      // ドロワーを出す側に、取っ手もつく
        if (((StackPanel)handle.Child).Children[0] is TextBlock chev) chev.Text = (open == !M.DrawerRight) ? "›" : "‹";
        handle.Background = open ? Ui.Line : Ui.Chip;
    }
}
