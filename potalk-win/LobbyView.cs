using System;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace Potalker;

public sealed class LobbyView : UserControl
{
    readonly AppModel M;
    readonly StackPanel list = new() { Margin = new Thickness(12) };
    readonly TextBox search = Ui.Input();
    readonly TextBlock viewers = Ui.Txt("", 12, Ui.Dim);
    readonly Button profBtn, createBtn, notifBtn, pinBtn;
    readonly ComboBox mic = new() { MinWidth = 150, FontSize = 12 };
    bool micBusy;

    readonly bool embedded;     // ドロワーの中（幅がせまいので、最前面のボタンは出さず、マイクは短くする）

    public LobbyView(AppModel m, bool embedded = false)
    {
        M = m; this.embedded = embedded;
        Background = Ui.Bg; Foreground = Ui.Fg; FontFamily = new System.Windows.Media.FontFamily("Yu Gothic UI, Segoe UI, Meiryo UI");

        profBtn = Ui.Btn("設定", M.OpenProfile);
        createBtn = Ui.Btn("🏠 部屋を作る", OpenCreate);
        notifBtn = Ui.Btn("", () => { M.S.NotifyRooms = !M.S.NotifyRooms; M.S.Save(); UpdateNotif(); });
        var help = Ui.Btn("？ これはなに？", M.OpenHelp);
        pinBtn = Ui.Btn("📌 最前面", M.TogglePinSingle, size: 12);
        var refresh = Ui.Btn("🔄 更新", M.RefreshLobby);

        mic.SelectionChanged += (_, _) =>
        {
            if (micBusy || mic.SelectedIndex < 0) return;
            M.SwitchMic(mic.SelectedIndex == 0 ? "" : (string)mic.SelectedItem);
        };
        mic.ToolTip = "次に入室するときから反映されます";
        if (embedded) { mic.MinWidth = 60; mic.MaxWidth = 130; } else mic.MaxWidth = 240;
        search.TextChanged += (_, _) => RefreshLobby();

        var top = new StackPanel { Margin = new Thickness(12, 8, 12, 8) };
        var r1 = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };
        DockPanel.SetDock(mic, Dock.Right); r1.Children.Add(mic);
        r1.Children.Add(profBtn); profBtn.HorizontalAlignment = HorizontalAlignment.Left; profBtn.Margin = new Thickness(0, 0, 8, 0);
        var r2 = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };
        DockPanel.SetDock(pinBtn, Dock.Right);
        var r2L = new StackPanel { Orientation = Orientation.Horizontal };
        help.Margin = new Thickness(0, 0, 8, 0); r2L.Children.Add(help); r2L.Children.Add(createBtn); r2.Children.Add(pinBtn); r2.Children.Add(r2L);
        var r3 = new DockPanel();
        DockPanel.SetDock(refresh, Dock.Right); refresh.Margin = new Thickness(8, 0, 0, 0); r3.Children.Add(refresh);
        r3.Children.Add(search);
        top.Children.Add(r1); top.Children.Add(r2); top.Children.Add(r3);

        var foot = new DockPanel { Margin = new Thickness(12, 8, 12, 8) };
        foot.Children.Add(notifBtn); notifBtn.HorizontalAlignment = HorizontalAlignment.Left;
        viewers.HorizontalAlignment = HorizontalAlignment.Right; foot.Children.Add(viewers);

        var root = new DockPanel();
        DockPanel.SetDock(top, Dock.Top); root.Children.Add(top);
        DockPanel.SetDock(foot, Dock.Bottom); root.Children.Add(foot);
        root.Children.Add(new ScrollViewer { Content = list, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        Content = root;

        // 画面に出ているあいだだけ、更新を受ける（ドロワーで作り直しても、あとに残らない）
        Loaded += (_, _) => { M.E.OnProfile += RefreshProfile; M.MicsChanged += RefreshMicList; M.LobbyRefresh += RefreshLobby; M.PaneChanged += UpdatePin; UpdateNotif(); RefreshMicList(); RefreshProfile(); RefreshLobby(); UpdatePin(); };
        Unloaded += (_, _) => { M.E.OnProfile -= RefreshProfile; M.MicsChanged -= RefreshMicList; M.LobbyRefresh -= RefreshLobby; M.PaneChanged -= UpdatePin; };
        UpdateNotif(); RefreshMicList(); RefreshLobby();
    }

    /// <summary>この部品がのっている窓（確認の表示などの親）</summary>
    Window Win => Window.GetWindow(this) ?? M.Main;

    void UpdatePin()
    {
        pinBtn.Visibility = M.S.SinglePane && !embedded ? Visibility.Visible : Visibility.Collapsed;
        pinBtn.Background = M.S.PinSingle ? Ui.TealSoft : Ui.Chip;
    }

    void UpdateNotif()
    {
        notifBtn.Content = M.S.NotifyRooms ? "🔔 部屋の通知：オン" : "🔕 部屋の通知：オフ";
        notifBtn.Background = M.S.NotifyRooms ? Ui.TealSoft : Ui.Chip;
    }

    void RefreshProfile()
    {
        var p = M.E.Profile;
        var n = p.S("name");
        profBtn.Content = $"{p.S("emoji")} {(n.Length == 0 ? "設定" : n)}";
        M.Prof?.Refresh();
    }

    void RefreshMicList()
    {
        micBusy = true;
        mic.Items.Clear();
        mic.Items.Add("🎤 既定のマイク");
        foreach (var n in M.Mics) mic.Items.Add(n);
        var i = M.S.MicLabel.Length == 0 ? 0 : M.Mics.IndexOf(M.S.MicLabel) + 1;
        mic.SelectedIndex = Math.Max(i, 0);
        micBusy = false;
    }

    string LinkId()
    {
        var v = search.Text.Trim();
        var i = v.IndexOf("#room=", StringComparison.Ordinal);
        if (i < 0) return null;
        var id = v[(i + 6)..].Split('&', ' ')[0];
        return Uri.UnescapeDataString(id);
    }

    void OpenCreate()
    {
        var w = Ui.Base("部屋を作る", 420, 280, Win); w.ResizeMode = ResizeMode.NoResize; w.SizeToContent = SizeToContent.Height;
        var pn = M.E.Profile.S("name");
        var name = Ui.Input(pn.Length == 0 ? "" : (pn + "の部屋"), 30);
        var chat = new RadioButton { Content = "🏠 雑談部屋にする（全員で話せます）", IsChecked = true, Margin = new Thickness(0, 10, 0, 4), Foreground = Ui.Fg };
        var bc = new RadioButton { Content = "📣 配信部屋にする（あなたの声だけ流れます）", Foreground = Ui.Fg };
        var sp = new StackPanel { Margin = new Thickness(18) };
        sp.Children.Add(Ui.Txt("🏠 部屋を作る", 16, bold: true));
        sp.Children.Add(new TextBlock { Text = "部屋名（30文字まで）", Foreground = Ui.Dim, FontSize = 12, Margin = new Thickness(0, 10, 0, 3) });
        var nameRow = new DockPanel(); var nc = Ui.Counter(name, 30); DockPanel.SetDock(nc, Dock.Right); nameRow.Children.Add(nc); nameRow.Children.Add(name);
        sp.Children.Add(nameRow); sp.Children.Add(chat); sp.Children.Add(bc);
        var ok = Ui.Btn("部屋を作る", () =>
        {
            var t = name.Text.Trim(); if (t.Length == 0) return;
            M.CreateRoom(t, bc.IsChecked == true); w.Close();
        }, Ui.Accent, Ui.White, bold: true);
        var cancel = Ui.Btn("キャンセル", () => w.Close()); cancel.Margin = new Thickness(0, 0, 8, 0);
        var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 16, 0, 0) };
        row.Children.Add(cancel); row.Children.Add(ok); sp.Children.Add(row);
        w.Content = sp; name.Focus(); w.ShowDialog();
    }

    void AskJoin(JsonElement r)
    {
        bool bcast = r.B("bc"), joined = M.E.Joined;
        var w = Ui.Base("部屋に参加", 420, 200, Win); w.ResizeMode = ResizeMode.NoResize; w.SizeToContent = SizeToContent.Height;
        var sp = new StackPanel { Margin = new Thickness(18) };
        sp.Children.Add(Ui.Txt($"「{(bcast ? "📣 " : "")}{r.S("name")}」に{(joined ? "移りますか？ いまの部屋を退出します" : "参加しますか？")}", 15, bold: true, wrap: true));
        sp.Children.Add(new TextBlock { Text = bcast ? "聞き役で入室します（マイクは使いません）" : "ミュート状態で入室します", Foreground = Ui.Dim, FontSize = 12.5, Margin = new Thickness(0, 6, 0, 0) });
        var quiet = new CheckBox { Content = "🤫 静かに入る（名前を出さずに聞きます）", Margin = new Thickness(0, 10, 0, 0), Visibility = bcast ? Visibility.Visible : Visibility.Collapsed };
        sp.Children.Add(quiet);
        var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 16, 0, 0) };
        var cancel = Ui.Btn("やめる", () => w.Close()); cancel.Margin = new Thickness(0, 0, 8, 0);
        var id = r.S("id");
        row.Children.Add(cancel);
        row.Children.Add(Ui.Btn(joined ? "移る" : "参加する", () => { M.Join(id, quiet.IsChecked == true); w.Close(); }, Ui.Accent, Ui.White, bold: true));
        sp.Children.Add(row);
        w.Content = sp; w.ShowDialog();
    }

    /// <summary>検索用に、表記の違いをそろえる：全角と半角（英数もカナも）、大文字と小文字、ひらがなとカタカナ。漢字とかなは、そろえない。</summary>
    public static string Fold(string s)
    {
        var n = s.Normalize(System.Text.NormalizationForm.FormKC).ToLowerInvariant();
        var sb = new System.Text.StringBuilder(n.Length);
        foreach (var c in n) sb.Append(c >= 'ぁ' && c <= 'ゖ' ? (char)(c + 0x60) : c);   // ひらがな → カタカナ
        return sb.ToString();
    }

    public void RefreshLobby()
    {
        var L = M.E.Lobby;
        viewers.Text = L.S("viewers");
        createBtn.IsEnabled = !M.E.Joined;
        list.Children.Clear();
        var rooms = L.A("rooms").ToList();
        var q = search.Text.Trim();
        var link = LinkId();
        if (q.Length > 0)
            rooms = link != null ? rooms.Where(r => r.S("id") == link).ToList()
                : rooms.Where(r => new[] { r.S("name"), r.S("sub"), r.S("subBy") }.Concat(r.A("people").Select(p => p.S("name")))
                    .Any(s => Fold(s).Contains(Fold(q), StringComparison.Ordinal))).ToList();
        if (rooms.Count == 0)
        {
            var sp = new StackPanel { Margin = new Thickness(0, 30, 0, 0) };
            if (q.Length > 0 && link != null)
            {
                sp.Children.Add(Ui.Txt("このリンクの部屋は、いま通話中の一覧にありません（お休み中かもしれません）。", 13, Ui.Dim, wrap: true));
                var b = Ui.Btn("このリンクの部屋に入ってみる", () => { var link = search.Text; search.Text = ""; M.OpenRoomLink(link); }); b.Margin = new Thickness(0, 10, 0, 0);
                sp.Children.Add(b);
            }
            else sp.Children.Add(Ui.Txt(q.Length > 0 ? $"「{q}」に合う部屋は見つかりません。" : "いま通話中の部屋はありません", 13, Ui.Dim));
            list.Children.Add(sp);
            return;
        }
        foreach (var r in rooms) list.Children.Add(RoomCard(r));
    }

    UIElement RoomCard(JsonElement r)
    {
        var sp = new StackPanel();
        var head = new DockPanel();
        var copy = Ui.Btn("🔗", null, Ui.Card, size: 12); copy.ToolTip = "部屋名とリンクをコピー";
        copy.Click += (_, e) =>
        {
            try
            {
                var link = $"https://potalk.app/#room={Uri.EscapeDataString(r.S("id"))}&name={Uri.EscapeDataString(r.S("name"))}";
                Clipboard.SetText($"{r.S("name")}\n{(M.S.ShortLinks ? Links.StripName(link) : link)}");
            }
            catch { }
            copy.Content = "✓"; var t = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(1.4) };
            t.Tick += (_, _) => { copy.Content = "🔗"; t.Stop(); }; t.Start();
            e.Handled = true;
        };
        DockPanel.SetDock(copy, Dock.Right); head.Children.Add(copy);
        var cnt = Ui.Txt(r.S("count"), 13, Ui.Teal, bold: true); cnt.Margin = new Thickness(8, 0, 8, 0);
        DockPanel.SetDock(cnt, Dock.Right); head.Children.Add(cnt);
        head.Children.Add(Ui.Txt(r.S("name"), 15, bold: true, wrap: true));
        sp.Children.Add(head);
        if (r.S("sub").Length > 0)
        {
            var s = new StackPanel { Orientation = Orientation.Horizontal };
            var sub = Ui.Txt("", 12, bold: true); Links.Fill(sub, r.S("sub"), u => M.ConfirmOpen(u, Win));
            var subBy = Ui.Txt("", 12, Ui.Dim); Links.Fill(subBy, r.S("subBy"), u => M.ConfirmOpen(u, Win));
            s.Children.Add(sub); s.Children.Add(subBy);
            sp.Children.Add(s);
        }
        sp.Children.Add(Ui.Txt(r.S("dur"), 11, Ui.Dim));
        var people = new WrapPanel { Margin = new Thickness(0, 5, 0, 0) };
        foreach (var p in r.A("people"))
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal };
            row.Children.Add(Ui.Txt(p.S("em"), 13)); var nm = Ui.Txt(p.S("name"), 12); nm.Margin = new Thickness(4, 0, 0, 0); row.Children.Add(nm);
            if (p.B("muted")) { var m = Ui.Txt("🔇", 10); m.Margin = new Thickness(3, 0, 0, 0); row.Children.Add(m); }
            var chip = Ui.Panel(row, Ui.Chip, 12, new Thickness(8, 2, 8, 2)); chip.BorderThickness = new Thickness(0); chip.Margin = new Thickness(0, 0, 5, 4);
            people.Children.Add(chip);
        }
        sp.Children.Add(people);
        var card = Ui.Panel(sp); card.Margin = new Thickness(0, 0, 0, 8);
        if (r.S("id").Length > 0)
        {
            card.Cursor = Cursors.Hand;
            card.MouseLeftButtonUp += (_, e) => { if (!Links.IsOnLink(e.OriginalSource)) AskJoin(r); };
        }
        return card;
    }
}
