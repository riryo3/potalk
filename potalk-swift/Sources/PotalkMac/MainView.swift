import SwiftUI
import AppKit

struct MainView: View {
    var embedded = false      // シングルペインの左列として置くとき
    var compact = false       // 入室中は、一覧を縮小して出す
    @EnvironmentObject var model: AppModel
    @EnvironmentObject var engine: Engine

    private var linkID: String? {
        let v = model.search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let r = v.range(of: "#room=") else { return nil }
        let rest = v[r.upperBound...]
        let id = rest.split(whereSeparator: { $0 == "&" || $0 == " " }).first.map(String.init) ?? ""
        return id.removingPercentEncoding ?? id
    }
    private var filtered: [LobbyRoom] {
        let v = model.search.trimmingCharacters(in: .whitespacesAndNewlines)
        if v.isEmpty { return engine.lobby.rooms }
        if let id = linkID { return engine.lobby.rooms.filter { $0.id == id } }
        let q = v.lowercased()
        return engine.lobby.rooms.filter { r in
            ([r.name, r.sub, r.subBy] + r.people.map { $0.name }).contains { $0.lowercased().contains(q) }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            Divider()
            if filtered.isEmpty && !model.search.isEmpty { noHit } else { list }
            Divider()
            footer
        }
        .frame(minWidth: embedded ? 0 : 360, minHeight: embedded ? 0 : 420)
        .sheet(item: $model.joinCandidate) { r in JoinSheet(room: r) }
        .sheet(isPresented: $model.createOpen) { CreateSheet() }
        .onAppear { model.requestDevices() }
    }

    func isCurrent(_ r: LobbyRoom) -> Bool {
        engine.room.joined && ((!model.joinedRoomID.isEmpty && r.id == model.joinedRoomID) || (model.joinedRoomID.isEmpty && engine.room.state.contains(r.name)))
    }

    var topBar: some View {
        VStack(spacing: 6) {
            HStack {
                Button { model.openProfile() } label: {
                    Text("\(engine.profile.emoji) \(engine.profile.name.isEmpty ? "設定" : engine.profile.name)").lineLimit(1).truncationMode(.tail)
                }.buttonStyle(ChipButton())
                Spacer(minLength: 8)
                Menu {
                    Button((model.selectedMic.isEmpty ? "✓ " : "") + "既定のマイク") { model.switchMic("") }
                    ForEach(model.mics, id: \.self) { name in
                        Button((model.selectedMic == name ? "✓ " : "") + name) { model.switchMic(name) }
                    }
                    Divider()
                    Button("マイクの一覧を更新") { model.requestDevices() }
                } label: { Text(embedded ? "🎤" : "🎤 入力設定") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                .padding(.vertical, 4).padding(.horizontal, 10)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .controlBackgroundColor)))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.15), lineWidth: 1))
                .help("次に入室するときから反映されます")
            }
            HStack(spacing: 8) {
                Button("？ これはなに？") { model.openHelp() }.buttonStyle(ChipButton())
                Button("🏠 部屋を作る") { model.createOpen = true }.buttonStyle(ChipButton()).disabled(engine.room.joined)
                Spacer()
                if model.singlePane && !embedded {
                    PinButton()
                }
            }
            HStack(spacing: 8) {
                TextField("部屋を検索／部屋のURLを貼る", text: $model.search).textFieldStyle(.roundedBorder)
                Button("🔄 更新") { model.refreshLobby() }.buttonStyle(ChipButton())
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    var list: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(filtered) { r in
                    if compact {
                        CompactRoomRow(room: r, current: isCurrent(r)).onTapGesture { if r.id != "", !isCurrent(r) { model.joinCandidate = r } }
                    } else {
                        let cur = embedded && isCurrent(r)
                        RoomCard(room: r)
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.accentColor, lineWidth: cur ? 2 : 0))
                            .onTapGesture { if r.id != "", !cur { model.joinCandidate = r } }
                    }
                }
                if engine.lobby.rooms.isEmpty { Text("いま通話中の部屋はありません").foregroundColor(.secondary).padding(.top, 30) }
            }.padding(12)
        }
    }

    var noHit: some View {
        VStack(spacing: 10) {
            if let id = linkID {
                Text("このリンクの部屋は、いま通話中の一覧にありません（お休み中かもしれません）。").multilineTextAlignment(.center)
                Button("このリンクの部屋に入ってみる") { _ = id; model.openRoomLink(model.search) }
            } else {
                Text("「\(model.search)」に合う部屋は見つかりません。")
            }
        }.foregroundColor(.secondary).padding(20).frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    var footer: some View {
        HStack {
            Button { model.notifyRooms.toggle() } label: { Text(model.notifyRooms ? (embedded ? "🔔 通知：オン" : "🔔 部屋の通知：オン") : (embedded ? "🔕 通知：オフ" : "🔕 部屋の通知：オフ")) }
                .buttonStyle(ChipButton(on: model.notifyRooms))
            Spacer()
            Text(engine.lobby.viewers).font(.system(size: 12)).foregroundColor(.secondary)
        }.padding(.horizontal, 12).padding(.vertical, 8)
    }
}

/// 入室中の左列に出す、縮小した部屋の一覧の1行
struct CompactRoomRow: View {
    let room: LobbyRoom
    let current: Bool
    var body: some View {
        HStack(spacing: 6) {
            Text(room.name).font(.system(size: 13, weight: current ? .bold : .regular)).lineLimit(1).truncationMode(.tail)
            Spacer(minLength: 4)
            Text(room.count).font(.system(size: 12, weight: .bold)).foregroundColor(tealColor)
        }
        .padding(.vertical, 6).padding(.horizontal, 10).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(current ? Color.accentColor.opacity(0.18) : Color.primary.opacity(0.05)))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(current ? Color.accentColor : .clear, lineWidth: 1.2))
        .contentShape(Rectangle())
    }
}

struct RoomCard: View {
    @EnvironmentObject var model: AppModel
    let room: LobbyRoom
    @State private var copied = false
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(room.name).font(.system(size: 15, weight: .bold)).lineLimit(2)
                Spacer()
                Text(room.count).font(.system(size: 13, weight: .bold)).foregroundColor(tealColor)
                Button {
                    let idEnc = room.id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? room.id
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString("\(room.name)\nhttps://potalk.app/#room=\(idEnc)", forType: .string)
                    copied = true; DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { copied = false }
                } label: { Image(systemName: copied ? "checkmark" : "square.and.arrow.up") }
                .buttonStyle(.plain).help("部屋名とリンクをコピー")
            }
            if !room.sub.isEmpty {
                HStack(spacing: 0) {
                    Text(linkified(room.sub)).font(.system(size: 12, weight: .semibold))
                    Text(linkified(room.subBy)).font(.system(size: 12)).foregroundColor(.secondary)
                }
            }
            Text(room.dur).font(.system(size: 11)).foregroundColor(.secondary)
            FlowLayout(spacing: 5) {
                ForEach(Array(room.people.enumerated()), id: \.offset) { _, p in
                    HStack(spacing: 4) {
                        Text(p.em).font(.system(size: 13)); Text(p.name).font(.system(size: 12))
                        if p.muted { Image(systemName: "mic.slash.fill").font(.system(size: 9)).foregroundColor(.white).padding(3).background(Circle().fill(redColor)) }
                    }
                    .padding(.vertical, 3).padding(.horizontal, 8)
                    .background(Capsule().fill(Color.primary.opacity(0.08)))
                }
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading).card().contentShape(Rectangle())
        .environment(\.openURL, OpenURLAction { url in model.confirmOpen(url.absoluteString, from: NSApp.keyWindow); return .handled })
    }
}

struct JoinSheet: View {
    @EnvironmentObject var model: AppModel
    @EnvironmentObject var engine: Engine
    let room: LobbyRoom
    @State private var quiet = false
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("「\(room.bc ? "📣 " : "")\(room.name)」に\(engine.room.joined ? "移りますか？ いまの部屋を退出します" : "参加しますか？")").font(.system(size: 15, weight: .semibold))
            Text(room.bc ? "聞き役で入室します（マイクは使いません）" : "ミュート状態で入室します").font(.system(size: 13)).foregroundColor(.secondary)
            if room.bc { Toggle("🤫 静かに入る（名前を出さずに聞きます）", isOn: $quiet) }
            HStack {
                Button("やめる") { model.joinCandidate = nil }.keyboardShortcut(.cancelAction)
                Spacer()
                Button(engine.room.joined ? "移る" : "参加する") { model.join(room, quiet: quiet) }.keyboardShortcut(.defaultAction)
            }
        }.padding(20).frame(width: 380)
    }
}

struct CreateSheet: View {
    @EnvironmentObject var model: AppModel
    @EnvironmentObject var engine: Engine
    @State private var name = ""
    @State private var broadcast = false
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("🏠 部屋を作る").font(.system(size: 16, weight: .bold))
            VStack(alignment: .leading, spacing: 4) {
                HStack { Text("部屋名").font(.caption).foregroundColor(.secondary); Spacer(); Text("\(name.count) / 30").font(.caption).foregroundColor(.secondary) }
                TextField("◯◯の部屋", text: $name).textFieldStyle(.roundedBorder).onChange(of: name) { _, v in if v.count > 30 { name = String(v.prefix(30)) } }
            }
            Picker("", selection: $broadcast) {
                Text("🏠 雑談部屋にする（全員で話せます）").tag(false)
                Text("📣 配信部屋にする（あなたの声だけ流れます）").tag(true)
            }.pickerStyle(.radioGroup).labelsHidden()
            HStack {
                Button("キャンセル") { model.createOpen = false }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("部屋を作る") { model.createRoom(name: name.trimmingCharacters(in: .whitespaces), broadcast: broadcast) }
                    .keyboardShortcut(.defaultAction).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }.padding(20).frame(width: 400)
        .onAppear { if name.isEmpty { name = engine.profile.name.isEmpty ? "" : String((engine.profile.name + "の部屋").prefix(30)) } }
    }
}
