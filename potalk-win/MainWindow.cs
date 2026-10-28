using System;
using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
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
    readonly ContentControl host = new() { IsTabStop = false };
    DrawerWindow drawer;

    public MainWindow(AppModel m)
    {
        M = m;
        Title = "Potalker"; Width = 460 * M.S.SingleScale; Height = 760 * M.S.SingleScale; MinWidth = 380; MinHeight = 440 + MenuBar.Height;
        Background = Ui.Bg; Foreground = Ui.Fg; FontFamily = new FontFamily("Yu Gothic UI, Segoe UI, Meiryo UI");
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        lobby = new LobbyView(M);
        var root = new DockPanel(); var menu = MenuBar.Build(M); DockPanel.SetDock(menu, Dock.Top); root.Children.Add(menu); root.Children.Add(host);
        Content = root;

        key = M.S.SinglePane ? "single" : "main";
        M.S.Restore(this, key);
        Snap.Attach(this, M, () => M.S.SinglePane);
        Closing += OnClosing;
        Closed += (_, _) => { M.S.Store(this, key); drawer?.Close(); Application.Current.Shutdown(); };
        SizeChanged += (_, e) => { OnUserResized(e); drawer?.Reposition(); UpdateDrawerSide(); };
        M.ChatDrawerChanged += OnChatDrawer; M.DividerDragged += OnDivider; M.ScaleChanged += OnScale;
        // 幅は、利用者さんが窓の縁をドラッグして変え終えたときだけ覚える（プログラムが決めた幅は、覚えない）
        SourceInitialized += (_, _) => (System.Windows.Interop.HwndSource.FromHwnd(new System.Windows.Interop.WindowInteropHelper(this).Handle))?.AddHook(
            (IntPtr h, int msg, IntPtr wp, IntPtr lp, ref bool handled) => { if (msg == 0x0231) userSizing = true; else if (msg == 0x0232) { userSizing = false; RememberWidth(); } return IntPtr.Zero; });
        LocationChanged += (_, _) => { drawer?.Reposition(); UpdateDrawerSide(); };
        StateChanged += (_, _) => SyncDrawer();
        M.PaneChanged += SyncDrawer;
        Loaded += (_, _) => ApplyMode();
        ApplyMode();
    }

    // ---- ひとこと用ドロワーと、表示サイズ ----
    const double PaneMinH = 548 + 36;     // 上のタブ + 部屋の画面（メンバー4人分くらい）+ ひとこと見出し（仕切り6 + 見出し30）
    const double ChatMin = 60;            // ひとこと側の、いちばん狭いとき
    double chatExtra;                     // ドロワーを開いている分、窓に足している高さ
    bool wasJoinedPane, userSizing;      // userSizing：利用者さんが窓の縁をドラッグしているあいだ

    double Sc => M.S.SingleScale;      // 表示サイズは、すべての窓にかかる
    double Wanted => M.S.SinglePane && M.E.Joined && M.ChatDrawer ? M.S.SingleChatH * Sc : 0;

    void KeepOnScreen()
    {
        var wa = SystemParameters.WorkArea;
        if (Top + Height > wa.Bottom) Top = Math.Max(wa.Top, wa.Bottom - Height);
        if (Top < wa.Top) Top = wa.Top;
    }

    /// <summary>ひとこと欄を開閉したとき：窓の上の端は動かさず、ドロワーの高さ分だけ伸ばす・縮める（下に余地がなければ上にずらす）</summary>
    void OnChatDrawer()
    {
        if (!IsLoaded) return;
        double target = Wanted, d = target - chatExtra;
        if (Math.Abs(d) < 0.5) return;
        fitting = true;
        try
        {
            chatExtra = target;
            double nh = Height + d;                      // 最小の高さを変えると、窓が先に広がってしまうので、先に高さを決める
            double min = (M.S.SinglePane && M.E.Joined ? PaneMinH : 440) * Sc + MenuBar.Height + (chatExtra > 0 ? ChatMin * Sc : 0);
            if (d > 0) { Height = Math.Max(nh, min); MinHeight = min; } else { MinHeight = Math.Min(MinHeight, min); Height = Math.Max(nh, min); MinHeight = min; }
            KeepOnScreen(); drawer?.Reposition();
        }
        finally { Dispatcher.BeginInvoke(new Action(() => fitting = false), System.Windows.Threading.DispatcherPriority.ContextIdle); }
    }

    /// <summary>仕切りの帯のドラッグ：窓の高さが変わる。ひとこと側の高さは、そのまま</summary>
    void OnDivider(double dy)
    {
        fitting = true;
        try { Height = Math.Max(Math.Max(MinHeight, PaneMinH * Sc + MenuBar.Height + chatExtra), Height + dy * Sc); KeepOnScreen(); }      // 上の部屋の画面が、最小より狭くならないところまで
        finally { Dispatcher.BeginInvoke(new Action(() => fitting = false), System.Windows.Threading.DispatcherPriority.ContextIdle); }
    }

    /// <summary>窓の下の縁を引いたとき（ドロワーが開いているあいだ）：ひとこと側が広がる・狭まる。上の部屋の画面は変わらない</summary>
    void OnUserResized(SizeChangedEventArgs e)
    {
        if (fitting || !userSizing || !e.HeightChanged || !M.S.SinglePane || !M.E.Joined || !M.ChatDrawer || e.PreviousSize.Height <= 0) return;
        M.SetChatHeight(M.S.SingleChatH + (e.NewSize.Height - e.PreviousSize.Height) / Sc);
        chatExtra = M.S.SingleChatH * Sc;
        MinHeight = (PaneMinH + ChatMin) * Sc + MenuBar.Height;      // ひとこと側は、ここまで狭められる
    }

    /// <summary>表示サイズが変わったとき：窓の大きさと中身を、同じ比率で変える</summary>
    void OnScale()
    {
        if (!IsLoaded) return;
        // 変える前の比率は、いまの窓の最小幅から逆算する
        double old = MinWidth / ((M.E.Joined && M.S.SinglePane) ? 340.0 : 360.0);
        double r = M.S.SingleScale / old;
        fitting = true;
        try
        {
            Width *= r; Height *= r; chatExtra = Wanted; ApplyMode(); KeepOnScreen();
        }
        finally { Dispatcher.BeginInvoke(new Action(() => fitting = false), System.Windows.Threading.DispatcherPriority.ContextIdle); }
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
        double sc = M.S.SingleScale;      // 窓の幅は、表示サイズに関わらない値（100% のときの幅）で覚える
        if (M.E.Joined) M.S.SingleRoomW = ActualWidth / sc; else M.S.SingleLobbyW = ActualWidth / sc;
    }

    /// <summary>使い方（複数ウインドウ／シングルペイン）と、入室中かどうかに合わせて、中身と大きさを切り替える。</summary>
    public void ApplyMode()
    {
        bool single = M.S.SinglePane, joined = M.E.Joined;

        // 使い方が変わったら、位置と大きさも、それぞれ別に覚える
        var want = single ? "single" : "main";
        if (want != key) { M.S.Store(this, key); key = want; M.S.Restore(this, key); }

        Topmost = single && M.S.PinSingle;
        double sc = M.S.SingleScale;
        if (Math.Abs(DrawerWindow.ScaleNow - sc) > 0.001) { DrawerWindow.ScaleNow = sc; drawer?.ApplyScale(); }
        if (!(single && joined && M.ChatDrawer)) chatExtra = 0;
        MinWidth = (joined && single ? 340 : 360) * sc; MinHeight = (joined && single ? PaneMinH : 440) * sc + MenuBar.Height + (chatExtra > 0 ? ChatMin * sc : 0);

        if (single && joined && M.Room != null && M.Chat != null && M.Mail != null && M.Sett != null)
        {
            if (pane == null || !pane.Matches(M)) { pane = new PaneView(M); }
            if (!ReferenceEquals(host.Content, pane)) { host.Content = null; host.Content = pane; }
        }
        else
        {
            pane = null;
            if (!ReferenceEquals(host.Content, lobby)) { host.Content = null; host.Content = lobby; }
        }
        if (host.Content is FrameworkElement fe) fe.LayoutTransform = Math.Abs(sc - 1) < 0.001 ? Transform.Identity : new ScaleTransform(sc, sc);
        if (single) FitSingleFrame(joined);
        wasJoinedPane = single && joined;
        SyncDrawer();
    }

    /// <summary>ドロワーを出す側：窓の左に出す余地があれば左、なければ右（開いているあいだは動かさない）</summary>
    void UpdateDrawerSide()
    {
        if (drawer != null || !IsLoaded) return;
        var wa = SystemParameters.WorkArea;
        double right = Left + ActualWidth;
        bool left = Left - wa.Left >= DrawerWindow.DrawerW || wa.Right - right < DrawerWindow.DrawerW;
        M.SetDrawerSide(!left);
    }

    /// <summary>部屋一覧のドロワー：入室中のシングルペインで、取っ手（か Ctrl+L）で開いているとき、本体の窓の左に出す。</summary>
    void SyncDrawer()
    {
        bool want = M.DrawerOpen && M.S.SinglePane && M.E.Joined && IsLoaded && WindowState != WindowState.Minimized;
        if (want && drawer == null)
        {
            UpdateDrawerSide();
            drawer = new DrawerWindow(M, this, M.DrawerRight) { Topmost = Topmost };
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
            double want = (joined ? M.S.SingleRoomW : M.S.SingleLobbyW) * Sc;
            double w = Math.Min(want > 0 ? want : ActualWidth, wa.Width);
            w = Math.Max(w, MinWidth);
            Width = w; Left = right - w;
            // 入室したときは、最小の高さにそろえる（そのあとは、利用者さんの決めた高さのまま）
            if (joined && !wasJoinedPane) Height = Math.Min(MinHeight, wa.Height);
            else if (Height < MinHeight) Height = Math.Min(MinHeight, wa.Height);
            if (Left + Width > wa.Right) Left = Math.Max(wa.Left, wa.Right - Width);
            if (Left < wa.Left) Left = wa.Left;
            if (Top + Height > wa.Bottom) Top = Math.Max(wa.Top, wa.Bottom - Height);
            if (Top < wa.Top) Top = wa.Top;
        }
        finally { Dispatcher.BeginInvoke(new Action(() => fitting = false), System.Windows.Threading.DispatcherPriority.ContextIdle); }
    }
}
