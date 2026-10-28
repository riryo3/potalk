using System;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Media;

namespace Potalker;

/// <summary>
/// 表示サイズ（100〜50%）：本体の窓以外の、すべての窓（部屋・ひとこと・設定・初期設定・ダイアログなど）にもかける。
/// 窓が開いたときに、中身を縮めて、窓の大きさと最小の大きさも、同じ比率で縮める。表示サイズが変わったら、開いている窓も追いかける。
/// 本体の窓と、部屋一覧のドロワーは、それぞれ自分で扱う。
/// </summary>
public static class Scaling
{
    sealed class State { public double Applied; public bool SizeDone; }
    static readonly ConditionalWeakTable<Window, State> states = new();
    static AppModel M;

    public static void Install(AppModel m)
    {
        M = m;
        EventManager.RegisterClassHandler(typeof(Window), FrameworkElement.LoadedEvent, new RoutedEventHandler((s, e) =>
        {
            if (s is Window w && ReferenceEquals(e.OriginalSource, w)) Attach(w);
        }));
        m.ScaleChanged += () =>
        {
            foreach (Window w in Application.Current.Windows) Change(w);
        };
    }

    static bool Own(Window w) => w is MainWindow || w is DrawerWindow;

    /// <summary>覚えていた大きさを戻した窓は、大きさをもう一度かけない（覚えた値は、すでに表示サイズをかけてある）。</summary>
    public static void MarkSized(Window w) => states.GetOrCreateValue(w).SizeDone = true;

    static void SetTransform(Window w, double sc)
    {
        if (w.Content is FrameworkElement fe) fe.LayoutTransform = Math.Abs(sc - 1) < 0.001 ? Transform.Identity : new ScaleTransform(sc, sc);
    }

    static void Attach(Window w)
    {
        if (M == null || Own(w)) return;
        var st = states.GetOrCreateValue(w);
        if (st.Applied != 0) return;
        double sc = M.S.SingleScale; st.Applied = sc;
        if (Math.Abs(sc - 1) < 0.001) return;
        SetTransform(w, sc);
        w.MinWidth *= sc; w.MinHeight *= sc;
        if (!st.SizeDone)
        {
            if (w.SizeToContent == SizeToContent.Manual || w.SizeToContent == SizeToContent.Height) w.Width *= sc;
            if (w.SizeToContent == SizeToContent.Manual || w.SizeToContent == SizeToContent.Width) w.Height *= sc;
        }
    }

    static void Change(Window w)
    {
        if (Own(w) || !states.TryGetValue(w, out var st) || st.Applied == 0) return;
        double sc = M.S.SingleScale, r = sc / st.Applied;
        if (Math.Abs(r - 1) < 0.001) return;
        st.Applied = sc;
        SetTransform(w, sc);
        w.MinWidth *= r; w.MinHeight *= r;
        if (w.SizeToContent == SizeToContent.Manual || w.SizeToContent == SizeToContent.Height) w.Width *= r;
        if (w.SizeToContent == SizeToContent.Manual || w.SizeToContent == SizeToContent.Width) w.Height *= r;
    }
}
