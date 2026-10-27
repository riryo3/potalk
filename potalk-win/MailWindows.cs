using System;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Potalker;

/// <summary>おたより（配信部屋）：募集・届いたお便り・公開の操作。</summary>
public sealed class MailWindow : Window
{
    readonly AppModel M;
    readonly StackPanel head = new() { Margin = new Thickness(12) }, body = new() { Margin = new Thickness(10) };
    readonly ScrollViewer sv;
    readonly TextBox input = Ui.Input();
    readonly TextBlock ph = Ui.Txt("", 12, Ui.Dim), counter = Ui.Txt("", 11, Ui.Dim);
    readonly Button send;
    readonly Border form;
    readonly TextBlock off = Ui.Txt("配信部屋のときだけ使えます。", 13, Ui.Dim);
    int max;
    string key = "";

    public MailWindow(AppModel m)
    {
        M = m;
        Title = "おたより"; Width = 380; Height = 500; MinWidth = 300; MinHeight = 280; Topmost = true;
        Background = Ui.Bg; Foreground = Ui.Fg; FontFamily = new FontFamily("Yu Gothic UI, Segoe UI, Meiryo UI");
        var wa = SystemParameters.WorkArea; Left = Math.Max(wa.Left, wa.Right - 400 - Width - 8); Top = wa.Top + 80;
        WindowStartupLocation = WindowStartupLocation.Manual;

        sv = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        send = Ui.Btn("送る", Send, Ui.Accent, Ui.White, bold: true);
        var row = new DockPanel { Margin = new Thickness(0, 4, 0, 0) };
        DockPanel.SetDock(send, Dock.Right); send.Margin = new Thickness(6, 0, 0, 0);
        DockPanel.SetDock(counter, Dock.Right); counter.Margin = new Thickness(6, 0, 0, 0);
        row.Children.Add(send); row.Children.Add(counter); row.Children.Add(input);
        var fp = new StackPanel { Margin = new Thickness(8) }; fp.Children.Add(ph); fp.Children.Add(row);
        form = new Border { Child = fp, BorderBrush = Ui.Line, BorderThickness = new Thickness(0, 1, 0, 0) };
        input.KeyDown += (_, e) => { if (e.Key == System.Windows.Input.Key.Enter) Send(); };
        input.TextChanged += (_, _) => { counter.Text = max > 0 && max < 100000 ? $"{input.Text.Length}/{max}" : ""; };

        var dock = new DockPanel();
        DockPanel.SetDock(head, Dock.Top); dock.Children.Add(head);
        DockPanel.SetDock(form, Dock.Bottom); dock.Children.Add(form);
        dock.Children.Add(sv);
        var root = new Grid(); root.Children.Add(dock); off.HorizontalAlignment = HorizontalAlignment.Center; off.VerticalAlignment = VerticalAlignment.Center; root.Children.Add(off);
        Content = root;

        M.S.Remember(this, "mail"); Snap.Attach(this, M);
        Closed += (_, _) => { M.Mail = null; M.MailOpen = false; M.RoomWindowRefresh(); };
        Refresh();
    }

    /// <summary>シングルペイン用：窓から中身だけを取り出す（窓は表示しない）。</summary>
    public UIElement Detach() { var c = (UIElement)Content; Content = null; return c; }

    void Send()
    {
        var t = input.Text.Trim(); if (t.Length == 0) return;
        M.E.Cmd(new { type = "mailsend", text = t }); input.Text = "";
    }

    Button MailBtn(JsonElement b)
    {
        int i = int.TryParse(b.S("i"), out var n) ? n : 0;
        var on = b.B("on") || b.S("label").Contains("公開中");
        var btn = Ui.Btn(b.S("label"), () => M.E.Cmd(new { type = "mailbtn", i }), on ? Ui.TealSoft : Ui.Chip, size: 12);
        btn.Margin = new Thickness(4, 0, 0, 0);
        if (on) btn.BorderBrush = Ui.Teal;
        return btn;
    }

    public void Refresh()
    {
        var r = M.E.Room;
        bool bcast = r.B("bcast");
        off.Visibility = bcast ? Visibility.Collapsed : Visibility.Visible;
        sv.Visibility = head.Visibility = bcast ? Visibility.Visible : Visibility.Collapsed;
        var mail = r.P("mail");
        var form_ = mail.P("form");
        form.Visibility = bcast && form_.Has() ? Visibility.Visible : Visibility.Collapsed;
        if (form_.Has())
        {
            ph.Text = form_.S("ph"); send.Content = form_.S("btn");
            max = int.TryParse(form_.S("max"), out var mx) ? mx : 0;
            input.MaxLength = max > 0 && max < 100000 ? max : 0;
        }
        // 内容が同じなら作り直さない（スクロール位置が戻るのを避ける）
        var k = mail.GetRawText() + bcast;
        if (k == key) return;
        key = k;
        var off_ = sv.VerticalOffset;
        head.Children.Clear(); body.Children.Clear();
        foreach (var h in mail.A("head"))
        {
            var row = new WrapPanel { Margin = new Thickness(0, 0, 0, 4) };
            if (h.S("text").Length > 0) row.Children.Add(Ui.Txt(h.S("text"), 13));
            foreach (var b in h.A("btns")) row.Children.Add(MailBtn(b));
            head.Children.Add(row);
        }
        foreach (var b in mail.A("body"))
        {
            if (b.B("item"))
            {
                var g = new DockPanel();
                var btns = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Top };
                foreach (var x in b.A("btns")) btns.Children.Add(MailBtn(x));
                DockPanel.SetDock(btns, Dock.Right); g.Children.Add(btns);
                var t = new StackPanel();
                t.Children.Add(Ui.Txt($"{b.S("em")} {b.S("who")}", 12, Ui.Dim));
                t.Children.Add(Ui.Txt(b.S("text"), 13, wrap: true));
                g.Children.Add(t);
                var card = Ui.Panel(g, Ui.Card, 10, new Thickness(10)); card.Margin = new Thickness(0, 0, 0, 6);
                if (b.B("shown")) { card.BorderBrush = Ui.Accent; card.BorderThickness = new Thickness(1.5); }
                body.Children.Add(card);
            }
            else body.Children.Add(Ui.Txt(b.S("text"), 12, Ui.Dim, wrap: true));
        }
        sv.ScrollToVerticalOffset(off_);
    }
}

/// <summary>公開中のお便りを、大きく見せる小窓。</summary>
public sealed class LetterWindow : Window
{
    readonly AppModel M;
    readonly TextBlock cap = Ui.Txt("", 13, Ui.Dim), who = Ui.Txt("", 15, Ui.Accent), text = new() { FontSize = 22, TextWrapping = TextWrapping.Wrap };

    public LetterWindow(AppModel m)
    {
        M = m;
        ShowActivated = false; Title = "公開中のお便り"; Width = 440; Height = 250; MinWidth = 300; MinHeight = 160; Topmost = true;
        Background = Ui.Bg; Foreground = Ui.Fg; FontFamily = new FontFamily("Yu Gothic UI, Segoe UI, Meiryo UI");
        var wa = SystemParameters.WorkArea; Left = wa.Left + (wa.Width - Width) / 2; Top = wa.Top + 60;
        WindowStartupLocation = WindowStartupLocation.Manual;
        var sp = new StackPanel { Margin = new Thickness(24) };
        sp.Children.Add(cap); who.Margin = new Thickness(0, 10, 0, 10); sp.Children.Add(who); sp.Children.Add(text);
        Content = new ScrollViewer { Content = sp, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        M.S.Remember(this, "letter"); Snap.Attach(this, M);
        Closed += (_, _) => M.LetterClosed();
        Refresh();
    }

    public void Refresh()
    {
        var mn = M.E.Room.P("mailNow");
        cap.Text = mn.S("cap");
        who.Text = mn.S("who").Trim('：', ':', ' ');
        text.Text = mn.S("text");
    }
}
