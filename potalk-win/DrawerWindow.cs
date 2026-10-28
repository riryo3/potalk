using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Threading;

namespace Potalker;

/// <summary>
/// 部屋一覧のドロワー（シングルペイン）：本体の窓の「左」に、すべり出る別窓。
/// 本体の窓は動かず、大きさも変わらない。本体にくっついて、一緒に動き、高さは本体に合わせる。
/// 左に出す余地がないときは、本体の窓を右にずらして出し、閉じるときに戻す。
/// </summary>
public sealed class DrawerWindow : Window
{
    /// <summary>ドロワーの幅（表示サイズをかけた値）。中身は、100% のときの幅 340 で組んで、表示サイズで縮める。</summary>
    public const double BaseW = 340;
    public static double ScaleNow = 1;
    public static double DrawerW => BaseW * ScaleNow;
    readonly Window main;
    readonly DispatcherTimer anim = new() { Interval = TimeSpan.FromMilliseconds(12) };
    double curW, fromW, toW;
    DateTime started;
    double shiftDip;            // 本体の窓を右にずらした量（閉じるときに戻す）
    bool closing;
    IntPtr hwnd;

    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int value, int size);
    const uint SWP_NOACTIVATE = 0x0010, SWP_NOZORDER = 0x0004, SWP_SHOWWINDOW = 0x0040;

    readonly AppModel M;
    readonly UIElement lobbyEl;
    readonly System.Windows.Shapes.Rectangle edgeEl;
    bool right;             // 本体の窓の右に出しているか（左に出す余地がないとき）

    public DrawerWindow(AppModel m, Window mainWindow, bool onRight)
    {
        M = m; right = onRight;
        main = mainWindow;
        WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize; ShowInTaskbar = false; ShowActivated = false;
        Background = Ui.Bg; Foreground = Ui.Fg; FontFamily = new System.Windows.Media.FontFamily("Yu Gothic UI, Segoe UI, Meiryo UI");
        Width = 1; Height = 1; Left = -20000; Top = -20000;
        // 中身の幅は、いつも DrawerW。窓の幅を広げていくと、本体の窓の左端から、すべり出て見える
        var lobby = new LobbyView(m, true) { Width = BaseW, LayoutTransform = new System.Windows.Media.ScaleTransform(ScaleNow, ScaleNow) };
        var host = new Grid { ClipToBounds = true };
        host.Children.Add(lobby);
        var edge = new System.Windows.Shapes.Rectangle { Width = 1, Fill = Ui.Line, IsHitTestVisible = false };
        host.Children.Add(edge);
        lobbyEl = lobby; edgeEl = edge; ApplySide();
        Content = host;
        anim.Tick += (_, _) => Step();
        SourceInitialized += (_, _) =>
        {
            hwnd = new WindowInteropHelper(this).Handle;
            int dontRound = 1;                        // 本体の窓との、つなぎ目を、まっすぐにする（角を丸くしない）
            DwmSetWindowAttribute(hwnd, 33, ref dontRound, sizeof(int));
        };
    }

    double Dpi => System.Windows.Media.VisualTreeHelper.GetDpi(main).DpiScaleX;

    /// <summary>本体の窓の左に、幅 wDip で置く（高さは本体に合わせる）。</summary>
    void Place(double wDip)
    {
        if (hwnd == IntPtr.Zero) return;
        var mh = new WindowInteropHelper(main).Handle; if (mh == IntPtr.Zero) return;
        var v = Snap.VisibleBounds(mh);
        int w = Math.Max(1, (int)Math.Round(wDip * Dpi));
        SetWindowPos(hwnd, IntPtr.Zero, right ? v.Right : v.Left - w, v.Top, w, v.Height, SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW);
    }

    /// <summary>中身を、本体の窓に接する側にそろえる（左に出すときは右端、右に出すときは左端）。</summary>
    void ApplySide()
    {
        ((FrameworkElement)lobbyEl).HorizontalAlignment = right ? HorizontalAlignment.Left : HorizontalAlignment.Right;
        edgeEl.HorizontalAlignment = right ? HorizontalAlignment.Right : HorizontalAlignment.Left;
    }

    /// <summary>その側に、ドロワー全体が画面に収まるか</summary>
    bool Fits(bool onRight)
    {
        var mh = new WindowInteropHelper(main).Handle; if (mh == IntPtr.Zero) return true;
        var v = Snap.VisibleBounds(mh); var wa = SystemParameters.WorkArea;
        double l = v.Left / Dpi, r = v.Right / Dpi;
        return onRight ? r + DrawerW <= wa.Right + 1 : l - DrawerW >= wa.Left - 1;
    }

    /// <summary>本体の窓が動いたとき：ついて行く。開いたまま、画面の外に出そうになったら、反対側に出し直す（反対側に収まるときだけ）。</summary>
    public void Reposition()
    {
        if (!closing && curW >= DrawerW - 0.5 && !Fits(right) && Fits(!right))
        {
            right = !right; ApplySide(); M.SetDrawerSide(right);
        }
        Place(curW);
    }

    /// <summary>表示サイズが変わったとき：中身と幅を、新しい比率にする</summary>
    public void ApplyScale()
    {
        ((FrameworkElement)lobbyEl).LayoutTransform = new System.Windows.Media.ScaleTransform(ScaleNow, ScaleNow);
        if (!closing) { curW = DrawerW; toW = DrawerW; Place(curW); }
    }

    public void SlideOpen()
    {
        // 左にも右にも出す余地がないときだけ、本体の窓を右にずらして、左に出す
        var mh = new WindowInteropHelper(main).Handle;
        var v = Snap.VisibleBounds(mh);
        var wa = SystemParameters.WorkArea;
        double leftDip = v.Left / Dpi, rightDip = v.Right / Dpi;
        if (!right)
        {
            double deficit = Math.Max(0, wa.Left - (leftDip - DrawerW));
            shiftDip = Math.Min(deficit, Math.Max(0, wa.Right - rightDip));
            if (shiftDip > 0) main.Left += shiftDip;
        }
        Start(0, DrawerW);
    }

    public void SlideClose(Action done)
    {
        if (closing) return;
        closing = true;
        Start(curW, 0, () =>
        {
            if (shiftDip > 0) { main.Left -= shiftDip; shiftDip = 0; }   // ずらしていたら、元に戻す
            Close(); done?.Invoke();
        });
    }

    Action finished;
    void Start(double from, double to, Action fin = null)
    {
        fromW = from; toW = to; finished = fin; started = DateTime.Now;
        curW = from; Place(curW); anim.Start();
    }

    void Step()
    {
        double t = Math.Min(1, (DateTime.Now - started).TotalMilliseconds / 180);
        double e = 1 - Math.Pow(1 - t, 3);          // ゆっくり止まる
        curW = fromW + (toW - fromW) * e;
        Place(curW);
        if (t >= 1) { anim.Stop(); finished?.Invoke(); }
    }
}
