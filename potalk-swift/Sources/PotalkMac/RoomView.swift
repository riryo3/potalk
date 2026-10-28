import SwiftUI
import AppKit

struct RowFrameKey: PreferenceKey {
    static var defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) { value.merge(nextValue()) { $1 } }
}

struct RoomView: View {
    var embedded = false      // シングルペインの中に置くとき
    var measuring = false     // 窓の最小の高さを測るための複製（一時的な表示は含めない）
    @EnvironmentObject var model: AppModel
    @EnvironmentObject var engine: Engine
    @State private var legendOpen = false
    @State private var copied = false
    @State private var rowFrames: [String: CGRect] = [:]
    @State private var tagEditing = false
    @State private var tagText = ""
    @State private var errorText: String? = nil
    @State private var dismissedNotice = ""
    @State private var errorTask: DispatchWorkItem? = nil

    var r: RoomState { engine.room }
    var ordered: [(Int, Member)] {
        func rank(_ m: Member) -> Int { m.mark == "📣" ? 0 : (m.mark.isEmpty ? 2 : 1) }
        return Array(r.members.enumerated()).sorted { (rank($0.element), $0.offset) < (rank($1.element), $1.offset) }
    }

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                header
                Divider()
                if let m = r.mailNow { mailBanner(m); Divider() }
                if r.tag.show { tagRow; Divider() }
                if !measuring {
                    if let e = errorText { errorBanner(e) }
                    if !r.notice.isEmpty && r.notice != dismissedNotice { pageBanner(r.notice, bad: r.notice.hasPrefix("🔌") || r.notice.contains("失敗") || r.notice.contains("できません")) { dismissedNotice = r.notice } }
                    if !r.audioWarn.isEmpty { pageBanner(r.audioWarn, bad: false) {} }
                }
                members
                legendAndEq
                Divider()
                reactions
                Divider()
                actions
            }
            effectsLayer
            if let c = r.card { cardOverlay(c) }
            if let a = r.ignoreAsk { ignoreOverlay(a) }
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .coordinateSpace(name: "room")
        .onPreferenceChange(RowFrameKey.self) { rowFrames = $0 }
        .onChange(of: r.state) { _, t in if !measuring { noteState(t) } }
        .onChange(of: r.notice) { _, t in if t.isEmpty { dismissedNotice = "" } }
        .frame(minWidth: 320, minHeight: embedded ? 440 : 600)
    }

    /// 接続に失敗・切断したときだけ、話題の下に、一時的に出す（しばらくすると消える。押しても消える）
    func isBad(_ t: String) -> Bool { t.contains("失敗") || t.contains("切断") || t.contains("エラー") || t.contains("できません") }
    func errorBanner(_ t: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.white)
            Text(t).font(.system(size: 14, weight: .bold)).foregroundColor(.white).lineLimit(2)
            Spacer(minLength: 4)
            Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundColor(.white.opacity(0.85))
        }
        .padding(.horizontal, 12).padding(.vertical, 9).frame(maxWidth: .infinity, alignment: .leading)
        .background(redColor).contentShape(Rectangle())
        .onTapGesture { errorText = nil }
        .transition(.move(edge: .top).combined(with: .opacity))
    }
    /// ページが出すお知らせ・警告（#peerNotice・#audioWarn）。お知らせは、押すと消える（ページ側でも12秒で消える）
    func pageBanner(_ t: String, bad: Bool, dismiss: @escaping () -> Void) -> some View {
        HStack(spacing: 8) {
            Text(t).font(.system(size: 13, weight: .bold)).foregroundColor(.white).lineLimit(3).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
        }
        .padding(.horizontal, 12).padding(.vertical, 9).frame(maxWidth: .infinity, alignment: .leading)
        .background(bad ? redColor : orangeColor).contentShape(Rectangle())
        .overlay(alignment: .bottom) { Rectangle().fill(Color.white.opacity(0.4)).frame(height: 1) }
        .onTapGesture(perform: dismiss)
        .transition(.move(edge: .top).combined(with: .opacity))
    }
    func noteState(_ t: String) {
        errorTask?.cancel()
        guard isBad(t) else { withAnimation { errorText = nil }; return }
        withAnimation { errorText = t }
        let w = DispatchWorkItem { withAnimation { errorText = nil } }
        errorTask = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: w)
    }

    /// 状態の文言（「通話中：部屋の名前」）を、状態と部屋の名前に分ける
    var roomStateParts: (status: String, title: String) {
        let t = r.state.isEmpty ? "未参加" : r.state
        for sep in ["：", "｜"] {
            if let i = t.firstIndex(of: Character(sep)) {
                let st = String(t[..<i]).trimmingCharacters(in: .whitespaces), name = String(t[t.index(after: i)...]).trimmingCharacters(in: .whitespaces)
                if !st.isEmpty && !name.isEmpty { return (st, name) }
            }
        }
        return ("", t)
    }

    var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            // 1行目：部屋の名前。2行目：状態・人数 … つなぎ直す・マイク（状態の文言は「通話中：部屋の名前」の形。分けられないときは、全体を1行目に出す）
            let parts = roomStateParts
            Text(parts.title).font(.system(size: 13, weight: .semibold)).lineLimit(1).truncationMode(.tail)
            HStack(spacing: 8) {
                if !parts.status.isEmpty {
                    let c: Color = isBad(r.state) ? redColor : (r.state.contains("通話中") ? tealColor : orangeColor)
                    Text(parts.status).font(.system(size: 11, weight: .bold)).foregroundColor(c)
                        .padding(.horizontal, 8).padding(.vertical, 2).background(Capsule().fill(c.opacity(0.16)))
                }
                Text("\(r.members.count)人").font(.system(size: 12)).foregroundColor(.secondary)
                Spacer(minLength: 4)
                Button("🔄 つなぎ直す") { engine.cmd(["type": "reconnect"]) }.buttonStyle(ChipButton()).help("通話をつなぎ直す（数秒、声が途切れます）")
                Menu {
                    Button((model.selectedMic.isEmpty ? "✓ " : "") + "既定のマイク") { model.switchMic("") }
                    ForEach(model.mics, id: \.self) { n in Button((model.selectedMic == n ? "✓ " : "") + n) { model.switchMic(n) } }
                } label: { Text("🎤") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help("入力（マイク）を切り替えて入り直す")
                if !embedded { Button("⚙ 設定") { model.openSettings() }.buttonStyle(ChipButton()) }
                if !embedded { Button("📌 最前面") { model.togglePin() }.buttonStyle(ChipButton(on: model.pinRoom)) }
            }
        }.padding(.horizontal, 12).padding(.vertical, 8)
    }

    func mailBanner(_ m: MailNow) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(m.cap).font(.system(size: 11)).foregroundColor(.secondary)
            Text("\(m.who) \(m.text)").font(.system(size: 14))
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 8)
        .background(Color.accentColor.opacity(0.15))
    }

    var tagRow: some View {
        VStack(spacing: 4) {
            HStack {
                Text(linkified("🏷 " + (r.tag.text.isEmpty ? "話題はまだありません" : r.tag.text))).font(.system(size: 12)).foregroundColor(.secondary).lineLimit(1)
                    .copyMenu(r.tag.text)
                Spacer()
                Button(r.tag.btn.isEmpty ? "つける" : r.tag.btn) { tagEditing.toggle() }.buttonStyle(ChipButton())
            }
            if tagEditing {
                HStack {
                    TextField("いまの話題", text: $tagText).textFieldStyle(.roundedBorder).onSubmit(sendTag)
                        .onChange(of: tagText) { _, v in if v.count > 30 { tagText = String(v.prefix(30)) } }
                    Text("\(tagText.count)/30").font(.system(size: 11, design: .monospaced)).foregroundColor(tagText.count >= 27 ? .orange : .secondary)
                    Button("確定", action: sendTag).buttonStyle(ChipButton())
                }
            }
        }.padding(.horizontal, 12).padding(.vertical, 6)
        .environment(\.openURL, OpenURLAction { url in model.confirmOpen(url.absoluteString, from: model.roomHost); return .handled })
    }
    func sendTag() { engine.cmd(["type": "tag", "text": tagText]); tagText = ""; tagEditing = false }

    var members: some View {
        ScrollView {
            VStack(spacing: 2) {
                ForEach(ordered, id: \.0) { idx, m in memberRow(idx, m) }
                if !r.more.isEmpty {
                    Text(r.more).font(.system(size: 12)).foregroundColor(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8).padding(.vertical, 6)
                        .background(GeometryReader { g in Color.clear.preference(key: RowFrameKey.self, value: ["\u{0}more": g.frame(in: .named("room"))]) })
                }
            }.padding(.horizontal, 10).padding(.vertical, 6)
        }.frame(maxHeight: .infinity)
    }

    func memberRow(_ idx: Int, _ m: Member) -> some View {
        HStack(spacing: 8) {
            Text(m.em).font(.system(size: 20)).frame(width: 28).opacity(m.muted ? 0.55 : 1)
            ZStack {
                if m.muted { Circle().fill(redColor); Image(systemName: "mic.slash.fill").font(.system(size: 11)).foregroundColor(.white) }
            }.frame(width: 22, height: 22)
            Group {
                if m.conn == "relay" { Image(systemName: "cloud").foregroundColor(orangeColor) }
                else if m.conn == "direct" { Image(systemName: "arrow.left.arrow.right").foregroundColor(tealColor) }
                else { Color.clear }
            }.font(.system(size: 12, weight: .semibold)).frame(width: 18)
            HStack(spacing: 4) {
                Text((m.mark.isEmpty ? "" : m.mark + " ") + m.name).font(.system(size: 15, weight: m.you ? .regular : .bold))
                    .foregroundColor(m.you ? .secondary : .primary).lineLimit(1)
                if m.you { Text("（あなた）").font(.system(size: 12)).foregroundColor(.secondary).lineLimit(1) }
            }
            if !m.stage.isEmpty { Text(m.stage).font(.system(size: 15)) }
            Spacer(minLength: 2)
            if let g = m.grant {
                Button(g.on ? "🎙 登壇中" : "🎙 登壇") { engine.cmd(["type": "grant", "i": idx]) }
                    .buttonStyle(ChipButton(on: g.on)).help(g.title)
            }
            if let ig = m.ig {
                Button { engine.cmd(["type": "ignoreRow", "i": idx]) } label: {
                    Image(systemName: ig.off ? "heart.slash" : "heart.fill").foregroundColor(ig.off ? .secondary : redColor)
                }.buttonStyle(.plain).help(ig.title)
            } else { Color.clear.frame(width: 18) }
        }
        .padding(.horizontal, 8).padding(.vertical, 3).frame(minHeight: 34)
        .background(RoundedRectangle(cornerRadius: 10).fill(m.speaking ? tealColor.opacity(0.18) : Color.clear))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(m.speaking ? tealColor : Color.clear, lineWidth: 1))
        .contentShape(Rectangle())
        .onTapGesture { if m.tap { engine.cmd(["type": "card", "i": idx]) } }
        .background(GeometryReader { g in Color.clear.preference(key: RowFrameKey.self, value: [m.you ? "\u{0}you" : "n:" + m.name: g.frame(in: .named("room"))]) })
    }

    var legendAndEq: some View {
        VStack(spacing: 6) {
            if legendOpen {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) { Image(systemName: "cloud").foregroundColor(orangeColor); Text("中継 ＝ その人のIPアドレスは隠れています") }
                    HStack(spacing: 6) { Image(systemName: "arrow.left.arrow.right").foregroundColor(tealColor); Text("直接 ＝ その人のIPアドレスが見えています") }
                }.font(.system(size: 11)).contentShape(Rectangle()).onTapGesture { legendOpen = false }
            } else {
                Button { legendOpen = true } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "cloud").foregroundColor(orangeColor); Text("中継"); Text("／").foregroundColor(.secondary)
                        Image(systemName: "arrow.left.arrow.right").foregroundColor(tealColor); Text("直接"); Text("詳細…").foregroundColor(.secondary)
                    }.font(.system(size: 11)).padding(.vertical, 2).padding(.horizontal, 9)
                    .background(Capsule().fill(Color(nsColor: .controlBackgroundColor))).overlay(Capsule().stroke(Color.primary.opacity(0.15)))
                }.buttonStyle(.plain)
            }
            HStack(spacing: 0) {
                ForEach(Array(engine.eq.enumerated()), id: \.offset) { _, c in
                    Text(String(c)).font(.system(size: 20, design: .monospaced)).foregroundColor(tealColor)
                        .shadow(color: tealColor.opacity(0.45), radius: 4).frame(maxWidth: .infinity)
                }
            }.frame(height: 24).padding(.horizontal, 10)
        }.padding(.top, 6).padding(.bottom, 4)
    }

    var reactions: some View {
        HStack(spacing: 4) {
            ForEach(Array(r.reactions.enumerated()), id: \.offset) { i, e in
                Button { engine.cmd(["type": "react", "i": i]) } label: {
                    Text(e).font(.system(size: 17)).frame(width: 34, height: 30)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .controlBackgroundColor)))
                        .scaleEffect(model.pop == e ? 1.35 : 1).animation(.easeOut(duration: 0.15), value: model.pop)
                }.buttonStyle(.plain)
            }
        }.padding(.vertical, 8).frame(maxWidth: .infinity)
    }

    var actions: some View {
        VStack(spacing: 8) {
            if !embedded { HStack(spacing: 8) {
                Button(model.unread > 0 ? "💬 ひとこと 新着 \(model.unread)" : "💬 ひとこと") { model.toggleChat() }
                    .buttonStyle(PillButton(fill: model.unread > 0 ? tealColor : (model.chatOpen ? .accentColor : Color(nsColor: .controlBackgroundColor)),
                                            fg: model.unread > 0 ? .black : (model.chatOpen ? .white : .primary), hot: model.unread > 0))
                if r.bcast {
                    let hot = r.mailOpen && !model.mailOpen
                    let n = r.mail.body.filter { $0.item }.count
                    Button((hot ? "📮 おたより募集中" : "📮 おたより") + (n > 0 ? " (\(n))" : "")) { model.openMail() }
                        .buttonStyle(PillButton(fill: hot ? .orange : Color(nsColor: .controlBackgroundColor), fg: hot ? .black : .primary, hot: hot))
                }
            } }
            RoomActionRows()
        }.padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 12)
    }

    // MARK: 飛ぶ絵文字
    var effectsLayer: some View {
        ZStack(alignment: .topLeading) {
            ForEach(model.effects) { e in
                let f = e.isSelf ? rowFrames["\u{0}you"] : (rowFrames["n:" + e.who] ?? rowFrames["\u{0}more"])
                FlyingEmoji(emoji: e.emoji).position(x: (f?.minX ?? 40) + 36 + e.dx, y: (f?.midY ?? 200))
            }
        }.allowsHitTesting(false)
    }

    // MARK: 名刺
    func cardOverlay(_ c: CardInfo) -> some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea().onTapGesture { engine.cmd(["type": "cardClose"]) }
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    Group {
                        if !c.img.isEmpty, let u = URL(string: c.img) { AsyncImage(url: u) { $0.resizable().scaledToFill() } placeholder: { Text(c.emoji) } }
                        else { Text(c.emoji).font(.system(size: 30)) }
                    }.frame(width: 52, height: 52).background(Color.primary.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: 14))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(c.name).font(.system(size: 18, weight: .bold)).lineLimit(2)
                        Text(c.state).font(.system(size: 12)).foregroundColor(.secondary)
                    }
                    Spacer()
                    Button { engine.cmd(["type": "cardClose"]) } label: { Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).frame(width: 30, height: 30).background(Circle().fill(Color.primary.opacity(0.1))) }.buttonStyle(.plain)
                }
                Divider()
                if !c.bio.isEmpty { Text(linkified(c.bio)).font(.system(size: 14)).textSelection(.enabled) }
                if !c.socials.isEmpty {
                    FlowLayout { ForEach(Array(c.socials.enumerated()), id: \.offset) { _, s in
                        Button(s.t.isEmpty ? s.u : s.t) { model.confirmOpen(s.u, from: model.roomHost) }.buttonStyle(.link).font(.system(size: 13))
                            .contextMenu {
                                Button("URLをコピー：\(s.u.prefix(40))") { copyToPasteboard(s.u) }
                                Button("表示の文字をコピー") { copyToPasteboard(s.t.isEmpty ? s.u : s.t) }
                            }
                    } }
                }
                Divider()
                Text(c.foot).font(.system(size: 12, weight: .semibold))
                if c.edit { Button("✏️ 自分の名刺を編集する") { engine.cmd(["type": "cardEditFromCard"]) }.frame(maxWidth: .infinity) }
                if let ig = c.ignore {
                    Button { engine.cmd(["type": "cardIgnore"]) } label: {
                        HStack(spacing: 8) { Image(systemName: "heart.fill"); Text(ig.text) }.frame(maxWidth: .infinity).padding(.vertical, 11)
                            .foregroundColor(redColor).background(RoundedRectangle(cornerRadius: 12).fill(redColor.opacity(0.10)))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(redColor.opacity(0.7)))
                    }.buttonStyle(.plain).disabled(ig.disabled)
                }
            }.padding(18).frame(maxWidth: 330)
            .background(RoundedRectangle(cornerRadius: 20).fill(Color(nsColor: .windowBackgroundColor)))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.primary.opacity(0.15)))
            .padding(14)
        }
        .environment(\.openURL, OpenURLAction { url in model.confirmOpen(url.absoluteString, from: model.roomHost); return .handled })
    }

    func ignoreOverlay(_ a: IgnoreAsk) -> some View {
        ZStack {
            Color.black.opacity(0.6).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 12) {
                Text(a.title).font(.system(size: 16, weight: .bold))
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(a.items.enumerated()), id: \.offset) { _, t in HStack(alignment: .top, spacing: 6) { Text("•"); Text(t) } }
                }.font(.system(size: 13))
                HStack(spacing: 8) {
                    Button(a.yes) { engine.cmd(["type": "ignoreYes"]) }.buttonStyle(PillButton(fill: redColor, fg: .white, hot: false))
                    Button(a.no) { engine.cmd(["type": "ignoreNo"]) }.buttonStyle(PillButton())
                }
            }.padding(18).frame(maxWidth: 340)
            .background(RoundedRectangle(cornerRadius: 20).fill(Color(nsColor: .windowBackgroundColor)))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.primary.opacity(0.15)))
            .padding(14)
        }
    }
}

/// ミュート（または通話希望・マイクを使う）のボタン。部屋の画面と、シングルペインの常時バーで使う
struct MuteControl: View {
    @EnvironmentObject var engine: Engine
    var body: some View {
        let r = engine.room
        if r.raise.show {
            Button("🙋 \(r.raise.label.isEmpty ? "通話希望" : r.raise.label)") { engine.cmd(["type": "raise"]) }.buttonStyle(PillButton())
        } else if r.speak.show {
            Button("🎙 \(r.speak.label.isEmpty ? "マイクを使う" : r.speak.label)") { engine.cmd(["type": "speak"]) }.buttonStyle(PillButton()).disabled(r.speak.disabled ?? false)
        } else {
            Button(r.muted ? "🔇 ミュート解除" : "🎤 ミュート") { engine.cmd(["type": "mute"]) }
                .buttonStyle(PillButton(fill: r.muted ? Color(red: 0.71, green: 0.33, blue: 0.04) : Color(nsColor: .controlBackgroundColor), fg: r.muted ? .white : .primary))
                .disabled(!r.canMute)
        }
    }
}

/// スピーカーのミュート（⇧⌘S でも切り替わる）。ふだんは 🔈、ミュート中は 🔇（オレンジ）。マイクのミュートの右隣に置く
struct SpeakerButton: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        Button { model.toggleSpeakerMute() } label: {
            Text(model.speakerMuted ? "🔇" : "🔈").font(.system(size: 15, weight: .bold))
                .frame(width: 44).padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 10).fill(model.speakerMuted ? Color(red: 0.71, green: 0.33, blue: 0.04) : Color(nsColor: .controlBackgroundColor)))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.15), lineWidth: 1))
        }.buttonStyle(.plain).help(model.speakerMuted ? "スピーカーのミュートを解除（⇧⌘S）" : "スピーカーをミュート（⇧⌘S）")
    }
}

struct FlyingEmoji: View {
    let emoji: String
    @State private var up = false
    var body: some View {
        Text(emoji).font(.system(size: 26)).scaleEffect(up ? 1.0 : 0.6).opacity(up ? 0 : 1).offset(y: up ? -90 : 0)
            .onAppear { withAnimation(.easeOut(duration: 1.4)) { up = true } }
    }
}


/// 部屋の下のボタン（ミュート・スピーカー、URL共有・退出）。シングルペインで部屋以外のタブを見ているときも、同じ並び・同じ位置で出す
struct RoomActionRows: View {
    @EnvironmentObject var model: AppModel
    @EnvironmentObject var engine: Engine
    @State private var copied = false
    var body: some View {
        let r = engine.room
        VStack(spacing: 8) {
            HStack(spacing: 6) { MuteControl(); SpeakerButton() }
            HStack(spacing: 8) {
                Button(copied ? "✓ コピーしました" : "🔗 URLを共有") {
                    NSPasteboard.general.clearContents(); NSPasteboard.general.setString(r.share, forType: .string)
                    copied = true; DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
                }.buttonStyle(PillButton()).disabled(r.share.isEmpty)
                Button("🚪 退出") { model.requestLeave(from: model.roomHost) }.buttonStyle(PillButton(fill: Color(red: 0.72, green: 0.11, blue: 0.11), fg: .white))
            }
        }.padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 12)
    }
}
