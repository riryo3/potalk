import AppKit
import WebKit

/// 開発用：/tmp/potalk-debug/in.txt に書いた命令を実行して out.txt に結果を書く（POTALK_DEBUG=1 のときだけ）
@MainActor
final class DebugChannel {
    let engine: Engine
    let dir = "/tmp/potalk-debug"
    var timer: Timer?
    var snapshots: [String: () -> NSView?] = [:]
    var actions: ((String) -> Void)?
    var extra: (() -> String)?

    init(engine: Engine) {
        self.engine = engine
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try? "".write(toFile: dir + "/out.txt", atomically: true, encoding: .utf8)
        timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
    }
    func out(_ s: String) {
        if let h = FileHandle(forWritingAtPath: dir + "/out.txt") { h.seekToEndOfFile(); h.write((s + "\n").data(using: .utf8)!); try? h.close() }
    }
    func poll() {
        let path = dir + "/in.txt"
        guard let s = try? String(contentsOfFile: path, encoding: .utf8), !s.isEmpty else { return }
        try? "".write(toFile: path, atomically: true, encoding: .utf8)
        for line in s.split(separator: "\n") { run(String(line)) }
    }
    func run(_ line: String) {
        let parts = line.split(separator: " ", maxSplits: 1).map(String.init)
        guard let c = parts.first else { return }
        let arg = parts.count > 1 ? parts[1] : ""
        switch c {
        case "js":
            engine.eval(arg) { r, e in self.out("js> \(r.map { "\($0)" } ?? "nil") \(e?.localizedDescription ?? "")") }
        case "state":
            out("lobby rooms=\(engine.lobby.rooms.count) status=\(engine.lobby.status) viewers=\(engine.lobby.viewers) | profile=\(engine.profile.emoji) \(engine.profile.name) | room joined=\(engine.room.joined) \(engine.room.state) members=\(engine.room.members.map { $0.name }) | ready=\(engine.ready) patched=\(engine.patched) devices=\(engine.devices.map { $0.label }) \(extra?() ?? "")")
        case "cmd":
            if let d = arg.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { engine.cmd(o); out("cmd sent") }
        case "snap":
            let a = arg.split(separator: " ").map(String.init)
            if a.count == 2, let v = snapshots[a[0]]?() { save(v, a[1]) } else { out("snap: unknown \(arg)") }
        case "do": actions?(arg); out("did \(arg)")
        case "quit": NSApp.terminate(nil)
        default: out("unknown \(c)")
        }
    }
    func save(_ view: NSView, _ path: String) {
        // 見本の画像は、2倍の細かさで書き出す
        let w = Int(view.bounds.width * 2), h = Int(view.bounds.height * 2)
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return }
        rep.size = view.bounds.size
        view.cacheDisplay(in: view.bounds, to: rep)
        if let data = rep.representation(using: .png, properties: [:]) { try? data.write(to: URL(fileURLWithPath: path)); out("snap saved \(path)") }
    }
}
