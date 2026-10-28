using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Potalker;

/// <summary>「これはなに？」と、初回起動のごあいさつ（作者への謝辞）。</summary>
public static class HelpWindows
{
    public const string Site = "https://potalk.app/", Source = "https://github.com/po-talk/po-talk.github.io";

    static TextBlock Link(string text, string url)
    {
        var tb = new TextBlock { FontSize = 12.5, Margin = new Thickness(0, 3, 0, 3) };
        var h = new System.Windows.Documents.Hyperlink(new System.Windows.Documents.Run(text));
        h.Click += (_, _) => Engine.OpenExternal(url); Links.CopyMenu(h, url);
        tb.Inlines.Add(h);
        return tb;
    }

    /// <summary>初回の起動で出す。「次から表示しない」は、はじめからチェック済み（はずして閉じると、次の起動でも出る）。</summary>
    public static void ShowThanksIfFirst(AppModel m)
    {
        if (m.S.ThanksHidden) return;
        var w = Ui.Base("Potalker", 460, 300, m.Main);
        w.ResizeMode = ResizeMode.NoResize; w.SizeToContent = SizeToContent.Height;
        var sp = new StackPanel { Margin = new Thickness(22) };
        sp.Children.Add(Ui.Txt("くらもさんへ、ありがとうございます", 17, bold: true, wrap: true));
        var body = Ui.Txt("Potalker は、くらもさんが作った「ぽっと通話」の、非公式クライアントです。通話の仕組みは、くらもさんのサイトをそのまま使わせてもらっています。\n\n" +
                          "こんなに気軽に話せる、すてきな場所を公開してくださって、ありがとうございます。「これはなに？」からも、読み返せます。", 13, wrap: true);
        body.Margin = new Thickness(0, 10, 0, 10); sp.Children.Add(body);
        sp.Children.Add(Link("ぽっと通話（Web アプリ）　potalk.app", Site));
        sp.Children.Add(Link("ソース（GitHub）　po-talk/po-talk.github.io", Source));
        var hide = new CheckBox { Content = "次から表示しない", IsChecked = true, Margin = new Thickness(0, 14, 0, 0) };
        sp.Children.Add(hide);
        var ok = Ui.Btn("はじめる", () => w.Close(), Ui.Accent, Ui.White, bold: true);
        ok.HorizontalAlignment = HorizontalAlignment.Right; ok.Padding = new Thickness(18, 6, 18, 6); ok.Margin = new Thickness(0, 14, 0, 0);
        sp.Children.Add(ok);
        w.Content = sp;
        w.Closed += (_, _) => { m.S.ThanksHidden = hide.IsChecked == true; m.S.Save(); };
        w.ShowDialog();
    }

    public static void ShowHelp(AppModel m)
    {
        if (m.Help != null) { m.Help.Activate(); return; }
        var w = Ui.Base("ぽっと通話：これはなに？", 460, 560, m.Main);
        w.MinWidth = 380; w.MinHeight = 420; w.WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var sp = new StackPanel { Margin = new Thickness(20) };
        var warn = Ui.Panel(Ui.Txt("⚠️ Potalker は、ぽっと通話（potalk.app）の「非公式」クライアントです。サイトの作者とは関係がありません。", 12, bold: true, wrap: true),
            Color("#fdecd6"), 8, new Thickness(10));
        warn.BorderThickness = new Thickness(0); sp.Children.Add(warn);
        var h = Ui.Txt("🫖 ぽっと通話とは", 20, bold: true); h.Margin = new Thickness(0, 14, 0, 8); sp.Children.Add(h);
        sp.Children.Add(Ui.Txt("登録なし・インストールなしで、居合わせた人と声だけで話せる小さなお茶の席です。同じ部屋を開いた人どうしが、そのまま話せます。", 13, wrap: true));
        var cau = Ui.Txt("⚠️ 実験中です。ご利用は自己責任で！", 14, Ui.Orange, bold: true); cau.Margin = new Thickness(0, 10, 0, 10); sp.Children.Add(cau);
        sp.Children.Add(Link("はじめに（初めての方へ）", "https://potalk.app/start/"));
        sp.Children.Add(Link("使い方（画面の順に説明）", "https://potalk.app/manual/"));
        sp.Children.Add(Link("しくみ（サーバなしで動く理由）", "https://potalk.app/tech/"));
        sp.Children.Add(Link("運営（制作者と方針）", "https://potalk.app/about/"));
        sp.Children.Add(Link("ソース（po-talk/po-talk.github.io）", Source));
        var kh = Ui.Txt("⌨ キーボードショートカット", 14, bold: true); kh.Margin = new Thickness(0, 14, 0, 4); sp.Children.Add(kh);
        var keys = new Grid();
        keys.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(120) });
        keys.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        (string, string)[] rows =
        {
            ("Ctrl+1", "メインウインドウ（本体の窓を前に出す）"),
            ("Ctrl+Shift+P", "シングルペイン（1つの窓にまとめる）のオン・オフ"),
            ("Ctrl+2", "部屋（シングルペインでは「部屋」のタブ）"),
            ("Ctrl+3", "ひとこと"),
            ("Ctrl+4", "おたより（配信部屋のとき）"),
            ("Ctrl+5", "部屋の設定"),
            ("Ctrl+Shift+M", "マイクのミュート"),
            ("Ctrl+Shift+S", "スピーカーのミュート"),
            ("Ctrl+L", "部屋一覧を開く／閉じる（シングルペイン）"),
            ("Ctrl+]　Ctrl+[", "次のタブ／前のタブ（シングルペイン）"),
        };
        for (int i = 0; i < rows.Length; i++)
        {
            keys.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var a = Ui.Txt(rows[i].Item1, 12, bold: true); a.Margin = new Thickness(0, 2, 6, 2); Grid.SetRow(a, i);
            var b = Ui.Txt(rows[i].Item2, 12, wrap: true); b.Margin = new Thickness(0, 2, 0, 2); Grid.SetRow(b, i); Grid.SetColumn(b, 1);
            keys.Children.Add(a); keys.Children.Add(b);
        }
        sp.Children.Add(keys);
        sp.Children.Add(Ui.Txt("入室していないあいだは、メインウインドウとシングルペインの切り替えだけが使えます。", 11, Ui.Dim, wrap: true));
        var thx = Ui.Txt("🙏 ぽっと通話を作ってくださった くらもさん に、感謝しています。通話の仕組みは、くらもさんのサイトをそのまま使わせてもらっています。", 12, wrap: true);
        thx.Margin = new Thickness(0, 12, 0, 0); sp.Children.Add(thx);
        var line = new Border { Height = 1, Background = Ui.Line, Margin = new Thickness(0, 14, 0, 10) }; sp.Children.Add(line);
        sp.Children.Add(Ui.Txt("Potalker は、通話の仕組みに potalk.app をそのまま使い、画面だけを Windows 用に作り直した非公式のアプリです。", 11, Ui.Dim, wrap: true));
        w.Content = new ScrollViewer { Content = sp, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        m.S.Remember(w, "help"); Snap.Attach(w, m);
        w.Closed += (_, _) => m.Help = null;
        m.Help = w; w.Show();
    }

    static Brush Color(string hex) => Ui.Color(hex);
}
