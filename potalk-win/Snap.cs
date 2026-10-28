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
    const int WM_MOVING = 0x0216, WM_SIZING = 0x0214, DWMWA_EXTENDED_FRAME_BOUNDS = 9;
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
        w.ContentRendered += (_, _) => { if (enabled == null) AlignOnOpen(w, m); };
        w.SourceInitialized += (_, _) =>
        {
            var src = HwndSource.FromHwnd(new WindowInteropHelper(w).Handle);
            src?.AddHook((IntPtr hwnd, int msg, IntPtr wp, IntPtr lp, ref bool handled) =>
            {
                if (msg == WM_SIZING && (enabled == null || enabled())) { OnSizing(w, hwnd, wp, lp, m); handled = true; return new IntPtr(1); }
                if (msg != WM_MOVING || (enabled != null && !enabled())) return IntPtr.Zero;
                OnMoving(w, hwnd, lp, m);
                handled = true;
                return new IntPtr(1);
            });
        };
    }

    /// <summary>
    /// 開いた小窓が、ほかの窓のすぐ隣（隙間が24以内）にあるときは、上の高さを、その窓にそろえる
    /// （覚えていた位置が少しずれていても、段差をなくす。ずれが120までのとき）。
    /// </summary>
    static void AlignOnOpen(Window w, AppModel m)
    {
        if (m.S.SinglePane || !w.IsVisible) return;
        var hw = new WindowInteropHelper(w).Handle; if (hw == IntPtr.Zero) return;
        double scale = VisualTreeHelper.GetDpi(w).DpiScaleX;
        var f = Visible(hw);
        foreach (var o in m.OtherWindows(w))
        {
            if (!o.IsVisible || o.WindowState == WindowState.Minimized) continue;
            var h = new WindowInteropHelper(o).Handle; if (h == IntPtr.Zero) continue;
            var g = Visible(h);
            int gapR = f.Left - g.Right, gapL = g.Left - f.Right;
            bool near = (gapR >= 0 && gapR <= 24 * scale) || (gapL >= 0 && gapL <= 24 * scale);
            if (!near || g.Bottom <= f.Top || g.Top >= f.Bottom) continue;
            int d = g.Top - f.Top;
            if (d == 0 || Math.Abs(d) > 120 * scale) return;
            var wa = System.Windows.Forms.Screen.FromHandle(hw).WorkingArea;
            double top = w.Top + d / scale;
            double maxTop = (wa.Bottom - (f.Bottom - f.Top)) / scale;
            w.Top = Math.Min(top, Math.Max(maxTop, wa.Top / scale));
            return;
        }
    }

    /// <summary>窓の縁を引いて大きさを変えるとき、動かしている縁を、画面の端と、ほかのウィンドウの縁に吸着させる。</summary>
    static void OnSizing(Window w, IntPtr hwnd, IntPtr wp, IntPtr lp, AppModel m)
    {
        int edge = wp.ToInt32();
        bool eL = edge == 1 || edge == 4 || edge == 7, eR = edge == 2 || edge == 5 || edge == 8;
        bool eT = edge == 3 || edge == 4 || edge == 5, eB = edge == 6 || edge == 7 || edge == 8;
        var r = Marshal.PtrToStructure<RECT>(lp);
        GetWindowRect(hwnd, out var outer);
        var vis = Visible(hwnd);
        int il = vis.Left - outer.Left, it = vis.Top - outer.Top, ir = outer.Right - vis.Right, ib = outer.Bottom - vis.Bottom;
        int L = r.Left + il, T = r.Top + it, R = r.Right - ir, B = r.Bottom - ib;
        double tol = Threshold * VisualTreeHelper.GetDpi(w).DpiScaleX;

        var xs = new List<int>(); var ys = new List<int>();
        var scr = System.Windows.Forms.Screen.FromRectangle(new System.Drawing.Rectangle(L, T, R - L, B - T)).WorkingArea;
        xs.Add(scr.Left); xs.Add(scr.Right); ys.Add(scr.Top); ys.Add(scr.Bottom);
        foreach (var o in m.OtherWindows(w))
        {
            if (!o.IsVisible || o.WindowState == WindowState.Minimized) continue;
            var h = new WindowInteropHelper(o).Handle; if (h == IntPtr.Zero) continue;
            var g = Visible(h);
            if (g.Bottom > T - tol && g.Top < B + tol) { xs.Add(g.Left); xs.Add(g.Right); }
            if (g.Right > L - tol && g.Left < R + tol) { ys.Add(g.Top); ys.Add(g.Bottom); }
        }
        static int? Near(IEnumerable<int> targets, int e, double tol) =>
            targets.Select(t => t - e).Where(d => Math.Abs(d) <= tol).OrderBy(Math.Abs).Cast<int?>().FirstOrDefault();

        if (eL && Near(xs, L, tol) is int dl) r.Left += dl;
        if (eR && Near(xs, R, tol) is int dr) r.Right += dr;
        if (eT && Near(ys, T, tol) is int dt) r.Top += dt;
        if (eB && Near(ys, B, tol) is int db) r.Bottom += db;
        Marshal.StructureToPtr(r, lp, false);
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

        var xs = new List<int>(); var ys = new List<int>(); var tops = new List<int>();
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
            // 横に並んでいる（隙間が小さい）ときは、上の高さを、少し離れていても（80まで）、そろえる
            int gapR = L - g.Right, gapL = g.Left - R;
            if (((gapR >= 0 && gapR <= tol) || (gapL >= 0 && gapL <= tol)) && g.Bottom > T && g.Top < B) tops.Add(g.Top - T);
            if (g.Right > L - tol && g.Left < R + tol) { ys.Add(g.Bottom - T); ys.Add(g.Top - B); ys.Add(g.Top - T); ys.Add(g.Bottom - B); }
        }

        int? dx = xs.Where(v => Math.Abs(v) <= tol).OrderBy(Math.Abs).Cast<int?>().FirstOrDefault();
        int? dy = ys.Where(v => Math.Abs(v) <= tol).OrderBy(Math.Abs).Cast<int?>().FirstOrDefault() ?? tops.Where(v => Math.Abs(v) <= 80 * scale).OrderBy(Math.Abs).Cast<int?>().FirstOrDefault();
        if (dx == null && dy == null) return;
        int mx = dx ?? 0, my = dy ?? 0;
        r.Left += mx; r.Right += mx; r.Top += my; r.Bottom += my;
        Marshal.StructureToPtr(r, lp, false);
    }
}
