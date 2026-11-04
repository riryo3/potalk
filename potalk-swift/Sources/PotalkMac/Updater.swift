import AppKit

/// GitHub のリリースを見て、新しい版があれば知らせる。「更新して再起動」を選ぶと、
/// 新しい版をダウンロードして、いまのアプリと入れ替え、開き直す。
/// 取りにいくのは、このリポジトリ（riryo3/potalk）の「v数字」のリリースにある Potalker-数字.zip だけ。
@MainActor
final class Updater {
    static let shared = Updater()
    /// 更新のために終了するとき、「通話中です」の確認をもう一度出さない
    static var quittingForUpdate = false

    private let repo = "riryo3/potalk"
    private var busy = false
    private var asked = Set<String>()
    private var timer: Timer?

    static var current: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }
    /// アプリとして開いているときだけ、入れ替えができる（swift run などの開発中は、しない）
    private var canSelfUpdate: Bool { !Self.current.isEmpty && Bundle.main.bundlePath.hasSuffix(".app") }

    private struct Release: Decodable {
        struct Asset: Decodable { let name: String; let browser_download_url: String; let size: Int }
        let tag_name: String; let draft: Bool; let prerelease: Bool; let html_url: String; let assets: [Asset]
    }
    private struct Found { let version: String; let zip: URL; let page: URL }

    /// 起動の少しあとと、そのあと6時間ごとに、自動で確かめる
    func start() {
        guard canSelfUpdate else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in Task { await self?.check(manual: false) } }
        timer = Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { [weak self] _ in Task { @MainActor in await self?.check(manual: false) } }
    }

    private static func parts(_ v: String) -> [Int] { v.split(separator: ".").map { Int($0) ?? 0 } }
    private static func isNewer(_ a: String, than b: String) -> Bool {
        let x = parts(a), y = parts(b)
        for i in 0..<max(x.count, y.count) {
            let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0
            if p != q { return p > q }
        }
        return false
    }

    private func latest() async throws -> Found? {
        var req = URLRequest(url: URL(string: "https://api.github.com/repos/\(repo)/releases?per_page=40")!)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("Potalker-updater", forHTTPHeaderField: "User-Agent")
        req.timeoutInterval = 20
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        let releases = try JSONDecoder().decode([Release].self, from: data)
        var best: Found?
        for r in releases where !r.draft && !r.prerelease {
            // Mac 版のタグは「v0.3.5」の形（win-v… や android-v… は、別のアプリ）
            guard r.tag_name.range(of: #"^v\d+\.\d+\.\d+$"#, options: .regularExpression) != nil else { continue }
            let ver = String(r.tag_name.dropFirst())
            guard let a = r.assets.first(where: { $0.name == "Potalker-\(ver).zip" }),
                  a.browser_download_url.hasPrefix("https://github.com/\(repo)/releases/download/"),
                  let zip = URL(string: a.browser_download_url), let page = URL(string: r.html_url) else { continue }
            if best == nil || Self.isNewer(ver, than: best!.version) { best = Found(version: ver, zip: zip, page: page) }
        }
        return best
    }

    func check(manual: Bool) async {
        guard !busy else { return }
        guard canSelfUpdate else {
            if manual { alert("この起動のしかたでは、更新できません", "アプリ（Potalker.app）として開いているときだけ、更新できます。") }
            return
        }
        busy = true; defer { busy = false }
        let found: Found?
        do { found = try await latest() } catch {
            CallLog.write("更新の確認に失敗しました（\(error.localizedDescription)）")
            if manual { alert("更新を確認できませんでした", "ネットワークにつながっているか、確かめてください。") }
            return
        }
        guard let f = found, Self.isNewer(f.version, than: Self.current) else {
            if manual { alert("最新の版です", "いまの版は \(Self.current) です。") }
            return
        }
        if !manual && asked.contains(f.version) { return }   // 同じ版は、起動中に何度も聞かない
        asked.insert(f.version)
        let a = NSAlert()
        a.messageText = "新しい版（\(f.version)）があります"
        a.informativeText = "いまの版は \(Self.current) です。更新すると、アプリがいったん終了して、新しい版で開き直します。通話中のときは、部屋から退出します。"
        a.addButton(withTitle: "更新して再起動"); a.addButton(withTitle: "あとで"); a.addButton(withTitle: "変更内容を見る")
        NSApp.activate(ignoringOtherApps: true)
        switch a.runModal() {
        case .alertFirstButtonReturn: await install(f)
        case .alertThirdButtonReturn: NSWorkspace.shared.open(f.page)
        default: break
        }
    }

    private func alert(_ title: String, _ text: String) {
        let a = NSAlert(); a.messageText = title; a.informativeText = text; a.addButton(withTitle: "OK")
        NSApp.activate(ignoringOtherApps: true); a.runModal()
    }

    private func fail(_ f: Found, _ why: String) {
        CallLog.write("更新に失敗しました（\(why)）")
        let a = NSAlert(); a.messageText = "更新できませんでした"
        a.informativeText = "\(why)\nリリースのページから、手で入れ替えてください。"
        a.addButton(withTitle: "リリースのページを開く"); a.addButton(withTitle: "閉じる")
        NSApp.activate(ignoringOtherApps: true)
        if a.runModal() == .alertFirstButtonReturn { NSWorkspace.shared.open(f.page) }
    }

    private func install(_ f: Found) async {
        busy = true; defer { busy = false }
        let fm = FileManager.default
        let work = fm.temporaryDirectory.appendingPathComponent("potalker-update-\(UUID().uuidString)")
        let dest = URL(fileURLWithPath: Bundle.main.bundlePath)
        let staged = dest.deletingLastPathComponent().appendingPathComponent(".Potalker-updating.app")
        do {
            try fm.createDirectory(at: work, withIntermediateDirectories: true)
            // 1) ダウンロード
            var req = URLRequest(url: f.zip); req.setValue("Potalker-updater", forHTTPHeaderField: "User-Agent"); req.timeoutInterval = 120
            let (tmp, resp) = try await URLSession.shared.download(for: req)
            guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            let zip = work.appendingPathComponent("new.zip")
            try fm.moveItem(at: tmp, to: zip)
            let sz = (try fm.attributesOfItem(atPath: zip.path)[.size] as? Int) ?? 0
            guard sz > 500_000 else { throw NSError(domain: "update", code: 1, userInfo: [NSLocalizedDescriptionKey: "ダウンロードしたファイルが小さすぎます"]) }
            // 2) 展開して、中身を確かめる（アプリの名前・版・署名）
            let out = work.appendingPathComponent("x"); try fm.createDirectory(at: out, withIntermediateDirectories: true)
            try await Self.run("/usr/bin/ditto", ["-x", "-k", zip.path, out.path])
            let newApp = out.appendingPathComponent("Potalker.app")
            let plist = NSDictionary(contentsOf: newApp.appendingPathComponent("Contents/Info.plist"))
            guard plist?["CFBundleIdentifier"] as? String == "app.potalker.mac",
                  plist?["CFBundleShortVersionString"] as? String == f.version,
                  fm.isExecutableFile(atPath: newApp.appendingPathComponent("Contents/MacOS/Potalker").path)
            else { throw NSError(domain: "update", code: 2, userInfo: [NSLocalizedDescriptionKey: "ダウンロードしたアプリの中身が、想定と違います"]) }
            try await Self.run("/usr/bin/codesign", ["--verify", "--deep", newApp.path])
            // 3) いまのアプリの隣に、新しい版を置く（ここまでで失敗しても、いまのアプリはそのまま）
            if fm.fileExists(atPath: staged.path) { try fm.removeItem(at: staged) }
            try await Self.run("/usr/bin/ditto", [newApp.path, staged.path])
            // 4) 終了を待って入れ替え、開き直す手順を、切り離して走らせる
            let script = work.appendingPathComponent("swap.sh")
            try """
            #!/bin/sh
            PID="$1"; DEST="$2"; STAGED="$3"; OLD="$4"
            n=0
            while kill -0 "$PID" 2>/dev/null && [ $n -lt 200 ]; do sleep 0.3; n=$((n+1)); done
            if mv "$DEST" "$OLD" && mv "$STAGED" "$DEST"; then
              /usr/bin/xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
            else
              [ -e "$DEST" ] || mv "$OLD" "$DEST"
            fi
            /usr/bin/open "$DEST"
            """.write(to: script, atomically: true, encoding: .utf8)
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/bin/sh")
            p.arguments = [script.path, String(ProcessInfo.processInfo.processIdentifier), dest.path, staged.path, work.appendingPathComponent("old.app").path]
            p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
            try p.run()
            CallLog.write("更新します：\(Self.current) → \(f.version)")
            Updater.quittingForUpdate = true
            NSApp.terminate(nil)
        } catch {
            try? fm.removeItem(at: staged)
            fail(f, error.localizedDescription)
        }
    }

    private static func run(_ exe: String, _ args: [String]) async throws {
        try await Task.detached {
            let p = Process(); p.executableURL = URL(fileURLWithPath: exe); p.arguments = args
            p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
            try p.run(); p.waitUntilExit()
            if p.terminationStatus != 0 { throw NSError(domain: "update", code: Int(p.terminationStatus), userInfo: [NSLocalizedDescriptionKey: "\((exe as NSString).lastPathComponent) が失敗しました"]) }
        }.value
    }
}
