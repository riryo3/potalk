import AppKit
import WebKit
import Combine

/// 通話の仕組み（potalk.app のページ）を動かす、画面に出ない WKWebView。
@MainActor
final class Engine: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    static let home = URL(string: "https://potalk.app/")!

    @Published var lobby = LobbyState(rooms: [], status: "", viewers: "")
    @Published var profile = ProfileState(emoji: "", name: "", input: "", avatars: [], version: "")
    @Published var room = RoomState.empty
    @Published var eq = ""
    @Published var cards = CardsState(edit: nil, auth: nil)
    @Published var devices: [AudioDevice] = []
    @Published var ready = false
    @Published var patched = false

    var demo = false
    var onChat: ((ChatLine) -> Void)?
    var onReact: ((ReactEvent) -> Void)?
    var log: ((String) -> Void)?

    let webView: WKWebView
    private let host: NSWindow

    override init() {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.preferences.inactiveSchedulingPolicy = .none
        let ucc = WKUserContentController()
        ucc.addUserScript(WKUserScript(source: BridgeJS.micOverride, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        ucc.addUserScript(WKUserScript(source: BridgeJS.bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.userContentController = ucc
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 900, height: 700), configuration: cfg)
        webView.isInspectable = true
        host = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.borderless], backing: .buffered, defer: false)
        super.init()
        ucc.add(WeakHandler(self), name: "pm")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.autoresizingMask = [.width, .height]
        host.contentView = webView
        host.isReleasedWhenClosed = false
        host.alphaValue = 0.01
        host.ignoresMouseEvents = true
        host.level = .normal
        host.collectionBehavior = [.stationary, .ignoresCycle, .transient, .canJoinAllSpaces]
        host.setFrame(NSRect(x: 0, y: 0, width: 900, height: 700), display: false)
        host.orderFrontRegardless()
    }

    func start() {
        Task { await load() }
    }

    func load(hash: String = "") async {
        let url = Engine.home
        var html: String?
        do {
            var req = URLRequest(url: url)
            req.cachePolicy = .reloadIgnoringLocalCacheData
            let (data, _) = try await URLSession.shared.data(for: req)
            html = String(data: data, encoding: .utf8)
        } catch { log?("ページの取得に失敗: \(error.localizedDescription)") }
        guard let src = html else { webView.load(URLRequest(url: url)); return }
        let (out, ok, missing) = PagePatcher.apply(src)
        patched = ok
        if !ok { log?("差し込み位置が見つかりません。元のページを使います: \(missing ?? "")") }
        let base = hash.isEmpty ? url : URL(string: url.absoluteString + hash) ?? url
        webView.loadHTMLString(out, baseURL: base)
    }

    enum LinkResult { case joined, asleep, choose, invalid, timeout }
    /// 部屋のリンクで入る：そのリンクでページを読み込み直し、ページの入口の案内が「いま開いています」になって
    /// 部屋の名前が入ったら、参加を押す（名前なしのリンクでも、開いている部屋なら、名前は自動で入る）
    func openLink(_ text: String, done: ((LinkResult) -> Void)? = nil) {
        guard let r = text.range(of: "#room=") else { return }
        let hash = String(text[r.lowerBound...]).split(whereSeparator: { $0 == " " || $0 == "\n" }).first.map(String.init) ?? ""
        Task {
            ready = false
            await load(hash: hash)
            let probe = "JSON.stringify({t: (document.getElementById('entryText')||{}).textContent||'', n: !!(document.getElementById('entryNote')&&!document.getElementById('entryNote').hidden), name: (document.getElementById('room')||{}).value||''})"
            var asleepSince = 0, idleSince = 0
            for i in 0..<80 {   // 最大 40 秒
                try? await Task.sleep(nanoseconds: 500_000_000)
                if room.joined { done?(.joined); return }
                guard ready else { continue }
                let json: String? = await withCheckedContinuation { c in self.eval(probe) { r, _ in c.resume(returning: r as? String) } }
                guard let json, let d = json.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { continue }
                let t = o["t"] as? String ?? "", name = o["name"] as? String ?? ""
                if t.contains("いま開いています") && !name.isEmpty { cmd(["type": "entryJoin"]); for _ in 0..<40 { try? await Task.sleep(nanoseconds: 500_000_000); if room.joined { done?(.joined); return } }; done?(.timeout); return }
                if t.contains("同じ名前の部屋") { done?(.choose); return }
                if t.contains("😴") { asleepSince += 1; if asleepSince > 2 { done?(.asleep); return } } else { asleepSince = 0 }
                // ページが入口の案内を出さない（部屋のIDとして読み取れない）リンクは、待たずに知らせる
                let entryShown = (o["n"] as? Bool) ?? false
                if !entryShown && t.isEmpty && name.isEmpty { idleSince += 1; if idleSince > 10 { done?(.invalid); return } } else { idleSince = 0 }
                _ = i
            }
            done?(.timeout)
        }
    }

    func reload() { Task { ready = false; await load() } }

    // MARK: 指示
    func cmd(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict), let s = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__pm && window.__pm.cmd(\(s))", completionHandler: nil)
    }
    func eval(_ js: String, _ done: ((Any?, Error?) -> Void)? = nil) {
        webView.evaluateJavaScript(js) { r, e in done?(r, e) }
    }

    // MARK: ページからの知らせ
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let t = body["t"] as? String else { return }
        if demo, t != "ready" { return }     // 画面の見本を作るとき（開発用）は、ページからの知らせを受け付けない
        let d = body["d"]
        func decode<T: Decodable>(_ type: T.Type) -> T? {
            guard let d = d, JSONSerialization.isValidJSONObject(d) || d is [Any] || d is [String: Any],
                  let data = try? JSONSerialization.data(withJSONObject: d) else { return nil }
            do { return try JSONDecoder().decode(T.self, from: data) } catch { self.log?("decode \(T.self): \(error)"); return nil }
        }
        switch t {
        case "lobby": if let v = decode(LobbyState.self), v != lobby { lobby = v }
        case "profile": if let v = decode(ProfileState.self), v != profile { profile = v }
        case "room": if let v = decode(RoomState.self) { if v != room { room = v } } else { log?("room の読み取りに失敗") }
        case "cards": if let v = decode(CardsState.self), v != cards { cards = v }
        case "eq": eq = (d as? String) ?? ""
        case "chat": if let v = decode(ChatLine.self) { onChat?(v) }
        case "react": if let v = decode(ReactEvent.self) { onReact?(v) }
        case "devices": if let v = decode([AudioDevice].self) { devices = v.filter { !$0.id.isEmpty && $0.id != "default" && $0.id != "communications" } }
        case "ready": ready = true
        default: break
        }
    }

    // MARK: WKUIDelegate
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.host == "potalk.app" ? .grant : .deny)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = navigationAction.request.url, ["http", "https"].contains(u.scheme ?? "") { NSWorkspace.shared.open(u) }
        return nil
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) { completionHandler() }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) { completionHandler(true) }

    // MARK: WKNavigationDelegate
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = action.request.url, action.navigationType == .linkActivated, ["http", "https"].contains(u.scheme ?? ""), u.host != "potalk.app" {
            NSWorkspace.shared.open(u); decisionHandler(.cancel); return
        }
        // ページが自分で読み込み直す（つなぎ直し）ときも、差し込み済みのページで読み込む
        if action.targetFrame?.isMainFrame == true, action.navigationType == .reload, action.request.url?.host == "potalk.app" {
            decisionHandler(.cancel)
            Task { await load() }
            return
        }
        decisionHandler(.allow)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { log?("ページの描画プロセスが落ちました。読み込み直します"); reload() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { log?("didFail \(error.localizedDescription)") }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { log?("didFailProvisional \(error.localizedDescription)") }
}

final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { target?.userContentController(c, didReceive: m) }
}
