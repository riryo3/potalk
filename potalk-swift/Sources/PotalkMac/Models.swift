import Foundation

struct Person: Codable, Hashable { var em: String; var name: String; var muted: Bool }
struct LobbyRoom: Codable, Identifiable, Hashable {
    var id: String; var name: String; var count: String; var sub: String; var subBy: String; var dur: String
    var people: [Person]; var bc: Bool
    var key: String { id.isEmpty ? name : id }
}
struct LobbyState: Codable, Equatable { var rooms: [LobbyRoom]; var status: String; var viewers: String }

struct Avatar: Codable, Hashable { var em: String; var on: Bool }
struct ProfileState: Codable, Equatable { var emoji: String; var name: String; var input: String; var avatars: [Avatar]; var version: String }

struct IgInfo: Codable, Hashable { var off: Bool; var title: String }
struct GrantInfo: Codable, Hashable { var on: Bool; var title: String }
struct Member: Codable, Hashable, Identifiable {
    var em: String; var name: String; var mark: String; var muted: Bool; var speaking: Bool; var you: Bool
    var stage: String; var tap: Bool; var ig: IgInfo?; var conn: String; var grant: GrantInfo?
    var id: String { "\(em)|\(name)|\(you)" }
}
struct Social: Codable, Hashable { var t: String; var u: String }
struct CardInfo: Codable, Hashable {
    var emoji: String; var img: String; var name: String; var state: String; var bio: String; var foot: String
    var ignore: CardIgnore?; var edit: Bool; var socials: [Social]
}
struct VerState: Codable, Hashable { var btnShow: Bool; var btnLabel: String; var btnDisabled: Bool; var verified: Bool }
struct CardEditState: Codable, Hashable {
    var img: String; var emoji: String; var sub: String; var clearShow: Bool; var avatarMsg: String; var bio: String
    var tipOpt: String; var tipOfuse: String; var tipAmazon: String; var tipZap: String; var tipKofi: String; var tipBmac: String
    var snsX: String; var snsGithub: String; var snsNote: String; var snsInstagram: String; var snsYoutube: String; var snsNostr: String
    var verX: VerState; var verGithub: VerState; var verNostr: VerState; var noImg: Bool; var warn: String
}
struct CardAuthState: Codable, Hashable {
    var title: String; var account: String; var desc: String; var codeShow: Bool; var code: String
    var postShow: Bool; var post: String; var tweet: String; var inputShow: Bool; var input: String
    var msg: String; var msgBad: Bool; var note: String; var verifyLabel: String; var verifyDisabled: Bool
}
struct CardsState: Codable, Equatable { var edit: CardEditState?; var auth: CardAuthState? }
struct CardIgnore: Codable, Hashable { var text: String; var disabled: Bool }
struct IgnoreAsk: Codable, Hashable { var title: String; var items: [String]; var yes: String; var no: String }
struct MailNow: Codable, Hashable { var cap: String; var who: String; var text: String }
struct TagInfo: Codable, Hashable { var show: Bool; var text: String; var btn: String }
struct ButtonState: Codable, Hashable { var show: Bool; var label: String; var disabled: Bool? }
struct MailBtn: Codable, Hashable { var i: Int; var label: String; var on: Bool }
struct MailHead: Codable, Hashable { var text: String; var btns: [MailBtn] }
struct MailBody: Codable, Hashable {
    var item: Bool; var em: String?; var who: String?; var text: String; var shown: Bool?; var btns: [MailBtn]
}
struct MailForm: Codable, Hashable { var ph: String; var btn: String; var max: Int }
struct MailInfo: Codable, Hashable { var head: [MailHead]; var body: [MailBody]; var form: MailForm? }
struct RadioItem: Codable, Hashable { var id: String; var label: String; var checked: Bool }
struct SettingItem: Codable, Hashable, Identifiable {
    var k: String
    var id: String?; var label: String?; var value: String?; var min: String?; var max: String?; var step: String?
    var items: [RadioItem]?; var checked: Bool?; var text: String?
    var uid: String { (id ?? "") + k + (text ?? "") + (items?.first?.id ?? "") }
}

struct RoomState: Codable, Equatable {
    var joined: Bool; var state: String; var members: [Member]
    var card: CardInfo?; var ignoreAsk: IgnoreAsk?; var mailNow: MailNow?
    var more: String; var mailOpen: Bool; var bcast: Bool
    var tag: TagInfo; var speak: ButtonState; var raise: ButtonState
    var mail: MailInfo; var reactions: [String]
    var canMute: Bool; var muted: Bool; var share: String; var settings: [SettingItem]
    var rid: String? = nil      // いまいる部屋の ID（URL の #room= から）
    var notice: String = ""       // ページが出す一時のお知らせ（#peerNotice。マイクの失敗・接続が切れた など）
    var audioWarn: String = ""     // 音が届いていない人がいるときの警告（#audioWarn）

    static let empty = RoomState(joined: false, state: "", members: [], card: nil, ignoreAsk: nil, mailNow: nil, more: "", mailOpen: false,
                                 bcast: false, tag: TagInfo(show: false, text: "", btn: ""), speak: ButtonState(show: false, label: "", disabled: nil),
                                 raise: ButtonState(show: false, label: "", disabled: nil), mail: MailInfo(head: [], body: [], form: nil),
                                 reactions: [], canMute: false, muted: false, share: "", settings: [])
}

struct ChatLine: Codable, Hashable, Identifiable {
    var id = UUID()
    var sys: Bool; var hist: Bool; var em: String; var who: String; var text: String
    enum CodingKeys: String, CodingKey { case sys, hist, em, who, text }
}
struct ReactEvent: Codable { var u: String; var i: Int; var e: String; var n: String }
struct AudioDevice: Codable, Hashable, Identifiable { var id: String; var label: String }
