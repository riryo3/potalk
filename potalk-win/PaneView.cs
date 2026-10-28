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
    readonly TextBlock speaking = Ui.Txt("", 12, Ui.Dim);
    readonly Button mute, leave, pin, spk;
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

        foreach (var b in new[] { roomBody, chatBody, mailBody, settBody }) content.Children.Add(b);

        // 左端の取っ手：押すと、部屋の一覧が左から出入りする
        var hs = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        hs.Children.Add(new TextBlock { Text = "‹", FontSize = 14, FontWeight = FontWeights.Bold, Foreground = Ui.Dim, HorizontalAlignment = HorizontalAlignment.Center, Name = "chev" });
        foreach (var c in "部屋一覧") hs.Children.Add(new TextBlock { Text = c.ToString(), FontSize = 10, Foreground = Ui.Dim, HorizontalAlignment = HorizontalAlignment.Center });
        handle = new Border { Width = HandleW, Background = Ui.Chip, Child = hs, Cursor = System.Windows.Input.Cursors.Hand, ToolTip = "部屋の一覧を開く／閉じる" };
        handle.MouseLeftButtonUp += (_, _) => M.ToggleDrawer();

        // 部屋の画面を見ていないときも、ミュートと退出が手元にあるように
        mute = Ui.Btn("", () => muteAction(), size: 12, bold: true); mute.Width = 130; mute.Margin = new Thickness(8, 0, 8, 0);
        leave = Ui.Btn("🚪 退出", () => M.RequestLeave(Window.GetWindow(this) ?? M.Main), Ui.Red, Ui.White, 12, true); leave.Width = 80;
        var mb = new DockPanel { Margin = new Thickness(12, 8, 12, 8) };
        spk = Ui.Btn("🔈", M.ToggleSpeaker, size: 12, bold: true); spk.Width = 36;
        void SyncSpk() { spk.Content = M.SpeakerMuted ? "🔇" : "🔈"; spk.Background = M.SpeakerMuted ? Ui.Orange : Ui.Chip; spk.Foreground = M.SpeakerMuted ? Ui.White : Ui.Fg; spk.ToolTip = M.SpeakerMuted ? "スピーカーのミュートを解除" : "スピーカーをミュート"; }
        M.SpeakerChanged += SyncSpk; Unloaded += (_, _) => M.SpeakerChanged -= SyncSpk; Loaded += (_, _) => { M.SpeakerChanged -= SyncSpk; M.SpeakerChanged += SyncSpk; SyncSpk(); };
        DockPanel.SetDock(leave, Dock.Right); DockPanel.SetDock(mute, Dock.Right); DockPanel.SetDock(spk, Dock.Right);
        mb.Children.Add(leave); mb.Children.Add(mute); mb.Children.Add(spk); mb.Children.Add(speaking);
        miniBar = new Border { Child = mb, BorderBrush = Ui.Line, BorderThickness = new Thickness(0, 1, 0, 0), Visibility = Visibility.Collapsed };

        pin = Ui.Btn("📌", M.TogglePinSingle, Brushes.Transparent, size: 12); pin.BorderThickness = new Thickness(0); pin.ToolTip = "最前面にする／しない"; pin.Padding = new Thickness(6, 4, 6, 4);

        var bodyDock = new DockPanel();
        DockPanel.SetDock(handle, Dock.Left); bodyDock.Children.Add(handle);
        DockPanel.SetDock(miniBar, Dock.Bottom); bodyDock.Children.Add(miniBar);
        bodyDock.Children.Add(content);
        body.Children.Add(bodyDock);

        var tb = new DockPanel { Background = Ui.Card };
        DockPanel.SetDock(pin, Dock.Right); tb.Children.Add(pin); tb.Children.Add(tabGrid);
        var bar = new Border { Child = tb, BorderBrush = Ui.Line, BorderThickness = new Thickness(0, 0, 0, 1) };

        var root = new DockPanel();
        DockPanel.SetDock(bar, Dock.Top); root.Children.Add(bar);
        root.Children.Add(body);
        Content = root;

        Loaded += (_, _) => { M.PaneChanged += Refresh; M.ChatChanged += Refresh; Refresh(); };
        Unloaded += (_, _) => { M.PaneChanged -= Refresh; M.ChatChanged -= Refresh; };
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
            ("ひとこと", PaneTab.Chat, M.Unread > 0, Ui.Teal),
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
        chatBody.Visibility = M.Tab == PaneTab.Chat ? Visibility.Visible : Visibility.Collapsed;
        mailBody.Visibility = M.Tab == PaneTab.Mail ? Visibility.Visible : Visibility.Collapsed;
        settBody.Visibility = M.Tab == PaneTab.Settings ? Visibility.Visible : Visibility.Collapsed;

        // 部屋の画面を見ていないときの、ミュートと退出
        miniBar.Visibility = M.Tab == PaneTab.Room ? Visibility.Collapsed : Visibility.Visible;
        var names = r.A("members").Where(x => x.B("speaking")).Select(x => x.S("name")).ToList();
        speaking.Text = names.Count == 0 ? "　" : "🔊 " + string.Join("、", names);
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

    /// <summary>取っ手の矢印：閉じているときは「‹」、開いているときは「›」。ドロワー本体は、本体の窓の左に出る別窓（MainWindow が出し入れする）。</summary>
    void SetDrawer(bool open)
    {
        if (open == drawerShown) return;
        drawerShown = open;
        if (((StackPanel)handle.Child).Children[0] is TextBlock chev) chev.Text = open ? "›" : "‹";
        handle.Background = open ? Ui.Line : Ui.Chip;
    }
}
