(() => {
  let port = null;
  let dead = false;
  let view = null;
  let tick = null;
  let prevTick = null;
  let lastCmd = 0;
  let loading = null;
  let rate = 1;
  let hold = null;
  let pendingNow = null;
  let startTimer = 0;
  let startFor = 0;
  let npKey = '';
  let npAt = 0;
  let jamFlag = false;
  let changedAt = 0;
  let optimistic = null;
  let deniedAt = 0;
  let adAt = 0;
  let adToast = 0;
  let adKick = 0;
  let cssDone = false;
  const pagePort = globalThis.chorusPagePort;
  const waiters = new Map();
  const requested = new Map();
  const LEAD = 700;
  const PLAY_LAG = 50;
  const LOCAL = new Set(['remove', 'move', 'promote', 'clear', 'mode', 'radio', 'pause', 'play', 'seek', 'jump', 'next']);
  const HOST_ONLY = new Set(['mode', 'radio', 'perm', 'lock']);

  const toPage = m => {
    if (pagePort) pagePort.postMessage(m);
  };

  function send(m) {
    if (!port) return;
    try {
      port.postMessage(m);
    } catch {}
  }

  function connect() {
    if (dead) return;
    try {
      port = chrome.runtime.connect({ name: 'tab' });
    } catch {
      dead = true;
      return;
    }
    port.onMessage.addListener(onPort);
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      port = null;
      if (chrome.runtime && chrome.runtime.id) setTimeout(connect, 1000);
      else dead = true;
    });
    send({ type: 'hello' });
    if (!cssDone) send({ type: 'css' });
  }

  function inJam() {
    return !!(view && view.jam && !view.jam.pending && view.jam.v);
  }

  function active() {
    return inJam() && view.driver;
  }

  function perms() {
    return inJam() ? view.jam.can : { add: true, ctl: true };
  }

  function allowed(o) {
    if (!inJam()) return true;
    const s = view.jam;
    if (s.isHost) return true;
    if (HOST_ONLY.has(o.k)) return false;
    const p = s.can;
    if (o.k === 'add' || o.k === 'addMany') return p.add;
    if (o.k === 'ended') return !o.bad || p.ctl;
    if (o.k === 'remove') return p.ctl || s.queue.some(q => q.qid === o.qid && q.by === view.me.id);
    return p.ctl;
  }

  function denied() {
    const now = Date.now();
    if (now - deniedAt < 3000) return;
    deniedAt = now;
    UI.toast(tr('noPerm'));
  }

  function hostNow() {
    return Date.now() + ((view && view.jam && view.jam.skew) || 0);
  }

  function target(s) {
    return s.playing ? s.pos + (Date.now() + (s.skew || 0) - s.at) : s.pos;
  }

  function cmd(m) {
    lastCmd = Date.now();
    toPage(m);
  }

  function setRate(r) {
    if (Math.abs(r - rate) < 0.002) return;
    rate = r;
    toPage({ c: 'rate', r });
  }

  function local(o, s) {
    const at = typeof o.at === 'number' ? o.at : Date.now() + (s.skew || 0);
    const inQueue = qid => s.queue.findIndex(q => q.qid === qid);
    const inCtx = qid => (s.ctx ? s.ctx.items.findIndex(q => q.qid === qid) : -1);
    const start = it => {
      if (s.cur && s.cur !== it) s.hist = [...(s.hist || []), s.cur];
      s.cur = it;
      s.pos = 0;
      s.at = at;
      s.playing = true;
      s.ended = false;
    };
    const upcoming = () => (s.queue.length ? s.queue.shift() : s.ctx && s.ctx.items.length ? s.ctx.items.shift() : null);
    switch (o.k) {
      case 'remove': {
        let i = inQueue(o.qid);
        if (i >= 0) s.queue.splice(i, 1);
        else if ((i = inCtx(o.qid)) >= 0) s.ctx.items.splice(i, 1);
        break;
      }
      case 'move': {
        const i = inQueue(o.qid);
        if (i < 0) break;
        const [it] = s.queue.splice(i, 1);
        s.queue.splice(Math.max(0, Math.min(o.to, s.queue.length)), 0, it);
        break;
      }
      case 'promote': {
        const i = inCtx(o.qid);
        if (i >= 0) s.queue.push(s.ctx.items.splice(i, 1)[0]);
        break;
      }
      case 'jump': {
        let i = inQueue(o.qid);
        if (i >= 0) start(s.queue.splice(i, 1)[0]);
        else if ((i = inCtx(o.qid)) >= 0) {
          const it = s.ctx.items[i];
          s.ctx.items = s.ctx.items.slice(i + 1);
          start(it);
        }
        break;
      }
      case 'next': {
        const it = upcoming();
        if (it) start(it);
        break;
      }
      case 'clear':
        if (o.which === 'ctx') s.ctx = null;
        else s.queue = [];
        break;
      case 'mode':
        s.mode = o.mode;
        break;
      case 'radio':
        s.radio = o.on;
        if (!o.on && s.ctx && s.ctx.auto) s.ctx = null;
        break;
      case 'pause':
        if (s.playing) {
          s.pos = typeof o.pos === 'number' ? o.pos : Math.max(0, s.pos + (at - s.at));
          s.playing = false;
          s.at = at;
        }
        break;
      case 'play':
        if (!s.playing && s.cur && !s.ended) {
          s.playing = true;
          s.at = at;
        }
        break;
      case 'seek':
        if (s.cur) {
          s.pos = o.pos;
          s.at = at;
          s.ended = false;
        }
        break;
    }
  }

  function stamp(o) {
    if (!inJam() || typeof o.at === 'number') return o;
    const s = view.jam;
    const now = hostNow();
    switch (o.k) {
      case 'play':
        return { ...o, at: now + 250 };
      case 'pause':
        return { ...o, at: now, pos: Math.max(0, target(s)) };
      case 'seek':
        return { ...o, at: now + 150 };
      case 'next':
      case 'prev':
      case 'jump':
      case 'now':
      case 'context':
        return { ...o, at: now + LEAD };
      default:
        return o;
    }
  }

  function op(o, mine) {
    if (!allowed(o)) {
      denied();
      return;
    }
    if (!mine) o = stamp(o);
    send({ type: 'op', op: o });
    if (!inJam()) return;
    if (mine) {
      hold = { at: Date.now(), v: view.jam.v };
      return;
    }
    if (!LOCAL.has(o.k)) return;
    const now = Date.now();
    const base = view.jam.v;
    const list = optimistic && optimistic.v === base && now < optimistic.until ? optimistic.list : [];
    optimistic = { v: base, until: now + 2500, list: [...list, o] };
    local(o, view.jam);
    UI.update(view);
    if (active() && tick) sync();
  }

  function ask(m, ms) {
    return new Promise(ok => {
      const rid = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        waiters.delete(rid);
        ok(null);
      }, ms);
      waiters.set(rid, r => {
        clearTimeout(timer);
        ok(r);
      });
      toPage({ ...m, rid });
    });
  }

  function resolve(ref) {
    return ask({ c: 'resolve', ref }, 30000);
  }

  const asked = new Set();

  function wantLyrics() {
    if (!UI.isOpen || UI.page !== 'lyrics') return;
    const t = inJam() ? view.jam.cur && view.jam.cur.t : tick && tick.t;
    if (!t || !t.id || asked.has(t.id)) return;
    if (asked.size > 300) asked.clear();
    asked.add(t.id);
    UI.setLyrics(t.id, 'loading');
    send({ type: 'lyrics', t });
  }

  function onPort(m) {
    if (m.type === 'view') {
      const prev = view;
      view = m.view;
      if (optimistic && view.jam && view.jam.v === optimistic.v && Date.now() < optimistic.until) {
        for (const o of optimistic.list) local(o, view.jam);
      } else {
        optimistic = null;
      }
      memberToasts(prev, view);
      if (inJam()) wantLyrics();
      UI.update(view);
      const on = active();
      if (on !== jamFlag) {
        jamFlag = on;
        toPage({ c: 'jam', on });
        if (!on) setRate(1);
      }
      if (on && tick) sync();
    } else if (m.type === 'toast') {
      if (m.key === 'noPerm') denied();
      else showToast(m);
    } else if (m.type === 'recs') {
      toPage({ c: 'recs', seeds: m.seeds, exclude: m.exclude, taste: m.taste });
    } else if (m.type === 'lyrics') {
      UI.setLyrics(m.id, { synced: m.synced, plain: m.plain });
    } else if (m.type === 'stats') {
      UI.setStats(m);
    } else if (m.type === 'statsExport') {
      const blob = new Blob([JSON.stringify(m.data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'chorus-stats-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } else if (m.type === 'css') {
      cssDone = true;
      UI.setCss(m.text);
    } else if (m.type === 'react') {
      UI.react(m.e, m.who, view && view.me && m.who && m.who.id === view.me.id);
    }
  }

  function memberToasts(prev, next) {
    const a = prev && prev.jam && prev.jam.members;
    const b = next.jam && next.jam.members;
    if (!a || !b || prev.jam.id !== next.jam.id) return;
    const self = next.me && next.me.id;
    for (const id in b) if (!a[id] && id !== self) UI.toast(tr('joined', { name: b[id].name }), { who: b[id] });
    for (const id in a) if (!b[id] && id !== self) UI.toast(tr('left', { name: a[id].name }), { who: a[id] });
  }

  function showToast(m) {
    const who = m.who || { name: '?' };
    const name = who.name || '?';
    if (m.key === 'invited' || m.key === 'knocked') {
      UI.toast(tr(m.key, { name }), {
        who,
        ttl: 30000,
        actions: [
          { label: tr('accept'), primary: true, run: () => send({ type: 'answer', id: who.id, yes: true }) },
          { label: tr('decline'), run: () => send({ type: 'answer', id: who.id, yes: false }) }
        ]
      });
    } else if (m.key === 'reqIn') {
      UI.toast(tr('reqIn', { name }), {
        who,
        ttl: 30000,
        actions: [
          { label: tr('accept'), primary: true, run: () => send({ type: 'friendAnswer', id: who.id, yes: true }) },
          { label: tr('decline'), run: () => send({ type: 'friendAnswer', id: who.id, yes: false }) }
        ]
      });
    } else if (m.key === 'dm' || m.key === 'chat') {
      const text = String(m.text || '');
      UI.toast(`${name}: ${text.length > 80 ? text.slice(0, 79) + '…' : text}`, {
        who,
        ttl: 6000,
        actions: [{ label: tr('reply'), primary: true, run: () => UI.open('thread', m.thread) }]
      });
    } else if (m.who) {
      UI.toast(tr(m.key, { name }), { who });
    } else {
      UI.toast(tr(m.key));
    }
  }

  function reportNp() {
    const t = tick;
    const key = (t.t ? t.t.id : '') + ':' + t.playing;
    const now = Date.now();
    if (key === npKey && now - npAt < 3000) return;
    npKey = key;
    npAt = now;
    send({ type: 'np', np: { t: t.t, playing: t.playing, pos: t.pos, ts: t.ts } });
  }

  function detect() {
    const p = prevTick;
    const t = tick;
    const s = view.jam;
    const now = Date.now();
    if (!p || now - lastCmd < 1500) return false;
    if (t.t && t.t.url && (!p.t || p.t.id !== t.t.id)) {
      if (s.cur && t.t.id === s.cur.t.id) return false;
      if (now - (requested.get(t.t.id) || 0) < 10000) return false;
      if (pendingNow && pendingNow.id === t.t.id) return true;
      if (p.t && p.t.dur && p.pos >= p.t.dur - 2500) return false;
      const can = perms();
      if ((s.mode === 'queue' && s.cur && !s.ended) || !can.ctl) {
        const opened = t.t;
        if (!can.add) {
          denied();
          return false;
        }
        send({ type: 'op', op: { k: 'add', t: opened } });
        UI.toast(tr('queuedOpen', { title: opened.title }), {
          track: opened,
          ttl: 6000,
          actions: can.ctl ? [{ label: tr('playNow'), primary: true, run: () => op({ k: 'now', t: opened }) }] : []
        });
        return false;
      }
      pendingNow = { id: t.t.id, at: now };
      op({ k: 'now', t: t.t, pos: t.pos, at: hostNow() }, true);
      return true;
    }
    if (t.ad || p.ad || now - adAt < 2500) return false;
    if (s.cur && t.t && p.t && t.t.id === s.cur.t.id && p.t.id === t.t.id && p.playing !== t.playing) {
      if (t.fin || p.fin || startTimer || now - changedAt < 3000 || (t.t.dur && t.pos >= t.t.dur - 2000)) return false;
      const want = s.playing && !s.ended && target(s) >= 0;
      if (t.playing !== want) {
        if (!perms().ctl) {
          denied();
          return false;
        }
        op(t.playing ? { k: 'play', pos: t.pos, at: hostNow() } : { k: 'pause', pos: t.pos, at: hostNow() }, true);
        return true;
      }
    }
    return false;
  }

  function schedule(ms) {
    const at = Date.now() + ms;
    if (startTimer && Math.abs(startFor - at) < 15) return;
    clearTimeout(startTimer);
    startFor = at;
    startTimer = setTimeout(() => {
      startTimer = 0;
      if (active()) cmd({ c: 'play' });
    }, ms);
  }

  function sync() {
    const s = view.jam;
    const t = tick;
    const now = Date.now();
    if (hold) {
      if (s.v === hold.v && now - hold.at < 2000) return;
      hold = null;
    }
    if (pendingNow) {
      if ((s.cur && s.cur.t.id === pendingNow.id) || now - pendingNow.at > 4000) pendingNow = null;
      else return;
    }
    const cur = s.cur;
    if (!cur || t.ad || now - adAt < 1200) {
      setRate(1);
      if (t.ad && t.adPaused && s.playing && !s.ended && now - adKick > 4000) {
        adKick = now;
        cmd({ c: 'adplay' });
      }
      return;
    }
    const want = target(s);
    const dur = cur.t.dur || Infinity;
    const a = t.t;
    if (!a || a.id !== cur.t.id) {
      setRate(1);
      if (s.playing && !s.ended && want >= dur - 2500) {
        if (a && t.playing && now - lastCmd > 1000) cmd({ c: 'pause' });
        return;
      }
      if (loading && loading.id === cur.t.id && now - loading.at < 8000) return;
      loading = { id: cur.t.id, at: now };
      requested.set(cur.t.id, now);
      if (requested.size > 50) requested.delete(requested.keys().next().value);
      const live = s.playing && !s.ended;
      const wait = live ? s.at - (now + (s.skew || 0)) : 0;
      cmd({ c: 'load', url: cur.t.url, pos: Math.max(0, live && wait <= 0 ? want : s.pos), live: live && wait <= 0, sent: now, play: live && wait <= 150 });
      return;
    }
    loading = null;
    if (t.fin) {
      setRate(1);
      return;
    }
    const apos = t.playing && !t.buf ? t.pos + (now - t.ts) : t.pos;
    if (s.playing && !s.ended) {
      if (want >= dur - 150) {
        setRate(1);
        return;
      }
      const wait = s.at - (now + (s.skew || 0));
      if (wait > 0) {
        setRate(1);
        if (t.playing && now - lastCmd > 300) cmd({ c: 'pause' });
        if (Math.abs(t.pos - s.pos) > 120 && now - lastCmd > 300) cmd({ c: 'seek', ms: s.pos });
        schedule(Math.max(0, wait - PLAY_LAG));
        return;
      }
      if (!t.playing) {
        if (startTimer) return;
        if (now - lastCmd > 700) {
          cmd({ c: 'seek', ms: want + 120 });
          cmd({ c: 'play' });
        }
        return;
      }
      if (t.buf) return;
      const drift = apos - want;
      if (Math.abs(drift) > 300) {
        setRate(1);
        if (now - lastCmd > 1200) cmd({ c: 'seek', ms: want + 60 });
        return;
      }
      setRate(Math.abs(drift) < 15 ? 1 : Math.max(0.96, Math.min(1.04, 1 - drift / 3000)));
    } else {
      setRate(1);
      clearTimeout(startTimer);
      startTimer = 0;
      if (t.playing && now - lastCmd > 400) cmd({ c: 'pause' });
      if (!t.playing && Math.abs(t.pos - s.pos) > 150 && now - lastCmd > 600) cmd({ c: 'seek', ms: s.pos });
    }
  }

  const listen = { id: null, t: null, ms: 0, total: 0, played: false, pending: false, lastAt: 0, sentAt: 0, lastPos: 0, ended: false, jam: false };

  function flushListen(force) {
    if (!listen.t || (!listen.ms && !listen.pending)) return;
    if (!force && !listen.pending && Date.now() - listen.sentAt < 15000) return;
    send({ type: 'listen', t: listen.t, ms: Math.round(listen.ms), play: listen.pending });
    listen.ms = 0;
    listen.pending = false;
    listen.sentAt = Date.now();
  }

  function trackListen(m) {
    const now = Date.now();
    const id = m.t ? m.t.id : null;
    if (id !== listen.id) {
      if (listen.t && !listen.played && !listen.ended && !listen.jam && listen.t.dur > 60000 && listen.total > 2000 && listen.total < 30000) send({ type: 'skip', t: listen.t });
      flushListen(true);
      Object.assign(listen, { id, t: m.t && m.t.url ? m.t : null, ms: 0, total: 0, played: false, pending: false, lastAt: now, lastPos: m.pos, ended: false, jam: inJam() });
    } else if (listen.played && m.pos < 5000 && listen.lastPos > m.pos + 20000) {
      flushListen(true);
      listen.total = 0;
      listen.played = false;
    }
    if (m.t && m.t.dur && m.pos >= m.t.dur - 8000) listen.ended = true;
    if (inJam()) listen.jam = true;
    if (m.playing && !m.buf && listen.t) {
      const d = Math.min(1000, now - listen.lastAt);
      if (d > 0) {
        listen.ms += d;
        listen.total += d;
      }
      if (!listen.played && listen.total >= 30000) {
        listen.played = true;
        listen.pending = true;
      }
    }
    listen.lastAt = now;
    listen.lastPos = m.pos;
    flushListen(false);
  }

  function sleepCheck(m) {
    const z = UI.sleep;
    if (!z) return;
    const now = Date.now();
    let fire = false;
    if (z.at && now >= z.at) fire = true;
    if (z.end) {
      if (!z.id && m.t) z.id = m.t.id;
      if (z.id && m.t && m.t.id !== z.id) fire = true;
      if (m.t && m.t.dur && m.t.id === z.id && m.pos >= m.t.dur - 1500) fire = true;
    }
    if (!fire) return;
    UI.sleep = null;
    if (inJam()) send({ type: 'leave' });
    setRate(1);
    cmd({ c: 'pause' });
    UI.toast(tr('sleepDone'));
    UI.render();
  }

  window.addEventListener('pagehide', () => flushListen(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushListen(true);
  });

  function onTick(m) {
    prevTick = tick;
    tick = m;
    if (m.ad || (prevTick && prevTick.ad)) adAt = Date.now();
    if (m.ad && active() && Date.now() - adToast > 60000) {
      adToast = Date.now();
      UI.toast(tr('adWait'));
    }
    trackListen(m);
    sleepCheck(m);
    if ((prevTick && prevTick.t && prevTick.t.id) !== (m.t && m.t.id)) {
      changedAt = Date.now();
      if (!inJam()) wantLyrics();
    }
    UI.solo(m);
    wantLyrics();
    reportNp();
    if (!active()) {
      if (rate !== 1) setRate(1);
      return;
    }
    const s = view.jam;
    if (m.fin && !(prevTick && prevTick.fin) && s.cur && m.t && s.cur.t.id === m.t.id && s.playing && !s.ended) send({ type: 'op', op: { k: 'ended', id: m.t.id } });
    if (detect()) return;
    sync();
  }

  function onUp(m) {
    if (!m || typeof m.ev !== 'string') return;
    switch (m.ev) {
      case 'tick':
        onTick(m);
        break;
      case 'useek': {
        const s = active() && view.jam;
        if (s && !s.can.ctl) break;
        if (typeof m.ms !== 'number' || !Number.isFinite(m.ms) || m.ms < 0) break;
        if (s && s.cur && s.cur.t.id === m.id && Date.now() - lastCmd > 800 && Date.now() - changedAt > 1500) op({ k: 'seek', pos: m.ms, at: hostNow() }, true);
        break;
      }
      case 'ukey':
        if (active() && (m.a === 'next' || m.a === 'prev')) op({ k: m.a });
        break;
      case 'ctx': {
        const s = active() && view.jam;
        if (s && s.can.ctl && s.mode !== 'queue' && Array.isArray(m.list) && m.list.length && ((s.cur && s.cur.t.id === m.id) || (pendingNow && pendingNow.id === m.id))) {
          send({ type: 'op', op: { k: 'ctx', for: m.id, title: m.title, url: m.url, ts: m.list } });
        }
        break;
      }
      case 'recs':
        if (Array.isArray(m.list)) send({ type: 'recs', ts: m.list });
        break;
      case 'bad': {
        const s = active() && view.jam;
        if (s && s.cur && s.cur.t.url === m.url && s.playing && !s.ended) send({ type: 'op', op: { k: 'ended', id: s.cur.t.id, bad: true } });
        break;
      }
      case 'res': {
        const w = waiters.get(m.rid);
        if (w) {
          waiters.delete(m.rid);
          w(m.err ? null : m);
        }
        break;
      }
    }
  }

  if (pagePort) pagePort.onmessage = e => onUp(e.data);

  const SKIP = '.ytmusicPlayerControlsNextButton, .ytmusicPlayerControlsPreviousButton, ytmusic-player-bar .next-button, ytmusic-player-bar .previous-button';
  const NEXT = '.ytmusicPlayerControlsNextButton, ytmusic-player-bar .next-button';

  function skipGuard(e) {
    if (!active() || !e.isTrusted || !(e.target instanceof Element)) return;
    const b = e.target.closest(SKIP);
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'pointerup' || (e.type === 'click' && e.detail === 0)) op({ k: b.matches(NEXT) ? 'next' : 'prev' });
  }

  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click']) window.addEventListener(type, skipGuard, true);

  async function add(d) {
    const r = await resolve(d.ref);
    if (!r || (!(r.t && typeof r.t === 'object') && !(Array.isArray(r.list) && r.list.length && r.list[0] && typeof r.list[0] === 'object'))) {
      UI.toast(tr('cantAdd'));
      return;
    }
    let o;
    let msg;
    if (inJam() && !perms().add) {
      denied();
      return;
    }
    if (inJam() && d.mode !== 'end' && !perms().ctl) d = { ...d, mode: 'end' };
    if (r.list && d.mode === 'now') {
      o = { k: 'context', title: r.title, url: r.url, ts: r.list };
      msg = tr('playingNow', { title: r.title || r.list[0].title });
    } else if (r.list) {
      o = { k: 'addMany', ts: r.list, next: d.mode === 'next' };
      msg = tr('addedMany', { n: r.list.length });
    } else if (d.mode === 'now') {
      o = { k: 'now', t: r.t };
      msg = tr('playingNow', { title: r.t.title });
    } else {
      o = { k: 'add', t: r.t, next: d.mode === 'next' };
      msg = tr(d.mode === 'next' ? 'addedNext' : 'added');
    }
    if (inJam()) send({ type: 'op', op: stamp(o) });
    else {
      send({ type: 'start', op: o });
      UI.goTab('jam');
    }
    UI.toast(msg, { track: r.t || r.list[0] });
  }

  UI.onAction = (act, d) => {
    const s = inJam() ? view.jam : null;
    const member = id => (s && s.members[id]) || null;
    const flip = (cur, mode) => {
      const next = { add: !!cur.add, ctl: !!cur.ctl };
      if (mode === 'ctl') {
        next.ctl = !next.ctl;
        if (next.ctl) next.add = true;
      } else {
        next.add = !next.add;
        if (!next.add) next.ctl = false;
      }
      return next;
    };
    switch (act) {
      case 'invite':
      case 'knock':
      case 'friendAdd':
      case 'friendCancel':
      case 'friendRemove':
      case 'kick':
      case 'makeHost':
        if (typeof d.id === 'string') send({ type: act, id: d.id });
        break;
      case 'answer':
      case 'friendAnswer':
        send({ type: act, id: d.id, yes: d.yes });
        break;
      case 'start':
      case 'resetCard':
      case 'newCode':
        send({ type: act });
        break;
      case 'leave':
        send({ type: 'leave' });
        setRate(1);
        UI.page = null;
        UI.render();
        break;
      case 'claim':
        send({ type: 'claim' });
        break;
      case 'thread':
        send({ type: 'thread', id: d.id || null, open: !!d.open });
        break;
      case 'chat':
        send({ type: 'chat', thread: d.id, text: d.value });
        break;
      case 'friendCode':
        send({ type: 'friendCode', code: d.value });
        break;
      case 'toggle':
        if (s) op(s.playing && !s.ended ? { k: 'pause' } : { k: 'play' });
        break;
      case 'next':
      case 'prev':
        if (s) op({ k: act });
        break;
      case 'clear':
        if (s) op({ k: 'clear', which: d.mode === 'ctx' ? 'ctx' : 'queue' });
        break;
      case 'line':
        if (typeof d.ms !== 'number') break;
        if (s && s.cur) op({ k: 'seek', pos: Math.max(0, d.ms - 300) });
        else if (!s) cmd({ c: 'seek', ms: Math.max(0, d.ms - 300) });
        break;
      case 'seekTo':
        if (s && s.cur && s.cur.t.dur) op({ k: 'seek', pos: Math.round(d.ratio * s.cur.t.dur) });
        break;
      case 'mode':
        if (s) op({ k: 'mode', mode: d.mode });
        break;
      case 'radio':
        if (s) op({ k: 'radio', on: s.radio === false });
        break;
      case 'perm': {
        const m = member(d.id);
        if (m) op({ k: 'perm', id: d.id, ...flip(m, d.mode) });
        break;
      }
      case 'defperm':
        if (s) op({ k: 'perm', ...flip(s.perms, d.mode) });
        break;
      case 'lock':
        if (s) op({ k: 'lock', on: !s.locked });
        break;
      case 'pref':
        if (view && ['share', 'open', 'record', 'shareStats'].includes(d.mode)) send({ type: 'prefs', prefs: { [d.mode]: !view.prefs[d.mode] } });
        break;
      case 'recapSeen':
        send({ type: 'prefs', prefs: { recapSeen: d.year } });
        break;
      case 'stats':
        send({ type: 'stats', who: d.who || null, period: d.period, year: d.year, req: d.req });
        break;
      case 'statsClear':
      case 'statsExport':
        send({ type: act });
        break;
      case 'sleep': {
        const mins = { 15: 15, 30: 30, 60: 60 }[d.mode];
        if (mins) UI.sleep = { mode: d.mode, at: Date.now() + mins * 60000 };
        else if (d.mode === 'end') UI.sleep = { mode: 'end', end: true, id: tick && tick.t ? tick.t.id : null };
        else UI.sleep = null;
        break;
      }
      case 'jump':
      case 'remove':
      case 'promote':
        op({ k: act, qid: d.qid });
        break;
      case 'move':
        op({ k: 'move', qid: d.qid, to: d.to });
        break;
      case 'react':
        if (s) send({ type: 'react', e: d.mode });
        break;
      case 'nick':
        send({ type: 'nick', nick: d.value });
        break;
      case 'joincode':
        send({ type: 'joinCode', code: d.value });
        break;
      case 'add':
        add(d);
        break;
      case 'pick':
        ask({ c: 'pick', mark: d.mark }, 3000).then(r => UI.picked(d.mark, r && r.item && r.item.ref ? r.item : null));
        break;
      case 'nav':
        toPage({ c: 'nav', path: d.path });
        break;
      case 'menu':
        toPage({ c: 'menu', close: !!d.close });
        break;
    }
  };

  UI.init();
  connect();
  setInterval(() => send({ type: 'beat' }), 20000);
})();
