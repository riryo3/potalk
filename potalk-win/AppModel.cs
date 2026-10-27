using System;
using System.Collections.Generic;
using System.Linq;
using System.Media;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using Windows.Devices.Enumeration;

namespace Potalker;

public sealed class AppModel
{
    public readonly Engine E = new();
    public readonly Settings S = Settings.Load();

    public MainWindow Main;
    public RoomWindow Room;
    public ChatWindow Chat;
    public SettingsWindow Sett;
    public ProfileWindow Prof;
    public Window Help;
    public MailWindow Mail;
    public LetterWindow Letter;
    public CardEditWindow CardEdit;
    public CardAuthWindow CardAuth;
    public bool MailOpen;
    string lastLetter = "", letterDismissed = "";
    public bool ForceClose;
    /// <summary>アプリの終了が決まった（確認は済んだ、またはWindowsの終了）。もう確認しない。</summary>
    public bool Quitting;
    public bool PinRoom = true;

    public readonly List<ChatLine> ChatLines = new(), Past = new();
    public int Unread;
    public bool ChatOpen;
    public List<string> Mics = new();
    public event Action ChatChanged, MicsChanged;
    public event Action<string, string, bool> Fly;      // 絵文字, 名前, 自分

    // ---- シングルペイン（1つの窓にまとめるモード）----
    public event Action PaneChanged, LobbyRefresh;
    PaneTab tab = PaneTab.Room;
    /// <summary>開いているタブ。ひとこと・おたよりを開いているときは、新着を既読にする</summary>
    public PaneTab Tab
    {
        get => tab;
        set
        {
            bool same = tab == value;
            tab = value;
            if (!same && S.SinglePane)
            {
                if (tab == PaneTab.Room) RoomHot = false;
                ChatOpen = tab == PaneTab.Chat; MailOpen = tab == PaneTab.Mail;
                if (tab == PaneTab.Chat) Unread = 0;
                ChatChanged?.Invoke();
            }
            PaneChanged?.Invoke();
        }
    }
    /// <summary>雑談部屋に新しい人が入ったとき、「部屋」のタブに色をつける（部屋を開くと消える）</summary>
    public bool RoomHot;
    HashSet<string> knownMembers = new();
    DateTime joinedAt = DateTime.MinValue;
    /// <summary>部屋一覧のドロワー（左の取っ手から出す）</summary>
    public bool DrawerOpen { get; private set; }
    public void ToggleDrawer() { DrawerOpen = !DrawerOpen; PaneChanged?.Invoke(); }

    // ---- ショートカットから呼ぶもの ----
    public bool CanShowMail => E.Joined && E.Room.B("bcast");

    /// <summary>本体の窓を前に出す（複数ウインドウではロビーの窓、シングルペインでは1つの窓）。</summary>
    public void FocusMain()
    {
        if (Main == null) return;
        if (Main.WindowState == WindowState.Minimized) Main.WindowState = WindowState.Normal;
        Main.Activate();
    }

    /// <summary>部屋：複数ウインドウでは部屋の窓を前に出し、シングルペインでは「部屋」のタブにする。</summary>
    public void ShowRoom()
    {
        if (!E.Joined) return;
        if (S.SinglePane) { Tab = PaneTab.Room; FocusMain(); return; }
        if (Room == null) return;
        if (Room.WindowState == WindowState.Minimized) Room.WindowState = WindowState.Normal;
        Room.Activate();
    }

    /// <summary>次のタブ（+1）／前のタブ（-1）。おたよりは、配信部屋のときだけ巡回に入れる。</summary>
    public void CycleTab(int dir)
    {
        if (!(S.SinglePane && E.Joined)) return;
        var tabs = new List<PaneTab> { PaneTab.Room, PaneTab.Chat };
        if (E.Room.B("bcast")) tabs.Add(PaneTab.Mail);
        tabs.Add(PaneTab.Settings);
        int i = tabs.IndexOf(Tab); if (i < 0) i = 0;
        Tab = tabs[(i + dir + tabs.Count) % tabs.Count];
    }
    public void TogglePinSingle()
    {
        S.PinSingle = !S.PinSingle; S.Save();
        if (Main != null) Main.Topmost = S.SinglePane && S.PinSingle;
        PaneChanged?.Invoke();
    }

    /// <summary>窓の使い方（複数ウインドウ／シングルペイン）を切り替える。通話はそのまま続く。</summary>
    public void SetSinglePane(bool on)
    {
        if (S.SinglePane == on) return;
        bool joined = E.Joined;
        if (joined) CloseRoomGroup(keepChat: true);
        S.SinglePane = on; S.Save();
        DrawerOpen = false; Tab = PaneTab.Room; RoomHot = false;
        if (joined) OpenRoom();      // 先に部屋の部品を作ってから、本体の窓を切り替える
        Main?.ApplyMode();
        PaneChanged?.Invoke();
    }

    (DateTime at, bool target)? pendingMute;
    readonly HashSet<string> seenRooms = new();
    bool armed, wasJoined;
    int lastHands;
    System.Windows.Forms.NotifyIcon tray;

    public void Start()
    {
        tray = new System.Windows.Forms.NotifyIcon { Icon = System.Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath) ?? System.Drawing.SystemIcons.Application, Visible = true, Text = "Potalker" };
        tray.BalloonTipClicked += (_, _) => { Main?.Show(); Main?.Activate(); };
        Application.Current.Exit += (_, _) => { tray.Visible = false; tray.Dispose(); };

        E.Log = s => System.Diagnostics.Debug.WriteLine(s);
        E.OnChat += l => ReceiveChat(l);
        E.OnReact += r => Fly?.Invoke(r.S("e"), r.S("u") == "self" ? "" : r.S("n"), r.S("u") == "self");
        E.OnRoom += RoomChanged;
        E.OnLobby += LobbyChanged;
        E.OnCards += CardsChanged;
        // 読み込み直し（つなぎ直し・マイクの入り直しなど）のたびに、数秒のあいだは、新しい部屋の通知を出さない。
        // そのあいだに見えた部屋は「見た部屋」に入るので、あとから「新しい部屋」として通知されることもない
        E.OnReloading += () => Quiet(null);
        E.OnReady += () =>
        {
            E.Cmd(new { type = "setMicLabel", label = S.MicLabel });
            E.Cmd(new { type = "sndRoom", on = false });   // 通知はこちらで一本化する（ページの音は使わない）
            Quiet(6);
        };
        _ = RefreshMics();
    }

    // ---- 新しい部屋の通知を止める ----
    int quietGen;

    /// <summary>新しい部屋の通知を、しばらく止める（null なら、読み込みが済むまで止めたまま）。入室・退出・作成・読み込み直しのあとは、一覧が入れ替わるため。</summary>
    public void Quiet(double? seconds)
    {
        armed = false; quietGen++;
        if (seconds == null) return;
        int g = quietGen;
        Task.Delay(TimeSpan.FromSeconds(seconds.Value)).ContinueWith(_ =>
        {
            try { Application.Current?.Dispatcher.Invoke(() => { if (g == quietGen) armed = true; }); } catch { }
        });
    }

    /// <summary>いま作られたばかりの部屋か（一覧の「経過時間」が数分以内）。読み込みが遅れて、あとから一覧に現れた古い部屋を、新しい部屋として通知しない。</summary>
    public static bool IsFresh(string dur)
    {
        if (dur.Contains("時間") || dur.Contains("日")) return false;
        var digits = new string(dur.Where(char.IsDigit).ToArray());
        return !int.TryParse(digits, out var n) || n <= 3;
    }

    public void RefreshLobby() { Quiet(6); E.Cmd(new { type = "refreshLobby" }); }   // 更新を押したときも、一覧の入れ替わりで音を出さない

    // ---- 受け取り ----
    void ReceiveChat(JsonElement l)
    {
        var c = new ChatLine { Sys = l.B("sys"), Hist = l.B("hist"), Em = l.S("em"), Who = l.S("who"), Text = l.S("text") };
        if (c.Hist || (c.Sys && c.Text.StartsWith("ここから過去ログ"))) Past.Add(c);
        else
        {
            ChatLines.Add(c); if (ChatLines.Count > 200) ChatLines.RemoveAt(0);
            if (!ChatOpen && !c.Sys && !c.Who.Contains("（あなた）")) Unread++;
        }
        ChatChanged?.Invoke(); PaneChanged?.Invoke();
    }

    string lastRid = "";
    void RoomChanged()
    {
        var r = E.Room;
        bool joined = r.B("joined");
        var rid = joined ? r.S("rid") : "";
        if (rid != lastRid) { lastRid = rid; LobbyRefresh?.Invoke(); }
        if (joined != wasJoined)
        {
            wasJoined = joined; Quiet(6);
            DrawerOpen = false;
            if (joined) { joinedAt = DateTime.Now; knownMembers = new HashSet<string>(); RoomHot = false; Tab = PaneTab.Room; OpenRoom(); }
            else CloseRoomGroup();
            Main?.ApplyMode();
        }
        if (!joined) return;
        if (S.SinglePane && (r.P("card").Has() || r.P("ignoreAsk").Has())) Tab = PaneTab.Room;
        // 雑談部屋に、新しい人が入ったら、「部屋」のタブに色をつける（入室して数秒は、もとからいた人なので、数えない）
        var ids = new HashSet<string>(r.A("members").Select(x => $"{x.S("em")}|{x.S("name")}|{x.B("you")}"));
        if (!r.B("bcast") && S.SinglePane && Tab != PaneTab.Room && (DateTime.Now - joinedAt).TotalSeconds > 3 && ids.Except(knownMembers).Any()) RoomHot = true;
        knownMembers = ids;
        // 作成・入室の直後は、設定に合わせてミュートにそろえる（マイクが取れて操作できるようになってから1回だけ）
        if (pendingMute is { } p)
        {
            if ((DateTime.Now - p.at).TotalSeconds > 15) pendingMute = null;
            else if (r.B("canMute")) { pendingMute = null; if (r.B("muted") != p.target) E.Cmd(new { type = "mute" }); }
        }
        // 配信者側：手が挙がったら音
        int hands = r.A("members").Count(m => m.S("mark") == "🙋");
        if (hands > lastHands) SystemSounds.Asterisk.Play();
        lastHands = hands;
        Room?.Refresh();
        Sett?.Refresh();
        Mail?.Refresh();
        // 公開されたお便り
        var mn = r.P("mailNow");
        var key = mn.Has() ? $"{mn.S("cap")}|{mn.S("who")}|{mn.S("text")}" : "";
        if (key.Length == 0) { lastLetter = ""; letterDismissed = ""; Letter?.Close(); }
        else
        {
            lastLetter = key;
            if (Letter != null) Letter.Refresh();
            else if (key != letterDismissed) { Letter = new LetterWindow(this); Letter.Show(); }
        }
        PaneChanged?.Invoke();
    }

    public void RoomWindowRefresh() => Room?.Refresh();

    /// <summary>吸着の相手にする、ほかのウィンドウ（本体も含む）。</summary>
    public IEnumerable<Window> OtherWindows(Window self) =>
        new Window[] { Main, Room, Chat, Mail, Letter, Sett, Prof, Help, CardEdit, CardAuth }.Where(x => x != null && x != self);
    public void LetterClosed() { letterDismissed = lastLetter; Letter = null; }

    void CardsChanged()
    {
        var c = E.Cards;
        if (c.P("edit").Has() && CardEdit == null) { CardEdit = new CardEditWindow(this); CardEdit.Show(); }
        else if (!c.P("edit").Has() && CardEdit != null) { var w = CardEdit; CardEdit = null; w.Close(); }
        CardEdit?.Refresh();
        if (c.P("auth").Has() && CardAuth == null) { CardAuth = new CardAuthWindow(this); CardAuth.Show(); }
        else if (!c.P("auth").Has() && CardAuth != null) { var w = CardAuth; CardAuth = null; w.Close(); }
        CardAuth?.Refresh();
    }

    public void OpenMail()
    {
        if (S.SinglePane) { Tab = PaneTab.Mail; return; }
        MailOpen = true;
        if (Mail == null) { Mail = new MailWindow(this); Mail.Show(); } else Mail.Activate();
        Room?.Refresh();
    }

    void LobbyChanged()
    {
        foreach (var room in E.Lobby.A("rooms"))
        {
            var key = room.S("id") is { Length: > 0 } id ? id : room.S("name");
            if (seenRooms.Add(key) && armed && S.NotifyRooms && IsFresh(room.S("dur")))
            {
                SystemSounds.Asterisk.Play();
                tray.ShowBalloonTip(4000, "新しい部屋ができました", room.S("name"), System.Windows.Forms.ToolTipIcon.Info);
            }
        }
        LobbyRefresh?.Invoke();
    }

    // ---- 指示 ----
    public void Join(string id, bool quiet)
    {
        Quiet(6); pendingMute = (DateTime.Now, S.MuteOnJoin);
        E.Cmd(new { type = "join", id, quiet });
    }
    public void CreateRoom(string name, bool broadcast)
    {
        Quiet(6); pendingMute = (DateTime.Now, S.MuteOnCreate);
        E.Cmd(new { type = "create", name, kind = broadcast ? "bc" : "chat" });
    }
    /// <summary>部屋のリンク（名前なしでもよい）で入る。入れなかったときは、理由を知らせる。</summary>
    public void OpenRoomLink(string text)
    {
        Quiet(6); pendingMute = (DateTime.Now, S.MuteOnJoin);
        E.OpenLink(text, r => Application.Current.Dispatcher.Invoke(() =>
        {
            string msg = r switch
            {
                Engine.LinkResult.Asleep => "この部屋は、いま開いていないようです。（見つけるのに時間がかかっているだけのこともあります）",
                Engine.LinkResult.Choose => "同じ名前の部屋が、いくつか開いています。一覧から選んでください。",
                Engine.LinkResult.Invalid => "このリンクは、部屋のリンクとして読み取れませんでした。リンクが、途中で切れていないか、確かめてください。",
                Engine.LinkResult.Timeout => "部屋に入れませんでした。もう一度お試しください。",
                _ => null,
            };
            if (msg == null) return;
            pendingMute = null;
            MessageBox.Show(Main, msg, "リンクの部屋に入れません", MessageBoxButton.OK, MessageBoxImage.Information);
        }));
    }
    public void SendChat(string t) => E.Cmd(new { type = "chat", text = t });

    public void SwitchMic(string name)
    {
        if (name == S.MicLabel) return;
        S.MicLabel = name; S.Save();
        E.Cmd(new { type = "setMicLabel", label = name });
        if (!E.Joined) return;
        if (Ui.Ask(Room, "マイクを切り替えるには、入り直します",
            $"「{(name.Length == 0 ? "既定のマイク" : name)}」に切り替えます。同じ部屋に入り直しますか？（数秒、声が途切れます）", "入り直す", "次に入るときから"))
            E.Cmd(new { type = "reconnect" });
    }

    /// <summary>入力デバイスの一覧（マイクの許可がなくても名前は取れる）</summary>
    public async Task RefreshMics()
    {
        try
        {
            var ds = await DeviceInformation.FindAllAsync(DeviceClass.AudioCapture);
            Mics = ds.Select(d => d.Name).Distinct().ToList();
            MicsChanged?.Invoke();
        }
        catch { }
    }

    public void ConfirmOpen(string url, Window owner)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || (u.Scheme != "http" && u.Scheme != "https")) return;
        var shown = Readable(u.AbsoluteUri);
        if (shown.Length > 300) shown = shown[..300];
        if (Ui.Ask(owner, "このリンクを開きますか？", shown, "ブラウザで開く")) Engine.OpenExternal(u.AbsoluteUri);
    }

    /// <summary>確認画面に出す用：%E9%9D%9E のようなパーセント表記を、読める文字に戻す（開くときは元のURLを使う）。</summary>
    static string Readable(string url)
    {
        try
        {
            var s = Uri.UnescapeDataString(url);
            // 制御文字や、向きを入れ替える文字が混じるときは、紛らわしいので元のまま見せる
            return s.Any(c => char.IsControl(c) || (c >= '‪' && c <= '‮') || (c >= '⁦' && c <= '⁩') || c == '�') ? url : s;
        }
        catch { return url; }
    }

    // ---- ウィンドウ ----
    void OpenRoom()
    {
        if (S.SinglePane)
        {
            // シングルペイン：部屋・ひとこと・おたより・設定は、窓として出さず、本体の窓のタブに入れる
            if (Room != null) return;
            Tab = PaneTab.Room;
            Room = new RoomWindow(this); Chat = new ChatWindow(this); Mail = new MailWindow(this); Sett = new SettingsWindow(this);
            Room.Refresh(); Sett.Refresh(); Mail.Refresh();
            return;
        }
        if (Room != null) { Room.Activate(); return; }
        Room = new RoomWindow(this);
        Room.Show();
        Room.Refresh();
    }
    public void OpenChat()
    {
        if (S.SinglePane) { Tab = PaneTab.Chat; return; }
        Unread = 0; ChatOpen = true;
        if (Chat == null) { Chat = new ChatWindow(this); Chat.Show(); } else Chat.Activate();
        ChatChanged?.Invoke();
    }
    public void ToggleChat()
    {
        if (S.SinglePane) { Tab = Tab == PaneTab.Chat ? PaneTab.Room : PaneTab.Chat; return; }
        if (Chat != null) Chat.Close(); else OpenChat();
    }
    public void OpenSettings()
    {
        if (S.SinglePane) { Tab = PaneTab.Settings; return; }
        if (Sett != null) { Sett.Activate(); return; }
        Sett = new SettingsWindow(this); Sett.Show(); Sett.Refresh();
    }
    public void OpenProfile()
    {
        if (Prof != null) { Prof.Activate(); return; }
        Prof = new ProfileWindow(this); Prof.Show();
    }
    public void OpenHelp()
    {
        HelpWindows.ShowHelp(this);
    }

    void CloseRoomGroup(bool keepChat = false)
    {
        ForceClose = true;
        try { Chat?.Close(); Sett?.Close(); Mail?.Close(); Letter?.Close(); Room?.Close(); } catch { } finally { ForceClose = false; }
        Chat = null; Sett = null; Room = null; Mail = null; Letter = null; MailOpen = false; lastLetter = ""; letterDismissed = "";
        if (!keepChat) { ChatLines.Clear(); Past.Clear(); Unread = 0; }
        ChatOpen = false; lastHands = 0; Tab = PaneTab.Room; RoomHot = false;
        ChatChanged?.Invoke();
    }

    public void RequestLeave(Window owner)
    {
        if (Ui.Ask(owner, "この部屋を退出しますか？", "小窓を閉じると、部屋から退出します。", "退出して閉じる", yesBg: Ui.Red)) E.Cmd(new { type = "leave" });
    }
}
