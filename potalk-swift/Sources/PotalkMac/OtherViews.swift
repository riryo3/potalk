import SwiftUI
import UniformTypeIdentifiers
import AppKit

// MARK: ひとこと
struct ChatView: View {
    @EnvironmentObject var model: AppModel
    @State private var text = ""
    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(model.past) { line($0, dim: true) }
                        ForEach(model.chat) { line($0, dim: false) }
                        Color.clear.frame(height: 1).id("end")
                    }.padding(12)
                }
                .onChange(of: model.chat.count) { _, _ in withAnimation { proxy.scrollTo("end") } }
                .onChange(of: model.past.count) { _, _ in proxy.scrollTo("end") }
            }
            Divider()
            HStack {
                TextField("ひとこと…", text: $text).textFieldStyle(.roundedBorder).onSubmit(send)
                    .onChange(of: text) { _, v in if v.count > 60 { text = String(v.prefix(60)) } }
                Text("\(text.count)/60").font(.system(size: 11, design: .monospaced)).foregroundColor(text.count >= 55 ? .orange : .secondary)
                Button("送信", action: send).keyboardShortcut(.defaultAction).disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
            }.padding(8)
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .environment(\.openURL, OpenURLAction { url in model.confirmOpen(url.absoluteString, from: model.chatWin ?? model.mainWin); return .handled })
    }
    func send() { let t = text.trimmingCharacters(in: .whitespaces); guard !t.isEmpty else { return }; model.sendChat(t); text = "" }

    @ViewBuilder func line(_ l: ChatLine, dim: Bool) -> some View {
        if l.sys {
            Text(linkified(l.text)).font(.system(size: 12)).foregroundColor(.secondary).frame(maxWidth: .infinity).opacity(dim ? 0.7 : 1)
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(l.em); Text(l.who).foregroundColor(.secondary).lineLimit(1).frame(maxWidth: 110, alignment: .leading)
                Text(linkified(l.text)).textSelection(.enabled)
            }.font(.system(size: 14)).opacity(dim ? 0.7 : 1)
        }
    }
}

// MARK: おたより
struct MailView: View {
    @EnvironmentObject var engine: Engine
    @State private var text = ""
    var body: some View {
        let m = engine.room.mail
        VStack(spacing: 0) {
            if !engine.room.bcast {
                Text("配信部屋のときだけ使えます。").foregroundColor(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(m.head.enumerated()), id: \.offset) { _, h in
                        HStack { if !h.text.isEmpty { Text(h.text) }; ForEach(h.btns, id: \.i) { b in btn(b) } }
                    }
                }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
                Divider()
                ScrollView {
                    VStack(spacing: 6) {
                        ForEach(Array(m.body.enumerated()), id: \.offset) { _, b in
                            if b.item {
                                HStack(alignment: .top, spacing: 8) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("\(b.em ?? "") \(b.who ?? "")").font(.system(size: 12)).foregroundColor(.secondary)
                                        Text(b.text)
                                    }
                                    Spacer()
                                    ForEach(b.btns, id: \.i) { x in btn(x) }
                                }.padding(10).card(10).overlay(RoundedRectangle(cornerRadius: 10).stroke((b.shown ?? false) ? Color.accentColor : .clear, lineWidth: 1.5))
                            } else {
                                Text(b.text).font(.system(size: 12)).foregroundColor(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }.padding(10)
                }
                if let f = m.form {
                    Divider()
                    HStack {
                        TextField(f.ph, text: $text).textFieldStyle(.roundedBorder).onSubmit(send)
                            .onChange(of: text) { _, v in if f.max > 0 && v.count > f.max { text = String(v.prefix(f.max)) } }
                        if f.max > 0 && f.max < 100000 { Text("\(text.count)/\(f.max)").font(.system(size: 11, design: .monospaced)).foregroundColor(text.count >= f.max - 5 ? .orange : .secondary) }
                        Button(f.btn, action: send).keyboardShortcut(.defaultAction)
                    }.padding(8)
                }
            }
        }.background(Color(nsColor: .windowBackgroundColor))
    }
    func btn(_ b: MailBtn) -> some View {
        Button(b.label) { engine.cmd(["type": "mailbtn", "i": b.i]) }.buttonStyle(ChipButton(on: b.on || b.label.contains("公開中")))
    }
    func send() { let t = text.trimmingCharacters(in: .whitespaces); guard !t.isEmpty else { return }; engine.cmd(["type": "mailsend", "text": t]); text = "" }
}

// MARK: 公開中のお便り
struct LetterView: View {
    @EnvironmentObject var engine: Engine
    var body: some View {
        let m = engine.room.mailNow
        VStack(alignment: .leading, spacing: 10) {
            Text(m?.cap ?? "").font(.system(size: 13)).foregroundColor(.secondary)
            Text((m?.who ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "：: "))).font(.system(size: 15)).foregroundColor(.accentColor)
            Text(m?.text ?? "").font(.system(size: 22)).textSelection(.enabled)
            Spacer(minLength: 0)
        }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).background(Color(nsColor: .windowBackgroundColor))
    }
}

// MARK: 部屋の設定（ページの設定パネルを写す）
struct RoomSettingsView: View {
    @EnvironmentObject var engine: Engine
    @State private var drag: [String: Double] = [:]
    var body: some View {
        let items = engine.room.settings
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if items.isEmpty { Text("部屋に入ると、ここに設定が出ます。").foregroundColor(.secondary).frame(maxWidth: .infinity).padding(.top, 30) }
                ForEach(items, id: \.uid) { it in
                    switch it.k {
                    case "range":
                        HStack {
                            Text(it.label ?? "").frame(width: 48, alignment: .leading)
                            Slider(value: Binding(get: { drag[it.id ?? ""] ?? (Double(it.value ?? "0") ?? 0) },
                                                  set: { v in
                                       let old = Int(drag[it.id ?? ""] ?? (Double(it.value ?? "0") ?? 0))
                                       drag[it.id ?? ""] = v
                                       if Int(v) != old { engine.cmd(["type": "set", "id": it.id ?? "", "value": String(Int(v))]) }    // 目盛りのない、なめらかなスライダー。整数が変わったときだけ送る
                                   }),
                                   in: (Double(it.min ?? "0") ?? 0)...(Double(it.max ?? "100") ?? 100))
                            Text("\(Int(drag[it.id ?? ""] ?? (Double(it.value ?? "0") ?? 0)))%").font(.caption).foregroundColor(.secondary).frame(width: 40, alignment: .trailing)
                        }
                    case "radios":
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(it.items ?? [], id: \.id) { r in
                                Button { engine.cmd(["type": "set", "id": r.id, "value": true]) } label: {
                                    HStack { Image(systemName: r.checked ? "largecircle.fill.circle" : "circle"); Text(r.label); Spacer() }
                                        .padding(.vertical, 6).padding(.horizontal, 10).background(RoundedRectangle(cornerRadius: 8).fill(r.checked ? Color.accentColor.opacity(0.18) : Color.primary.opacity(0.06)))
                                }.buttonStyle(.plain)
                            }
                        }
                    case "check":
                        Toggle(it.label ?? "", isOn: Binding(get: { it.checked ?? false }, set: { v in engine.cmd(["type": "set", "id": it.id ?? "", "value": v]) }))
                    default:
                        Text(it.text ?? "").font(.caption).foregroundColor(.secondary)
                    }
                }
            }.padding(14)
        }.background(Color(nsColor: .windowBackgroundColor))
    }
}

// MARK: 初期設定（名前・アバター）
struct ProfileView: View {
    @EnvironmentObject var engine: Engine
    @EnvironmentObject var model: AppModel
    @State private var name = ""
    @State private var loaded = false
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("🫖 ぽっと通話").font(.system(size: 20, weight: .bold))
            VStack(alignment: .leading, spacing: 4) {
                Text("あなたの名前").font(.caption).foregroundColor(.secondary)
                TextField("ゲスト", text: $name).textFieldStyle(.roundedBorder)
                    .onChange(of: name) { _, v in
                        let c = String(v.prefix(20)); if c != v { name = c }
                        engine.cmd(["type": "setName", "name": c])
                    }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("アバター").font(.caption).foregroundColor(.secondary)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 8), spacing: 8) {
                    ForEach(Array(engine.profile.avatars.enumerated()), id: \.offset) { i, a in
                        Button { engine.cmd(["type": "setAvatar", "i": i]) } label: {
                            Text(a.em).font(.system(size: 24)).frame(maxWidth: .infinity, minHeight: 38)
                                .background(RoundedRectangle(cornerRadius: 10).fill(a.on || a.em == engine.profile.emoji ? Color.accentColor.opacity(0.25) : Color.primary.opacity(0.07)))
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(a.on || a.em == engine.profile.emoji ? Color.accentColor : .clear, lineWidth: 1.5))
                        }.buttonStyle(.plain)
                    }
                }
            }
            Button("📇 名刺（プロフィールカード）を設定…") { engine.cmd(["type": "cardEdit"]) }.frame(maxWidth: .infinity)
            Button("🛡 自衛ワードを登録…（含む部屋を一覧に出さない）") { model.openBanned() }.frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 6) {
                Text("ウインドウの使い方").font(.caption).foregroundColor(.secondary)
                Toggle("シングルペイン（1つの窓にまとめる）", isOn: $model.singlePane)
                Text("オフのときは、部屋・ひとこと・設定などを別々の小窓で開きます。").font(.caption2).foregroundColor(.secondary)
                Picker("表示サイズ", selection: $model.scalePct) {
                    ForEach(AppModel.scaleSteps, id: \.self) { Text("\($0)%").tag($0) }
                }
                Text("小さな画面では、小さくできます（ウインドウメニューからも選べます）。").font(.caption2).foregroundColor(.secondary)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("部屋に入るとき").font(.caption).foregroundColor(.secondary)
                Toggle("部屋を作るとき、ミュートで始める", isOn: $model.muteOnCreate)
                Toggle("部屋に入るとき、ミュートで始める", isOn: $model.muteOnJoin)
            }
            Spacer()
            Text("名前・アバターを変えると、次に入る部屋から反映されます。").font(.caption).foregroundColor(.secondary)
            Text(engine.profile.version).font(.caption2).foregroundColor(.secondary)
        }
        .padding(20).frame(minWidth: 400, minHeight: 420)
        .onAppear { if !loaded { name = engine.profile.input; loaded = true } }
    }
}

// MARK: これはなに？
struct HelpView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("⚠️ Potalker は、ぽっと通話（potalk.app）の「非公式」クライアントです。サイトの作者とは関係がありません。").font(.system(size: 12, weight: .semibold)).padding(10).frame(maxWidth: .infinity, alignment: .leading).background(RoundedRectangle(cornerRadius: 8).fill(Color.orange.opacity(0.15)))
                Text("🫖 ぽっと通話とは").font(.system(size: 20, weight: .bold))
                Text("登録なし・インストールなしで、居合わせた人と声だけで話せる小さなお茶の席です。同じ部屋を開いた人どうしが、そのまま話せます。")
                Text("⚠️ 実験中です。ご利用は自己責任で！").font(.system(size: 14, weight: .semibold)).foregroundColor(.orange)
                VStack(alignment: .leading, spacing: 6) {
                    Link("はじめに（初めての方へ）", destination: URL(string: "https://potalk.app/start/")!)
                    Link("使い方（画面の順に説明）", destination: URL(string: "https://potalk.app/manual/")!)
                    Link("しくみ（サーバなしで動く理由）", destination: URL(string: "https://potalk.app/tech/")!)
                    Link("運営（制作者と方針）", destination: URL(string: "https://potalk.app/about/")!)
                Link("ソース（po-talk/po-talk.github.io）", destination: URL(string: "https://github.com/po-talk/po-talk.github.io")!)
                }
                Text("🙏 ぽっと通話を作ってくださった くらもさん に、感謝しています。通話の仕組みは、くらもさんのサイトをそのまま使わせてもらっています。").font(.system(size: 12))
                Divider()
                Text("Potalker は、通話の仕組みに potalk.app をそのまま使い、画面だけを Mac 用に作り直した非公式のアプリです。").font(.caption).foregroundColor(.secondary)
            }.padding(20)
        }.frame(minWidth: 380, minHeight: 420)
    }
}


// MARK: 自衛ワード（Potalker 独自）
struct BannedWordsView: View {
    @EnvironmentObject var model: AppModel
    @State private var text = ""
    @State private var target: String?
    @State private var dup = false
    @State private var note = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("ここに登録した言葉を含む部屋は、部屋の一覧に出しません。").font(.system(size: 13))
            Text("部屋の名前・話題タグ・いまいる人の名前を見ます。全角半角・大文字小文字・ひらがなカタカナは、区別しません。").font(.caption).foregroundColor(.secondary)
            HStack {
                TextField("自衛ワード", text: $text).textFieldStyle(.roundedBorder).onSubmit(add)
                Button("登録", action: add).keyboardShortcut(.defaultAction).disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            if dup { Text("すでに登録されています。").font(.caption).foregroundColor(.orange) }
            HStack {
                Button("書き出し…", action: exportFile).disabled(model.bannedWords.isEmpty)
                Button("読み込み…", action: importFile)
                Text(note).font(.caption).foregroundColor(.secondary).lineLimit(2)
                Spacer()
            }
            Divider()
            HStack {
                Text("登録したワード（新しい順）").font(.caption).foregroundColor(.secondary)
                Spacer()
                Text("\(model.bannedWords.count)件").font(.caption).foregroundColor(.secondary)
            }
            ScrollView {
                if model.bannedWords.isEmpty {
                    Text("まだ登録されていません。").foregroundColor(.secondary).frame(maxWidth: .infinity).padding(.top, 20)
                } else {
                    FlowLayout(spacing: 6) {
                        ForEach(model.bannedWords, id: \.self) { w in
                            Button { target = w } label: {
                                Text(w).font(.system(size: 13)).lineLimit(1).padding(.horizontal, 10).padding(.vertical, 5)
                                    .background(Capsule().fill(Color.primary.opacity(0.1))).overlay(Capsule().stroke(Color.primary.opacity(0.15)))
                            }.buttonStyle(.plain).help("押すと、消すかどうかを聞きます")
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(maxHeight: .infinity)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
        }
        .padding(16)
        .frame(minWidth: 320, minHeight: 300)
        .alert("このワードを消しますか？", isPresented: Binding(get: { target != nil }, set: { if !$0 { target = nil } }), presenting: target) { w in
            Button("消す", role: .destructive) { model.removeBanned(w); target = nil }
            Button("やめる", role: .cancel) { target = nil }
        } message: { w in
            Text("「\(w)」を消すと、このワードを含む部屋が、また一覧に出ます。")
        }
    }
    func exportFile() {
        let p = NSSavePanel()
        p.nameFieldStringValue = AppModel.bannedFileName(); p.allowedContentTypes = [.plainText]; p.canCreateDirectories = true
        p.message = "自衛ワードを、1行に1ワードのテキストで書き出します（先頭が最新）"
        guard p.runModal() == .OK, let url = p.url else { return }
        do { try model.exportBanned(to: url); note = "\(model.bannedWords.count)件を書き出しました。" } catch { note = "書き出せませんでした。" }
    }
    func importFile() {
        let p = NSOpenPanel()
        p.allowedContentTypes = [.plainText]; p.allowsMultipleSelection = false; p.canChooseDirectories = false
        p.message = "自衛ワードのファイル（1行に1ワード）を選んでください"
        guard p.runModal() == .OK, let url = p.url else { return }
        do {
            let r = try model.importBanned(from: url)
            note = "\(r.added)件を足しました" + (r.skipped > 0 ? "（登録済み・重複 \(r.skipped)件は飛ばしました）。" : "。")
        } catch { note = "読み込めませんでした（UTF-8のテキストか確認してください）。" }
    }
    func add() {
        if model.addBanned(text) { text = ""; dup = false } else if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { dup = true }
    }
}
