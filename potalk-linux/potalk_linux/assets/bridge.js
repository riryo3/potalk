    (() => {
      if (window.__pm) return;
      const $ = id => document.getElementById(id);
      const post = (t, d) => { try { window.__pmPost && window.__pmPost({ t: t, d: d === undefined ? null : d }); } catch (e) {} };
      const T = (e, sel) => (e && e.querySelector(sel) ? e.querySelector(sel).textContent : '') || '';

      // ---- ロビー（通話中の部屋の一覧）----
      const lobbyState = () => {
        const list = $('lobbyList');
        const rooms = [...(list ? list.children : [])].filter(e => e.tagName === 'BUTTON').map(b => ({
          id: b.dataset.room || '',
          name: T(b, '.room-name'),
          count: T(b, '.room-count'),
          sub: T(b, '.room-sub-name'),
          subBy: T(b, '.room-sub-by'),
          dur: T(b, '.room-dur > span'),
          people: [...b.querySelectorAll('.room-people .rp')].map(rp => ({ em: rp.children[0] ? rp.children[0].textContent : '', name: rp.children[1] ? rp.children[1].textContent : '', muted: rp.classList.contains('mut') })),
          bc: (T(b, '.room-name') + T(b, '.room-sub-name')).includes('📣'),
        }));
        return { rooms: rooms, status: T(document, '#lobbyStatus'), viewers: ($('lobbyViewers') ? $('lobbyViewers').textContent : '').trim() };
      };

      // ---- プロフィール ----
      const profileState = () => ({
        emoji: ($('pfEmoji') ? $('pfEmoji').textContent : '') || '',
        name: ($('pfName') ? $('pfName').textContent : '') || '',
        input: $('name') ? $('name').value : '',
        avatars: [...(($('avatars') || {}).children || [])].map(b => ({ em: b.textContent, on: b.classList.contains('on') || b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true' })),
        version: ($('ver') ? $('ver').textContent : ''),
      });

      // ---- 部屋 ----
      const roomState = () => {
        const j = !!$('tabs') && !$('tabs').hidden;
        const members = [...document.querySelectorAll('#members .member')].map(r => ({
          em: T(r, '.m-emoji'), name: T(r, '.m-name'), mark: T(r, '.m-bc'),
          muted: r.classList.contains('muted'), speaking: r.classList.contains('speaking'),
          you: !!r.querySelector('.you'), stage: T(r, '.m-stage'),
          tap: !!r.querySelector('.m-emoji.m-tap'),
          ig: (() => { const b = r.querySelector('.m-ig'); return b && b.style.visibility !== 'hidden' ? { off: b.classList.contains('off'), title: b.title || '' } : null; })(),
          conn: (() => { const c = r.querySelector('.m-conn'); return c ? (c.classList.contains('relay') ? 'relay' : c.classList.contains('direct') ? 'direct' : 'unknown') : ''; })(),
          grant: (() => { const g = r.querySelector('.m-mic'); return g && g.style.visibility !== 'hidden' ? { on: g.classList.contains('on'), title: g.title || '' } : null; })(),
        }));
        const mailBtns = [...$('mailHead').querySelectorAll('button'), ...$('mailBody').querySelectorAll('button')];
        const bi = b => ({ i: mailBtns.indexOf(b), label: b.textContent, on: b.classList.contains('on') });
        const settings = (() => {
          const out = [], hid = e => { for (; e && e.id !== 'panSettings'; e = e.parentElement) if (e.hidden || e.style.display === 'none') return true; return false; };
          for (const e of ($('panSettings') ? $('panSettings').children : [])) {
            if (hid(e)) continue;
            const t = (e.textContent || '').replace(/\s+/g, ' ').trim();
            const inp = e.querySelector ? e.querySelector('input') : null;
            if (e.classList.contains('vol-opt') && inp && inp.type === 'range')
              out.push({ k: 'range', id: inp.id, label: T(e, '.vol-lbl'), value: inp.value, min: inp.min, max: inp.max, step: inp.step });
            else if (e.classList.contains('bgm-row') || e.getAttribute('role') === 'radiogroup')
              out.push({ k: 'radios', items: [...e.querySelectorAll('input[type=radio]')].map(r => ({ id: r.id, label: (r.closest('label') ? r.closest('label').textContent.trim() : ''), checked: r.checked })) });
            else if (e.classList.contains('snd-opt') && inp && inp.type === 'checkbox')
              out.push({ k: 'check', id: inp.id, label: t, checked: inp.checked });
            else if (e.classList.contains('vol-note') && t) out.push({ k: 'note', text: t });
          }
          return out;
        })();
        const cd = $('cardDlg'), ig = $('cdIgnore'), av = $('cdAvatar'), igd = $('ignoreDlg');
        const mn = $('mailNow');
        return {
          joined: j,
          rid: (() => { const m = location.hash.match(/room=([^&]*)/); try { return m ? decodeURIComponent(m[1]) : ''; } catch { return ''; } })(),
          state: $('state') ? $('state').textContent : '',
          members: members,
          card: cd && cd.open ? {
            emoji: T(document, '#cdEmoji'), img: av && !av.hidden ? av.src : '', name: T(document, '#cdName'), state: T(document, '#cdState'), bio: T(document, '#cdBio'),
            foot: T(cd, '.cd-foot-note'),
            ignore: ig && !ig.hidden ? { text: ig.textContent.trim(), disabled: !!ig.disabled } : null,
            edit: !!$('cdEditBtn') && !$('cdEditBtn').hidden,
            socials: [...cd.querySelectorAll('#cdSocials a')].map(a => ({ t: a.textContent.trim(), u: a.href })),
          } : null,
          ignoreAsk: igd && igd.open ? { title: T(document, '#ignoreTitle'), items: [...igd.querySelectorAll('li')].map(l => l.textContent), yes: ($('ignoreYes') || {}).textContent || '', no: ($('ignoreNo') || {}).textContent || '' } : null,
          mailNow: mn && !mn.hidden ? { cap: T(mn, '.mn-cap'), who: T(mn, '.mn-who'), text: mn.children.length ? mn.children[mn.children.length - 1].textContent : '' } : null,
          more: $('membersMore') ? $('membersMore').textContent.trim() : '',
          mailOpen: ($('mailHead') ? $('mailHead').textContent : '').includes('📮'),
          bcast: !!$('tabMail') && !$('tabMail').hidden,
          tag: { show: !!$('tagRow') && !$('tagRow').hidden, text: T(document, '#tagText'), btn: T(document, '#tagEdit') },
          speak: { show: !!$('speak') && $('speak').style.display !== 'none', label: $('speak') ? $('speak').textContent.trim() : '', disabled: !!($('speak') && $('speak').disabled) },
          raise: { show: !!$('raise') && !$('raise').hidden && $('raise').style.display !== 'none', label: $('raise') ? $('raise').textContent.trim() : '' },
          mail: {
            head: [...$('mailHead').children].map(d => d.tagName === 'BUTTON' ? { text: '', btns: [bi(d)] } : ({ text: [...d.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() || (d.querySelector('button') ? '' : d.textContent.trim()), btns: [...d.querySelectorAll('button')].map(bi) })),
            body: [...$('mailBody').children].map(d => d.classList.contains('mail-item') && d.querySelector('.mail-text')
              ? { item: true, em: T(d, '.mail-em'), who: T(d, '.mail-who'), text: d.querySelector('.mail-text').textContent, shown: d.classList.contains('shown'), btns: [...d.querySelectorAll('button')].map(bi) }
              : { item: false, text: d.textContent.trim(), btns: [] }),
            form: $('mailForm') && !$('mailForm').hidden ? { ph: $('mailText').placeholder, btn: $('mailSend').textContent, max: $('mailText').maxLength } : null,
          },
          reactions: [...document.querySelectorAll('#reactions button')].map(b => b.textContent),
          canMute: !!$('mute') && $('mute').style.display !== 'none',
          muted: !!($('mute') && $('mute').classList.contains('muted')),
          share: $('share') ? $('share').textContent.trim() : '',
          settings: settings,
        };
      };

      // ---- 名刺の編集・本人確認 ----
      const cardsState = () => {
        const ed = $('cardEditDlg'), au = $('cardAuthDlg');
        const val = id => ($(id) ? $(id).value : '');
        const ver = k => ({ btnShow: !!$('ceBtnVer_' + k) && !$('ceBtnVer_' + k).hidden, btnLabel: $('ceBtnVer_' + k) ? $('ceBtnVer_' + k).textContent : '', btnDisabled: !!($('ceBtnVer_' + k) && $('ceBtnVer_' + k).disabled), verified: !!$('ceVerBadge_' + k) && !$('ceVerBadge_' + k).hidden });
        const tipOpt = (() => { const r = document.querySelector('input[name=ceTipOpt]:checked'); return r ? r.value : 'none'; })();
        const av = $('ceAvatarImg');
        return {
          edit: ed && ed.open ? {
            img: av && !av.hidden ? av.src : '', emoji: ($('ceAvatarEmoji') ? $('ceAvatarEmoji').textContent : ''), sub: $('ceSubEmoji') && !$('ceSubEmoji').hidden ? $('ceSubEmoji').textContent : '',
            clearShow: !!$('ceAvatarClear') && !$('ceAvatarClear').hidden,
            avatarMsg: $('ceAvatarMsg') && !$('ceAvatarMsg').hidden ? $('ceAvatarMsg').textContent : '',
            bio: val('ceBio'),
            tipOpt: tipOpt, tipOfuse: val('ceTip_ofuse'), tipAmazon: val('ceTip_amazon'), tipZap: val('ceTip_zap'), tipKofi: val('ceTip_kofi'), tipBmac: val('ceTip_bmac'),
            snsX: val('ceSns_x'), snsGithub: val('ceSns_github'), snsNote: val('ceSns_note'), snsInstagram: val('ceSns_instagram'), snsYoutube: val('ceSns_youtube'), snsNostr: val('ceSns_nostr'),
            verX: ver('x'), verGithub: ver('github'), verNostr: ver('nostr'),
            noImg: !!($('ceNoImg') && $('ceNoImg').checked),
            warn: $('ceWarn') && !$('ceWarn').hidden ? $('ceWarn').textContent : '',
          } : null,
          auth: au && au.open ? {
            title: T(document, '#caTitle'), account: T(document, '#caAccount'), desc: T(document, '#caDesc'),
            codeShow: !!$('caCodeSec') && !$('caCodeSec').hidden, code: T(document, '#caCode'),
            postShow: !!$('caXPostSec') && !$('caXPostSec').hidden, post: T(document, '#caPostPreview'), tweet: $('caTweetBtn') ? $('caTweetBtn').href : '',
            inputShow: !!$('caInputSec') && !$('caInputSec').hidden, input: $('caInputUrl') ? $('caInputUrl').value : '',
            msg: $('caMsg') && !$('caMsg').hidden ? $('caMsg').textContent : '', msgBad: !!($('caMsg') && $('caMsg').classList.contains('bad')),
            note: T(document, '#caNote'), verifyLabel: T(document, '#caVerifyBtn'), verifyDisabled: !!($('caVerifyBtn') && $('caVerifyBtn').disabled),
          } : null,
        };
      };
      // 画像の切り抜きは、ネイティブ側で済ませた正方形の画像を渡すので、ページ側の窓は自動で「決定」する
      setInterval(() => { const c = $('cropDlg'); if (c && c.open && $('cropOk')) $('cropOk').click(); }, 200);

      let last = { lobby: '', profile: '', room: '', eq: null, cards: '' };
      const sendIfChanged = (key, value) => { const s = JSON.stringify(value); if (s !== last[key]) { last[key] = s; post(key, value); } };
      setInterval(() => {
        try { sendIfChanged('lobby', lobbyState()); } catch (e) {}
        try { sendIfChanged('profile', profileState()); } catch (e) {}
        try { sendIfChanged('room', roomState()); } catch (e) {}
        try { sendIfChanged('cards', cardsState()); } catch (e) {}
      }, 250);
      setInterval(() => {
        const s = $('eq') ? $('eq').textContent : '';
        if (s !== last.eq) { last.eq = s; post('eq', s); }
      }, 80);

      // ひとこと：ログに増えた行を流す
      const watchChat = () => {
        const log = $('chatLog'); if (!log) return false;
        new MutationObserver(muts => {
          for (const m of muts) for (const n of m.addedNodes) {
            if (!n.classList || !n.classList.contains('cl-row')) continue;
            post('chat', { sys: n.classList.contains('cl-sys'), hist: n.classList.contains('cl-hist'), em: T(n, '.cl-em'), who: T(n, '.cl-who'), text: T(n, '.cl-text') });
          }
        }).observe(log, { childList: true });
        return true;
      };
      document.addEventListener('DOMContentLoaded', () => { watchChat(); post('ready', null); });

      // ---- 小窓などからの操作 ----
      const click = el => { if (el) el.click(); };
      const rowAt = i => document.querySelectorAll('#members .member')[i | 0];
      // スピーカーのミュート（ページの音量の設定には触らない＝保存されない）。
      // ページが後から作る・戻す音の要素にも効くよう、ミュート中は 100ms ごとにかけ直す。解除では、こちらがミュートにした要素だけを戻す
      const spk = { on: false, ours: new WeakSet(), timer: 0 };
      const spkApply = () => document.querySelectorAll('audio,video').forEach(e => { if (!e.muted) { e.muted = true; spk.ours.add(e); } });
      const spkSet = on => {
        spk.on = !!on;
        if (spk.on) { spkApply(); if (!spk.timer) spk.timer = setInterval(spkApply, 100); }
        else { clearInterval(spk.timer); spk.timer = 0; document.querySelectorAll('audio,video').forEach(e => { if (spk.ours.has(e)) { e.muted = false; spk.ours.delete(e); } }); }
      };
      window.__pm = {
        react: (u, i, e, n) => post('react', { u: String(u), i: i, e: e, n: n || '' }),
        cmd: (c) => {
          switch (c.type) {
            case 'mute': click($('mute')); break;
            case 'spk': spkSet(c.on); break;
            case 'react': click(document.querySelectorAll('#reactions button')[c.i | 0]); break;
            case 'leave': click($('leave')); setTimeout(() => click($('leaveYes')), 80); break;
            case 'grant': click(rowAt(c.i) && rowAt(c.i).querySelector('.m-mic')); break;
            case 'speak': click($('speak')); break;
            case 'raise': click($('raise')); break;
            case 'tag': $('tagInput').value = String(c.text).slice(0, 30); if ($('tagSend').onclick) $('tagSend').onclick(); break;
            case 'mailbtn': click([...$('mailHead').querySelectorAll('button'), ...$('mailBody').querySelectorAll('button')][c.i | 0]); break;
            case 'mailsend': $('mailText').value = String(c.text); click($('mailSend')); break;
            case 'card': click(rowAt(c.i) && rowAt(c.i).querySelector('.m-emoji')); break;
            case 'cardClose': try { $('cardDlg').close(); } catch (e) {} break;
            case 'cardIgnore': click($('cdIgnore')); break;
            case 'cardEditFromCard': click($('cdEditBtn')); break;
            case 'ignoreRow': click(rowAt(c.i) && rowAt(c.i).querySelector('.m-ig')); break;
            case 'ignoreYes': click($('ignoreYes')); break;
            case 'ignoreNo': click($('ignoreNo')); break;
            case 'set': {
              const el = $(String(c.id));
              if (!el || !el.closest('#panSettings')) break;
              if (el.type === 'range') { el.value = String(c.value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
              else if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked !== !!c.value || el.type === 'radio') el.click(); }
              break;
            }
            case 'chat': { const i = $('chatText'); i.value = String(c.text).slice(0, 60); i.dispatchEvent(new Event('input', { bubbles: true })); click($('chatSend')); break; }
            case 'create': {
              const room = $('room'), join = $('join'); if (!room || !join) break;
              room.value = String(c.name).slice(0, 30); room.dispatchEvent(new Event('input', { bubbles: true }));
              const k = $(c.kind === 'bc' ? 'kindBc' : 'kindChat');
              if (k) { k.checked = true; k.dispatchEvent(new Event('change', { bubbles: true })); k.click(); }
              if (c.kind !== 'bc') { join.click(); break; }
              const t0 = Date.now();
              const wait = () => { if (($('share') ? $('share').textContent : '').includes('~pk~')) { join.click(); return; } if (Date.now() - t0 < 6000) setTimeout(wait, 100); };
              wait(); break;
            }
            case 'join': {
              const b = [...document.querySelectorAll('#lobbyList > button')].find(x => x.dataset.room === c.id);
              if (!b) break; b.click();
              setTimeout(() => {
                const q = $('roomAskQuiet'); if (q) { q.checked = !!c.quiet; q.dispatchEvent(new Event('change', { bubbles: true })); }
                click($('roomAskYes'));
              }, 250); break;
            }
            case 'cardEdit': click($('btnOpenCardEdit')); break;
            case 'ceField': {
              const m = { bio: 'ceBio', tipOfuse: 'ceTip_ofuse', tipAmazon: 'ceTip_amazon', tipZap: 'ceTip_zap', tipKofi: 'ceTip_kofi', tipBmac: 'ceTip_bmac', snsX: 'ceSns_x', snsGithub: 'ceSns_github', snsNote: 'ceSns_note', snsInstagram: 'ceSns_instagram', snsYoutube: 'ceSns_youtube', snsNostr: 'ceSns_nostr' };
              const el = $(m[c.field]); if (el) { el.value = String(c.value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
              break;
            }
            case 'ceTipOpt': { const r = document.querySelector('input[name=ceTipOpt][value="' + c.v + '"]'); if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); } break; }
            case 'ceNoImg': { const e = $('ceNoImg'); if (e && e.checked !== !!c.on) e.click(); break; }
            case 'ceSave': click($('ceSave')); break;
            case 'ceClose': click($('ceCancel')); break;
            case 'ceAvatarClear': click($('ceAvatarClear')); break;
            case 'ceAvatarFile': {
              try {
                const bin = atob(c.b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
                const f = new File([u8], c.name || 'avatar.jpg', { type: c.mime || 'image/jpeg' });
                const dt = new DataTransfer(); dt.items.add(f);
                const inp = $('ceAvatarFile'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
              } catch (e) {}
              break;
            }
            case 'ceVerify': click($('ceBtnVer_' + c.k)); break;
            case 'ceUnverify': click($('ceVerBadge_' + c.k)); break;
            case 'caInput': { const i = $('caInputUrl'); if (i) { i.value = String(c.value); i.dispatchEvent(new Event('input', { bubbles: true })); } break; }
            case 'caVerify': click($('caVerifyBtn')); break;
            case 'caCancel': click($('caCancelBtn')); break;
            case 'reconnect': click($('retry')); break;
            case 'entryTry': click($('entryTry')); break;
            case 'entryJoin': click($('join')); break;
            case 'refreshLobby': click($('lobbyRefresh')); break;
            case 'setName': { const n = $('name'); if (n) { n.value = String(c.name).slice(0, 20); n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); } break; }
            case 'setAvatar': click(($('avatars') || {}).children && $('avatars').children[c.i | 0]); break;
            case 'sndRoom': { const b = $('sndRoom'); if (b && b.checked !== !!c.on) b.click(); break; }
            case 'setMicLabel': try { localStorage.setItem('potalkMicLabel', String(c.label || '')); } catch (e) {} break;
            case 'devices': navigator.mediaDevices.enumerateDevices().then(ds => post('devices', ds.filter(d => d.kind === 'audioinput').map(d => ({ id: d.deviceId, label: d.label })))).catch(() => post('devices', [])); break;
            case 'probeMic': navigator.mediaDevices.getUserMedia({ audio: true }).then(s => { s.getTracks().forEach(t => t.stop()); window.__pm.cmd({ type: 'devices' }); }).catch(() => {}); break;
          }
        },
      };
    })();