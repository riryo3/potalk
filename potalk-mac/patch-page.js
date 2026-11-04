// ページ(potalk.app の index.html)への差し込み。
// 差し込み位置が見つからないときは、何もせず元のページをそのまま使う。
const PATCHES = [
  // 名刺と「無視」の確認は、アプリ側の小窓に出すので、ページ内ではモーダルにしない（開いたまま・見えない状態にする）
  { find: "try { $('cardDlg').showModal() } catch {}", replace: () => "try { $('cardDlg').show() } catch {}" },
  { find: "try { $('ignoreDlg').showModal() } catch { doIgnore(id) }", replace: () => "try { $('ignoreDlg').show() } catch { doIgnore(id) }" },
  // 共有するURLには、部屋の名前（&name=…）を付けない（部屋のIDだけで入れる）
  { find: "const roomUrl = (id, name) => location.origin + location.pathname + '#room=' + id + (name ? '&name=' + encodeURIComponent(name) : '')", replace: () => "const roomUrl = (id, name) => location.origin + location.pathname + '#room=' + id" },
  // ロビーの各部屋に部屋IDを持たせる（アプリの検索・リンク指定で使う）
  { find: 'btn.onclick = () => askRoom(room, lobbyName(room, people))', replace: m => "btn.dataset.room = room; " + m },
  // リアクションが出た（自分が押した／届いた）ことをアプリに知らせる。ページ内の行が見えていなくても飛ばせるように
  { find: 'const flyReaction = (uid, idx) => {\n', replace: m => m +
      "  try { window.dispatchEvent(new CustomEvent('pm-react', { detail: JSON.stringify({ u: String(uid), i: idx, e: REACTIONS[idx], n: uid === 'self' ? '' : ((call.profiles.get(uid) || {}).name || '') }) })) } catch {}\n" },
];

function applyPatches(html) {
  let out = html;
  for (const p of PATCHES) {
    const first = out.indexOf(p.find);
    if (first < 0 || out.indexOf(p.find, first + 1) >= 0) return { html, applied: false, missing: p.find };
    out = out.slice(0, first) + p.replace(p.find) + out.slice(first + p.find.length);
  }
  return { html: out, applied: true };
}
module.exports = { applyPatches };
