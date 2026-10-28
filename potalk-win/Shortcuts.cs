using System.Windows;
using System.Windows.Input;

namespace Potalker;

/// <summary>
/// キーボードのショートカット（Mac 版のウインドウメニューの Windows 版。⌘ は Ctrl に読み替え）。
/// アプリのどの窓からでも効く。入室していないあいだは、本体と、シングルペインの切り替えだけ。
/// </summary>
public static class Shortcuts
{
    public static void Install(AppModel m)
    {
        EventManager.RegisterClassHandler(typeof(Window), Keyboard.PreviewKeyDownEvent, new KeyEventHandler((_, e) =>
        {
            var mods = Keyboard.Modifiers;
            var k = e.Key == Key.System ? e.SystemKey : e.Key;
            bool joined = m.E.Joined;
            bool handled = true;

            if (mods == (ModifierKeys.Control | ModifierKeys.Shift) && k == Key.P) m.SetSinglePane(!m.S.SinglePane);
            else if (mods == (ModifierKeys.Control | ModifierKeys.Shift) && k == Key.S) { if (joined) m.ToggleSpeaker(); else handled = false; }
            else if (mods == (ModifierKeys.Control | ModifierKeys.Shift) && k == Key.M) { if (joined) m.ToggleMic(); else handled = false; }
            else if (mods == ModifierKeys.Control)
            {
                switch (k)
                {
                    case Key.D1: case Key.NumPad1: m.FocusMain(); break;                                   // メインウインドウ
                    case Key.D2: case Key.NumPad2: if (joined) m.ShowRoom(); else handled = false; break;   // 部屋
                    case Key.D3: case Key.NumPad3: if (joined) m.OpenChat(); else handled = false; break;   // ひとこと
                    case Key.D4: case Key.NumPad4: if (m.CanShowMail) m.OpenMail(); else handled = false; break;   // おたより（配信部屋のみ）
                    case Key.D5: case Key.NumPad5: if (joined) m.OpenSettings(); else handled = false; break;      // 部屋の設定
                    case Key.L: if (m.S.SinglePane && joined) m.ToggleDrawer(); else handled = false; break;       // 部屋一覧
                    case Key.OemCloseBrackets: if (m.S.SinglePane && joined) m.CycleTab(1); else handled = false; break;    // 次のタブ
                    case Key.OemOpenBrackets: if (m.S.SinglePane && joined) m.CycleTab(-1); else handled = false; break;    // 前のタブ
                    default: handled = false; break;
                }
            }
            else handled = false;
            if (handled) e.Handled = true;
        }));
    }
}
