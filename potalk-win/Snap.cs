using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;

namespace Potalker;

/// <summary>小窓をドラッグしたとき、画面の端と、ほかのウィンドウの縁に、近ければ吸着させる（Swift 版と同じ：14pt）。</summary>
public static class Snap
{
    const int WM_MOVING = 0x0216, DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    const double Threshold = 14;

    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);

    /// <summary>見た目どおりの枠（影の分の見えない余白を除く）。取れなければ、ふつうの枠。</summary>
    static RECT Visible(IntPtr h)
    {
        if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out var r, Marshal.SizeOf<RECT>()) == 0) return r;
        GetWindowRect(h, out r); return r;
    }

    /// <summary>見た目どおりの枠（ピクセル）。影の分の見えない余白を除く。</summary>
    public static System.Drawing.Rectangle VisibleBounds(IntPtr h)
    {
        var r = Visible(h);
        return new System.Drawing.Rectangle(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
    }

    public static void Attach(Window w, AppModel m, Func<bool> enabled = null)
    {
        w.SourceInitialized += (_, _) =>
        {
            var src = HwndSource.FromHwnd(new WindowInteropHelper(w).Handle);
            src?.AddHook((IntPtr hwnd, int msg, IntPtr wp, IntPtr lp, ref bool handled) =>
            {
                if (msg != WM_MOVING || (enabled != null && !enabled())) return IntPtr.Zero;
                OnMoving(w, hwnd, lp, m);
                handled = true;
                return new IntPtr(1);
            });
        };
    }

    static void OnMoving(Window w, IntPtr hwnd, IntPtr lp, AppModel m)
    {
        var r = Marshal.PtrToStructure<RECT>(lp);
        GetWindowRect(hwnd, out var outer);
        var vis = Visible(hwnd);
        // 動かしている窓の、見えない余白の分（左・上・右・下）
        int il = vis.Left - outer.Left, it = vis.Top - outer.Top, ir = outer.Right - vis.Right, ib = outer.Bottom - vis.Bottom;
        int L = r.Left + il, T = r.Top + it, R = r.Right - ir, B = r.Bottom - ib;

        double scale = VisualTreeHelper.GetDpi(w).DpiScaleX;
        double tol = Threshold * scale;

        var xs = new List<int>(); var ys = new List<int>();
        var scr = System.Windows.Forms.Screen.FromRectangle(new System.Drawing.Rectangle(L, T, R - L, B - T)).WorkingArea;
        xs.Add(scr.Left - L); xs.Add(scr.Right - R);
        ys.Add(scr.Top - T); ys.Add(scr.Bottom - B);

        foreach (var o in m.OtherWindows(w))
        {
            if (!o.IsVisible || o.WindowState == WindowState.Minimized) continue;
            var h = new WindowInteropHelper(o).Handle; if (h == IntPtr.Zero) continue;
            var g = Visible(h);
            // 縦に重なっているときだけ、横の吸着（隣・端そろえ）を考える。横も同じ
            if (g.Bottom > T - tol && g.Top < B + tol) { xs.Add(g.Right - L); xs.Add(g.Left - R); xs.Add(g.Left - L); xs.Add(g.Right - R); }
            if (g.Right > L - tol && g.Left < R + tol) { ys.Add(g.Bottom - T); ys.Add(g.Top - B); ys.Add(g.Top - T); ys.Add(g.Bottom - B); }
        }

        int? dx = xs.Where(v => Math.Abs(v) <= tol).OrderBy(Math.Abs).Cast<int?>().FirstOrDefault();
        int? dy = ys.Where(v => Math.Abs(v) <= tol).OrderBy(Math.Abs).Cast<int?>().FirstOrDefault();
        if (dx == null && dy == null) return;
        int mx = dx ?? 0, my = dy ?? 0;
        r.Left += mx; r.Right += mx; r.Top += my; r.Bottom += my;
        Marshal.StructureToPtr(r, lp, false);
    }
}
