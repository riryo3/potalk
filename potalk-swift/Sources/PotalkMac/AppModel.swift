import AppKit
import SwiftUI
import Combine
import UserNotifications
import AVFoundation

enum PaneTab: Hashable { case room, mail, settings }

struct FlyEffect: Identifiable { let id = UUID(); let emoji: String; let who: String; let isSelf: Bool; let dx: CGFloat }

@MainActor
final class AppModel: NSObject, ObservableObject, NSWindowDelegate, UNUserNotificationCenterDelegate {
    let engine: Engine
    private var bag = Set<AnyCancellable>()

    // 画面の状態
    @Published var chat: [ChatLine] = []          // 入室後に届いたもの
    @Published var past: [ChatLine] = []          // 過去ログ（参加者から受け取ったもの）
    @Published var unread = 0
    @Published var chatOpen = false
    @Published var mailOpen = false
    @Published var effects: [FlyEffect] = []
    @Published var pop: String = ""               // 押したリアクション（ぽんと跳ねる）
    @Published var search = ""
    @Published var notifyRooms: Bool { didSet { UserDefaults.standard.set(notifyRooms, forKey: "notifyRooms") } }
    @Published var mics: [String] = []            // 起動時に Mac から直接取る入力デバイスの名前
    @Published var selectedMic: String { didSet { UserDefaults.standard.set(selectedMic, forKey: "micLabel"); engine.cmd(["type": "setMicLabel", "label": selectedMic]) } }
    @Published var muteOnCreate: Bool { didSet { UserDefaults.standard.set(muteOnCreate, forKey: "muteOnCreate") } }
    @Published var muteOnJoin: Bool { didSet { UserDefaults.standard.set(muteOnJoin, forKey: "muteOnJoin") } }
    private var pendingMute: (at: Date, target: Bool)?   // 作成・入室の直後だけ、設定の状態（ミュート／解除）にそろえる（つなぎ直しでは触らない）
    @Published var pinRoom = true
    /// シングルペインの窓を、ほかの窓の上に浮かせておくか（ロビーと部屋の📌で切り替える）
    @Published var pinSingle: Bool {
        didSet {
            UserDefaults.standard.set(pinSingle, forKey: "pinSingle")
            let lv: NSWindow.Level = pinSingle ? .floating : .normal
            if singlePane { mainWin?.level = lv }
            drawerWin?.level = lv
        }
    }
    @Published var joinCandidate: LobbyRoom?       // 「参加しますか？」を出す部屋
    @Published var createOpen = false
    /// シングルペインの表示サイズ（％）。小さな画面向けに、50〜100%で選べる
    static let scaleSteps = [100, 90, 80, 70, 60, 50]
    @Published var scalePct: Int = {
        let d = UserDefaults.standard
        if let v = d.object(forKey: "single.scalePct") as? Int, scaleSteps.contains(v) { return v }
        return d.bool(forKey: "single.compact") ? 80 : 100     // 以前の「80%」のスイッチを引き継ぐ
    }() {
        didSet {
            UserDefaults.standard.set(scalePct, forKey: "single.scalePct")
            guard oldValue != scalePct, singlePane else { return }
            let r = CGFloat(scalePct) / CGFloat(oldValue)
            drawerOpen = false
            roomW *= r; lobbyW *= r; chatGrown *= r
            if let w = mainWin {
                var f = w.frame; let h = f.height * r
                f.origin.y += f.height - h; f.size.height = h
                w.setFrame(f, display: true)
            }
            fitSingleFrame(joined: engine.room.joined)
            syncChatGrow()
        }
    }
    var uiScale: CGFloat { singlePane ? CGFloat(scalePct) / 100 : 1 }
    /// 1つの窓にまとめて使うモード（初期設定のスイッチ）
    @Published var singlePane: Bool {
        didSet {
            UserDefaults.standard.set(singlePane, forKey: "singlePane")
            if oldValue != singlePane { DispatchQueue.main.async { self.applyLayoutMode() } }
        }
    }
    /// シングルペインで開いているタブ。ひとこと・おたよりを開いているときは、新着を既読にする
    /// シングルペインで、雑談部屋に新しい人が入ったとき、「部屋」のタブに色をつける（部屋を開くと消える）
    @Published var roomHot = false
    private var knownMembers = Set<String>()
    private var joinedAt = Date.distantPast
    @Published var tab: PaneTab = .room {
        didSet {
            guard singlePane else { return }
            if tab == .room { roomHot = false }
            syncChatGrow()
            mailOpen = (tab == .mail)
        }
    }
    /// シングルペインで、窓の下から開くひとことのドロワー。開いている間は新着を既読にする
    @Published var chatDrawer = false {
        didSet { chatOpen = chatDrawer; if chatDrawer { unread = 0 }; syncChatGrow() }
    }
    @Published var chatH: CGFloat = {
        let v = UserDefaults.standard.double(forKey: "single.chatH"); return v >= 60 ? CGFloat(v) : 220
    }() {
        didSet { UserDefaults.standard.set(Double(chatH), forKey: "single.chatH"); if chatDrawer, !adoptingResize { syncChatGrow() } }
    }
    /// 画面の下に余地がなくて、窓を伸ばしきれなかったときの、ひとことの高さの上限
    /// 部屋以外のタブで下に出る、ミュート・退出の帯の高さ（窓の最小の高さは、どのタブでも同じにするため、部屋のタブにも見込む）
    @Published var miniH: CGFloat = 105 { didSet { if oldValue != miniH { applyMinSize() } } }
    @Published var chatCap: CGFloat = .infinity
    private var adoptingResize = false     // 窓の縁をつかんで変えた高さを、ひとことの高さとして取り込んでいる間
    private var liveResizing = false, lastMainH: CGFloat = 0
    private var chatGrown: CGFloat = 0     // ひとこと用に、窓を下へ伸ばしているぶん
    /// 部屋の画面（上のタブからひとことまで）が、切れずに収まるのに要る高さ。これより窓を縮められないようにする
    @Published var paneNeedH: CGFloat = 0 { didSet { if oldValue != paneNeedH { applyMinSize() } } }
    /// ひとことを閉じているときの必要な高さ（paneNeedH）に、開いているときは、ひとことの高さを足す
    var minPaneH: CGFloat { (paneNeedH > 0 ? paneNeedH : 520) + (chatDrawer ? chatH + 1 : 0) }
    func applyMinSize() {
        guard singlePane, engine.room.joined, let w = mainWin else { return }
        w.contentMinSize = NSSize(width: 340 * uiScale, height: minPaneH * uiScale)
        setWindowHeight(w.frame.height)      // 足りなければ、いまの窓も、最小まで伸ばす
    }
    /// 仕切り線のドラッグ：ひとこと（大きさはそのまま）が下に追従し、上の部屋の画面が伸び縮みする。窓の上の端は動かさない
    func setWindowHeight(_ h: CGFloat) {
        guard singlePane, let w = mainWin else { return }
        let v = (w.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        var f = w.frame
        let top = f.maxY
        let minH = minFrameSize(w).height
        f.size.height = max(minH, min(h, top - v.minY))
        f.origin.y = top - f.height
        if f != w.frame { w.setFrame(f, display: true) }
    }
    /// ひとことのドロワーの高さのぶんだけ、窓を下に伸ばす（上の部屋の画面は、大きさも位置も変えない）。閉じたら戻す。
    /// 画面の下に余地がなければ、窓を上にずらし、それでも足りなければ、ひとことのほうを縮める
    func syncChatGrow() {
        guard singlePane, engine.room.joined, let w = mainWin else { chatGrown = 0; chatCap = .infinity; return }
        let want: CGFloat = chatDrawer ? ((chatH + 1) * uiScale).rounded() : 0
        var f = w.frame
        var delta = want - chatGrown
        if delta > 0 {
            let v = (w.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
            let below = max(0, f.minY - v.minY), up = max(0, v.maxY - f.maxY)
            delta = min(delta, below + up)
            f.origin.y += max(0, delta - below)
        }
        if delta != 0 {
            f.origin.y -= delta; f.size.height += delta
            w.setFrame(f, display: true)
            chatGrown += delta
        }
        applyMinSize()
        let cap: CGFloat = chatGrown < want ? max(60, chatGrown / uiScale - 1) : .infinity
        if cap != chatCap { chatCap = cap }
    }
    /// シングルペインで、左から出す部屋一覧（ドロワー）が開いているか
    @Published var drawerOpen = false {
        didSet { if oldValue != drawerOpen { applyDrawer() } }
    }
    var drawerWin: NSPanel?
    private var drawerShift: CGFloat = 0       // 左に出す余地がなくて、本体の窓を右にずらしたぶん
    var drawerW: CGFloat { 360 * uiScale }
    let drawerOverlap: CGFloat = 24        // 本体の窓の下に潜り込ませるぶん（つなぎ目を、角丸にせず、まっすぐに見せる）
    var joinedRoomID = ""

    // ウィンドウ
    var mainWin: NSWindow?
    var roomWin: NSPanel?
    var chatWin: NSPanel?
    var mailWin: NSPanel?
    var letterWin: NSPanel?
    var settingsWin: NSPanel?
    var profileWin: NSWindow?
    var bannedWin: NSWindow?
    var helpWin: NSWindow?
    var cardEditWin: NSWindow?
    var cardAuthWin: NSWindow?
    private var forceClose = Set<ObjectIdentifier>()
    private var askingLeave = false

    // 検知用
    private var seenRooms = Set<String>()
    private var armed = false
    private var quietGen = 0
    /// スピーカー（聞こえてくる音）のミュート。ボタンは増やさず、ショートカット（通話メニュー）で切り替える
    @Published var speakerMuted = false
    private var lastRid = ""      // いまいる部屋の ID（部屋から部屋へ移ったことを見分ける）
    private var lastHands = 0
    private var lastLetter = ""
    private var letterDismissed = ""
    private var wasJoined = false

    init(engine: Engine) {
        self.engine = engine
        let d = UserDefaults.standard
        notifyRooms = d.object(forKey: "notifyRooms") as? Bool ?? true
        selectedMic = d.string(forKey: "micLabel") ?? ""
        muteOnCreate = d.object(forKey: "muteOnCreate") as? Bool ?? true
        muteOnJoin = d.object(forKey: "muteOnJoin") as? Bool ?? true
        singlePane = d.bool(forKey: "singlePane")
        pinSingle = d.object(forKey: "pinSingle") as? Bool ?? true
        super.init()
        engine.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
        engine.onChat = { [weak self] l in self?.receive(chat: l) }
        engine.onReact = { [weak self] r in self?.receive(react: r) }
        engine.$room.removeDuplicates().sink { [weak self] _ in DispatchQueue.main.async { guard let self else { return }; self.roomChanged(self.engine.room) } }.store(in: &bag)
        engine.$cards.removeDuplicates().sink { [weak self] _ in DispatchQueue.main.async { guard let self else { return }; self.cardsChanged(self.engine.cards) } }.store(in: &bag)
        engine.$lobby.removeDuplicates().sink { [weak self] l in self?.lobbyChanged(l) }.store(in: &bag)
        engine.$ready.removeDuplicates().sink { [weak self] ok in
            guard let self else { return }
            // 読み込み直し（つなぎ直し・マイクの入り直しなど）のたびに、数秒のあいだは、新しい部屋の通知を出さない。
            // そのあいだに見えた部屋は「見た部屋」に入るので、あとから「新しい部屋」として通知されることもない
            self.quiet(for: ok ? 6 : nil)
            self.speakerMuted = false      // ページを読み込み直すと、ミュートも解ける
            guard ok else { return }
            self.engine.cmd(["type": "setMicLabel", "label": self.selectedMic])
            self.engine.cmd(["type": "sndRoom", "on": false])    // 通知はこちらで一本化する（ページの音は使わない）
        }.store(in: &bag)
        refreshMics()
        for n in [AVCaptureDevice.wasConnectedNotification, AVCaptureDevice.wasDisconnectedNotification] {
            NotificationCenter.default.addObserver(forName: n, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.refreshMics() } }
        }
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    // MARK: 初回起動のごあいさつ（作者への謝辞）
    /// 初回の起動で出す。「次から表示しない」は、はじめからチェック済み（はずして閉じると、次の起動でも出る）
    func showThanksIfFirst() {
        let d = UserDefaults.standard
        guard !d.bool(forKey: "thanksShown") else { return }
        let a = NSAlert()
        a.messageText = "くらもさんへ、ありがとうございます"
        a.informativeText = "Potalker は、くらもさんが作った「ぽっと通話」の、非公式クライアントです。通話の仕組みは、くらもさんのサイトをそのまま使わせてもらっています。\n\nこんなに気軽に話せる、すてきな場所を公開してくださって、ありがとうございます。「これはなに？」からも、読み返せます。"
        a.addButton(withTitle: "はじめる")
        a.showsSuppressionButton = true
        a.suppressionButton?.title = "次から表示しない"
        a.suppressionButton?.state = .on
        let links = [("ぽっと通話（Web アプリ）　potalk.app", "https://potalk.app/"),
                     ("ソース（GitHub）　po-talk/po-talk.github.io", "https://github.com/po-talk/po-talk.github.io")]
        let openers = links.map { LinkOpener(url: URL(string: $0.1)!) }
        let stack = NSStackView(views: zip(links, openers).map { l, o in
            let b = NSButton(title: "", target: o, action: #selector(LinkOpener.open))
            b.isBordered = false; b.alignment = .left
            b.attributedTitle = NSAttributedString(string: l.0, attributes: [.foregroundColor: NSColor.linkColor, .underlineStyle: NSUnderlineStyle.single.rawValue, .font: NSFont.systemFont(ofSize: 12)])
            return b
        })
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 6
        stack.frame = NSRect(x: 0, y: 0, width: 300, height: 44)
        a.accessoryView = stack
        a.runModal()
        if a.suppressionButton?.state == .on { d.set(true, forKey: "thanksShown") }
        withExtendedLifetime(openers) {}
    }

    // MARK: 受け取り
    private func receive(chat l: ChatLine) {
        if l.hist || (l.sys && l.text.hasPrefix("ここから過去ログ")) { past.append(l); return }
        chat.append(l); if chat.count > 200 { chat.removeFirst() }
        if !chatOpen && !l.sys && !l.who.contains("（あなた）") { unread += 1 }
    }
    private func receive(react r: ReactEvent) {
        if effects.count >= 12 { return }
        let e = FlyEffect(emoji: r.e, who: r.u == "self" ? "" : r.n, isSelf: r.u == "self", dx: CGFloat.random(in: -10...10))
        effects.append(e)
        if r.u == "self" { pop = r.e; DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.pop = "" } }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.effects.removeAll { $0.id == e.id } }
    }

    private func roomChanged(_ r: RoomState) {
        if r.joined != wasJoined {
            wasJoined = r.joined
            quiet(for: 6)
            warnedBanned = []
            if r.joined { joinedAt = Date(); knownMembers = []; roomHot = false; openRoom() } else { closeRoomGroup() }
            drawerOpen = false
            fitSingleFrame(joined: r.joined, resetHeight: true)
        }
        if !r.joined { lastRid = ""; if speakerMuted { speakerMuted = false; engine.cmd(["type": "spk", "on": false]) } }
        guard r.joined else { return }
        // 部屋から部屋へ、いったん退出せずに移ったときも、前の部屋のひとことを残さない
        if let rid = r.rid, !rid.isEmpty, rid != lastRid {
            if !lastRid.isEmpty { clearChat() }
            lastRid = rid
        }
        if singlePane, r.card != nil || r.ignoreAsk != nil { tab = .room }
        // 雑談部屋に、新しい人が入ったら、「部屋」のタブに色をつける（入室して数秒は、もとからいた人なので、数えない）
        if r.joined, !bannedWords.isEmpty {
            for m in r.members where !m.you { if let w = matchedBannedWord(m.name), warnedBanned.insert(m.name).inserted { notify(bannedMember: m.name, word: w) } }
        }
        let names = Set(r.members.map { $0.id })
        if !r.bcast, singlePane, tab != .room, Date().timeIntervalSince(joinedAt) > 3, !names.subtracting(knownMembers).isEmpty { roomHot = true }
        knownMembers = names
        // 作成・入室の直後は、設定に合わせてミュートにそろえる（マイクが取れて、ミュートの操作ができるようになってから1回だけ）
        if let p = pendingMute {
            if Date().timeIntervalSince(p.at) > 15 { pendingMute = nil }
            else if r.canMute { pendingMute = nil; if r.muted != p.target { engine.cmd(["type": "mute"]) } }
        }
        // 配信者側：手が挙がったら音
        let hands = r.members.filter { $0.mark == "🙋" }.count
        if hands > lastHands { NSSound(named: "Glass")?.play() }
        lastHands = hands
        // 公開されたお便り
        let key = r.mailNow.map { "\($0.cap)|\($0.who)|\($0.text)" } ?? ""
        if key.isEmpty { lastLetter = ""; letterDismissed = ""; letterWin?.close() }
        else { lastLetter = key; if key != letterDismissed && letterWin == nil { openLetter() } }
    }

    private func cardsChanged(_ c: CardsState) {
        if c.edit != nil, cardEditWin == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 500, height: 740), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            w.title = "名刺の設定"; w.isReleasedWhenClosed = false
            w.contentView = NSHostingView(rootView: CardEditView().environmentObject(self).environmentObject(engine))
            w.contentMinSize = NSSize(width: 460, height: 520)
            w.delegate = self; w.center(); w.setFrameAutosaveName("win.cardedit"); w.makeKeyAndOrderFront(nil); cardEditWin = w
        } else if c.edit == nil, let w = cardEditWin { cardEditWin = nil; w.close() }
        if c.auth != nil, cardAuthWin == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 520), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            w.title = "本人確認"; w.isReleasedWhenClosed = false; w.level = .floating
            w.contentView = NSHostingView(rootView: CardAuthView().environmentObject(self).environmentObject(engine))
            w.delegate = self; w.center(); w.setFrameAutosaveName("win.cardauth"); w.makeKeyAndOrderFront(nil); cardAuthWin = w
        } else if c.auth == nil, let w = cardAuthWin { cardAuthWin = nil; w.close() }
    }

    /// いま作られたばかりの部屋か（一覧の「経過時間」が数分以内）。読み込みが遅れて、あとから一覧に現れた古い部屋を、新しい部屋として通知しない
    static func isFresh(_ dur: String) -> Bool {
        if dur.contains("時間") || dur.contains("日") { return false }
        let digits = dur.filter { $0.isNumber }
        guard let n = Int(digits) else { return true }
        return n <= 3
    }
    private func lobbyChanged(_ l: LobbyState) {
        for room in l.rooms {
            if seenRooms.insert(room.key).inserted && armed && notifyRooms && Self.isFresh(room.dur) && !isBanned(room) { notify(newRoom: room) }
        }
    }
    /// 新しい部屋の通知を、しばらく止める（nil なら、読み込みが済むまで止めたまま）。入室・退出・作成・読み込み直しのあとは、一覧が入れ替わるため
    func quiet(for seconds: Double?) {
        armed = false; quietGen += 1
        guard let seconds else { return }
        let g = quietGen
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in if let self, g == self.quietGen { self.armed = true } }
    }
    /// 禁止ワードを含む名前の人が、いまの部屋にいたら、1人につき1回だけ知らせる（入室時にもういた人も、あとから入った人も）
    private var warnedBanned = Set<String>()
    func matchedBannedWord(_ name: String) -> String? {
        let h = MainView.fold(name)
        return bannedWords.first { h.contains(MainView.fold($0)) }
    }
    func notify(bannedMember name: String, word: String) {
        if ProcessInfo.processInfo.environment["POTALK_DEBUG"] == "1" { fputs("notify banned: \(name) \(word)\n", stderr) }
        NSSound(named: "Basso")?.play()
        let c = UNMutableNotificationContent()
        c.title = "禁止ワードを含む名前の人がいます"; c.body = "\(name)（登録ワード：\(word)）"; c.sound = nil
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
    }
    func notify(newRoom r: LobbyRoom) {
        if ProcessInfo.processInfo.environment["POTALK_DEBUG"] == "1" { print("notify:", r.name) }
        NSSound(named: "Glass")?.play()
        let c = UNMutableNotificationContent()
        c.title = "新しい部屋ができました"; c.body = r.name; c.sound = nil
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        await MainActor.run { NSApp.activate(ignoringOtherApps: true); self.mainWin?.makeKeyAndOrderFront(nil) }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent n: UNNotification) async -> UNNotificationPresentationOptions { [.banner] }

    // MARK: 指示
    func toggleSpeakerMute() {
        guard engine.room.joined else { return }
        speakerMuted.toggle()
        engine.cmd(["type": "spk", "on": speakerMuted])
    }
    func toggleMicMute() { if engine.room.joined, engine.room.canMute { engine.cmd(["type": "mute"]) } }
    /// ひとこと（前の部屋のぶん）を空にする
    func clearChat() { chat = []; past = []; unread = 0 }
    func join(_ r: LobbyRoom, quiet q: Bool) { quiet(for: 6); if engine.room.joined { clearChat() }; joinedRoomID = r.id; drawerOpen = false; pendingMute = (Date(), muteOnJoin); engine.cmd(["type": "join", "id": r.id, "quiet": q]); joinCandidate = nil }
    func createRoom(name: String, broadcast: Bool) { quiet(for: 6); if engine.room.joined { clearChat() }; joinedRoomID = ""; pendingMute = (Date(), muteOnCreate); engine.cmd(["type": "create", "name": name, "kind": broadcast ? "bc" : "chat"]); createOpen = false }
    /// 部屋のリンク（名前なしでもよい）で入る。入れなかったときは、理由を知らせる
    func openRoomLink(_ text: String) {
        quiet(for: 6)
        joinedRoomID = ""
        pendingMute = (Date(), muteOnJoin)
        search = ""
        engine.openLink(text) { [weak self] r in
            DispatchQueue.main.async {
                guard let self else { return }
                print("link result:", r)
                let msg: String?
                switch r {
                case .joined: msg = nil
                case .asleep: msg = "この部屋は見つかりません。存在しないか、すでに終了しています。"
                case .choose: msg = "同じ名前の部屋が、いくつか開いています。一覧から選んでください。"
                case .invalid: msg = "この部屋は見つかりません。存在しないか、すでに終了しています。"
                case .timeout: msg = "部屋に入れませんでした。もう一度お試しください。"
                }
                if let msg, ProcessInfo.processInfo.environment["POTALK_DEBUG"] == "1" { print("link message:", msg); self.pendingMute = nil; return }
                if let msg { self.pendingMute = nil; let a = NSAlert(); a.messageText = "部屋に入れません"; a.informativeText = msg; a.runModal() }
            }
        }
    }
    func sendChat(_ t: String) { engine.cmd(["type": "chat", "text": t]) }
    func refreshLobby() { quiet(for: 6); engine.cmd(["type": "refreshLobby"]) }    // 更新を押したときも、一覧の入れ替わりで音を出さない
    /// 入力デバイスの一覧（マイクの許可がなくても名前は取れる）
    /// マイクを選ぶ。通話中なら、入り直さないと切り替わらないので、確認して「つなぎ直す」
    func switchMic(_ name: String) {
        guard name != selectedMic else { return }
        selectedMic = name
        guard engine.room.joined else { return }
        let a = NSAlert()
        a.messageText = "マイクを切り替えるには、入り直します"
        a.informativeText = "「\(name.isEmpty ? "既定のマイク" : name)」に切り替えます。同じ部屋に入り直しますか？（数秒、声が途切れます）"
        a.addButton(withTitle: "入り直す"); a.addButton(withTitle: "次に入るときから")
        let go: (NSApplication.ModalResponse) -> Void = { [weak self] r in if r == .alertFirstButtonReturn { self?.engine.cmd(["type": "reconnect"]) } }
        if let w = roomHost { a.beginSheetModal(for: w, completionHandler: go) } else { go(a.runModal()) }
    }
    func refreshMics() {
        let s = AVCaptureDevice.DiscoverySession(deviceTypes: [.microphone, .external], mediaType: .audio, position: .unspecified)
        mics = s.devices.map { $0.localizedName }
    }
    func requestDevices() { refreshMics() }
    func confirmOpen(_ urlString: String, from window: NSWindow?) {
        guard let u = URL(string: urlString), ["http", "https"].contains(u.scheme ?? "") else { return }
        let a = NSAlert(); a.messageText = "このリンクを開きますか？"; a.informativeText = String(u.absoluteString.prefix(300))
        a.addButton(withTitle: "ブラウザで開く"); a.addButton(withTitle: "キャンセル")
        if let w = window { a.beginSheetModal(for: w) { if $0 == .alertFirstButtonReturn { NSWorkspace.shared.open(u) } } }
        else if a.runModal() == .alertFirstButtonReturn { NSWorkspace.shared.open(u) }
    }

    // MARK: ウィンドウ
    func makePanel<V: View>(title: String, size: NSSize, origin: NSPoint, floating: Bool, min: NSSize? = nil, save: String? = nil, _ view: V) -> NSPanel {
        let p = NSPanel(contentRect: NSRect(origin: origin, size: size), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        p.title = title
        p.contentView = NSHostingView(rootView: view.environmentObject(self).environmentObject(engine))
        p.isReleasedWhenClosed = false
        p.isFloatingPanel = floating
        if floating { p.level = .floating }
        p.hidesOnDeactivate = false
        p.becomesKeyOnlyIfNeeded = true
        if let m = min { p.contentMinSize = m }
        p.delegate = self
        if let save { p.setFrameAutosaveName(save) }   // 前回の位置と大きさを覚える（保存があれば、ここで戻る）
        return p
    }
    func rightOf(_ w: NSWindow?, width: CGFloat, height: CGFloat, dy: CGFloat = 0) -> NSPoint {
        let screen = (w?.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        guard let f = w?.frame else { return NSPoint(x: screen.maxX - width - 20, y: screen.maxY - height - 40) }
        let x = min(f.maxX + 8, screen.maxX - width)
        let y = max(screen.minY, min(f.maxY - height - dy, screen.maxY - height))
        return NSPoint(x: x, y: y)
    }

    /// 部屋の操作を出す窓（確認の表示などの親）。シングルペインでは本体の窓
    var roomHost: NSWindow? { roomWin ?? mainWin }

    func buildMainWindow() {
        let k = uiScale
        let size = singlePane && engine.room.joined ? NSSize(width: 400 * k, height: 720 * k) : NSSize(width: 520 * k, height: 820 * k)
        let w = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        w.title = "Potalker"
        let root: AnyView = singlePane ? AnyView(SinglePaneView().uiScaled(self).environmentObject(self).environmentObject(engine))
                                       : AnyView(MainView().environmentObject(self).environmentObject(engine))
        // 窓の最小の大きさは、こちらで決める（SwiftUI側の最小値に任せると、縮めた表示で、幅がなくなってしまう）
        let hv = NSHostingView(rootView: root)
        hv.sizingOptions = []
        w.contentView = hv
        w.contentMinSize = singlePane && engine.room.joined ? NSSize(width: 340 * k, height: 560 * k) : NSSize(width: 360 * k, height: 420 * k)
        w.isReleasedWhenClosed = false; w.delegate = self
        if singlePane { w.level = pinSingle ? .floating : .normal }     // シングルペインは、小さな画面向け。既定は、ほかの窓の上に浮かせておく
        w.center(); w.setFrameAutosaveName(singlePane ? "win.single" : "win.main"); w.makeKeyAndOrderFront(nil)
        mainWin = w
        fitSingleFrame(joined: engine.room.joined)
        keepOnScreen(w)
    }
    /// シングルペインの窓の幅。入室前（縦長の一覧）と、入室中（部屋の小窓くらい）で、別々に覚える
    private var lobbyW: CGFloat {
        get { UserDefaults.standard.object(forKey: "single.lobbyW") as? CGFloat ?? 520 }
        set { UserDefaults.standard.set(newValue, forKey: "single.lobbyW") }
    }
    private var roomW: CGFloat {
        get { UserDefaults.standard.object(forKey: "single.roomW") as? CGFloat ?? 400 * uiScale }
        set { UserDefaults.standard.set(newValue, forKey: "single.roomW") }
    }
    /// シングルペイン：入室前は縦長の一覧、入室したら部屋の小窓くらいの幅にする。右端と上端の位置は動かさない
    func fitSingleFrame(joined: Bool, resetHeight: Bool = false) {
        guard singlePane, let w = mainWin else { return }
        if !joined { chatDrawer = false }
        w.contentMinSize = joined ? NSSize(width: 340 * uiScale, height: minPaneH * uiScale) : NSSize(width: 360 * uiScale, height: 420 * uiScale)
        var f = w.frame
        let screen = (w.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let right = f.maxX     // 右端を基準に、幅を変える
        f.size.width = min(joined ? roomW : lobbyW, screen.width)
        f.origin.x = right - f.width
        let minH = minFrameSize(w).height
        if joined, resetHeight ? f.height != minH : f.height < minH { f.origin.y += f.height - minH; f.size.height = minH }      // 入室したら、必要な高さ（メンバー4人分くらい）にそろえる
        if f.maxX > screen.maxX { f.origin.x = max(screen.minX, screen.maxX - f.width) }
        if f.minX < screen.minX { f.origin.x = screen.minX }
        if f.minY < screen.minY { f.origin.y = screen.minY }
        if f != w.frame { w.setFrame(f, display: true, animate: true) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.applyMinSize(); self?.keepOnScreen(w) }     // 測り終わったあと、最小の高さを守らせる
    }
    /// 窓が画面の外に出ていたら、画面の中に戻す（大きさが画面より大きければ、収まる大きさにする）
    func keepOnScreen(_ w: NSWindow) {
        guard w.isVisible else { return }
        let f = w.frame
        let screen = NSScreen.screens.max { $0.visibleFrame.intersection(f).width * $0.visibleFrame.intersection(f).height < $1.visibleFrame.intersection(f).width * $1.visibleFrame.intersection(f).height }
        guard let v = (screen ?? NSScreen.main)?.visibleFrame else { return }
        var g = f
        g.size.width = min(g.width, v.width); g.size.height = min(g.height, v.height)
        if g.maxX > v.maxX { g.origin.x = v.maxX - g.width }
        if g.minX < v.minX { g.origin.x = v.minX }
        if g.maxY > v.maxY { g.origin.y = v.maxY - g.height }
        if g.minY < v.minY { g.origin.y = v.minY }
        if g != f { w.setFrame(g, display: true) }
    }
    /// 部屋一覧のドロワー：本体の窓の左に、窓の後ろからすべり出る（窓の大きさは変えない）。閉じると、すべって戻る
    func applyDrawer() {
        if drawerOpen {
            guard singlePane, engine.room.joined, let w = mainWin, drawerWin == nil else { drawerOpen = false; return }
            let screen = (w.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
            // 左に出す余地がないときは、本体の窓を右にずらす
            let deficit = max(0, screen.minX - (w.frame.minX - drawerW))
            drawerShift = min(deficit, max(0, screen.maxX - w.frame.maxX))
            if drawerShift > 0 { var f = w.frame; f.origin.x += drawerShift; w.setFrame(f, display: true, animate: true) }
            // 窓の大きさは最初から最後まで変えず、中身を、本体の窓の左の縁から、マスク（はみ出しを切る）の中へ滑り出させる
            let full = NSRect(x: w.frame.minX - drawerW, y: w.frame.minY, width: drawerW + drawerOverlap, height: w.frame.height)
            let p = DrawerPanel(contentRect: full, styleMask: [.titled, .fullSizeContentView], backing: .buffered, defer: false)
            p.titleVisibility = .hidden; p.titlebarAppearsTransparent = true
            for b in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] { p.standardWindowButton(b)?.isHidden = true }
            p.isMovable = false; p.isReleasedWhenClosed = false; p.hidesOnDeactivate = false; p.level = pinSingle ? .floating : .normal
            p.isOpaque = false; p.backgroundColor = .clear
            let box = NSView(frame: NSRect(origin: .zero, size: full.size))
            box.wantsLayer = true; box.layer?.masksToBounds = true; box.autoresizingMask = [.width, .height]
            let host = NSHostingView(rootView: MainView(embedded: true).uiScaled(self).padding(.trailing, drawerOverlap).background(Color(nsColor: .windowBackgroundColor)).environmentObject(self).environmentObject(engine))
            host.autoresizingMask = [.width, .height]
            host.frame = box.bounds.offsetBy(dx: drawerW, dy: 0)
            box.addSubview(host); p.contentView = box
            p.delegate = self
            w.addChildWindow(p, ordered: .below)
            p.orderFront(nil)
            NSAnimationContext.runAnimationGroup { c in
                c.duration = 0.25; c.timingFunction = CAMediaTimingFunction(name: .easeOut)
                host.animator().frame = box.bounds
            }
            drawerWin = p
        } else {
            guard let p = drawerWin else { return }
            drawerWin = nil
            let main = p.parent
            let host = p.contentView?.subviews.first
            let shift = drawerShift; drawerShift = 0
            NSAnimationContext.runAnimationGroup({ c in
                c.duration = 0.2; c.timingFunction = CAMediaTimingFunction(name: .easeIn)
                if let h = host, let box = h.superview { h.animator().frame = box.bounds.offsetBy(dx: drawerW, dy: 0) }
            }, completionHandler: {
                MainActor.assumeIsolated {
                    main?.removeChildWindow(p); p.orderOut(nil); p.close()
                    if shift > 0, let m = main { var f = m.frame; f.origin.x -= shift; m.setFrame(f, display: true, animate: true) }
                }
            })
        }
    }
    /// シングルペインの窓の最小の大きさを守る（表示を縮めているときも、幅や高さがなくならないように）
    /// シングルペインの窓の、枠を含めた最小の大きさ
    func minFrameSize(_ w: NSWindow) -> NSSize {
        let joined = engine.room.joined
        let c = NSSize(width: (joined ? 340 : 360) * uiScale, height: (joined ? minPaneH : 420) * uiScale)
        return w.frameRect(forContentRect: NSRect(origin: .zero, size: c)).size
    }
    /// シングルペインの窓の最小の大きさ（幅・高さ）を守る（表示を縮めているときも、なくならないように）
    func windowWillResize(_ sender: NSWindow, to frameSize: NSSize) -> NSSize {
        guard singlePane, sender === mainWin else { return frameSize }
        var m = minFrameSize(sender)
        if liveResizing, chatDrawer {      // 縁で縮めるのは、ひとことのぶん。ひとこと側は60まで
            let c = NSSize(width: 340 * uiScale, height: ((paneNeedH > 0 ? paneNeedH : 520) + 61) * uiScale)
            m.height = sender.frameRect(forContentRect: NSRect(origin: .zero, size: c)).height
        }
        return NSSize(width: max(frameSize.width, m.width), height: max(frameSize.height, m.height))
    }
    func windowDidResize(_ n: Notification) {
        guard let w = n.object as? NSWindow, w === mainWin else { return }
        // ひとことを開いているとき、窓の縁を引っぱった分は、ひとことの高さにする（上の部屋の画面は変えない）
        if liveResizing, singlePane, chatDrawer {
            let d = w.frame.height - lastMainH
            if d != 0 { adoptingResize = true; chatGrown += d; chatH = max(60, chatH + d / uiScale); adoptingResize = false }
        }
        lastMainH = w.frame.height
        guard let p = drawerWin else { return }
        p.setFrame(NSRect(x: w.frame.minX - drawerW, y: w.frame.minY, width: drawerW + drawerOverlap, height: w.frame.height), display: true)
    }
    func windowWillStartLiveResize(_ n: Notification) {
        guard let w = n.object as? NSWindow, w === mainWin else { return }
        liveResizing = true; lastMainH = w.frame.height
    }
    func windowDidEndLiveResize(_ n: Notification) {
        if let w = n.object as? NSWindow, w === mainWin { liveResizing = false }
        guard singlePane, let w = n.object as? NSWindow, w === mainWin else { return }
        if engine.room.joined { roomW = w.frame.width } else { lobbyW = w.frame.width }
    }

    /// 窓の使い方（複数ウインドウ／シングルペイン）を切り替える。通話はそのまま続く
    func applyLayoutMode() {
        if let old = mainWin { forceClose.insert(ObjectIdentifier(old)); old.close() }
        mainWin = nil
        drawerOpen = false
        if singlePane {
            for w in [roomWin, chatWin, mailWin, letterWin, settingsWin] { if let w { forceClose.insert(ObjectIdentifier(w)); w.close() } }
            roomWin = nil; chatWin = nil; mailWin = nil; letterWin = nil; settingsWin = nil
            tab = .room
        } else {
            chatDrawer = false; chatOpen = false; mailOpen = false
        }
        buildMainWindow()
        if !singlePane, engine.room.joined { openRoom() }
    }

    /// メインウインドウ（複数ウインドウではロビー、シングルペインでは1つの窓）を前に出す
    func showMain() {
        NSApp.activate(ignoringOtherApps: true)
        mainWin?.makeKeyAndOrderFront(nil)
    }
    /// シングルペインのタブを、前後に移る（おたよりは、配信部屋のときだけ）
    func cycleTab(_ step: Int) {
        guard singlePane, engine.room.joined else { return }
        var order: [PaneTab] = [.room]
        if engine.room.bcast { order.append(.mail) }
        order.append(.settings)
        let i = order.firstIndex(of: tab) ?? 0
        tab = order[(i + step + order.count) % order.count]
    }

    func openRoom() {
        if singlePane { tab = .room; showMain(); return }
        if let w = roomWin { w.orderFront(nil); return }
        let size = NSSize(width: 360, height: 700)
        let h = min(size.height, (mainWin?.screen ?? NSScreen.main)?.visibleFrame.height ?? 700)
        let p = makePanel(title: "部屋", size: NSSize(width: 360, height: h), origin: rightOf(mainWin, width: 360, height: h), floating: pinRoom, min: NSSize(width: 320, height: 640), save: "win.room", RoomView())
        roomWin = p; p.orderFront(nil)
        alignTop(p, to: mainWin)
    }
    /// 本体の窓のすぐ隣に開いた小窓は、上の高さをそろえる（覚えていた位置が少しずれていても、段差をなくす）
    func alignTop(_ w: NSWindow, to ref: NSWindow?) {
        guard let refWin = ref, refWin.isVisible else { return }
        let g = refWin.frame
        var f = w.frame
        let gapR = f.minX - g.maxX, gapL = g.minX - f.maxX
        guard (0...24).contains(gapR) || (0...24).contains(gapL) else { return }
        let d = g.maxY - f.maxY
        guard d != 0, abs(d) <= 40 else { return }
        f.origin.y += d
        let screen = (w.screen ?? NSScreen.main)?.visibleFrame ?? .zero
        if f.maxY > screen.maxY { f.origin.y = screen.maxY - f.height }
        w.setFrame(f, display: true)
    }
    func togglePin() { pinRoom.toggle(); roomWin?.level = pinRoom ? .floating : .normal; roomWin?.isFloatingPanel = pinRoom }
    func openChat() {
        if singlePane { chatDrawer = true; showMain(); return }
        unread = 0; chatOpen = true
        if let w = chatWin { w.orderFront(nil); return }
        let p = makePanel(title: "ひとこと", size: NSSize(width: 340, height: 460), origin: rightOf(roomWin ?? mainWin, width: 340, height: 460), floating: true, min: NSSize(width: 260, height: 240), save: "win.chat", ChatView())
        chatWin = p; p.orderFront(nil)
    }
    func toggleChat() {
        if singlePane { chatDrawer.toggle(); return }
        if let w = chatWin, w.isVisible { w.close() } else { openChat() }
    }
    func openMail() {
        if singlePane { if engine.room.bcast { tab = .mail; showMain() }; return }
        mailOpen = true
        if let w = mailWin { w.orderFront(nil); return }
        let p = makePanel(title: "おたより", size: NSSize(width: 360, height: 480), origin: rightOf(roomWin ?? mainWin, width: 360, height: 480, dy: 40), floating: true, min: NSSize(width: 300, height: 280), save: "win.mail", MailView())
        mailWin = p; p.orderFront(nil)
    }
    func openLetter() {
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let s = NSSize(width: 440, height: 250)
        let p = makePanel(title: "公開中のお便り", size: s, origin: NSPoint(x: screen.midX - s.width / 2, y: screen.maxY - s.height - 60), floating: true, min: NSSize(width: 300, height: 160), save: "win.letter", LetterView())
        letterWin = p; p.orderFront(nil)
    }
    func openSettings() {
        if singlePane { tab = .settings; showMain(); return }
        if let w = settingsWin { w.orderFront(nil); return }
        let p = makePanel(title: "部屋の設定", size: NSSize(width: 340, height: 460), origin: rightOf(roomWin, width: 340, height: 460), floating: true, min: NSSize(width: 280, height: 240), RoomSettingsView())
        if let rf = roomWin?.frame { p.setFrameOrigin(NSPoint(x: max(0, rf.minX - 348), y: rf.maxY - 460)) }
        p.setFrameAutosaveName("win.settings")
        settingsWin = p; p.orderFront(nil)
    }
    // MARK: 禁止ワード（Potalker 独自：含む部屋を、一覧に出さない）
    /// 登録した禁止ワード。新しく登録したものが先頭
    @Published var bannedWords: [String] = UserDefaults.standard.stringArray(forKey: "bannedWords") ?? [] {
        didSet { UserDefaults.standard.set(bannedWords, forKey: "bannedWords") }
    }
    /// 登録する。空・すでにあるもの（全角半角・大文字小文字・ひらがなカタカナの違いは区別しない）は、受け付けない。登録できたら true
    @discardableResult func addBanned(_ w: String) -> Bool {
        let t = w.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !bannedWords.contains(where: { MainView.fold($0) == MainView.fold(t) }) else { return false }
        bannedWords.insert(t, at: 0)
        return true
    }
    func removeBanned(_ w: String) { bannedWords.removeAll { $0 == w } }
    /// 部屋の名前・話題タグ・タグを付けた人・いまいる人の名前に、禁止ワードが含まれるか
    func isBanned(_ r: LobbyRoom) -> Bool {
        guard !bannedWords.isEmpty else { return false }
        let hay = ([r.name, r.sub, r.subBy] + r.people.map { $0.name }).map { MainView.fold($0) }
        return bannedWords.contains { w in let q = MainView.fold(w); return hay.contains { $0.contains(q) } }
    }
    func openBanned() {
        if let w = bannedWin { w.makeKeyAndOrderFront(nil); return }
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 460), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        w.title = "禁止ワード"; w.isReleasedWhenClosed = false
        w.contentView = NSHostingView(rootView: BannedWordsView().environmentObject(self))
        w.contentMinSize = NSSize(width: 320, height: 300)
        w.center(); w.setFrameAutosaveName("win.banned"); w.delegate = self; bannedWin = w; w.makeKeyAndOrderFront(nil)
    }
    func openProfile() {
        if let w = profileWin { w.makeKeyAndOrderFront(nil); return }
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 600), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        w.title = "初期設定"; w.isReleasedWhenClosed = false
        w.contentView = NSHostingView(rootView: ProfileView().environmentObject(self).environmentObject(engine))
        w.center(); w.setFrameAutosaveName("win.profile"); w.delegate = self; profileWin = w; w.makeKeyAndOrderFront(nil)
    }
    func openHelp() {
        if let w = helpWin { w.makeKeyAndOrderFront(nil); return }
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 440, height: 560), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        w.title = "ぽっと通話：これはなに？"; w.isReleasedWhenClosed = false
        w.contentView = NSHostingView(rootView: HelpView())
        w.center(); w.setFrameAutosaveName("win.help"); w.delegate = self; helpWin = w; w.makeKeyAndOrderFront(nil)
    }
    /// 覚えているウィンドウの位置と大きさを消し、開いているウィンドウも初期の配置に戻す
    func resetWindowLayout() {
        for k in ["single.lobbyW", "single.roomW"] { UserDefaults.standard.removeObject(forKey: k) }
        for n in ["main", "single", "room", "chat", "mail", "letter", "settings", "profile", "help", "cardedit", "cardauth"] { NSWindow.removeFrame(usingName: "win." + n) }
        let screen = (mainWin?.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        func place(_ w: NSWindow?, _ size: NSSize, _ origin: NSPoint) { w?.setFrame(NSRect(origin: origin, size: size), display: true) }
        if let m = mainWin {
            let size = singlePane ? NSSize(width: (engine.room.joined ? 400 : 520) * uiScale, height: min((engine.room.joined ? 720 : 820) * uiScale, screen.height)) : NSSize(width: 520, height: min(820, screen.height))
            place(m, size, NSPoint(x: screen.midX - size.width / 2, y: screen.midY - size.height / 2))
        }
        let rh = min(700, screen.height)
        place(roomWin, NSSize(width: 360, height: rh), rightOf(mainWin, width: 360, height: rh))
        place(chatWin, NSSize(width: 340, height: 460), rightOf(roomWin ?? mainWin, width: 340, height: 460))
        place(mailWin, NSSize(width: 360, height: 480), rightOf(roomWin ?? mainWin, width: 360, height: 480, dy: 40))
        if let rf = roomWin?.frame { place(settingsWin, NSSize(width: 340, height: 460), NSPoint(x: max(0, rf.minX - 348), y: rf.maxY - 460)) }
        else { place(settingsWin, NSSize(width: 340, height: 460), rightOf(mainWin, width: 340, height: 460)) }
        place(letterWin, NSSize(width: 440, height: 250), NSPoint(x: screen.midX - 220, y: screen.maxY - 250 - 60))
        for w in [profileWin, helpWin, bannedWin, cardEditWin, cardAuthWin] { w?.center() }
    }
    @objc func resetWindowLayoutAction() { resetWindowLayout() }

    func closeRoomGroup() {
        for w in [roomWin, chatWin, mailWin, letterWin, settingsWin] { if let w { forceClose.insert(ObjectIdentifier(w)); w.close() } }
        roomWin = nil; chatWin = nil; mailWin = nil; letterWin = nil; settingsWin = nil
        chat = []; past = []; unread = 0; chatDrawer = false; chatOpen = false; mailOpen = false; lastHands = 0; lastLetter = ""; letterDismissed = ""
        tab = .room; roomHot = false
    }
    func requestLeave(from w: NSWindow?) {
        let a = NSAlert(); a.messageText = "この部屋を退出しますか？"; a.informativeText = "窓を閉じると、部屋から退出します。"
        a.addButton(withTitle: "退出して閉じる"); a.addButton(withTitle: "キャンセル"); a.buttons[1].keyEquivalent = "\u{1b}"
        let handler: (NSApplication.ModalResponse) -> Void = { [weak self] r in
            self?.askingLeave = false
            if r == .alertFirstButtonReturn { self?.engine.cmd(["type": "leave"]) }
        }
        if askingLeave { return }
        askingLeave = true
        if let w { a.beginSheetModal(for: w, completionHandler: handler) } else { handler(a.runModal()) }
    }

    // MARK: NSWindowDelegate
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sender === roomWin || (singlePane && sender === mainWin && engine.room.joined), !forceClose.contains(ObjectIdentifier(sender)) { requestLeave(from: sender); return false }
        return true
    }
    // MARK: 画面の端・ほかのウィンドウへの吸着（本体以外のウィンドウをドラッグしたとき）
    private var snapping = false
    var forceSnap = false
    func windowDidMove(_ n: Notification) {
        guard let w = n.object as? NSWindow, !snapping, (forceSnap || NSEvent.pressedMouseButtons & 1 == 1), w !== mainWin || singlePane,
              [mainWin, roomWin, chatWin, mailWin, letterWin, settingsWin, cardEditWin, cardAuthWin, profileWin, helpWin, bannedWin].contains(where: { $0 === w }) else { return }
        snapping = true; defer { snapping = false }
        let T: CGFloat = 14
        var f = w.frame
        let screen = (w.screen ?? NSScreen.main)?.visibleFrame ?? .zero
        var xs: [CGFloat] = [screen.minX - f.minX, screen.maxX - f.maxX]
        var ys: [CGFloat] = [screen.minY - f.minY, screen.maxY - f.maxY]
        for o in [mainWin, roomWin, chatWin, mailWin, letterWin, settingsWin, cardEditWin, cardAuthWin, profileWin, helpWin, bannedWin].compactMap({ $0 }) where o !== w && o !== drawerWin && o.isVisible {
            let g = o.frame
            // 縦に重なっているときだけ、横の吸着（隣・端そろえ）を考える。横も同じ
            if g.maxY > f.minY - T && g.minY < f.maxY + T { xs += [g.maxX - f.minX, g.minX - f.maxX, g.minX - f.minX, g.maxX - f.maxX] }
            if g.maxX > f.minX - T && g.minX < f.maxX + T { ys += [g.maxY - f.minY, g.minY - f.maxY, g.minY - f.minY, g.maxY - f.maxY] }
        }
        let dx = xs.filter { abs($0) <= T }.min { abs($0) < abs($1) }
        let dy = ys.filter { abs($0) <= T }.min { abs($0) < abs($1) }
        if dx == nil && dy == nil { return }
        f.origin.x += dx ?? 0; f.origin.y += dy ?? 0
        w.setFrame(f, display: true)
    }

    func windowWillClose(_ n: Notification) {
        guard let w = n.object as? NSWindow else { return }
        if w === chatWin { chatOpen = false; chatWin = nil }
        else if w === mailWin { mailOpen = false; mailWin = nil }
        else if w === letterWin { letterDismissed = lastLetter; letterWin = nil }
        else if w === settingsWin { settingsWin = nil }
        else if w === profileWin { profileWin = nil }
        else if w === bannedWin { bannedWin = nil }
        else if w === helpWin { helpWin = nil }
        else if w === cardEditWin { cardEditWin = nil; engine.cmd(["type": "ceClose"]) }
        else if w === cardAuthWin { cardAuthWin = nil; engine.cmd(["type": "caCancel"]) }
        else if w === roomWin { roomWin = nil }
        forceClose.remove(ObjectIdentifier(w))
    }
}

/// ごあいさつの画面のリンク用（押しても、画面は閉じない）
final class LinkOpener: NSObject {
    let url: URL
    init(url: URL) { self.url = url }
    @objc func open() { NSWorkspace.shared.open(url) }
}
