using System;
using System.Windows;
using System.Windows.Controls;

namespace Potalker;

/// <summary>本体の窓の上のメニュー（Mac 版の「通話」「ウインドウ」に当たる）。ショートカットは Shortcuts.cs と同じ。</summary>
public static class MenuBar
{
    public const double Height = 24;

    public static Menu Build(AppModel m)
    {
        var bar = new Menu { Height = Height, Background = Ui.Card, Foreground = Ui.Fg, FontFamily = new System.Windows.Media.FontFamily("Yu Gothic UI, Segoe UI, Meiryo UI"), FontSize = 12.5 };
        MenuItem Item(string title, string keys, Action act, Action<MenuItem> refresh = null, MenuItem parent = null)
        {
            var it = new MenuItem { Header = title, InputGestureText = keys };
            it.Click += (_, _) => act();
            if (refresh != null) parent.SubmenuOpened += (_, _) => refresh(it);
            return it;
        }

        // 通話
        var call = new MenuItem { Header = "通話(_C)" };
        var mic = Item("マイクのミュート", "Ctrl+Shift+M", m.ToggleMic, i => i.IsEnabled = m.E.Joined && m.E.Room.B("canMute"), call);
        var spk = Item("スピーカーのミュート", "Ctrl+Shift+S", m.ToggleSpeaker, i => { i.IsEnabled = m.E.Joined; i.IsChecked = m.SpeakerMuted; }, call);
        call.Items.Add(mic); call.Items.Add(spk);

        // ウインドウ
        var win = new MenuItem { Header = "ウインドウ(_W)" };
        win.Items.Add(Item("メインウインドウ", "Ctrl+1", m.FocusMain));
        win.Items.Add(Item("シングルペインで表示", "Ctrl+Shift+P", () => m.SetSinglePane(!m.S.SinglePane), i => i.IsChecked = m.S.SinglePane, win));
        var size = new MenuItem { Header = "表示サイズ" };
        foreach (var pct in new[] { 100, 90, 80, 70, 60, 50 })
        {
            var p = pct;
            var it = new MenuItem { Header = p + "%", IsCheckable = false };
            it.Click += (_, _) => m.SetSingleScale(p / 100.0);
            size.Items.Add(it);
        }
        win.SubmenuOpened += (_, _) =>
        {
            foreach (MenuItem it in size.Items) it.IsChecked = Math.Abs(m.S.SingleScale * 100 - int.Parse(((string)it.Header).TrimEnd('%'))) < 1;
        };
        win.Items.Add(size);
        win.Items.Add(new Separator());
        win.Items.Add(Item("部屋", "Ctrl+2", m.ShowRoom, i => i.IsEnabled = m.E.Joined, win));
        win.Items.Add(Item("ひとこと", "Ctrl+3", m.OpenChat, i => i.IsEnabled = m.E.Joined, win));
        win.Items.Add(Item("おたより", "Ctrl+4", m.OpenMail, i => i.IsEnabled = m.CanShowMail, win));
        win.Items.Add(Item("部屋の設定", "Ctrl+5", m.OpenSettings, i => i.IsEnabled = m.E.Joined, win));
        win.Items.Add(new Separator());
        win.Items.Add(Item("部屋一覧を開く／閉じる", "Ctrl+L", m.ToggleDrawer, i => i.IsEnabled = m.E.Joined && m.S.SinglePane, win));
        win.Items.Add(Item("次のタブ", "Ctrl+]", () => m.CycleTab(1), i => i.IsEnabled = m.E.Joined && m.S.SinglePane, win));
        win.Items.Add(Item("前のタブ", "Ctrl+[", () => m.CycleTab(-1), i => i.IsEnabled = m.E.Joined && m.S.SinglePane, win));
        win.Items.Add(new Separator());
        win.Items.Add(Item("自衛ワードの登録…", "", m.OpenBanned));
        win.Items.Add(new Separator());
        win.Items.Add(Item("ウインドウの位置と大きさを初期に戻す", "", () =>
        {
            m.S.Windows.Clear(); m.S.Save();
            MessageBox.Show(m.Main, "次にウィンドウを開くときから、初期の配置に戻ります。", "Potalker");
        }));

        // ヘルプ
        var help = new MenuItem { Header = "ヘルプ(_H)" };
        help.Items.Add(Item("初期設定…", "", m.OpenProfile));
        help.Items.Add(Item("これはなに？", "", m.OpenHelp));

        bar.Items.Add(call); bar.Items.Add(win); bar.Items.Add(help);
        return bar;
    }
}
