import SwiftUI
import AppKit

let tealColor = Color(red: 0, green: 0.78, blue: 0.70)
let orangeColor = Color(red: 0.96, green: 0.51, blue: 0.12)
let redColor = Color(red: 0.94, green: 0.38, blue: 0.24)

/// 折り返して並べるレイアウト
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? 300
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, w: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > maxW && x > 0 { y += rowH + spacing; x = 0; rowH = 0 }
            x += sz.width + spacing; rowH = max(rowH, sz.height); w = max(w, x - spacing)
        }
        return CGSize(width: w, height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > bounds.maxX && x > bounds.minX { y += rowH + spacing; x = bounds.minX; rowH = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(sz))
            x += sz.width + spacing; rowH = max(rowH, sz.height)
        }
    }
}

/// 角丸のボタン（色つき）
struct PillButton: ButtonStyle {
    var fill: Color = Color(nsColor: .controlBackgroundColor)
    var fg: Color = .primary
    var hot = false
    var strokeOnly = false
    @State private var pulse = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: hot ? .bold : .regular))
            .foregroundColor(fg)
            .padding(.vertical, 8).padding(.horizontal, 10)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 10).fill(strokeOnly ? fill.opacity(0.10) : fill).opacity(configuration.isPressed ? 0.8 : 1))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(strokeOnly ? fill : Color.primary.opacity(0.15), lineWidth: 1))
            .shadow(color: hot ? fill.opacity(pulse ? 0.0 : 0.7) : .clear, radius: pulse ? 8 : 0)
            .onAppear { if hot { withAnimation(.easeOut(duration: 1.3).repeatForever(autoreverses: false)) { pulse = true } } }
    }
}

/// 小さなチップ（上のバー用）
struct ChipButton: ButtonStyle {
    var on = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12))
            .padding(.vertical, 4).padding(.horizontal, 10)
            .background(RoundedRectangle(cornerRadius: 8).fill(on ? Color.accentColor : Color(nsColor: .controlBackgroundColor)).opacity(configuration.isPressed ? 0.7 : 1))
            .foregroundColor(on ? .white : .primary)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.15), lineWidth: 1))
    }
}

/// 文章中の URL をリンクにする
func linkified(_ text: String) -> AttributedString {
    var out = AttributedString(text)
    guard let re = try? NSRegularExpression(pattern: #"(https?://[^\s<>"'「」『』（）【】〈〉《》［］｛｝、。，．！？]+|www\.[^\s<>"'「」『』（）【】〈〉《》［］｛｝、。，．！？]+)"#, options: [.caseInsensitive]) else { return out }
    let ns = text as NSString
    for m in re.matches(in: text, range: NSRange(location: 0, length: ns.length)).reversed() {
        var r = m.range
        var s = ns.substring(with: r)
        while let last = s.last, ".,;:!?)]、。，．）".contains(last) { s.removeLast(); r.length -= 1 }
        guard let sr = Range(r, in: text), let ar = out.range(of: String(text[sr])) else { continue }
        let href = s.lowercased().hasPrefix("www.") ? "https://" + s : s
        if let url = URL(string: href) { out[ar].link = url; out[ar].foregroundColor = .accentColor; out[ar].underlineStyle = .single }
    }
    return out
}

extension View {
    func card(_ r: CGFloat = 12) -> some View {
        self.background(RoundedRectangle(cornerRadius: r).fill(Color(nsColor: .controlBackgroundColor)))
            .overlay(RoundedRectangle(cornerRadius: r).stroke(Color.primary.opacity(0.12), lineWidth: 1))
    }
}

/// 最前面の切り替え（📌）。オンのときは、青い丸で囲う
struct PinButton: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        Button { model.pinSingle.toggle() } label: {
            Text("📌").font(.system(size: 13)).frame(width: 26, height: 26)
                .background(Circle().fill(model.pinSingle ? Color.accentColor : Color(nsColor: .controlBackgroundColor)))
                .overlay(Circle().stroke(Color.primary.opacity(0.15), lineWidth: 1))
        }.buttonStyle(.plain).help("最前面に表示する／しない")
    }
}
