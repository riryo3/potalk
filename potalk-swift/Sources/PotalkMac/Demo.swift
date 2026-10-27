import Foundation

/// 画面の見本（スクリーンショット）用の、作り物のデータ。開発用で、POTALK_DEBUG=1 のときだけ使う。
/// 実際の人の名前や部屋は、一切入れない。
@MainActor
enum Demo {
    static func apply(_ m: AppModel, joined: Bool) {
        let e = m.engine
        e.demo = true
        e.profile = ProfileState(emoji: "🐼", name: "ゲスト", input: "ゲスト",
                                 avatars: ["🐼", "🦊", "🐙", "🐧", "🐸", "🐻", "🐱", "🐶"].map { Avatar(em: $0, on: $0 == "🐼") }, version: "")
        e.lobby = LobbyState(rooms: [
            LobbyRoom(id: "demo1", name: "🏠 お茶の部屋", count: "3人", sub: "🏷 今日はほうじ茶", subBy: " ミントが付けた", dur: "⏱ 12分",
                      people: [Person(em: "🦊", name: "ミント", muted: false), Person(em: "🐙", name: "ひなた", muted: true), Person(em: "🐧", name: "そら", muted: true)], bc: false),
            LobbyRoom(id: "demo2", name: "📣 ひとりごとラジオ", count: "5人", sub: "", subBy: "", dur: "⏱ 34分",
                      people: [Person(em: "🐻", name: "ラジオの人", muted: false), Person(em: "🐱", name: "ゲストA", muted: true), Person(em: "🐶", name: "ゲストB", muted: true)], bc: true),
            LobbyRoom(id: "demo3", name: "🏠 作業しながら雑談", count: "2人", sub: "", subBy: "", dur: "⏱ 1時間20分",
                      people: [Person(em: "🐸", name: "もくもく", muted: false), Person(em: "🐼", name: "ゲストC", muted: false)], bc: false),
            LobbyRoom(id: "demo4", name: "🏠 のんびり部屋", count: "1人", sub: "", subBy: "", dur: "⏱ 3分",
                      people: [Person(em: "🐧", name: "ぺんぎん", muted: false)], bc: false),
        ], status: "", viewers: "👥 いまだいたい10人が見ています")
        if !joined { e.room = .empty; e.eq = ""; return }
        func mem(_ em: String, _ name: String, muted: Bool = false, speaking: Bool = false, you: Bool = false, conn: String = "direct") -> Member {
            Member(em: em, name: name, mark: "", muted: muted, speaking: speaking, you: you, stage: "", tap: !you, ig: you ? nil : IgInfo(off: false, title: "無視する"), conn: conn, grant: nil)
        }
        var r = RoomState.empty
        r.joined = true; r.state = "通話中：お茶の部屋"
        r.members = [mem("🐼", "ゲスト", muted: true, you: true, conn: "relay"), mem("🦊", "ミント", speaking: true), mem("🐙", "ひなた", muted: true), mem("🐧", "そら", muted: true, conn: "relay")]
        r.tag = TagInfo(show: true, text: "今日はほうじ茶", btn: "変える")
        r.reactions = ["👏", "😂", "✨", "👍", "🤔", "😮", "🎉", "🍵"]
        r.canMute = true; r.muted = true; r.share = "https://potalk.app/#room=demo1"
        r.settings = [
            SettingItem(k: "range", id: "vol", label: "音量", value: "80", min: "0", max: "100", step: "5", items: nil, checked: nil, text: nil),
            SettingItem(k: "radios", id: nil, label: nil, value: nil, min: nil, max: nil, step: nil,
                        items: [RadioItem(id: "b0", label: "🔈 BGMなし", checked: true), RadioItem(id: "b1", label: "🎵 軽快な音楽", checked: false), RadioItem(id: "b2", label: "🔥 焚き火", checked: false)], checked: nil, text: nil),
            SettingItem(k: "check", id: "joinsnd", label: "🔔 入室・退出を音で知らせる", value: nil, min: nil, max: nil, step: nil, items: nil, checked: true, text: nil),
        ]
        m.joinedRoomID = "demo1"
        e.room = r
        e.eq = "▁▂▃▅▇▅▃▂▁▂▃▅"
        m.chat = [
            ChatLine(sys: true, hist: false, em: "", who: "", text: "ゲスト（あなた）が入室しました"),
            ChatLine(sys: false, hist: false, em: "🦊", who: "ミント", text: "こんばんは〜"),
            ChatLine(sys: false, hist: false, em: "🐙", who: "ひなた", text: "おじゃまします"),
            ChatLine(sys: false, hist: false, em: "🦊", who: "ミント", text: "今日はほうじ茶です🍵"),
        ]
    }
}
