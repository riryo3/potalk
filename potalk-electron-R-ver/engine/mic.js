    (() => {
      const P = window.MediaDevices && window.MediaDevices.prototype;
      if (!P || P.__potalkMac) return;
      const orig = P.getUserMedia, enumerate = P.enumerateDevices;
      // 選んだマイクの「名前」から、ブラウザ側の deviceId を探して使う（名前の一覧は Swift 側が起動時に持っている）
      const pickId = async (self, label) => {
        let tmp = null, ds = await enumerate.call(self);
        if (!ds.some(d => d.kind === 'audioinput' && d.label)) {   // 許可前・取得前は名前が空 → 一度取っている間だけ名前が出る
          try { tmp = await orig.call(self, { audio: true }); } catch (e) { return null; }
          ds = await enumerate.call(self);
        }
        if (tmp) tmp.getTracks().forEach(t => t.stop());
        const ins = ds.filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
        const hit = ins.find(d => d.label === label) || ins.find(d => d.label && (d.label.includes(label) || label.includes(d.label)));
        return hit ? hit.deviceId : null;
      };
      P.getUserMedia = async function (c) {
        let label = ''; try { label = localStorage.getItem('potalkMicLabel') || ''; } catch (e) {}
        if (!label || !c || !c.audio) return orig.call(this, c);
        let id = null; try { id = await pickId(this, label); } catch (e) {}
        if (!id) return orig.call(this, c);
        const a = c.audio === true ? {} : c.audio;
        try { return await orig.call(this, { ...c, audio: { ...a, deviceId: { exact: id } } }); }
        catch (e) { if (e && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) return orig.call(this, c); throw e; }
      };
      P.__potalkMac = true;
    })();