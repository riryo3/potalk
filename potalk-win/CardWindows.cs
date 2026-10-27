using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Potalker;

/// <summary>名刺（プロフィールカード）の設定。ページの入力欄と同期して、保存はページに任せる。</summary>
public sealed class CardEditWindow : Window
{
    readonly AppModel M;
    Engine E => M.E;
    readonly List<Action<JsonElement>> ups = new();

    public CardEditWindow(AppModel m)
    {
        M = m;
        Title = "名刺の設定"; Width = 520; Height = 740; MinWidth = 460; MinHeight = 520;
        Background = Ui.Bg; Foreground = Ui.Fg; FontFamily = new FontFamily("Yu Gothic UI, Segoe UI, Meiryo UI");
        WindowStartupLocation = WindowStartupLocation.CenterScreen;

        var sp = new StackPanel { Margin = new Thickness(18) };
        sp.Children.Add(Ui.Txt("📇 名刺（プロフィール）設定", 17, bold: true));
        sp.Children.Add(Dim("端末にのみ保存され、相手があなたのアイコン・名前を押した時だけ直接渡されます。"));
        sp.Children.Add(Avatar());
        sp.Children.Add(Sep()); sp.Children.Add(Bio());
        sp.Children.Add(Sep()); sp.Children.Add(Tips());
        sp.Children.Add(Sep()); sp.Children.Add(Sns());
        var noImg = new CheckBox { Content = "相手の名刺の画像を表示しない（絵文字だけにする）", Margin = new Thickness(0, 12, 0, 0) };
        noImg.Click += (_, _) => E.Cmd(new { type = "ceNoImg", on = noImg.IsChecked == true });
        ups.Add(s => noImg.IsChecked = s.B("noImg"));
        sp.Children.Add(noImg);
        var warn = Ui.Txt("", 12, Ui.Orange, wrap: true); warn.Margin = new Thickness(0, 6, 0, 0);
        ups.Add(s => { warn.Text = s.S("warn"); warn.Visibility = warn.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed; });
        sp.Children.Add(warn);

        var close = Ui.Btn("閉じる", () => Close());
        var save = Ui.Btn("保存する", () => E.Cmd(new { type = "ceSave" }), Ui.Accent, Ui.White, bold: true); save.Margin = new Thickness(0, 0, 0, 0);
        var bar = new DockPanel { Margin = new Thickness(12) };
        DockPanel.SetDock(save, Dock.Right); bar.Children.Add(save); bar.Children.Add(close); close.HorizontalAlignment = HorizontalAlignment.Left;
        var dock = new DockPanel();
        var bb = new Border { Child = bar, BorderBrush = Ui.Line, BorderThickness = new Thickness(0, 1, 0, 0) };
        DockPanel.SetDock(bb, Dock.Bottom); dock.Children.Add(bb);
        dock.Children.Add(new ScrollViewer { Content = sp, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        Content = dock;

        M.S.Remember(this, "cardedit"); Snap.Attach(this, M);
        Closed += (_, _) => { if (M.CardEdit == this) { M.CardEdit = null; E.Cmd(new { type = "ceClose" }); } };
        Refresh();
    }

    public void Refresh()
    {
        var s = E.Cards.P("edit");
        if (!s.Has()) return;
        foreach (var u in ups) u(s);
    }

    static TextBlock Dim(string t) { var x = Ui.Txt(t, 12, Ui.Dim, wrap: true); x.Margin = new Thickness(0, 4, 0, 10); return x; }
    static Border Sep() => new() { Height = 1, Background = Ui.Line, Margin = new Thickness(0, 14, 0, 14) };

    UIElement Avatar()
    {
        var sp = new StackPanel();
        sp.Children.Add(Ui.Txt("名刺アイコン（画像または絵文字）", 12, Ui.Dim));
        var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 0) };
        var emoji = new TextBlock { FontSize = 26, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        var image = new Image { Stretch = Stretch.UniformToFill };
        var holder = new Border { Width = 48, Height = 48, CornerRadius = new CornerRadius(12), Background = Ui.Chip, ClipToBounds = true, Child = emoji };
        var sub = new TextBlock { FontSize = 12, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom };
        var wrap = new Grid(); wrap.Children.Add(holder); wrap.Children.Add(sub);
        row.Children.Add(wrap);
        var pick = Ui.Btn("📷 画像を選ぶ", Pick); pick.Margin = new Thickness(12, 0, 8, 0); row.Children.Add(pick);
        var clear = Ui.Btn("画像を削除", () => E.Cmd(new { type = "ceAvatarClear" })); row.Children.Add(clear);
        sp.Children.Add(row);
        var msg = Ui.Txt("", 12, Ui.Orange, wrap: true); msg.Margin = new Thickness(0, 6, 0, 0); sp.Children.Add(msg);
        string last = null;
        ups.Add(s =>
        {
            emoji.Text = s.S("emoji"); sub.Text = s.S("sub");
            var img = s.S("img");
            if (img != last)
            {
                last = img;
                var src = img.Length > 0 ? Img.Load(img) : null;
                if (src != null) { image.Source = src; holder.Child = image; } else holder.Child = emoji;
            }
            clear.Visibility = s.B("clearShow") ? Visibility.Visible : Visibility.Collapsed;
            msg.Text = s.S("avatarMsg"); msg.Visibility = msg.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        });
        return sp;
    }

    void Pick()
    {
        var d = new Microsoft.Win32.OpenFileDialog { Filter = "画像|*.png;*.jpg;*.jpeg;*.gif;*.bmp;*.webp|すべてのファイル|*.*" };
        if (d.ShowDialog(this) != true) return;
        var jpg = CropDialog.Run(this, d.FileName);
        if (jpg != null) E.Cmd(new { type = "ceAvatarFile", b64 = Convert.ToBase64String(jpg), name = "avatar.jpg", mime = "image/jpeg" });
    }

    UIElement Bio()
    {
        var sp = new StackPanel();
        var h = new DockPanel(); var cnt = Ui.Txt("", 12, Ui.Dim); DockPanel.SetDock(cnt, Dock.Right); h.Children.Add(cnt); h.Children.Add(Ui.Txt("ひとこと（bio）", 12, Ui.Dim));
        sp.Children.Add(h);
        var box = new SyncedBox(v => E.Cmd(new { type = "ceField", field = "bio", value = v.Length > 60 ? v[..60] : v }), 60) { Margin = new Thickness(0, 4, 0, 0) };
        box.TextChanged += (_, _) => cnt.Text = $"{box.Text.Length}/60";
        sp.Children.Add(box);
        ups.Add(s => box.Sync(s.S("bio")));
        return sp;
    }

    UIElement Tips()
    {
        var sp = new StackPanel();
        sp.Children.Add(Ui.Txt("お礼・チップ窓口（提示する1件を選択）", 12, Ui.Dim));
        void Row(string v, string name, string field, string ph)
        {
            var g = new Grid { Margin = new Thickness(0, 6, 0, 0) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(field == null ? 1 : 150) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var rb = new RadioButton { Content = name, GroupName = "tip", VerticalContentAlignment = VerticalAlignment.Center };
            rb.Click += (_, _) => E.Cmd(new { type = "ceTipOpt", v });
            g.Children.Add(rb);
            ups.Add(s => rb.IsChecked = s.S("tipOpt") == v);
            if (field != null)
            {
                var box = new SyncedBox(t => E.Cmd(new { type = "ceField", field, value = t })) { ToolTip = ph };
                Grid.SetColumn(box, 1); g.Children.Add(box);
                ups.Add(s => box.Sync(s.S(field)));
            }
            sp.Children.Add(g);
        }
        Row("none", "提示しない（非表示）", null, "");
        Row("ofuse", "☕ OFUSE", "tipOfuse", "URL または ユーザID");
        Row("amazon", "📦 ほしい物リスト", "tipAmazon", "URL または リストID");
        Row("zap", "⚡ Nostr Zap", "tipZap", "name@domain または npub");
        Row("kofi", "☕ Ko-fi", "tipKofi", "URL または ユーザ名");
        Row("bmac", "🥐 Buy Me Coffee", "tipBmac", "URL または ユーザ名");
        var note = Ui.Txt("※ Amazonほしい物リストは配送先の本名や住所バレにご注意ください。", 11, Ui.Dim, wrap: true); note.Margin = new Thickness(0, 6, 0, 0);
        sp.Children.Add(note);
        return sp;
    }

    UIElement Sns()
    {
        var sp = new StackPanel();
        sp.Children.Add(Ui.Txt("SNS ID（オプトイン本人確認対応）", 12, Ui.Dim));
        void Row(string name, string field, string ph, string key)
        {
            var g = new Grid { Margin = new Thickness(0, 6, 0, 0) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(120) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.Children.Add(Ui.Txt(name, 13));
            var box = new SyncedBox(t => E.Cmd(new { type = "ceField", field, value = t })) { ToolTip = ph };
            Grid.SetColumn(box, 1); g.Children.Add(box);
            ups.Add(s => box.Sync(s.S(field)));
            var right = new ContentControl { Margin = new Thickness(6, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(right, 2); g.Children.Add(right);
            if (key == null) right.Content = Ui.Txt("自己申告", 11, Ui.Dim);
            else
            {
                var ok = Ui.Btn("✅", () =>
                {
                    if (Ui.Ask(this, "認証を解除しますか？", "解除すると、相手の画面で ✅ が付かなくなります。", "解除する", yesBg: Ui.Red)) E.Cmd(new { type = "ceUnverify", k = key });
                }, Ui.TealSoft, size: 12);
                ok.ToolTip = "認証済み（押すと解除）";
                var go = Ui.Btn("認証", () => E.Cmd(new { type = "ceVerify", k = key }), size: 12);
                ups.Add(s =>
                {
                    var v = s.P("ver" + char.ToUpper(key[0]) + key[1..]);
                    if (v.B("verified")) right.Content = ok;
                    else if (v.B("btnShow")) { go.Content = v.S("btnLabel").Length == 0 ? "認証" : v.S("btnLabel"); go.IsEnabled = !v.B("btnDisabled"); right.Content = go; }
                    else right.Content = null;
                });
            }
            sp.Children.Add(g);
        }
        Row("𝕏 (Twitter)", "snsX", "URL または @ID", "x");
        Row("🐙 GitHub", "snsGithub", "URL または ユーザ名", "github");
        Row("📝 note", "snsNote", "URL または クリエイター名", null);
        Row("📸 Instagram", "snsInstagram", "URL または ユーザ名", null);
        Row("▶️ YouTube", "snsYoutube", "URL または @ハンドル", null);
        Row("🟣 Nostr", "snsNostr", "URL または npub1...", "nostr");
        var note = Ui.Txt("※ 各サービスのプロフィールURLを貼ると自動でIDに切り詰めます。「認証」で本人確認すると、相手が「✅ を確かめる」を押したときに確認できます。", 11, Ui.Dim, wrap: true);
        note.Margin = new Thickness(0, 6, 0, 0); sp.Children.Add(note);
        return sp;
    }
}

/// <summary>本人確認（X / GitHub / Nostr）。</summary>
public sealed class CardAuthWindow : Window
{
    readonly AppModel M;
    readonly TextBlock title = Ui.Txt("", 17, bold: true, wrap: true), account = Ui.Txt("", 13, bold: true, wrap: true), desc = Ui.Txt("", 13, wrap: true),
        code = new() { FontFamily = new FontFamily("Consolas"), FontSize = 12, TextWrapping = TextWrapping.Wrap }, post = Ui.Txt("", 13, wrap: true),
        msg = Ui.Txt("", 13, wrap: true), note = Ui.Txt("", 11, Ui.Dim, wrap: true);
    readonly StackPanel codeSec = new(), postSec = new(), inputSec = new();
    readonly Button verify, copyCode, copyPost;
    string tweet = "";

    public CardAuthWindow(AppModel m)
    {
        M = m;
        Title = "本人確認"; Width = 480; Height = 560; MinWidth = 440; MinHeight = 420; Topmost = true;
        Background = Ui.Bg; Foreground = Ui.Fg; FontFamily = new FontFamily("Yu Gothic UI, Segoe UI, Meiryo UI");
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        var sp = new StackPanel { Margin = new Thickness(18) };
        title.Margin = new Thickness(0, 0, 0, 6); account.Margin = new Thickness(0, 0, 0, 6); desc.Margin = new Thickness(0, 0, 0, 10);
        sp.Children.Add(title); sp.Children.Add(account); sp.Children.Add(desc);

        codeSec.Children.Add(Ui.Txt("あなたの名刺の鍵", 12, Ui.Dim));
        copyCode = Ui.Btn("📋 鍵の行をコピー", () => Copy(code.Text, copyCode, "📋 鍵の行をコピー"), size: 12);
        var cr = new DockPanel { Margin = new Thickness(0, 4, 0, 0) }; DockPanel.SetDock(copyCode, Dock.Right); copyCode.Margin = new Thickness(8, 0, 0, 0);
        cr.Children.Add(copyCode); cr.Children.Add(code);
        codeSec.Children.Add(Ui.Panel(cr, Ui.Card, 10, new Thickness(10)));
        codeSec.Margin = new Thickness(0, 0, 0, 10); sp.Children.Add(codeSec);

        postSec.Children.Add(Ui.Panel(post, Ui.Card, 10, new Thickness(10)));
        var pr = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 0) };
        var tw = Ui.Btn("𝕏 でポストする", () => Engine.OpenExternal(tweet), size: 12); tw.Margin = new Thickness(0, 0, 8, 0);
        copyPost = Ui.Btn("📋 投稿文をコピー", () => Copy(post.Text, copyPost, "📋 投稿文をコピー"), size: 12);
        pr.Children.Add(tw); pr.Children.Add(copyPost); postSec.Children.Add(pr); postSec.Margin = new Thickness(0, 0, 0, 10); sp.Children.Add(postSec);

        inputSec.Children.Add(Ui.Txt("投稿したポストのリンク（共有URL）", 12, Ui.Dim));
        var box = new SyncedBox(t => M.E.Cmd(new { type = "caInput", value = t })) { Margin = new Thickness(0, 4, 0, 0), ToolTip = "https://x.com/ユーザー名/status/..." };
        inputSec.Tag = box; inputSec.Children.Add(box); inputSec.Margin = new Thickness(0, 0, 0, 10); sp.Children.Add(inputSec);

        msg.Margin = new Thickness(0, 0, 0, 6); sp.Children.Add(msg); sp.Children.Add(note);
        var bar = new DockPanel { Margin = new Thickness(0, 14, 0, 0) };
        verify = Ui.Btn("確認する", () => M.E.Cmd(new { type = "caVerify" }), Ui.Accent, Ui.White, bold: true);
        DockPanel.SetDock(verify, Dock.Right); bar.Children.Add(verify);
        var cancel = Ui.Btn("やめる", () => Close()); cancel.HorizontalAlignment = HorizontalAlignment.Left; bar.Children.Add(cancel);
        sp.Children.Add(bar);
        Content = new ScrollViewer { Content = sp, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };

        M.S.Remember(this, "cardauth"); Snap.Attach(this, M);
        Closed += (_, _) => { if (M.CardAuth == this) { M.CardAuth = null; M.E.Cmd(new { type = "caCancel" }); } };
        Refresh();
    }

    static void Copy(string s, Button b, string back)
    {
        try { Clipboard.SetText(s); } catch { return; }
        b.Content = "✅ コピー済";
        var t = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(1.5) };
        t.Tick += (_, _) => { b.Content = back; t.Stop(); }; t.Start();
    }

    public void Refresh()
    {
        var a = M.E.Cards.P("auth");
        if (!a.Has()) return;
        title.Text = a.S("title"); account.Text = a.S("account"); desc.Text = a.S("desc");
        codeSec.Visibility = a.B("codeShow") ? Visibility.Visible : Visibility.Collapsed; code.Text = a.S("code");
        postSec.Visibility = a.B("postShow") ? Visibility.Visible : Visibility.Collapsed; post.Text = a.S("post"); tweet = a.S("tweet");
        inputSec.Visibility = a.B("inputShow") ? Visibility.Visible : Visibility.Collapsed;
        ((SyncedBox)inputSec.Tag).Sync(a.S("input"));
        msg.Text = a.S("msg"); msg.Foreground = a.B("msgBad") ? Ui.Red : Ui.Teal; msg.Visibility = msg.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        note.Text = a.S("note");
        verify.Content = a.S("verifyLabel").Length == 0 ? "確認する" : a.S("verifyLabel"); verify.IsEnabled = !a.B("verifyDisabled");
    }
}

/// <summary>画像の切り抜き（ドラッグで位置、スライダーで大きさ）。枠の中を 512×512 の JPEG にして返す。</summary>
public static class CropDialog
{
    const double V = 300;

    public static byte[] Run(Window owner, string path)
    {
        BitmapSource bmp;
        try
        {
            var b = new BitmapImage(); b.BeginInit(); b.CacheOption = BitmapCacheOption.OnLoad; b.UriSource = new Uri(path); b.EndInit(); bmp = b;
        }
        catch { MessageBox.Show(owner, "画像を読み込めませんでした。", "Potalker"); return null; }

        double iw = bmp.PixelWidth, ih = bmp.PixelHeight;
        double baseScale = Math.Max(V / iw, V / ih), zoom = 1, ox = 0, oy = 0;
        double Scale() => baseScale * zoom;
        (double x, double y) Origin()
        {
            double w = iw * Scale(), h = ih * Scale();
            return (Math.Min(0, Math.Max(V - w, (V - w) / 2 + ox)), Math.Min(0, Math.Max(V - h, (V - h) / 2 + oy)));
        }

        var w_ = Ui.Base("画像の位置を決める", 360, 520, owner); w_.ResizeMode = ResizeMode.NoResize;
        var canvas = new Canvas { Width = V, Height = V, Background = Brushes.White, ClipToBounds = true, Cursor = System.Windows.Input.Cursors.SizeAll };
        var img = new Image { Source = bmp, Stretch = Stretch.Fill };
        canvas.Children.Add(img);
        void Place() { var o = Origin(); img.Width = iw * Scale(); img.Height = ih * Scale(); Canvas.SetLeft(img, o.x); Canvas.SetTop(img, o.y); }
        Place();

        System.Windows.Point? start = null; double sx = 0, sy = 0;
        canvas.MouseLeftButtonDown += (_, e) => { start = e.GetPosition(canvas); sx = ox; sy = oy; canvas.CaptureMouse(); };
        canvas.MouseMove += (_, e) => { if (start is { } s) { var p = e.GetPosition(canvas); ox = sx + p.X - s.X; oy = sy + p.Y - s.Y; Place(); } };
        canvas.MouseLeftButtonUp += (_, _) => { start = null; canvas.ReleaseMouseCapture(); var o = Origin(); ox = o.x - (V - iw * Scale()) / 2; oy = o.y - (V - ih * Scale()) / 2; };

        var slider = new Slider { Minimum = 1, Maximum = 4, Value = 1, Width = V, Margin = new Thickness(0, 10, 0, 0) };
        slider.ValueChanged += (_, e) => { zoom = e.NewValue; Place(); };

        byte[] result = null;
        var sp = new StackPanel { Margin = new Thickness(20), HorizontalAlignment = HorizontalAlignment.Center };
        sp.Children.Add(Ui.Txt("画像の位置を決める", 15, bold: true));
        var hint = Ui.Txt("ドラッグで位置、つまみで大きさを調整します。枠の中が名刺の画像になります。", 12, Ui.Dim, wrap: true); hint.Width = V; hint.Margin = new Thickness(0, 4, 0, 10);
        sp.Children.Add(hint);
        sp.Children.Add(new Border { Child = canvas, BorderBrush = Ui.Line, BorderThickness = new Thickness(1), HorizontalAlignment = HorizontalAlignment.Center });
        sp.Children.Add(slider);
        var row = new DockPanel { Width = V, Margin = new Thickness(0, 14, 0, 0) };
        var ok = Ui.Btn("決定", () =>
        {
            var o = Origin(); double k = 512 / V;
            var dv = new DrawingVisual();
            using (var dc = dv.RenderOpen())
            {
                dc.DrawRectangle(Brushes.White, null, new Rect(0, 0, 512, 512));
                dc.DrawImage(bmp, new Rect(o.x * k, o.y * k, iw * Scale() * k, ih * Scale() * k));
            }
            var rt = new RenderTargetBitmap(512, 512, 96, 96, PixelFormats.Pbgra32); rt.Render(dv);
            var enc = new JpegBitmapEncoder { QualityLevel = 85 }; enc.Frames.Add(BitmapFrame.Create(rt));
            using var ms = new MemoryStream(); enc.Save(ms); result = ms.ToArray(); w_.Close();
        }, Ui.Accent, Ui.White, bold: true);
        DockPanel.SetDock(ok, Dock.Right); row.Children.Add(ok);
        var cancel = Ui.Btn("やめる", () => w_.Close()); cancel.HorizontalAlignment = HorizontalAlignment.Left; row.Children.Add(cancel);
        sp.Children.Add(row);
        w_.Content = sp; w_.ShowDialog();
        return result;
    }
}
