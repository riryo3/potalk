using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;

namespace Potalker;

/// <summary>potalk.app の index.html に小さな差し込みを当てる。差し込み位置が見つからなければ元のページをそのまま使う。</summary>
public static class PagePatcher
{
    static string HistCode
    {
        get
        {
            using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Potalker.Assets.hist.js");
            using var r = new StreamReader(s, Encoding.UTF8);
            return r.ReadToEnd() + "\n";
        }
    }

    record Patch(string Find, Func<string, string> Replace);

    static List<Patch> Patches() => new()
    {
        new("const CHAT_LOG_MAX = 30\n", f => f + HistCode),
        new("call.chatAction = call.room.makeAction('chat')", f =>
            "pmHistAction = call.room.makeAction('hist'); pmHistAction.onMessage = (d, { peerId }) => pmHistRecv(d, peerId)\n  " + f),
        new("sendProfile(id); sendMeta(id);", f => f + " pmHistSend(id);"),
        // 名刺と「無視」の確認は、ネイティブ側に出すので、ページ内ではモーダルにしない
        new("try { $('cardDlg').showModal() } catch {}", _ => "try { $('cardDlg').show() } catch {}"),
        new("try { $('ignoreDlg').showModal() } catch { doIgnore(id) }", _ => "try { $('ignoreDlg').show() } catch { doIgnore(id) }"),
        // 起動のたびに確認が出ないよう、名刺の鍵は起動時には読まない。
        // 相手が自分の名刺を見るとき（名刺を渡す直前）に、はじめて読む（本人確認の✅を、相手に見せるため）
        new("cardKeyLoad(false).catch(() => {})\nconst CARD_NOSTR_KIND", _ => "const CARD_NOSTR_KIND"),
        new("      sendTo(call.cardAction, myCardPayload(), peerId)\n    } else if (data.k === 'res') {", _ =>
            "      const _pc = loadCard()\n      if (_pc.proofs && Object.keys(_pc.proofs).length) cardKeyLoad(false).catch(() => {}).then(() => sendTo(call.cardAction, myCardPayload(), peerId))\n      else sendTo(call.cardAction, myCardPayload(), peerId)\n    } else if (data.k === 'res') {"),
        new("try { $('cropDlg').showModal() } catch { finish(null) }", _ => "try { $('cropDlg').show() } catch { finish(null) }"),
        new("try { $('cardEditDlg').showModal() } catch {}", _ => "try { $('cardEditDlg').show() } catch {}"),
        new("try { $('cardAuthDlg').showModal() } catch {}", _ => "try { $('cardAuthDlg').show() } catch {}"),
        new("btn.onclick = () => askRoom(room, lobbyName(room, people))", f => "btn.dataset.room = room; " + f),
        // 共有する部屋のURLから &name= を外す（ページ側の共有リンクと、ロビーのコピーの両方）
        new("const roomUrl = (id, name) => location.origin + location.pathname + '#room=' + id + (name ? '&name=' + encodeURIComponent(name) : '')",
            _ => "const roomUrl = (id, name) => location.origin + location.pathname + '#room=' + id"),
        new("const flyReaction = (uid, idx) => {\n", f =>
            f + "  try { window.__pm && window.__pm.react(uid, idx, REACTIONS[idx], uid === 'self' ? '' : ((call.profiles.get(uid) || {}).name || '')) } catch {}\n"),
    };

    /// <returns>(html, 当てられたか, 見つからなかった位置)</returns>
    public static (string, bool, string) Apply(string html)
    {
        var o = html;
        foreach (var p in Patches())
        {
            var i = o.IndexOf(p.Find, StringComparison.Ordinal);
            if (i < 0) return (html, false, p.Find);
            if (o.IndexOf(p.Find, i + p.Find.Length, StringComparison.Ordinal) >= 0) return (html, false, p.Find);
            o = o.Remove(i, p.Find.Length).Insert(i, p.Replace(p.Find));
        }
        return (o, true, null);
    }
}
