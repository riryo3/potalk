import Foundation
import Network

/// 通話の記録（~/Library/Application Support/Potalker/call.log）。切れた・落ちた原因を、あとから調べるため。Mac の中だけに残る
enum CallLog {
    private static let queue = DispatchQueue(label: "app.potalker.calllog")
    private static let df: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "MM/dd HH:mm:ss"; return f
    }()
    static var url: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Potalker")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("call.log")
    }

    static func write(_ msg: String) {
        let line = "\(df.string(from: Date())) \(msg)\n"
        queue.async {
            let f = url
            if let size = (try? FileManager.default.attributesOfItem(atPath: f.path))?[.size] as? Int, size > 200_000,
               let t = try? String(contentsOf: f, encoding: .utf8) {
                try? String(t.suffix(100_000)).write(to: f, atomically: true, encoding: .utf8)
            }
            if let h = try? FileHandle(forWritingTo: f) {
                h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close()
            } else {
                try? line.write(to: f, atomically: true, encoding: .utf8)
            }
        }
    }

    static func text() -> String {
        queue.sync { (try? String(contentsOf: url, encoding: .utf8)) ?? "" }
    }

    /// ネットワークの変わり目（Wi-Fi が切れた・つながった、使う回線が変わった）を、記録する
    private static var monitor: NWPathMonitor?
    private static var lastPath = ""
    static func watchNetwork() {
        let m = NWPathMonitor()
        m.pathUpdateHandler = { p in
            let kind = p.usesInterfaceType(.wifi) ? "Wi-Fi" : p.usesInterfaceType(.wiredEthernet) ? "有線" : p.usesInterfaceType(.cellular) ? "モバイル" : "その他"
            let s = p.status == .satisfied ? "つながっています（\(kind)）" : "つながっていません"
            if s != lastPath { lastPath = s; write("ネットワーク：\(s)") }
        }
        m.start(queue: DispatchQueue(label: "app.potalker.netmon"))
        monitor = m
    }
}
