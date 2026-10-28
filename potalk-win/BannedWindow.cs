using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Potalker;

/// <summary>自衛ワードの登録の窓（見たくない部屋に近づかないための、Potalker 独自の機能）。</summary>
public sealed class BannedWindow : Window
{
    readonly AppModel M;
    readonly TextBox input = Ui.Input("", 30);
    readonly WrapPanel chips = new() { Margin = new Thickness(0, 6, 0, 0) };
    readonly TextBlock dup = Ui.Txt("すでに登録されています。", 12, Ui.Orange), note = Ui.Txt("", 12, Ui.Dim, wrap: true), count = Ui.Txt("", 12, Ui.Dim);
    readonly Button export;

    public BannedWindow(AppModel m)
    {
        M = m;
        Title = "自衛ワード"; Width = 440; Height = 520; MinWidth = 360; MinHeight = 320;
        Background = Ui.Bg; Foreground = Ui.Fg; FontFamily = new FontFamily("Yu Gothic UI, Segoe UI, Meiryo UI");
        WindowStartupLocation = WindowStartupLocation.CenterOwner; Owner = M.Main;
        var sp = new StackPanel { Margin = new Thickness(18) };
        sp.Children.Add(Ui.Txt("ここに登録した言葉を含む部屋は、部屋の一覧に出しません。", 13, wrap: true));
        sp.Children.Add(Ui.Txt("部屋の名前・話題タグ・いまいる人の名前を見ます。全角半角・大文字小文字・ひらがなカタカナは、区別しません。", 11.5, Ui.Dim, wrap: true));
        var add = Ui.Btn("登録", Add, Ui.Accent, Ui.White, bold: true); add.Margin = new Thickness(8, 0, 0, 0);
        var row = new DockPanel { Margin = new Thickness(0, 12, 0, 0) };
        DockPanel.SetDock(add, Dock.Right); row.Children.Add(add); row.Children.Add(input);
        input.KeyDown += (_, e) => { if (e.Key == System.Windows.Input.Key.Enter) Add(); };
        input.TextChanged += (_, _) => dup.Visibility = Visibility.Collapsed;
        sp.Children.Add(row);
        dup.Visibility = Visibility.Collapsed; dup.Margin = new Thickness(0, 4, 0, 0); sp.Children.Add(dup);
        export = Ui.Btn("書き出し…", Export, size: 12); var imp = Ui.Btn("読み込み…", Import, size: 12); imp.Margin = new Thickness(8, 0, 0, 0);
        var io = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 12, 0, 0) };
        io.Children.Add(export); io.Children.Add(imp); sp.Children.Add(io);
        note.Margin = new Thickness(0, 6, 0, 0); sp.Children.Add(note);
        var head = new DockPanel { Margin = new Thickness(0, 14, 0, 0) };
        DockPanel.SetDock(count, Dock.Right); head.Children.Add(count); head.Children.Add(Ui.Txt("登録したワード（新しい順）", 12, Ui.Dim));
        sp.Children.Add(head); sp.Children.Add(chips);
        Content = new ScrollViewer { Content = sp, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        M.BannedChanged += Rebuild; Closed += (_, _) => { M.BannedChanged -= Rebuild; M.Banned = null; };
        Rebuild(); input.Focus();
    }

    void Add()
    {
        var t = input.Text.Trim(); if (t.Length == 0) return;
        if (M.AddBanned(t)) { input.Text = ""; note.Text = ""; } else dup.Visibility = Visibility.Visible;
    }

    void Rebuild()
    {
        chips.Children.Clear();
        var words = M.S.BannedWords;
        count.Text = $"{words.Count}件"; export.IsEnabled = words.Count > 0;
        if (words.Count == 0) { chips.Children.Add(Ui.Txt("まだ登録されていません。", 13, Ui.Dim)); return; }
        foreach (var w in words.ToList())
        {
            var b = Ui.Btn(w, () =>
            {
                if (Ui.Ask(this, "このワードを消しますか？", $"「{w}」を消すと、このワードを含む部屋が、また一覧に出ます。", "消す", "やめる", Ui.Red)) M.RemoveBanned(w);
            }, size: 13);
            b.ToolTip = "押すと、消すかどうかを聞きます"; b.Margin = new Thickness(0, 0, 6, 6);
            chips.Children.Add(b);
        }
    }

    void Export()
    {
        var dlg = new Microsoft.Win32.SaveFileDialog { FileName = AppModel.BannedFileName(), Filter = "テキスト (*.txt)|*.txt", DefaultExt = ".txt" };
        if (dlg.ShowDialog(this) != true) return;
        try { File.WriteAllText(dlg.FileName, string.Join("\n", M.S.BannedWords) + "\n", new UTF8Encoding(false)); note.Text = $"{M.S.BannedWords.Count}件を書き出しました。"; }
        catch (Exception e) { note.Text = "書き出せませんでした：" + e.Message; }
    }

    void Import()
    {
        var dlg = new Microsoft.Win32.OpenFileDialog { Filter = "テキスト (*.txt)|*.txt|すべて (*.*)|*.*" };
        if (dlg.ShowDialog(this) != true) return;
        try
        {
            var (added, skipped) = M.ImportBanned(File.ReadAllText(dlg.FileName, new UTF8Encoding(false)));
            note.Text = skipped > 0 ? $"{added}件を足しました（登録済み・重複 {skipped}件は飛ばしました）。" : $"{added}件を足しました。";
        }
        catch (Exception e) { note.Text = "読み込めませんでした：" + e.Message; }
    }
}
