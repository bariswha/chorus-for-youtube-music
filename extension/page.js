(() => {
  const ORIGIN = 'https://music.youtube.com/';
  const VID = /^[A-Za-z0-9_-]{11}$/;
  const LIST = /^[A-Za-z0-9_-]{2,80}$/;
  const PATH = /^\/(?:watch\?v=([A-Za-z0-9_-]{11})(?:&list=([A-Za-z0-9_-]{2,80}))?|playlist\?list=([A-Za-z0-9_-]{2,80})|(?:browse|channel)\/([A-Za-z0-9_-]{2,80}))$/;
  let port = null;
  let jamOn = false;
  let rate = 1;
  let quietUntil = 0;
  let lastId = null;
  let ctxFor = null;
  let finished = null;

  const getter = (proto, key) => Object.getOwnPropertyDescriptor(proto, key).get;
  const evData = getter(MessageEvent.prototype, 'data');
  const evPorts = getter(MessageEvent.prototype, 'ports');
  const evSource = getter(MessageEvent.prototype, 'source');
  const stopNow = Event.prototype.stopImmediatePropagation;
  const listen = EventTarget.prototype.addEventListener;
  const portPost = MessagePort.prototype.postMessage;
  const portStart = MessagePort.prototype.start;
  const self = window;
  const up = m => {
    if (port) portPost.call(port, m);
  };

  listen.call(
    window,
    'message',
    e => {
      if (port || evSource.call(e) !== self) return;
      const d = evData.call(e);
      const ports = evPorts.call(e);
      if (!d || d.__chorusBridge !== 1 || !ports || !ports[0]) return;
      stopNow.call(e);
      port = ports[0];
      listen.call(port, 'message', ev => onDown(evData.call(ev)));
      portStart.call(port);
    },
    true
  );

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const hush = (ms = 1200) => {
    quietUntil = Math.max(quietUntil, Date.now() + ms);
  };
  const quiet = () => Date.now() < quietUntil;

  const session = navigator.mediaSession;
  if (session && session.setActionHandler) {
    const set0 = session.setActionHandler.bind(session);
    session.setActionHandler = (action, fn) => {
      if (fn && (action === 'nexttrack' || action === 'previoustrack')) {
        const orig = fn;
        fn = d => (jamOn ? up({ ev: 'ukey', a: action === 'nexttrack' ? 'next' : 'prev' }) : orig(d));
      }
      return set0(action, fn);
    };
  }

  function player() {
    const p = document.getElementById('movie_player');
    return p && typeof p.getVideoData === 'function' && typeof p.getPlayerState === 'function' && typeof p.seekTo === 'function' ? p : null;
  }

  function media(p) {
    return p ? p.querySelector('video') : null;
  }

  function isAd(p) {
    return !!p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'));
  }

  function curId(p) {
    try {
      const d = p && p.getVideoData();
      return d && VID.test(d.video_id || '') ? d.video_id : '';
    } catch {
      return '';
    }
  }

  function watch(id) {
    return ORIGIN + 'watch?v=' + id;
  }

  function art(thumbs, id) {
    const list = Array.isArray(thumbs) ? thumbs : [];
    for (const x of list) {
      const u = String((x && x.url) || '');
      const m = /^https:\/\/((?:lh3|yt3)\.googleusercontent\.com\/[A-Za-z0-9_-]{16,360})(?:=[^?#]*)?$/.exec(u);
      if (m) return 'https://' + m[1] + '=w226-h226-l90-rj';
    }
    return VID.test(id || '') ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : '';
  }

  function runs(x) {
    if (!x) return '';
    if (typeof x.simpleText === 'string') return x.simpleText;
    return Array.isArray(x.runs) ? x.runs.map(r => (r && typeof r.text === 'string' ? r.text : '')).join('') : '';
  }

  function artistOf(s) {
    return String(s || '')
      .split(' • ')[0]
      .replace(/\s+-\s+Topic$/i, '')
      .trim();
  }

  function clockMs(s) {
    const parts = String(s || '')
      .trim()
      .split(':')
      .map(Number);
    if (!parts.length || parts.length > 3 || parts.some(n => !Number.isFinite(n))) return 0;
    return parts.reduce((a, n) => a * 60 + n, 0) * 1000;
  }

  function desc(p) {
    try {
      const id = curId(p);
      if (!id) return null;
      const d = p.getVideoData();
      const r = p.getPlayerResponse();
      const vd = r && r.videoDetails;
      if (!vd || vd.videoId !== id || vd.isPrivate === true || /PRIVATELY_OWNED/.test(String(vd.musicVideoType || ''))) return null;
      let dur = (Number(vd.lengthSeconds) || 0) * 1000;
      const pd = p.getDuration();
      if (!isAd(p) && pd > 0) dur = Math.round(pd * 1000);
      return { id, url: watch(id), title: String(d.title || ''), artist: artistOf(d.author), art: art(vd.thumbnail && vd.thumbnail.thumbnails, id), dur, genre: '' };
    } catch {
      return null;
    }
  }

  function fromPanel(v) {
    if (!v || !VID.test(v.videoId || '')) return null;
    return {
      id: v.videoId,
      url: watch(v.videoId),
      title: runs(v.title),
      artist: artistOf(runs(v.shortBylineText) || runs(v.longBylineText)),
      art: art(v.thumbnail && v.thumbnail.thumbnails, v.videoId),
      dur: clockMs(runs(v.lengthText)),
      genre: ''
    };
  }

  function collect(root, key, max) {
    const out = [];
    const seen = new Set();
    const walk = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 40 || out.length >= max || seen.has(o)) return;
      seen.add(o);
      if (o[key]) {
        out.push(o[key]);
        return;
      }
      for (const k in o) walk(o[k], depth + 1);
    };
    walk(root, 0);
    return out;
  }

  async function api(body) {
    const cfg = window.ytcfg && typeof window.ytcfg.get === 'function' ? window.ytcfg : null;
    const ctx = cfg && cfg.get('INNERTUBE_CONTEXT');
    const client = ctx && ctx.client;
    if (!client || !client.clientName || !client.clientVersion) throw new Error('client');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch('/youtubei/v1/next?prettyPrint=false', {
        method: 'POST',
        credentials: 'omit',
        signal: ctl.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context: { client: { clientName: String(client.clientName), clientVersion: String(client.clientVersion), hl: 'en' } }, ...body })
      });
      if (!r.ok) throw new Error('http ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function panel(body, max) {
    const j = await api(body);
    const list = collect(j, 'playlistPanelVideoRenderer', max).map(fromPanel).filter(Boolean);
    const head = collect(j, 'playlistPanelRenderer', 1)[0];
    return { list, title: head ? runs(head.title) : '' };
  }

  async function resolve(ref) {
    ref = ref && typeof ref === 'object' ? ref : {};
    if (typeof ref.v === 'string' && VID.test(ref.v)) {
      const p = player();
      if (curId(p) === ref.v && !isAd(p)) return { t: desc(p) };
      const { list } = await panel({ videoId: ref.v }, 30);
      const t = list.find(x => x.id === ref.v);
      if (!t) throw new Error('track');
      return { t };
    }
    if (typeof ref.list === 'string' && LIST.test(ref.list)) {
      const { list, title } = await panel({ playlistId: ref.list }, 200);
      const seen = new Set();
      const uniq = list.filter(x => !seen.has(x.id) && seen.add(x.id)).slice(0, 150);
      if (!uniq.length) throw new Error('empty');
      return { title, url: ORIGIN + 'playlist?list=' + ref.list, list: uniq };
    }
    throw new Error('ref');
  }

  function firstWatch(o) {
    for (const w of collect(o, 'watchEndpoint', 6)) if (w && VID.test(w.videoId || '')) return w.videoId;
    return '';
  }

  function firstList(o) {
    for (const w of collect(o, 'watchPlaylistEndpoint', 6)) if (w && LIST.test(w.playlistId || '') && !/^RD/.test(w.playlistId)) return w.playlistId;
    return '';
  }

  function pick(mark) {
    if (typeof mark !== 'string' || !/^[a-z0-9]{1,12}$/.test(mark)) return null;
    const el = document.querySelector(`[data-chorus-pick="${mark}"]`);
    if (!el) return null;
    const tag = el.tagName.toLowerCase();
    if (tag === 'ytmusic-miniplayer' || tag === 'ytmusic-player-bar') {
      const id = curId(player());
      return id ? { kind: 'track', ref: { v: id } } : null;
    }
    const d = el.data;
    if (!d || typeof d !== 'object') return null;
    if (tag === 'ytmusic-responsive-header-renderer' || tag === 'ytmusic-detail-header-renderer') {
      const list = firstList(d);
      return list ? { kind: 'set', ref: { list } } : null;
    }
    const nav = d.navigationEndpoint || {};
    const browse = nav.browseEndpoint;
    if (browse) {
      const cfg = browse.browseEndpointContextSupportedConfigs && browse.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig;
      const type = (cfg && cfg.pageType) || '';
      if (!/ALBUM|PLAYLIST/.test(type)) return null;
      let list = firstList(d.thumbnailOverlay || d.overlay || {}) || firstList(d);
      if (!list && /^VL[A-Za-z0-9_-]{2,80}$/.test(browse.browseId || '')) list = browse.browseId.slice(2);
      return list ? { kind: 'set', ref: { list } } : null;
    }
    const v = (d.playlistItemData && d.playlistItemData.videoId) || d.videoId || (nav.watchEndpoint && nav.watchEndpoint.videoId) || firstWatch(d.overlay) || firstWatch(d.flexColumns) || firstWatch(d.thumbnailOverlay);
    return typeof v === 'string' && VID.test(v) ? { kind: 'track', ref: { v } } : null;
  }

  function go(endpoint) {
    const app = document.querySelector('ytmusic-app');
    if (!app) return false;
    app.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint } }));
    return true;
  }

  function nav(path) {
    const m = typeof path === 'string' ? PATH.exec(path) : null;
    if (!m) return;
    if (m[1]) go({ watchEndpoint: m[2] ? { videoId: m[1], playlistId: m[2] } : { videoId: m[1] } });
    else if (m[3]) go({ browseEndpoint: { browseId: 'VL' + m[3] } });
    else go({ browseEndpoint: { browseId: m[4] } });
  }

  async function context(t) {
    let list = '';
    try {
      list = new URLSearchParams(location.search).get('list') || '';
    } catch {}
    if (!LIST.test(list) || /^RD/.test(list) || new URLSearchParams(location.search).get('v') !== t.id) return;
    const { list: items, title } = await panel({ videoId: t.id, playlistId: list }, 220);
    const i = items.findIndex(x => x.id === t.id);
    if (i < 0) return;
    const rest = items.slice(i + 1, i + 151);
    if (!rest.length) return;
    up({ ev: 'ctx', id: t.id, title, url: ORIGIN + 'playlist?list=' + list, list: rest });
  }

  function script(text) {
    if (/[ğüşıöçĞÜŞİÖÇ]/.test(text)) return 'tr';
    if (/[Ѐ-ӿ]/.test(text)) return 'cyr';
    if (/[؀-ۿ]/.test(text)) return 'ar';
    if (/[぀-ヿ一-鿿가-힯]/.test(text)) return 'cjk';
    return 'lat';
  }

  async function recs(seeds, exclude, taste) {
    seeds = seeds.filter(s => s && VID.test(s.id || '')).slice(-3);
    if (!seeds.length) return [];
    taste = taste && typeof taste === 'object' ? taste : {};
    const weight = (map, k) => (map && typeof map === 'object' && Object.hasOwn(map, k) && typeof map[k] === 'number' && Number.isFinite(map[k]) ? map[k] : 0);
    const love = taste.love;
    const meh = taste.meh;
    const heard = new Set((taste.recent || []).map(String));
    const skip = new Set(exclude.map(String));
    const scripts = new Map();
    const seedArtists = new Set();
    for (const s of seeds) {
      skip.add(String(s.id));
      const sc = script(s.title + ' ' + s.artist);
      scripts.set(sc, (scripts.get(sc) || 0) + 1);
      seedArtists.add(String(s.artist || '').toLowerCase());
    }
    const mainScript = [...scripts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const pool = new Map();
    const lists = await Promise.all(seeds.map(s => panel({ videoId: s.id, playlistId: 'RDAMVM' + s.id }, 60).then(r => r.list, () => [])));
    lists.forEach((list, i) => {
      const weight = 1 + (0.6 * i) / Math.max(1, seeds.length - 1);
      list.forEach((t, rank) => {
        if (skip.has(t.id) || !(t.dur >= 60000 && t.dur <= 12 * 60000)) return;
        const e = pool.get(t.id) || { t, score: 0, hits: 0 };
        e.score += weight * (1 - rank / 70);
        e.hits++;
        pool.set(t.id, e);
      });
    });
    for (const e of pool.values()) {
      const artist = e.t.artist;
      const sc = script(e.t.title + ' ' + artist);
      if (sc === mainScript) e.score += 1;
      else if (mainScript !== 'lat' || sc !== 'lat') e.score -= 1.6;
      if (e.hits > 1) e.score += 0.9 * (e.hits - 1);
      e.score += 1.2 * weight(love, artist) - 0.6 * weight(meh, artist);
      if (seedArtists.has(artist.toLowerCase())) e.score -= 0.4;
      if (heard.has(e.t.id)) e.score -= 2.5;
      e.score += Math.random() * 0.45;
    }
    const ranked = [...pool.values()].sort((x, y) => y.score - x.score);
    const perArtist = new Map();
    const out = [];
    let lastArtist = '';
    while (out.length < 20 && ranked.length) {
      let pickAt = ranked.findIndex((e, i) => i < 12 && e.t.artist !== lastArtist && (perArtist.get(e.t.artist) || 0) < (out.length < 10 ? 1 : 2));
      if (pickAt < 0) pickAt = ranked.findIndex(e => (perArtist.get(e.t.artist) || 0) < 2);
      if (pickAt < 0) break;
      const [e] = ranked.splice(pickAt, 1);
      perArtist.set(e.t.artist, (perArtist.get(e.t.artist) || 0) + 1);
      lastArtist = e.t.artist;
      out.push(e.t);
    }
    return out;
  }

  function playability(p) {
    try {
      const r = p.getPlayerResponse();
      return (r && r.playabilityStatus && r.playabilityStatus.status) || '';
    } catch {
      return '';
    }
  }

  async function load(m) {
    const x = typeof m.url === 'string' ? /^https:\/\/music\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/.exec(m.url) : null;
    if (!x) return;
    const id = x[1];
    if (!player()) return;
    hush(5000);
    if (curId(player()) !== id && !go({ watchEndpoint: { videoId: id } })) return;
    for (let i = 0; i < 240 && curId(player()) !== id; i++) await sleep(50);
    let p = player();
    if (!p || curId(p) !== id) return;
    for (let i = 0; i < 60 && !isAd(p) && !playability(p); i++) {
      await sleep(50);
      p = player();
    }
    const ok = playability(p);
    if (ok && ok !== 'OK') {
      up({ ev: 'bad', url: m.url });
      return;
    }
    if (isAd(p)) return;
    const v = media(p);
    const silent = !m.play && v && !v.muted;
    if (silent) v.muted = true;
    try {
      for (let i = 0; i < 60 && p.getPlayerState() === -1; i++) await sleep(50);
      hush();
      const pos = m.live ? m.pos + (Date.now() - m.sent) + 60 : m.pos;
      if (pos > 300) p.seekTo(pos / 1000, true);
      if (m.play) p.playVideo();
      else {
        p.pauseVideo();
        if (pos <= 300) p.seekTo(0, true);
      }
    } finally {
      if (silent) setTimeout(() => (v.muted = false), 150);
    }
  }

  async function run(m) {
    const p = player();
    if (m.c === 'play' || m.c === 'seek' || m.c === 'load') finished = null;
    switch (m.c) {
      case 'jam':
        jamOn = !!m.on;
        break;
      case 'rate':
        if (typeof m.r !== 'number' || !(m.r >= 0.9 && m.r <= 1.1)) break;
        rate = m.r;
        break;
      case 'play':
        if (!p || isAd(p)) break;
        hush();
        p.playVideo();
        break;
      case 'adplay':
        if (p && isAd(p)) p.playVideo();
        break;
      case 'pause':
        if (!p) break;
        hush();
        p.pauseVideo();
        break;
      case 'seek':
        if (p && !isAd(p) && typeof m.ms === 'number' && Number.isFinite(m.ms)) {
          hush();
          p.seekTo(Math.max(0, m.ms) / 1000, true);
        }
        break;
      case 'load':
        await load(m);
        break;
      case 'resolve':
        up({ ev: 'res', rid: m.rid, ...(await resolve(m.ref)) });
        break;
      case 'pick':
        up({ ev: 'res', rid: m.rid, item: pick(m.mark) });
        break;
      case 'nav':
        nav(m.path);
        break;
      case 'menu':
        for (const dd of document.querySelectorAll('ytmusic-popup-container tp-yt-iron-dropdown')) {
          if (!dd.opened) continue;
          if (m.close && typeof dd.close === 'function') dd.close();
          else if (!m.close && typeof dd.refit === 'function') dd.refit();
        }
        break;
      case 'recs':
        up({ ev: 'recs', list: await recs(Array.isArray(m.seeds) ? m.seeds : [], Array.isArray(m.exclude) ? m.exclude : [], m.taste) });
        break;
    }
  }

  function onDown(m) {
    if (!m || typeof m.c !== 'string') return;
    run(m).catch(err => {
      if (m.rid) up({ ev: 'res', rid: m.rid, err: String((err && err.message) || err) });
    });
  }

  document.addEventListener(
    'seeked',
    e => {
      const p = player();
      if (!jamOn || quiet() || !p || e.target !== media(p) || isAd(p)) return;
      const id = curId(p);
      const ms = Math.round(p.getCurrentTime() * 1000);
      if (id && ms > 0) up({ ev: 'useek', ms, id });
    },
    true
  );

  setInterval(() => {
    const p = player();
    if (!p) {
      up({ ev: 'tick', ts: Date.now(), t: null, playing: false, pos: 0, buf: false, ad: false, adPaused: false, fin: false });
      return;
    }
    const ad = isAd(p);
    const t = desc(p);
    let st = -1;
    let pos = 0;
    try {
      st = p.getPlayerState();
      pos = Math.round((p.getCurrentTime() || 0) * 1000);
    } catch {}
    const v = media(p);
    const want = ad ? 1 : rate;
    if (v && v.playbackRate !== want) v.playbackRate = want;
    if (jamOn && t && !ad && st === 1 && t.dur && pos >= t.dur - 350) {
      finished = t.id;
      hush();
      p.pauseVideo();
    }
    if (t && t.id !== lastId) {
      lastId = t.id;
      ctxFor = t.id;
    }
    if (ctxFor && t && t.id === ctxFor && !quiet()) {
      ctxFor = null;
      context(t).catch(() => {});
    }
    up({ ev: 'tick', ts: Date.now(), t, playing: !ad && (st === 1 || st === 3), pos, buf: !ad && st === 3, ad, adPaused: ad && !!v && v.paused, fin: !!t && finished === t.id });
  }, 200);
})();
