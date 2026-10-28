import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation {
    let engine = Engine()
    lazy var model = AppModel(engine: engine)
    var debug: DebugChannel?

    func applicationDidFinishLaunching(_ n: Notification) {
        engine.log = { print("[engine]", $0) }
        engine.start()
        buildMenu()
        model.buildMainWindow()
        if ProcessInfo.processInfo.environment["POTALK_DEBUG"] != "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in self?.model.showThanksIfFirst() }
        }
        if ProcessInfo.processInfo.environment["POTALK_DEBUG"] == "1" {
            let d = DebugChannel(engine: engine)
            d.snapshots["main"] = { [weak self] in self?.model.mainWin?.contentView }
            d.snapshots["room"] = { [weak self] in self?.model.roomWin?.contentView }
            d.snapshots["chat"] = { [weak self] in self?.model.chatWin?.contentView }
            d.snapshots["mail"] = { [weak self] in self?.model.mailWin?.contentView }
            d.snapshots["letter"] = { [weak self] in self?.model.letterWin?.contentView }
            d.snapshots["settings"] = { [weak self] in self?.model.settingsWin?.contentView }
            d.snapshots["drawer"] = { [weak self] in self?.model.drawerWin?.contentView }
            d.snapshots["cardedit"] = { [weak self] in self?.model.cardEditWin?.contentView }
            d.snapshots["cardauth"] = { [weak self] in self?.model.cardAuthWin?.contentView }
            d.snapshots["profile"] = { [weak self] in self?.model.profileWin?.contentView }
            d.extra = { [weak self] in "mics=\(self?.model.mics ?? [])" }
            d.actions = { [weak self] name in
                guard let m = self?.model else { return }
                if name.hasPrefix("raw:") { let u = String(name.dropFirst(4)); print("raw link test:", u); m.openRoomLink(u); return }
                if name.hasPrefix("link:") { let q = String(name.dropFirst(5)); if let r = m.engine.lobby.rooms.first(where: { $0.name.contains(q) }) { print("link test:", r.name, r.id); m.openRoomLink("https://potalk.app/#room=\(r.id)") } else { print("link test: no room", q) }; return }
                switch name {
                case "snapTest":
                    if let w = m.roomWin ?? (m.singlePane ? m.mainWin : nil), let s = w.screen?.visibleFrame {
                        m.forceSnap = true
                        w.setFrameOrigin(NSPoint(x: s.maxX - w.frame.width - 9, y: s.minY + 6))
                        m.windowDidMove(Notification(name: NSWindow.didMoveNotification, object: w))
                        m.forceSnap = false
                        print("snap result:", w.frame.maxX == s.maxX, w.frame.minY == s.minY, w.frame, s)
                    }
                case "openLetterOnly": m.openLetter()
                case "openAll": m.openChat(); m.openMail(); m.openSettings(); m.openLetter(); m.openProfile(); m.openHelp()
                case "moveAll":
                    var y: CGFloat = 200
                    for w in [m.chatWin, m.mailWin, m.settingsWin, m.letterWin, m.profileWin, m.helpWin] { if let w { var f = w.frame; f.origin = NSPoint(x: 150 + y / 2, y: y); f.size.width += 11; w.setFrame(f, display: true); y += 40 } }
                case "allFrames":
                    for (n, w) in [("chat", m.chatWin), ("mail", m.mailWin), ("settings", m.settingsWin), ("letter", m.letterWin), ("profile", m.profileWin), ("help", m.helpWin)] { print("frame", n, w.map { "\(Int($0.frame.minX)),\(Int($0.frame.minY)) w\(Int($0.frame.width))" } ?? "nil") }
                case "resetLayout": m.resetWindowLayout()
                case "menuItems": print("menu:", NSApp.mainMenu?.items.compactMap { $0.submenu?.items.map { $0.title } } as Any)
                case "moveRoom": if let w = m.roomWin { w.setFrame(NSRect(x: 321, y: 123, width: 377, height: 655), display: true) }
                case "roomFrame": print("roomFrame:", m.roomWin?.frame as Any, "main:", m.mainWin?.frame as Any, "drawer:", m.drawerWin?.frame as Any, "level:", m.mainWin?.level.rawValue as Any, m.drawerWin?.level.rawValue as Any)
                case "openLinkGreeter": if let r = m.engine.lobby.rooms.first(where: { $0.name.contains("ようこそ") }) { m.openRoomLink("https://potalk.app/#room=\(r.id)") }
                case "createRoom": m.createRoom(name: "ミュート試験", broadcast: false)
                case "setMuteOnCreate": m.muteOnCreate = false
                case "setMuteOnJoin": m.muteOnJoin = false
                case "joinGreeter": if let r = m.engine.lobby.rooms.first(where: { $0.name.contains("ようこそ") }) { m.join(r, quiet: false) }
                case "fakeUnread": m.unread = 1
                case "alignTest":
                    if let w = m.roomWin, let gw = m.mainWin {
                        let g = gw.frame
                        var f = w.frame; f.origin.x = g.maxX + 8; f.origin.y = g.maxY - f.height - 20; w.setFrame(f, display: true)
                        m.alignTop(w, to: gw)
                        print("align result:", w.frame.maxY == g.maxY, w.frame.maxY, g.maxY)
                    }
                case "thanks": UserDefaults.standard.set(false, forKey: "thanksShown"); m.showThanksIfFirst()
                case "fakeJoin": m.roomHot = true
                case let n where n.hasPrefix("menu:"):
                    let t = String(n.dropFirst(5))
                    if let it = NSApp.windowsMenu?.items.first(where: { $0.title == t }), let a = it.action { print("menu:", t, "enabled:", self?.validateMenuItem(it) as Any); _ = NSApp.sendAction(a, to: it.target, from: it); print("tab:", m.tab, "singlePane:", m.singlePane) }
                    else { print("menu: not found", t) }
                case "demoLobby": Demo.apply(m, joined: false)
                case "demoRoom": Demo.apply(m, joined: true)
                case "demoTag": m.engine.room.tag.text = "https://riryo3.github.io/en/（リョータが付けた）"
                case "fakeChat": m.chat.append(ChatLine(sys: false, hist: false, em: "🦊", who: "テスト", text: "前の部屋のひとこと")); print("chat count:", m.chat.count)
                case "chatCount": print("chat count:", m.chat.count, "past:", m.past.count)
                case "joinOther": if let r = m.engine.lobby.rooms.first(where: { !$0.name.contains("ようこそ") && !$0.bc }) { print("join other:", r.name); m.join(r, quiet: false) } else { print("no other room") }
                case "spk": m.toggleSpeakerMute(); print("speakerMuted:", m.speakerMuted)
                case "toggleDrawer": m.drawerOpen.toggle()
                case "singleOn": m.singlePane = true
                case "singleOff": m.singlePane = false
                case "tabRoom": m.tab = .room
                case "dragDown": m.setWindowHeight((m.mainWin?.frame.height ?? 0) + 120)
                case "dragUp": m.setWindowHeight((m.mainWin?.frame.height ?? 0) - 120)
                case "tabChat": m.chatDrawer.toggle()
                case "tabMail": m.tab = .mail
                case "tabSettings": m.tab = .settings
                case "openChat": m.openChat()
                case "openMail": m.openMail()
                case "openSettings": m.openSettings()
                case "openProfile": m.openProfile()
                case "openHelp": m.openHelp()
                case "openCreate": m.createOpen = true
                case "join0": if let r = m.engine.lobby.rooms.first { m.joinCandidate = r }
                default: break
                }
            }
            debug = d
        }
        NSApp.activate(ignoringOtherApps: true)
    }
    /// 入室中（部屋を開いている場合も含む）に終了しようとしたら、確認する
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard model.engine.room.joined else { return .terminateNow }
        if ProcessInfo.processInfo.environment["POTALK_DEBUG"] == "1" { print("quit warning: would ask (joined)"); return .terminateNow }
        let a = NSAlert()
        a.messageText = "通話中です。アプリを終了しますか？"
        a.informativeText = "終了すると、いまの部屋から退出します。部屋を開いている場合は、あなたが抜けたあとの部屋が、どうなるかは、ほかの参加者しだいです。"
        a.addButton(withTitle: "キャンセル"); a.addButton(withTitle: "退出して終了")
        a.buttons[0].keyEquivalent = "\r"; a.buttons[1].keyEquivalent = ""
        NSApp.activate(ignoringOtherApps: true)
        if a.runModal() == .alertSecondButtonReturn { model.engine.cmd(["type": "leave"]); return .terminateNow }
        return .terminateCancel
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { model.mainWin?.makeKeyAndOrderFront(nil) }; return true
    }

    @objc func showMain() { model.showMain() }
    @objc func showRoom() { model.openRoom() }
    @objc func showChat() { model.openChat() }
    @objc func showMail() { model.openMail() }
    @objc func showSettings() { model.openSettings() }
    @objc func micMute() { model.toggleMicMute() }
    @objc func speakerMute() { model.toggleSpeakerMute() }
    @objc func toggleSinglePane() { model.singlePane.toggle() }
    @objc func toggleDrawer() { if model.singlePane { model.drawerOpen.toggle() } }
    @objc func setScale(_ sender: NSMenuItem) { model.scalePct = sender.tag }
    @objc func nextTab() { model.cycleTab(1) }
    @objc func prevTab() { model.cycleTab(-1) }
    /// 入室していないあいだは、部屋まわりの項目を、グレーにする
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        let joined = model.engine.room.joined
        switch item.action {
        case #selector(showRoom), #selector(showChat), #selector(showSettings): return joined
        case #selector(showMail): return joined && model.engine.room.bcast
        case #selector(toggleDrawer), #selector(nextTab), #selector(prevTab): return joined && model.singlePane
        case #selector(micMute): return joined && model.engine.room.canMute
        case #selector(speakerMute): item.state = model.speakerMuted ? .on : .off; return joined
        case #selector(setScale(_:)): item.state = item.tag == model.scalePct ? .on : .off; return model.singlePane
        case #selector(toggleSinglePane): item.state = model.singlePane ? .on : .off; return true
        default: return true
        }
    }

    @objc func showAbout() {
        let credits = NSAttributedString(string: "ぽっと通話（potalk.app）の非公式クライアントです。\nサイトの作者とは関係ありません。通話の仕組みは potalk.app をそのまま利用しています。\nご参考：github.com/po-talk/po-talk.github.io", attributes: [.font: NSFont.systemFont(ofSize: 12)])
        NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "Potalker", .credits: credits])
    }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        let about = NSMenuItem(title: "Potalker について", action: #selector(AppDelegate.showAbout), keyEquivalent: ""); about.target = self; appMenu.addItem(about)
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Potalker を隠す", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Potalker を終了", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "編集"); editItem.submenu = edit
        edit.addItem(withTitle: "カット", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "コピー", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "ペースト", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "すべてを選択", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        let callItem = NSMenuItem(); main.addItem(callItem)
        let call = NSMenu(title: "通話"); callItem.submenu = call
        for (t, sel, key) in [("マイクのミュート", #selector(micMute), "m"), ("スピーカーのミュート", #selector(speakerMute), "s")] {
            let m = NSMenuItem(title: t, action: sel, keyEquivalent: key); m.keyEquivalentModifierMask = [.command, .shift]; m.target = self; call.addItem(m)
        }
        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "ウインドウ"); winItem.submenu = win
        func item(_ title: String, _ sel: Selector, _ key: String, _ mods: NSEvent.ModifierFlags = [.command]) {
            let m = NSMenuItem(title: title, action: sel, keyEquivalent: key); m.keyEquivalentModifierMask = mods; m.target = self; win.addItem(m)
        }
        item("メインウインドウ", #selector(showMain), "1")
        item("シングルペインで表示", #selector(toggleSinglePane), "p", [.command, .shift])
        let sizeItem = NSMenuItem(title: "シングルペインの表示サイズ", action: nil, keyEquivalent: ""); win.addItem(sizeItem)
        let sizeMenu = NSMenu(title: "表示サイズ"); sizeItem.submenu = sizeMenu
        for pct in AppModel.scaleSteps {
            let m = NSMenuItem(title: "\(pct)%", action: #selector(setScale(_:)), keyEquivalent: ""); m.tag = pct; m.target = self; sizeMenu.addItem(m)
        }
        win.addItem(.separator())
        item("部屋", #selector(showRoom), "2")
        item("ひとこと", #selector(showChat), "3")
        item("おたより", #selector(showMail), "4")
        item("部屋の設定", #selector(showSettings), "5")
        win.addItem(.separator())
        item("部屋一覧を開く／閉じる", #selector(toggleDrawer), "l")
        item("次のタブ", #selector(nextTab), "]")
        item("前のタブ", #selector(prevTab), "[")
        win.addItem(.separator())
        win.addItem(withTitle: "しまう", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        win.addItem(.separator())
        let reset = NSMenuItem(title: "ウインドウのレイアウトを初期化", action: #selector(AppModel.resetWindowLayoutAction), keyEquivalent: "")
        reset.target = model
        win.addItem(reset)
        NSApp.windowsMenu = win
        NSApp.mainMenu = main
    }
}
