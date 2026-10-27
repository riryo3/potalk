using System;
using System.ComponentModel;
using System.Windows;
using System.Windows.Media;

namespace Potalker;

/// <summary>本体の窓。ふつうは、部屋の一覧だけ。シングルペインでは、入室すると、タブ（部屋・ひとこと・おたより・設定）に変わる。</summary>
public sealed class MainWindow : Window
{
    readonly AppModel M;
    readonly LobbyView lobby;
    PaneView pane;
    string key;
    bool fitting;
    DrawerWindow drawer;

    public MainWindow(AppModel m)
    {
        M = m;
        Title = "Potalker"; Width = 460; Height = 760; MinWidth = 380; MinHeight = 440;
        Background = Ui.Bg; Foreground = Ui.Fg; FontFamily = new FontFamily("Yu Gothic UI, Segoe UI, Meiryo UI");
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        lobby = new LobbyView(M);

        key = M.S.SinglePane ? "single" : "main";
        M.S.Restore(this, key);
        Snap.Attach(this, M, () => M.S.SinglePane);
        Closing += OnClosing;
        Closed += (_, _) => { M.S.Store(this, key); drawer?.Close(); Application.Current.Shutdown(); };
        SizeChanged += (_, _) => drawer?.Reposition();
        // 幅は、利用者さんが窓の縁をドラッグして変え終えたときだけ覚える（プログラムが決めた幅は、覚えない）
        SourceInitialized += (_, _) => (System.Windows.Interop.HwndSource.FromHwnd(new System.Windows.Interop.WindowInteropHelper(this).Handle))?.AddHook(
            (IntPtr h, int msg, IntPtr wp, IntPtr lp, ref bool handled) => { if (msg == 0x0232) RememberWidth(); return IntPtr.Zero; });
        LocationChanged += (_, _) => drawer?.Reposition();
        StateChanged += (_, _) => SyncDrawer();
        M.PaneChanged += SyncDrawer;
        Loaded += (_, _) => ApplyMode();
        ApplyMode();
    }

    void OnClosing(object s, CancelEventArgs e)
    {
        // 入室中に、アプリを終了しようとしたら、確認する（Windows では、本体の窓を閉じる＝アプリの終了）
        if (M.ForceClose || M.Quitting || !M.E.Joined) return;
        e.Cancel = true;
        if (!Ui.Ask(this, "アプリを終了しますか？", "いま入っている部屋から退出して、終了します。", "退出して終了", yesBg: Ui.Red)) return;
        M.Quitting = true;
        M.E.Cmd(new { type = "leave" });                  // 相手に、退出が伝わるように、少し待ってから閉じる
        _ = System.Threading.Tasks.Task.Delay(700).ContinueWith(_ => Dispatcher.Invoke(Close));
    }

    /// <summary>窓の幅を、入室前と入室中で、別々に覚える（シングルペイン）</summary>
    void RememberWidth()
    {
        if (!M.S.SinglePane || fitting || !IsLoaded) return;
        if (M.E.Joined) M.S.SingleRoomW = ActualWidth; else M.S.SingleLobbyW = ActualWidth;
    }

    /// <summary>使い方（複数ウインドウ／シングルペイン）と、入室中かどうかに合わせて、中身と大きさを切り替える。</summary>
    public void ApplyMode()
    {
        bool single = M.S.SinglePane, joined = M.E.Joined;

        // 使い方が変わったら、位置と大きさも、それぞれ別に覚える
        var want = single ? "single" : "main";
        if (want != key) { M.S.Store(this, key); key = want; M.S.Restore(this, key); }

        Topmost = single && M.S.PinSingle;
        MinWidth = joined && single ? 340 : 380; MinHeight = joined && single ? 560 : 440;

        if (single && joined && M.Room != null && M.Chat != null && M.Mail != null && M.Sett != null)
        {
            if (pane == null || !pane.Matches(M)) { pane = new PaneView(M); }
            if (!ReferenceEquals(Content, pane)) { Content = null; Content = pane; }
        }
        else
        {
            pane = null;
            if (!ReferenceEquals(Content, lobby)) { Content = null; Content = lobby; }
        }
        if (single) FitSingleFrame(joined);
        SyncDrawer();
    }

    /// <summary>部屋一覧のドロワー：入室中のシングルペインで、取っ手（か Ctrl+L）で開いているとき、本体の窓の左に出す。</summary>
    void SyncDrawer()
    {
        bool want = M.DrawerOpen && M.S.SinglePane && M.E.Joined && IsLoaded && WindowState != WindowState.Minimized;
        if (want && drawer == null)
        {
            drawer = new DrawerWindow(M, this) { Topmost = Topmost };
            drawer.Show();
            drawer.SlideOpen();
        }
        else if (!want && drawer != null)
        {
            var d = drawer; drawer = null;
            d.SlideClose(null);
        }
        if (drawer != null) drawer.Topmost = Topmost;
    }

    /// <summary>シングルペイン：入室前は縦長の一覧、入室したら部屋の小窓くらいの幅にする。右端と上端の位置は動かさない。</summary>
    void FitSingleFrame(bool joined)
    {
        if (!IsLoaded) return;
        fitting = true;
        try
        {
            var wa = SystemParameters.WorkArea;
            double right = Left + ActualWidth;
            double want = joined ? M.S.SingleRoomW : M.S.SingleLobbyW;
            double w = Math.Min(want > 0 ? want : ActualWidth, wa.Width);
            w = Math.Max(w, MinWidth);
            Width = w; Left = right - w;
            if (joined && Height < 640) Height = Math.Min(640, wa.Height);
            if (Left + Width > wa.Right) Left = Math.Max(wa.Left, wa.Right - Width);
            if (Left < wa.Left) Left = wa.Left;
            if (Top + Height > wa.Bottom) Top = Math.Max(wa.Top, wa.Bottom - Height);
            if (Top < wa.Top) Top = wa.Top;
        }
        finally { Dispatcher.BeginInvoke(new Action(() => fitting = false), System.Windows.Threading.DispatcherPriority.ContextIdle); }
    }
}
