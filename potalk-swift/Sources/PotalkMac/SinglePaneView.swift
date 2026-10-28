import SwiftUI
import AppKit

/// 1つの窓にまとめるモード。入室前は縦長の一覧、入室中は部屋の小窓くらいの幅で、タブ（部屋・ひとこと・おたより・設定）と、左から出す部屋一覧（☰）
struct SinglePaneView: View {
    @EnvironmentObject var model: AppModel
    @EnvironmentObject var engine: Engine

    var body: some View {
        Group {
            if engine.room.joined {
                // 部屋一覧は、左の取っ手から、窓の左にドロワーとして開く（別の小窓。窓の大きさは変えない）
                VStack(spacing: 0) {
                    tabBar
                    Divider()
                    HStack(spacing: 0) {
                        handle
                        content.frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                    if model.tab != .room { Divider(); miniBar }
                    Divider()
                    chatDrawer
                }
                .frame(minWidth: 340, minHeight: 560)
            } else {
                MainView()      // 入室前は、複数ウインドウの本体と同じ縦長の一覧
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }

    let handleW: CGFloat = 16
    @State private var dragStartH: CGFloat? = nil

    /// 窓の下から開くひとこと。見出しを押すと開閉し、開いているときは上の縁をドラッグして高さを変えられる
    var chatDrawer: some View {
        VStack(spacing: 0) {
            if model.chatDrawer {
                Rectangle().fill(Color.primary.opacity(0.12)).frame(height: 6)
                    .overlay(Capsule().fill(Color.secondary.opacity(0.6)).frame(width: 36, height: 3))
                    .contentShape(Rectangle())
                    .onHover { if $0 { NSCursor.resizeUpDown.push() } else { NSCursor.pop() } }
                    .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
                        .onChanged { g in
                            let s = dragStartH ?? model.chatH
                            dragStartH = s
                            model.chatH = min(480, max(120, s - g.translation.height / model.uiScale))
                        }
                        .onEnded { _ in dragStartH = nil })
            }
            Button { model.chatDrawer.toggle() } label: {
                let hot = model.unread > 0
                HStack(spacing: 6) {
                    Image(systemName: model.chatDrawer ? "chevron.down" : "chevron.up").font(.system(size: 10, weight: .bold))
                    Text(hot ? "ひとこと 新着 \(model.unread)" : "ひとこと").font(.system(size: 12, weight: hot ? .semibold : .regular))
                }
                .foregroundColor(hot ? .black : .secondary)
                .frame(maxWidth: .infinity).padding(.vertical, 6)
                .background(hot ? tealColor : Color.clear)
                .contentShape(Rectangle())
            }.buttonStyle(.plain).help("ひとことを開く／閉じる（⌘3）")
            if model.chatDrawer {
                Divider()
                ChatView().frame(height: model.chatH)
            }
        }
    }

    /// 左端の取っ手。押すと、部屋の一覧が左から出入りする
    var handle: some View {
        Button { model.drawerOpen.toggle() } label: {
            ZStack {
                Rectangle().fill(Color.primary.opacity(model.drawerOpen ? 0.14 : 0.07))
                VStack(spacing: 6) {
                    Image(systemName: model.drawerOpen ? "chevron.right" : "chevron.left").font(.system(size: 10, weight: .bold))
                    VStack(spacing: 1) { ForEach(Array("部屋一覧"), id: \.self) { Text(String($0)).font(.system(size: 10)) } }
                }.foregroundColor(.secondary)
            }.frame(width: handleW).frame(maxHeight: .infinity)
        }.buttonStyle(.plain).help("部屋の一覧を開く／閉じる")
    }

    /// 窓の幅いっぱいに等分した見出し（部屋 | ひとこと | おたより | 設定）。選んでいるタブは下に線。新着があるタブは、色がつく
    var tabBar: some View {
        let r = engine.room
        let mailHot = r.mailOpen && model.tab != .mail
        var tabs: [(String, PaneTab, Bool, Color)] = [("部屋", .room, model.roomHot, tealColor)]
        if r.bcast { tabs.append(("おたより", .mail, mailHot, orangeColor)) }
        tabs.append(("設定", .settings, false, tealColor))
        return HStack(spacing: 0) {
            ForEach(Array(tabs.enumerated()), id: \.offset) { i, t in
                tabCell(t.0, t.1, hot: t.2, hotColor: t.3)
                if i < tabs.count - 1 { Rectangle().fill(Color.primary.opacity(0.25)).frame(width: 1, height: 14) }
            }
            // 最前面の切り替え（設定の右）
            Rectangle().fill(Color.primary.opacity(0.25)).frame(width: 1, height: 14)
            PinButton().padding(.horizontal, 6)
        }
        .background(Color(nsColor: .controlBackgroundColor))
    }

    func tabCell(_ title: String, _ t: PaneTab, hot: Bool, hotColor: Color) -> some View {
        let on = model.tab == t
        return Button { model.tab = t } label: {
            VStack(spacing: 0) {
                Text(title).font(.system(size: 13, weight: on || hot ? .semibold : .regular)).lineLimit(1)
                    .frame(maxWidth: .infinity).padding(.vertical, 10)
                    .foregroundColor(hot ? .black : (on ? .accentColor : .primary))
                    .background(hot ? hotColor : Color.clear)
                Rectangle().fill(on ? Color.accentColor : Color.clear).frame(height: 2.5)
            }.contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

    @ViewBuilder var content: some View {
        switch model.tab {
        case .room: RoomView(embedded: true)
        case .mail: MailView()
        case .settings: RoomSettingsView()
        }
    }

    /// 部屋の画面を見ていないときも、ミュートと退出が手元にあるように
    var miniBar: some View {
        let speaking = engine.room.members.filter { $0.speaking }.map { $0.name }
        return HStack(spacing: 10) {
            Text(speaking.isEmpty ? "　" : "🔊 " + speaking.joined(separator: "、")).font(.system(size: 12)).foregroundColor(.secondary).lineLimit(1)
            Spacer(minLength: 4)
            MuteControl().frame(width: 130)
            SpeakerButton()
            Button("🚪 退出") { model.requestLeave(from: model.roomHost) }
                .buttonStyle(PillButton(fill: Color(red: 0.72, green: 0.11, blue: 0.11), fg: .white)).frame(width: 80)
        }.padding(.horizontal, 12).padding(.vertical, 8)
    }
}

/// キーを受け取れる、枠なしふうの小窓（部屋一覧のドロワー用）
final class DrawerPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}
