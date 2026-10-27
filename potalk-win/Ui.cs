using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Markup;
using System.Windows.Media;

namespace Potalker;

/// <summary>見た目の部品。色は Mac 版に合わせた、明るい配色。</summary>
public static class Ui
{
    public static Brush Color(string hex) { var b = (Brush)new BrushConverter().ConvertFromString(hex); b.Freeze(); return b; }
    public static readonly Brush Bg = Color("#f5f5f7"), Card = Color("#ffffff"), Chip = Color("#e9e9ee"), Fg = Color("#1c1c1e"),
        Dim = Color("#76767c"), Teal = Color("#0f9d8a"), TealSoft = Color("#d6f3ee"), Red = Color("#d93036"), Orange = Color("#d9822b"),
        Line = Color("#d8d8de"), Accent = Color("#2f6fed"), White = Color("#ffffff");

    static readonly ControlTemplate Tpl = (ControlTemplate)XamlReader.Parse(
        "<ControlTemplate xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' TargetType='Button'>" +
        "<Border Background='{TemplateBinding Background}' BorderBrush='{TemplateBinding BorderBrush}' BorderThickness='{TemplateBinding BorderThickness}' CornerRadius='8' Padding='{TemplateBinding Padding}'>" +
        "<ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/></Border>" +
        "<ControlTemplate.Triggers><Trigger Property='IsMouseOver' Value='True'><Setter Property='Opacity' Value='0.82'/></Trigger>" +
        "<Trigger Property='IsEnabled' Value='False'><Setter Property='Opacity' Value='0.4'/></Trigger></ControlTemplate.Triggers></ControlTemplate>");

    public static Button Btn(string text, Action click, Brush bg = null, Brush fg = null, double size = 13, bool bold = false)
    {
        var b = new Button
        {
            Content = text, Template = Tpl, Background = bg ?? Chip, Foreground = fg ?? Fg, FontSize = size,
            BorderBrush = Line, BorderThickness = new Thickness(1), Padding = new Thickness(10, 5, 10, 5), Cursor = System.Windows.Input.Cursors.Hand,
            FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal,
        };
        if (click != null) b.Click += (_, _) => click();
        return b;
    }

    public static TextBlock Txt(string text, double size = 13, Brush fg = null, bool bold = false, bool wrap = false)
    {
        return new TextBlock
        {
            Text = text, FontSize = size, Foreground = fg ?? Fg, FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal,
            TextWrapping = wrap ? TextWrapping.Wrap : TextWrapping.NoWrap, TextTrimming = wrap ? TextTrimming.None : TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
    }

    public static Border Panel(UIElement child, Brush bg = null, double radius = 12, Thickness? pad = null) => new()
    {
        Child = child, Background = bg ?? Card, CornerRadius = new CornerRadius(radius), BorderBrush = Line, BorderThickness = new Thickness(1),
        Padding = pad ?? new Thickness(12),
    };

    /// <summary>入力欄の横に置く「n/最大」。最大に近づくとオレンジ。</summary>
    public static TextBlock Counter(TextBox box, int max)
    {
        var c = new TextBlock { FontFamily = new FontFamily("Consolas"), FontSize = 11, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(6, 0, 0, 0) };
        void Upd() { var n = box.Text.Length; c.Text = $"{n}/{max}"; c.Foreground = n >= max - 3 ? Orange : Dim; }
        box.TextChanged += (_, _) => Upd(); Upd();
        return c;
    }

    public static TextBox Input(string text = "", int max = 0)
    {
        var t = new TextBox { Text = text, FontSize = 13, Padding = new Thickness(6, 4, 6, 4), VerticalContentAlignment = VerticalAlignment.Center };
        if (max > 0) t.MaxLength = max;
        return t;
    }

    public static Window Base(string title, double w, double h, Window owner = null)
    {
        // まだ表示していない窓（シングルペインの部品として使うだけの窓）は、親にできない。本体の窓を親にする
        if (owner != null && !owner.IsVisible) owner = Application.Current?.MainWindow is { IsVisible: true } mw ? mw : null;
        return new Window
        {
            Title = title, Width = w, Height = h, Background = Bg, Foreground = Fg, FontFamily = new FontFamily("Yu Gothic UI, Segoe UI, Meiryo UI"),
            Owner = owner, WindowStartupLocation = owner != null ? WindowStartupLocation.CenterOwner : WindowStartupLocation.CenterScreen,
        };
    }

    /// <summary>OK / キャンセルの小さな確認ダイアログ。</summary>
    public static bool Ask(Window owner, string title, string detail, string yes, string no = "キャンセル", Brush yesBg = null)
    {
        var w = Base("Potalker", 400, 170, owner);
        w.SizeToContent = SizeToContent.Height; w.ResizeMode = ResizeMode.NoResize;
        var sp = new StackPanel { Margin = new Thickness(18) };
        sp.Children.Add(Txt(title, 15, bold: true, wrap: true));
        if (!string.IsNullOrEmpty(detail)) sp.Children.Add(new TextBlock { Text = detail, Foreground = Dim, FontSize = 12.5, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) });
        var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 16, 0, 0) };
        bool ok = false;
        var nb = Btn(no, () => w.Close()); nb.Margin = new Thickness(0, 0, 8, 0);
        var yb = Btn(yes, () => { ok = true; w.Close(); }, yesBg ?? Accent, White, bold: true);
        row.Children.Add(nb); row.Children.Add(yb); sp.Children.Add(row);
        w.Content = sp; w.ShowDialog();
        return ok;
    }
}

public sealed class ChatLine
{
    public bool Sys, Hist; public string Em = "", Who = "", Text = "";
}

/// <summary>ページの入力欄と同期する TextBox（ページ側で切り詰められた値もそのまま反映する）</summary>
public sealed class SyncedBox : System.Windows.Controls.TextBox
{
    readonly Action<string> send;
    string remote = "";
    bool busy;

    public SyncedBox(Action<string> send, int max = 0)
    {
        this.send = send;
        FontSize = 13; Padding = new System.Windows.Thickness(6, 4, 6, 4); VerticalContentAlignment = System.Windows.VerticalAlignment.Center;
        if (max > 0) MaxLength = max;
        TextChanged += (_, _) => { if (!busy && Text != remote) this.send(Text); };
    }

    public void Sync(string v)
    {
        remote = v ?? "";
        if (Text != remote && !IsKeyboardFocused) { busy = true; Text = remote; busy = false; }
    }
}

public static class Img
{
    /// <summary>http(s) の画像と、data: の画像（名刺の画像）を読む。読めなければ null。</summary>
    public static System.Windows.Media.ImageSource Load(string src)
    {
        try
        {
            var b = new System.Windows.Media.Imaging.BitmapImage();
            b.BeginInit(); b.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;
            if (src.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
            {
                var i = src.IndexOf("base64,", StringComparison.Ordinal); if (i < 0) return null;
                b.StreamSource = new System.IO.MemoryStream(Convert.FromBase64String(src[(i + 7)..]));
            }
            else b.UriSource = new Uri(src);
            b.EndInit(); return b;
        }
        catch { return null; }
    }
}

public static class Links
{
    static readonly System.Text.RegularExpressions.Regex Url = new(@"https?://[A-Za-z0-9\-._~:/?#@!$&*+,;=%\[\]]+", System.Text.RegularExpressions.RegexOptions.Compiled);

    static readonly System.Text.RegularExpressions.Regex NameParam = new(@"&name=[^&\s#]*", System.Text.RegularExpressions.RegexOptions.Compiled);

    /// <summary>部屋のURLから、表示用の &name=… を取り除く（部屋はIDで決まる）。</summary>
    public static string StripName(string text) => NameParam.Replace(text, "");

    /// <summary>文中の http(s) のURLをリンクにして、TextBlock に入れる（押すと、開く前に確認を出す）。</summary>
    /// <summary>クリックされたものが、リンクの上か（カードを押した扱いにしないため）。</summary>
    public static bool IsOnLink(object source)
    {
        var d = source as DependencyObject;
        while (d != null) { if (d is System.Windows.Documents.Hyperlink) return true; d = LogicalTreeHelper.GetParent(d); }
        return false;
    }

    /// <summary>リンクを右クリックすると、「リンクをコピー」が出る。</summary>
    public static void CopyMenu(System.Windows.Documents.Hyperlink h, string url)
    {
        var mi = new MenuItem { Header = "リンクをコピー" };
        mi.Click += (_, _) => { try { Clipboard.SetText(url); } catch { } };
        h.ContextMenu = new ContextMenu { Items = { mi } };
    }

    public static void Fill(TextBlock tb, string text, Action<string> open)
    {
        tb.Inlines.Clear(); tb.Text = "";
        int pos = 0;
        foreach (System.Text.RegularExpressions.Match m in Url.Matches(text))
        {
            if (m.Index > pos) tb.Inlines.Add(new System.Windows.Documents.Run(text[pos..m.Index]));
            var u = m.Value;
            var h = new System.Windows.Documents.Hyperlink(new System.Windows.Documents.Run(u)) { ToolTip = u };
            h.Click += (_, _) => open(u); CopyMenu(h, u);
            tb.Inlines.Add(h); pos = m.Index + m.Length;
        }
        if (pos < text.Length) tb.Inlines.Add(new System.Windows.Documents.Run(text[pos..]));
    }
}
