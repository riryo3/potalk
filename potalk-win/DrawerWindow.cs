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
    public const double DrawerW = 340;
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

    public DrawerWindow(AppModel m, Window mainWindow)
    {
        main = mainWindow;
        WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize; ShowInTaskbar = false; ShowActivated = false;
        Background = Ui.Bg; Foreground = Ui.Fg; FontFamily = new System.Windows.Media.FontFamily("Yu Gothic UI, Segoe UI, Meiryo UI");
        Width = 1; Height = 1; Left = -20000; Top = -20000;
        // 中身の幅は、いつも DrawerW。窓の幅を広げていくと、本体の窓の左端から、すべり出て見える
        var lobby = new LobbyView(m, true) { Width = DrawerW, HorizontalAlignment = HorizontalAlignment.Right };
        var host = new Grid { ClipToBounds = true };
        host.Children.Add(lobby);
        var edge = new System.Windows.Shapes.Rectangle { Width = 1, Fill = Ui.Line, HorizontalAlignment = HorizontalAlignment.Left, IsHitTestVisible = false };
        host.Children.Add(edge);
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
        SetWindowPos(hwnd, IntPtr.Zero, v.Left - w, v.Top, w, v.Height, SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW);
    }

    public void Reposition() => Place(curW);

    public void SlideOpen()
    {
        // 左に出す余地がないときは、本体の窓を右にずらす
        var mh = new WindowInteropHelper(main).Handle;
        var v = Snap.VisibleBounds(mh);
        var wa = SystemParameters.WorkArea;
        double leftDip = v.Left / Dpi, rightDip = v.Right / Dpi;
        double deficit = Math.Max(0, wa.Left - (leftDip - DrawerW));
        shiftDip = Math.Min(deficit, Math.Max(0, wa.Right - rightDip));
        if (shiftDip > 0) main.Left += shiftDip;
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
