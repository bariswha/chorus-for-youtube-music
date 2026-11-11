import { Mqtt, sha, keyFrom, seal, open, makeIdentity, loadSign, loadDh, idOf, sign, verify, sealTo, openBox, isKey, isCode, hashCode, rid } from './net.js';
import { lyricsFor } from './lyrics.js';
import { obj, str, num, ytUrl, cleanText, whoOf, track } from './clean.js';
import * as Stats from './stats.js';

const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
const NS = 'chorus-ytm/1/';
const LEAD = 700;
const REACTIONS = ['❤️', '🔥', '😂', '🥹', '🎉'];
const CLOCK_WINDOW = 600000;
const PRESENCE_TTL = 75000;
const TR = (chrome.i18n.getUILanguage() || '').toLowerCase().startsWith('tr');

const ports = new Map();
const routes = new Map();
const invites = new Map();
const knocks = new Set();
const live = new Map();
const watching = new Map();
const nonces = new Map();
const buckets = new Map();
const pendingOps = new Map();
const doneOps = [];
const memo = new Map();

let me = null;
let meReady = null;
let net = null;
let connecting = null;
let jam = null;
let restored = null;
let driver = null;
let friends = {};
let requests = {};
let prefs = { share: true, open: false, record: true, shareStats: false, recapSeen: 0 };
const statsWait = new Map();
const statsCache = new Map();
let presence = null;
let card = null;
let nonceTimer = 0;
let dms = {};
let unread = {};
let idleSince = 0;
let waitEnd = 0;
let beat = 0;
let pushQueued = false;
let echo = 0;
let recsAt = 0;
let dmTimer = 0;
let presTimer = 0;

function limit(key, max, per) {
  const now = Date.now();
  const b = buckets.get(key) || { n: 0, at: now };
  if (now - b.at > per) {
    b.n = 0;
    b.at = now;
  }
  b.n++;
  buckets.set(key, b);
  if (buckets.size > 500) buckets.delete(buckets.keys().next().value);
  return b.n <= max;
}

function fresh(nonce) {
  if (typeof nonce !== 'string' || nonce.length < 8 || nonce.length > 40 || nonces.has(nonce)) return false;
  nonces.set(nonce, Date.now());
  clearTimeout(nonceTimer);
  nonceTimer = setTimeout(() => chrome.storage.session.set({ nonces: [...nonces].slice(-1500) }).catch(() => {}), 300);
  if (nonces.size > 2000) {
    const cut = Date.now() - CLOCK_WINDOW * 2;
    for (const [k, t] of nonces) if (t < cut || nonces.size > 1500) nonces.delete(k);
  }
  return true;
}

async function cached(key, make) {
  if (!memo.has(key)) {
    if (memo.size > 400) memo.clear();
    memo.set(key, await make());
  }
  return memo.get(key);
}

function inboxTopic(id) {
  return cached('i:' + id, async () => NS + 'i/' + (await sha('chorus-inbox:' + id)).slice(0, 32));
}

function presTarget(id, secret) {
  return cached('p:' + id + ':' + secret, async () => ({
    topic: NS + 'p/' + (await sha('chorus-presence:' + id + ':' + secret)).slice(0, 32),
    key: await keyFrom('chorus-presence:' + id + ':' + secret, 'presence')
  }));
}

function jamTarget(id, secret) {
  return cached('j:' + id + ':' + secret, async () => ({
    topic: NS + 'j/' + (await sha('chorus-jam:' + id + ':' + secret)).slice(0, 32),
    key: await keyFrom('chorus-jam:' + secret + ':' + id, 'jam')
  }));
}

function cardTarget(code) {
  return cached('c:' + code, async () => ({
    topic: NS + 'c/' + (await sha('chorus-cardtopic:' + code)).slice(0, 32),
    key: await keyFrom('chorus-cardkey:' + code, 'card')
  }));
}

async function codeOf(sk, dk, salt) {
  return hashCode(await sha('chorus-card:' + sk + '.' + dk + '.' + salt), 12);
}

function store(o) {
  chrome.storage.local.set(o).catch(() => {});
}

function saveFriends() {
  store({ friends });
}

function saveRequests() {
  store({ requests });
}

function saveDms() {
  clearTimeout(dmTimer);
  dmTimer = setTimeout(() => store({ dms, unread }), 400);
}

function identity() {
  if (!meReady) {
    meReady = (async () => {
      const st = await chrome.storage.local.get(null);
      let ident = st.ident;
      if (!ident || !isKey(ident.sk) || !isKey(ident.dk) || !ident.sPriv || !ident.dPriv) {
        ident = await makeIdentity();
        await chrome.storage.local.set({ ident });
      }
      chrome.storage.local.remove(['id', 'key', 'room']).catch(() => {});
      me = {
        id: await idOf(ident.sk, ident.dk),
        sk: ident.sk,
        dk: ident.dk,
        sPriv: await loadSign(ident.sPriv),
        dPriv: await loadDh(ident.dPriv),
        nick: cleanText(st.nick).slice(0, 32)
      };
      friends = obj(st.friends);
      requests = obj(st.requests);
      dms = obj(st.dms);
      unread = obj(st.unread);
      prefs = { share: true, open: false, record: true, shareStats: false, recapSeen: 0, ...obj(st.prefs) };
      await Stats.load();
      presence = st.presence && isCode(st.presence.secret, 24) ? st.presence : { secret: rid(24) };
      card = st.card && isCode(st.card.salt, 16) ? { salt: st.card.salt } : { salt: rid(16) };
      card.code = await codeOf(me.sk, me.dk, card.salt);
      await chrome.storage.local.set({ presence, card: { salt: card.salt } });
      const saved = await chrome.storage.session.get(['jam', 'nonces']);
      restored = saved.jam || null;
      if (Array.isArray(saved.nonces)) for (const x of saved.nonces) if (Array.isArray(x) && typeof x[0] === 'string') nonces.set(x[0], num(x[1]));
      return me;
    })();
  }
  return meReady;
}

function profile() {
  const fallback = (TR ? 'Dinleyici ' : 'Listener ') + me.id.slice(0, 4).toUpperCase();
  return {
    id: me.id,
    name: me.nick || fallback,
    avatar: '',
    url: ''
  };
}

function driverNp() {
  const info = driver && ports.get(driver);
  return info ? info.np : null;
}

function viewing(thread) {
  for (const info of ports.values()) if (info.open && info.thread === thread) return true;
  return false;
}

function route(topic, fn) {
  routes.set(topic, fn);
  if (net) net.mq.sub(topic);
}

function unroute(topic) {
  if (routes.delete(topic) && net) net.mq.unsub(topic);
}

function online() {
  if (net) return Promise.resolve(net);
  if (connecting) return connecting;
  connecting = (async () => {
    await identity();
    const pres = await presTarget(me.id, presence.secret);
    const will = { topic: pres.topic, payload: await seal(pres.key, { on: false, ts: Date.now() }), retain: true };
    let mq = null;
    for (const url of BROKERS) {
      const c = new Mqtt(url);
      try {
        await c.connect('chorus_' + rid(12), will);
        mq = c;
        break;
      } catch {
        c.close();
      }
    }
    if (!mq) throw new Error('broker');
    routes.clear();
    watching.clear();
    net = { mq, pres, inbox: await inboxTopic(me.id) };
    mq.on('message', (topic, data) => {
      const fn = routes.get(topic);
      if (fn) fn(data).catch(() => {});
    });
    mq.on('close', () => {
      if (net && net.mq === mq) {
        net = null;
        routes.clear();
        watching.clear();
        live.clear();
        push();
      }
    });
    route(net.inbox, onInbox);
    for (const f of Object.values(friends)) await watchFriend(f);
    await publishCard();
    if (!jam && restored) {
      const r = restored;
      restored = null;
      if (r && isCode(r.id, 10) && isCode(r.secret, 24)) await enterJam(r.id, r.secret, r.state, r.skew, r.chat);
    }
    if (jam) {
      routeJam(jam);
      if (jam.state && jam.state.host === me.id) broadcast();
      else {
        jamSend({ t: 'join', m: profile() });
        burst();
      }
    }
    publishPresence();
    push();
    return net;
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}

async function goOffline() {
  if (!net) return;
  const n = net;
  net = null;
  routes.clear();
  watching.clear();
  live.clear();
  try {
    n.mq.pub(n.pres.topic, await seal(n.pres.key, { on: false, ts: Date.now() }), true);
  } catch {}
  setTimeout(() => n.mq.close(), 300);
}

async function shutdown() {
  idleSince = 0;
  if (jam) await leaveJam();
  await goOffline();
  invites.clear();
  knocks.clear();
}

async function reconnect() {
  await goOffline();
  push();
  if (connecting) await connecting.catch(() => {});
  if (net) await goOffline();
  await online().catch(() => {});
}

async function publishPresence() {
  if (!net || !me) return;
  const np = prefs.share ? driverNp() : null;
  const t = np && np.playing && track(np.t);
  const s = jam && jam.state;
  const p = JSON.stringify({
    on: true,
    id: me.id,
    ts: Date.now(),
    who: profile(),
    np: t ? { id: t.id, title: t.title, artist: t.artist, url: t.url, art: t.art } : null,
    jam: s ? { n: Object.keys(s.members).length, host: s.host === me.id } : null
  });
  net.mq.pub(net.pres.topic, await seal(net.pres.key, { p, s: await sign(me.sPriv, p) }), true);
}

function presenceSoon() {
  clearTimeout(presTimer);
  presTimer = setTimeout(() => publishPresence().catch(() => {}), 400);
}

async function publishCard() {
  if (!net) return;
  const t = await cardTarget(card.code);
  const p = JSON.stringify({ sk: me.sk, dk: me.dk, salt: card.salt, who: profile(), ts: Date.now() });
  net.mq.pub(t.topic, await seal(t.key, { p, s: await sign(me.sPriv, p) }), true);
}

async function resetCard() {
  if (net) net.mq.pub((await cardTarget(card.code)).topic, new Uint8Array(0), true);
  card = { salt: rid(16) };
  card.code = await codeOf(me.sk, me.dk, card.salt);
  store({ card: { salt: card.salt } });
  await publishCard();
  push();
}

async function watchFriend(f) {
  if (!net || !isCode(f.pk, 24)) return;
  const t = await presTarget(f.id, f.pk);
  const old = watching.get(f.id);
  if (old === t.topic) return;
  if (old) unroute(old);
  watching.set(f.id, t.topic);
  route(t.topic, data => onPresence(f.id, f.pk, t.key, data));
}

function unwatchFriend(id) {
  const topic = watching.get(id);
  watching.delete(id);
  if (topic) unroute(topic);
  live.delete(id);
}

async function onPresence(id, pk, key, data) {
  const f = friends[id];
  if (!f || f.pk !== pk) return;
  if (!data.length) {
    if (live.delete(id)) push();
    return;
  }
  const env = await open(key, data);
  let o = null;
  if (env && typeof env.p === 'string' && env.p.length < 8000 && (await verify(f.sk, env.p, env.s))) {
    try {
      o = JSON.parse(env.p);
    } catch {}
  }
  if (o && o.id !== id) o = null;
  if (!o || !o.on || Math.abs(Date.now() - num(o.ts)) > PRESENCE_TTL) {
    if (live.delete(id)) push();
    return;
  }
  const who = whoOf({ ...obj(o.who), id });
  const np = o.np ? track(o.np) : null;
  const j = o.jam && typeof o.jam === 'object' ? { n: Math.max(1, Math.min(99, num(o.jam.n) | 0)), host: !!o.jam.host } : null;
  live.set(id, { at: Date.now(), np: np ? { title: np.title, artist: np.artist, url: np.url, art: np.art } : null, jam: j });
  if (who.name && (who.name !== f.name || who.avatar !== f.avatar || who.url !== f.url)) {
    f.name = who.name;
    f.avatar = who.avatar;
    f.url = who.url;
    saveFriends();
  }
  push();
}

async function sendTo(peer, body) {
  if (!net || !peer || !isKey(peer.sk) || !isKey(peer.dk)) return false;
  if ((await idOf(peer.sk, peer.dk)) !== peer.id) return false;
  const p = JSON.stringify({ to: peer.id, from: me.id, ts: Date.now(), n: rid(16), b: body });
  const env = { p, s: await sign(me.sPriv, p), sk: me.sk, dk: me.dk };
  net.mq.pub(await inboxTopic(peer.id), await sealTo(peer.dk, env));
  return true;
}

async function openEnvelope(data) {
  const env = await openBox(me.dPriv, data);
  if (!env || typeof env.p !== 'string' || typeof env.s !== 'string' || !isKey(env.sk) || !isKey(env.dk)) return null;
  let p;
  try {
    p = JSON.parse(env.p);
  } catch {
    return null;
  }
  if (!p || p.to !== me.id || typeof p.from !== 'string' || p.from === me.id) return null;
  if (Math.abs(Date.now() - num(p.ts)) > CLOCK_WINDOW) return null;
  if ((await idOf(env.sk, env.dk)) !== p.from) return null;
  if (!(await verify(env.sk, env.p, env.s))) return null;
  if (!fresh(p.n)) return null;
  return { from: p.from, sk: env.sk, dk: env.dk, body: obj(p.b) };
}

function notify(key, who, extra) {
  const msg = { type: 'toast', key, who: who ? whoOf(who) : null, ...extra };
  for (const p of ports.keys()) {
    try {
      p.postMessage(msg);
    } catch {}
  }
}

function makeFriend(id, sk, dk, who, pk) {
  const w = whoOf({ ...who, id });
  friends[id] = { id, sk, dk, name: w.name || id.slice(0, 6), avatar: w.avatar, url: w.url, pk, since: Date.now() };
  delete requests[id];
  saveFriends();
  saveRequests();
  watchFriend(friends[id]).catch(() => {});
  push();
}

function forget(id) {
  delete friends[id];
  delete dms[id];
  delete unread[id];
  invites.delete(id);
  knocks.delete(id);
  unwatchFriend(id);
  saveFriends();
  saveDms();
  push();
}

async function rotatePresence() {
  if (net) {
    try {
      net.mq.pub(net.pres.topic, new Uint8Array(0), true);
    } catch {}
  }
  presence = { secret: rid(24) };
  store({ presence });
  const others = Object.values(friends);
  await reconnect();
  for (const f of others) await sendTo(f, { t: 'pk', pk: presence.secret });
}

async function requestFriend(peer, who) {
  const r = requests[peer.id];
  if (r && r.dir === 'in') return answerFriend(peer.id, true);
  requests[peer.id] = { id: peer.id, sk: peer.sk, dk: peer.dk, who: whoOf({ ...who, id: peer.id }), dir: 'out', at: Date.now() };
  saveRequests();
  push();
  await sendTo(peer, { t: 'freq', who: profile(), pk: presence.secret });
  notify('reqSent', requests[peer.id].who);
}

async function answerFriend(id, yes) {
  const r = requests[id];
  if (!r || r.dir !== 'in') return;
  if (yes) {
    makeFriend(r.id, r.sk, r.dk, r.who, r.pk);
    await sendTo(r, { t: 'facc', who: profile(), pk: presence.secret });
    notify('friendAdded', r.who);
  } else {
    delete requests[id];
    saveRequests();
    push();
    await sendTo(r, { t: 'fno' });
  }
}

async function addByCode(raw) {
  await online();
  const code = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^chorus/, '');
  if (!isCode(code, 12)) return notify('badFriendCode');
  if (code === card.code) return notify('selfCode');
  const t = await cardTarget(code);
  const got = await new Promise(resolve => {
    const timer = setTimeout(() => {
      unroute(t.topic);
      resolve(null);
    }, 9000);
    route(t.topic, async data => {
      const c = await readCard(await open(t.key, data), code);
      if (!c) return;
      clearTimeout(timer);
      unroute(t.topic);
      resolve(c);
    });
  });
  if (!got) return notify('cardNotFound');
  if (got.id === me.id) return notify('selfCode');
  if (friends[got.id]) return notify('alreadyFriend', got.who);
  await requestFriend(got, got.who);
}

async function readCard(env, code) {
  if (!env || typeof env.p !== 'string' || env.p.length > 4000) return null;
  let c;
  try {
    c = JSON.parse(env.p);
  } catch {
    return null;
  }
  if (!c || !isKey(c.sk) || !isKey(c.dk) || !isCode(c.salt, 16)) return null;
  if ((await codeOf(c.sk, c.dk, c.salt)) !== code) return null;
  if (!(await verify(c.sk, env.p, env.s))) return null;
  const id = await idOf(c.sk, c.dk);
  return { id, sk: c.sk, dk: c.dk, who: whoOf({ ...obj(c.who), id }) };
}

function addDm(id, msg) {
  const list = dms[id] || (dms[id] = []);
  if (list.some(x => x.mid === msg.mid)) return false;
  list.push(msg);
  if (list.length > 200) list.splice(0, list.length - 200);
  saveDms();
  return true;
}

async function onInbox(data) {
  const e = await openEnvelope(data);
  if (!e || !limit('i:' + e.from, 40, 20000)) return;
  const b = e.body;
  const f = friends[e.from];
  const peer = { id: e.from, sk: e.sk, dk: e.dk };
  const who = { ...whoOf(b.who || f || {}), id: e.from };
  if (!who.name) who.name = e.from.slice(0, 6);
  switch (b.t) {
    case 'freq': {
      if (!isCode(b.pk, 24)) return;
      if (f) {
        f.pk = b.pk;
        saveFriends();
        watchFriend(f).catch(() => {});
        await sendTo(peer, { t: 'facc', who: profile(), pk: presence.secret });
        return;
      }
      const r = requests[e.from];
      if (r && r.dir === 'out') {
        makeFriend(e.from, e.sk, e.dk, who, b.pk);
        await sendTo(peer, { t: 'facc', who: profile(), pk: presence.secret });
        notify('friendAdded', who);
        return;
      }
      const pending = Object.values(requests)
        .filter(x => x.dir === 'in')
        .sort((a, b) => a.at - b.at);
      if (pending.length >= 50) delete requests[pending[0].id];
      requests[e.from] = { id: e.from, sk: e.sk, dk: e.dk, who, pk: b.pk, dir: 'in', at: Date.now() };
      saveRequests();
      notify('reqIn', who);
      push();
      break;
    }
    case 'facc': {
      const r = requests[e.from];
      if (!isCode(b.pk, 24)) return;
      if (f) {
        if (f.pk !== b.pk) {
          f.pk = b.pk;
          saveFriends();
          watchFriend(f).catch(() => {});
        }
        return;
      }
      if (!r || r.dir !== 'out') return;
      makeFriend(e.from, e.sk, e.dk, who, b.pk);
      notify('friendAdded', who);
      break;
    }
    case 'fno': {
      const r = requests[e.from];
      if (!r || r.dir !== 'out') return;
      delete requests[e.from];
      saveRequests();
      notify('reqDeclined', r.who);
      push();
      break;
    }
    case 'unf':
      if (!f) return;
      forget(e.from);
      await rotatePresence();
      break;
    case 'pk':
      if (!f || !isCode(b.pk, 24)) return;
      f.pk = b.pk;
      saveFriends();
      await watchFriend(f);
      break;
    case 'dm': {
      if (!f || !limit('dm:' + e.from, 20, 20000)) return;
      const text = cleanText(b.text);
      const mid = str(b.mid, 16);
      if (!text || mid.length < 6) return;
      if (!addDm(e.from, { mid, from: e.from, text, ts: Date.now() })) return;
      if (!viewing(e.from)) {
        unread[e.from] = (unread[e.from] || 0) + 1;
        notify('dm', who, { text, thread: e.from });
      }
      push();
      break;
    }
    case 'invite': {
      const j = obj(b.jam);
      if (!f || !isCode(j.id, 10) || !isCode(j.secret, 24) || !isHostId(j.host)) return;
      if (jam && jam.id === j.id) return;
      if (knocks.has(e.from)) {
        knocks.delete(e.from);
        await join({ id: j.id, secret: j.secret, host: j.host });
        return;
      }
      invites.set(e.from, { kind: 'invite', who, jam: { id: j.id, secret: j.secret, host: j.host }, at: Date.now() });
      notify('invited', who);
      push();
      break;
    }
    case 'knock': {
      if (!f) return;
      const s = jam && jam.state;
      if (!s) {
        await sendTo(peer, { t: 'nope' });
        return;
      }
      if (s.members[e.from]) return;
      if (prefs.open && s.host === me.id && !s.locked) {
        await sendTo(peer, { t: 'invite', jam: inviteOf(), who: profile() });
        return;
      }
      invites.set(e.from, { kind: 'knock', who, at: Date.now() });
      notify('knocked', who);
      push();
      break;
    }
    case 'nope':
      if (!knocks.delete(e.from)) return;
      notify('declined', who);
      push();
      break;
    case 'rekey': {
      const j = obj(b.jam);
      if (!jam || !jam.state || jam.state.host !== e.from || j.id !== jam.id || !isCode(j.secret, 24)) return;
      if (j.old !== (await sha('chorus-old:' + jam.secret))) return;
      await switchKey(j.secret);
      break;
    }
    case 'kicked':
      if (!jam || !jam.state || jam.state.host !== e.from || b.jam !== jam.id) return;
      await leaveJam(true);
      notify('kicked');
      break;
    case 'statsReq':
      if (!f || !limit('sr:' + e.from, 6, 60000)) return;
      if (prefs.shareStats) await sendTo(f, { t: 'stats', data: await Stats.shareable() });
      else await sendTo(f, { t: 'statsNo' });
      break;
    case 'stats':
    case 'statsNo': {
      if (!f || !statsWait.has(e.from)) return;
      const result = b.t === 'stats' ? { data: Stats.cleanShared(b.data) } : { denied: true };
      if (result.data) statsCache.set(e.from, { at: Date.now(), data: result.data });
      else statsCache.delete(e.from);
      deliverStats(e.from, result);
      break;
    }
  }
}

function deliverStats(id, result) {
  const w = statsWait.get(id);
  if (!w) return;
  statsWait.delete(id);
  clearTimeout(w.timer);
  for (const port of w.ports) {
    try {
      port.postMessage({ type: 'stats', who: id, ...result });
    } catch {}
  }
}

async function friendStats(port, id) {
  const f = friends[id];
  if (!f) return;
  const c = statsCache.get(id);
  if (c && c.data && Date.now() - c.at < 30000) {
    port.postMessage({ type: 'stats', who: id, data: c.data });
    return;
  }
  const w = statsWait.get(id);
  if (w) {
    w.ports.add(port);
    return;
  }
  statsWait.set(id, { ports: new Set([port]), timer: setTimeout(() => deliverStats(id, { error: true }), 9000) });
  await online();
  await sendTo(f, { t: 'statsReq' });
}

async function inviteFriend(id) {
  const f = friends[id];
  if (!f) return;
  await online();
  if (!jam || !jam.state) await startJam();
  await sendTo(f, { t: 'invite', jam: inviteOf(), who: profile() });
  notify('sent', f);
}

async function knock(id) {
  const f = friends[id];
  if (!f) return;
  await online();
  knocks.add(id);
  push();
  await sendTo(f, { t: 'knock', who: profile() });
  setTimeout(() => {
    if (knocks.delete(id)) push();
  }, 60000);
}

async function answer(id, yes) {
  const inv = invites.get(id);
  if (!inv) return;
  invites.delete(id);
  push();
  const f = friends[id];
  if (inv.kind === 'invite') {
    if (yes) await join(inv.jam);
    else if (f) await sendTo(f, { t: 'nope' });
  } else if (f && yes && jam && jam.state) {
    await sendTo(f, { t: 'invite', jam: inviteOf(), who: profile() });
  } else if (f) {
    await sendTo(f, { t: 'nope' });
  }
}

function isHostId(x) {
  return typeof x === 'string' && /^[0-9a-f]{20}$/.test(x);
}

function inviteOf() {
  return { id: jam.id, secret: jam.secret, host: jam.state.host };
}

function routeJam(j) {
  route(j.topic, data => onJam(j, data));
}

async function enterJam(id, secret, state = null, skew = 0, chat = [], expect = null) {
  const t = await jamTarget(id, secret);
  const log = Array.isArray(chat) ? chat.slice(-150) : [];
  jam = { id, secret, key: t.key, topic: t.topic, state: state ? cleanState(state) : null, skew: num(skew), samples: [], heard: Date.now(), hostAt: 0, contest: 0, expect, chat: log, seen: new Set(log.map(c => c.mid)), unread: 0 };
  if (net) routeJam(jam);
  save();
}

async function switchKey(secret) {
  const j = jam;
  const t = await jamTarget(j.id, secret);
  if (jam !== j) return;
  unroute(j.topic);
  j.secret = secret;
  j.key = t.key;
  j.topic = t.topic;
  routeJam(j);
  save();
  push();
  burst();
}

async function join(j) {
  await online();
  if (jam) await leaveJam();
  await enterJam(j.id, j.secret, null, 0, [], j.host);
  jamSend({ t: 'join', m: profile() });
  burst();
  push();
  const id = j.id;
  setTimeout(() => {
    if (jam && jam.id === id && !jam.state) {
      notify('notFound');
      leaveJam(true);
    }
  }, 9000);
}

function memberOf(p) {
  return { ...whoOf(p), sk: me && p.id === me.id ? me.sk : p.sk, dk: me && p.id === me.id ? me.dk : p.dk, seen: Date.now() };
}

async function startJam() {
  await online();
  if (jam) await leaveJam();
  await enterJam(rid(10), rid(24));
  const now = Date.now();
  const s = {
    v: 1,
    host: me.id,
    members: { [me.id]: memberOf(profile()) },
    queue: [],
    ctx: null,
    cur: null,
    playing: false,
    pos: 0,
    at: now,
    ended: false,
    mode: 'now',
    radio: true,
    hist: [],
    perms: { add: true, ctl: false },
    allow: {},
    locked: false
  };
  const np = driverNp();
  const t = np && track(np.t);
  if (t) {
    s.cur = { qid: rid(6), t, by: me.id, who: whoOf(profile()) };
    s.playing = !!np.playing;
    s.pos = Math.max(0, num(np.pos) + (np.playing ? now - num(np.ts) : 0));
  }
  jam.state = s;
  broadcast();
  save();
  push();
  presenceSoon();
}

async function leaveJam(silent) {
  if (!jam) return;
  const j = jam;
  jam = null;
  pendingOps.clear();
  if (!silent) {
    if (j.state && j.state.host === me.id) {
      const rest = Object.keys(j.state.members).filter(id => id !== me.id).sort();
      if (rest.length) {
        delete j.state.members[me.id];
        j.state.host = rest[0];
        j.state.v++;
        await jamSend({ t: 'state', s: j.state }, j);
      }
    } else if (j.state) {
      await jamSend({ t: 'leave' }, j);
    }
  }
  unroute(j.topic);
  waitEnd = 0;
  save();
  push();
  presenceSoon();
}

async function jamSend(m, j = jam) {
  if (!net || !j) return;
  const p = JSON.stringify({ ...m, from: me.id, j: j.id, ts: Date.now() });
  net.mq.pub(j.topic, await seal(j.key, { p, s: await sign(me.sPriv, p), sk: me.sk, dk: me.dk }));
}

async function onJam(j, data) {
  if (j !== jam) return;
  const env = await open(j.key, data);
  if (!env || typeof env.p !== 'string' || typeof env.s !== 'string' || !isKey(env.sk) || !isKey(env.dk)) return;
  let m;
  try {
    m = JSON.parse(env.p);
  } catch {
    return;
  }
  if (!m || typeof m !== 'object' || m.j !== j.id || typeof m.from !== 'string' || m.from === me.id || typeof m.t !== 'string') return;
  if (Math.abs(Date.now() - num(m.ts)) > CLOCK_WINDOW) return;
  if ((await idOf(env.sk, env.dk)) !== m.from) return;
  if (!(await verify(env.sk, env.p, env.s))) return;
  if (j !== jam || !limit('j:' + m.from, 120, 20000)) return;
  m.sk = env.sk;
  m.dk = env.dk;
  jamMsg(m);
}

function broadcast() {
  if (jam && jam.state) jamSend({ t: 'state', s: jam.state });
}

function bump() {
  const s = jam.state;
  s.v++;
  if (s.members[me.id]) s.members[me.id].seen = Date.now();
  broadcast();
  clearTimeout(echo);
  echo = setTimeout(broadcast, 400);
  save();
  push();
}

function sendOp(op) {
  const oid = rid(10);
  pendingOps.set(oid, { op, tries: 0, at: Date.now() });
  jamSend({ t: 'op', op, oid });
}

function retryOps(now) {
  for (const [oid, p] of pendingOps) {
    if (now - p.at < 900) continue;
    if (p.tries >= 4 || !jam || !jam.state) {
      pendingOps.delete(oid);
      continue;
    }
    p.tries++;
    p.at = now;
    jamSend({ t: 'op', op: p.op, oid });
  }
}

function save() {
  chrome.storage.session
    .set({ jam: jam ? { id: jam.id, secret: jam.secret, state: jam.state, skew: jam.skew, chat: jam.chat } : null })
    .catch(() => {});
}

function ping() {
  if (jam && jam.state) jamSend({ t: 'ping', c: Date.now() });
}

function burst() {
  for (let i = 0; i < 6; i++) setTimeout(ping, 150 + i * 300);
}

function sample(m) {
  const now = Date.now();
  const rtt = now - num(m.c);
  if (!(rtt >= 0 && rtt < 4000)) return;
  jam.samples.push({ rtt, off: num(m.h) - (num(m.c) + rtt / 2) });
  if (jam.samples.length > 12) jam.samples.shift();
  const best = jam.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  if (Math.abs(best.off - jam.skew) > 3) {
    jam.skew = best.off;
    save();
    push();
  }
}

function cleanItem(x) {
  x = obj(x);
  const t = track(x.t);
  if (!t) return null;
  return { qid: str(x.qid, 12) || rid(6), t, by: str(x.by, 40) || null, who: x.who ? whoOf(x.who) : null, auto: !!x.auto };
}

function cleanList(a, max) {
  return (Array.isArray(a) ? a.slice(0, max) : []).map(cleanItem).filter(Boolean);
}

function cleanState(n) {
  n = obj(n);
  if (!Number.isSafeInteger(n.v) || n.v < 0 || typeof n.host !== 'string' || !Array.isArray(n.queue)) return null;
  const members = {};
  const entries = Object.entries(obj(n.members));
  entries.sort((a, b) => (a[0] === n.host ? -1 : b[0] === n.host ? 1 : 0));
  for (const [id, m] of entries.slice(0, 50)) {
    const mm = obj(m);
    if (typeof id !== 'string' || id.length !== 20 || !isKey(mm.sk) || !isKey(mm.dk)) continue;
    members[id] = { ...whoOf({ ...mm, id }), sk: mm.sk, dk: mm.dk, seen: num(mm.seen) };
  }
  if (!members[n.host]) return null;
  const allow = {};
  for (const [id, p] of Object.entries(obj(n.allow))) if (members[id]) allow[id] = { add: !!obj(p).add, ctl: !!obj(p).ctl };
  const ctx = n.ctx && typeof n.ctx === 'object' ? { title: cleanText(n.ctx.title).slice(0, 120), url: ytUrl(n.ctx.url), auto: !!n.ctx.auto, items: cleanList(n.ctx.items, 150) } : null;
  const perms = obj(n.perms);
  return {
    v: n.v,
    host: n.host,
    members,
    queue: cleanList(n.queue, 300),
    ctx,
    cur: n.cur ? cleanItem(n.cur) : null,
    playing: !!n.playing,
    pos: Math.max(0, num(n.pos)),
    at: num(n.at),
    ended: !!n.ended,
    mode: n.mode === 'queue' ? 'queue' : 'now',
    radio: n.radio !== false,
    hist: cleanList(Array.isArray(n.hist) ? n.hist.slice(-30) : [], 30),
    perms: { add: perms.add !== false, ctl: !!perms.ctl },
    allow,
    locked: !!n.locked
  };
}

function becomeHost(s) {
  s.at -= jam.skew;
  jam.skew = 0;
  jam.samples = [];
  s.host = me.id;
  s.members[me.id] = memberOf(profile());
  waitEnd = 0;
}

function acceptState(m) {
  const n = cleanState(m.s);
  if (!n) return;
  const s = jam.state;
  const now = Date.now();
  if (!s) {
    if (n.host !== m.from || !jam.expect || m.from !== jam.expect) return;
  } else {
    if (n.v < s.v) return;
    if (n.v === s.v && n.host === s.host) {
      if (m.from === s.host) jam.heard = now;
      return;
    }
    const fromHost = m.from === s.host;
    const takeover = !!s.members[m.from] && n.host === m.from && (now - jam.heard > 8000 || (now - jam.contest < 15000 && m.from < s.host));
    if (takeover && !fromHost) jam.contest = now;
    if (!fromHost && !takeover) return;
  }
  const prevHost = s && s.host;
  jam.state = n;
  jam.heard = now;
  if (prevHost !== n.host) jam.hostAt = now;
  if (n.host === me.id && prevHost !== me.id) {
    becomeHost(n);
    n.v++;
    broadcast();
    if (prevHost) notify('youHost');
  } else if (n.host !== me.id) {
    if (prevHost && prevHost !== n.host) {
      jam.samples = [];
      burst();
    }
    if (!n.members[me.id]) jamSend({ t: 'join', m: profile() });
  }
  save();
  push();
  presenceSoon();
}

function jamMsg(m) {
  const s = jam.state;
  const host = !!s && s.host === me.id;
  const member = !!s && !!s.members[m.from];
  switch (m.t) {
    case 'state':
      acceptState(m);
      break;
    case 'join':
      if (!host) break;
      if (s.locked && !member) {
        jamSend({ t: 'deny', to: m.from, why: 'locked' });
        break;
      }
      if (!member && Object.keys(s.members).length >= 30) {
        jamSend({ t: 'deny', to: m.from, why: 'full' });
        break;
      }
      s.members[m.from] = memberOf({ ...obj(m.m), id: m.from, sk: m.sk, dk: m.dk });
      bump();
      presenceSoon();
      break;
    case 'leave':
      if (host && member) {
        delete s.members[m.from];
        delete s.allow[m.from];
        bump();
        presenceSoon();
      }
      break;
    case 'op':
      if (!host || !member || !m.op || typeof m.op !== 'object') break;
      s.members[m.from].seen = Date.now();
      if (typeof m.oid === 'string') {
        jamSend({ t: 'ack', oid: m.oid, to: m.from });
        if (doneOps.includes(m.oid)) break;
        doneOps.push(m.oid);
        if (doneOps.length > 300) doneOps.shift();
      }
      if (!can(s, m.from, m.op)) {
        jamSend({ t: 'deny', to: m.from, why: 'perm' });
        break;
      }
      apply(m.op, m.from);
      break;
    case 'ack':
      if (m.to === me.id && s && m.from === s.host) pendingOps.delete(m.oid);
      break;
    case 'deny':
      if (m.to !== me.id) break;
      if (!s) {
        if ((m.why === 'locked' || m.why === 'full') && m.from === jam.expect) {
          notify(m.why);
          leaveJam(true);
        }
      } else if (m.from === s.host) {
        notify(m.why === 'locked' || m.why === 'full' ? m.why : 'noPerm');
      }
      break;
    case 'ping':
      if (host && member) {
        s.members[m.from].seen = Date.now();
        jamSend({ t: 'pong', to: m.from, c: m.c, h: Date.now() });
      }
      break;
    case 'pong':
      if (m.to === me.id && !host && s && m.from === s.host) sample(m);
      break;
    case 'react':
      if (member && limit('r:' + m.from, 10, 5000)) react(m.from, m.e);
      break;
    case 'chat':
      if (member) chatIn(m.from, m.mid, m.text);
      break;
  }
}

function react(from, e) {
  if (!REACTIONS.includes(e) || !jam || !jam.state) return;
  const p = jam.state.members[from] || (from === me.id ? profile() : null);
  if (!p) return;
  for (const port of ports.keys()) {
    try {
      port.postMessage({ type: 'react', e, who: whoOf({ ...p, id: from }) });
    } catch {}
  }
}

function chatIn(from, mid, text) {
  text = cleanText(text);
  mid = str(mid, 16);
  if (!text || mid.length < 6 || jam.seen.has(mid)) return;
  jam.seen.add(mid);
  const who = whoOf(jam.state.members[from]);
  jam.chat.push({ mid, from, who, text, ts: Date.now() });
  if (jam.chat.length > 150) jam.chat.splice(0, jam.chat.length - 150);
  if (!viewing('jam')) {
    jam.unread++;
    notify('chat', who, { text, thread: 'jam' });
  }
  save();
  push();
}

async function sendChat(thread, raw) {
  const text = cleanText(raw);
  if (!text) return;
  const mid = rid(12);
  if (thread === 'jam') {
    if (!jam || !jam.state) return;
    jam.seen.add(mid);
    jam.chat.push({ mid, from: me.id, who: whoOf(profile()), text, ts: Date.now() });
    if (jam.chat.length > 150) jam.chat.splice(0, jam.chat.length - 150);
    save();
    push();
    await jamSend({ t: 'chat', mid, text });
    return;
  }
  const f = friends[thread];
  if (!f) return;
  addDm(thread, { mid, from: me.id, text, ts: Date.now() });
  push();
  await sendTo(f, { t: 'dm', mid, text });
}

function permsOf(s, id) {
  if (id === s.host) return { add: true, ctl: true, host: true };
  return { add: false, ctl: false, ...s.perms, ...(s.allow[id] || {}), host: false };
}

function can(s, id, op) {
  if (id === s.host) return true;
  if (!s.members[id]) return false;
  const p = permsOf(s, id);
  switch (op.k) {
    case 'add':
    case 'addMany':
      return op.next ? p.ctl : p.add || p.ctl;
    case 'remove': {
      if (p.ctl) return true;
      const it = s.queue.find(q => q.qid === op.qid);
      return !!(it && it.by === id);
    }
    case 'ended':
      return !op.bad || p.ctl;
    case 'play':
    case 'pause':
    case 'seek':
    case 'next':
    case 'prev':
    case 'jump':
    case 'move':
    case 'promote':
    case 'clear':
    case 'now':
    case 'context':
    case 'ctx':
      return p.ctl;
    default:
      return false;
  }
}

function startItem(s, it, at) {
  if (s.cur && s.cur !== it) {
    s.hist.push(s.cur);
    if (s.hist.length > 30) s.hist.shift();
  }
  s.cur = it;
  s.pos = 0;
  s.at = at;
  s.playing = true;
  s.ended = false;
  waitEnd = 0;
}

function stopAtEnd(s) {
  s.playing = false;
  s.pos = 0;
  s.at = Date.now();
  s.ended = true;
}

function when(op, lead) {
  const now = Date.now();
  return typeof op.at === 'number' && op.at > now - 1500 && op.at < now + 3000 ? op.at : now + lead;
}

function upcoming(s) {
  if (s.queue.length) return s.queue.shift();
  if (s.ctx && s.ctx.items.length) return s.ctx.items.shift();
  return null;
}

function items(list, from, who, max) {
  return (Array.isArray(list) ? list.slice(0, max * 2) : []).map(track).filter(Boolean).slice(0, max).map(t => ({ qid: rid(6), t, by: from, who, auto: false }));
}

function context(op, list) {
  return { title: cleanText(op.title).slice(0, 120), url: ytUrl(op.url), auto: false, items: list };
}

function apply(op, from) {
  const s = jam.state;
  const now = Date.now();
  const at = () => (s.playing ? s.pos + (now - s.at) : s.pos);
  const who = whoOf(s.members[from] || { id: from, name: '?' });
  const inQueue = qid => s.queue.findIndex(q => q.qid === qid);
  const inCtx = qid => (s.ctx ? s.ctx.items.findIndex(q => q.qid === qid) : -1);
  switch (op.k) {
    case 'add': {
      const t = track(op.t);
      if (!t) return;
      const it = { qid: rid(6), t, by: from, who, auto: false };
      if (!s.cur || s.ended) startItem(s, it, when(op, LEAD));
      else if (s.queue.length >= 300) return;
      else if (op.next) s.queue.unshift(it);
      else s.queue.push(it);
      break;
    }
    case 'addMany': {
      const list = items(op.ts, from, who, 300);
      if (!list.length) return;
      if (!s.cur || s.ended) startItem(s, list.shift(), when(op, LEAD));
      if (op.next) s.queue.unshift(...list);
      else s.queue.push(...list);
      if (s.queue.length > 300) s.queue.length = 300;
      break;
    }
    case 'now': {
      const t = track(op.t);
      if (!t) return;
      const liveStart = typeof op.pos === 'number';
      startItem(s, { qid: rid(6), t, by: from, who, auto: false }, liveStart ? when(op, 0) : when(op, LEAD));
      if (liveStart) s.pos = Math.max(0, num(op.pos));
      if (op.ctx) s.ctx = context(op.ctx, items(op.ctx.ts, from, who, 150));
      break;
    }
    case 'context': {
      const list = items(op.ts, from, who, 150);
      if (!list.length) return;
      startItem(s, list.shift(), when(op, LEAD));
      s.ctx = context(op, list);
      break;
    }
    case 'ctx': {
      if (!s.cur || s.cur.t.id !== op.for) return;
      const list = items(op.ts, from, who, 150);
      if (!list.length) return;
      s.ctx = context(op, list);
      break;
    }
    case 'recs': {
      if (from !== me.id || s.radio === false) return;
      if (s.ctx && !s.ctx.auto && s.ctx.items.length) return;
      const seen = new Set([...s.hist, s.cur, ...s.queue, ...(s.ctx ? s.ctx.items : [])].filter(Boolean).map(x => x.t.id));
      const list = items(op.ts, null, null, 40).filter(x => !seen.has(x.t.id));
      list.forEach(x => (x.auto = true));
      if (!list.length) return;
      const base = s.ctx && s.ctx.auto ? s.ctx.items : [];
      s.ctx = { title: '', url: '', auto: true, items: [...base, ...list].slice(0, 60) };
      if (!s.cur || s.ended) startItem(s, upcoming(s), when(op, LEAD));
      break;
    }
    case 'jump': {
      let i = inQueue(op.qid);
      if (i >= 0) {
        startItem(s, s.queue.splice(i, 1)[0], when(op, LEAD));
        break;
      }
      i = inCtx(op.qid);
      if (i < 0) return;
      const it = s.ctx.items[i];
      s.ctx.items = s.ctx.items.slice(i + 1);
      startItem(s, it, when(op, LEAD));
      break;
    }
    case 'remove': {
      let i = inQueue(op.qid);
      if (i >= 0) s.queue.splice(i, 1);
      else if ((i = inCtx(op.qid)) >= 0) s.ctx.items.splice(i, 1);
      else return;
      break;
    }
    case 'move': {
      const i = inQueue(op.qid);
      if (i < 0) return;
      const [it] = s.queue.splice(i, 1);
      s.queue.splice(Math.max(0, Math.min(num(op.to) | 0, s.queue.length)), 0, it);
      break;
    }
    case 'promote': {
      const i = inCtx(op.qid);
      if (i < 0) return;
      s.queue.push(s.ctx.items.splice(i, 1)[0]);
      break;
    }
    case 'clear':
      if (op.which === 'ctx') s.ctx = null;
      else s.queue = [];
      break;
    case 'play':
      if (!s.cur || s.ended) {
        const it = upcoming(s) || s.cur;
        if (!it) return;
        startItem(s, it, when(op, 300));
      } else if (!s.playing) {
        if (typeof op.pos === 'number') s.pos = Math.max(0, num(op.pos));
        s.playing = true;
        s.at = when(op, 0);
      } else return;
      break;
    case 'pause':
      if (!s.playing) return;
      s.pos = Math.max(0, typeof op.pos === 'number' ? num(op.pos) : at());
      s.playing = false;
      s.at = now;
      break;
    case 'seek':
      if (!s.cur) return;
      s.pos = Math.max(0, Math.min(num(op.pos), s.cur.t.dur || Infinity));
      s.at = when(op, 0);
      s.ended = false;
      break;
    case 'ended': {
      if (!s.cur || String(s.cur.t.id) !== String(op.id) || !s.playing || s.ended) return;
      if (!op.bad && s.cur.t.dur && at() < s.cur.t.dur - 15000) return;
      const it = upcoming(s);
      if (!it) return;
      startItem(s, it, now + LEAD);
      break;
    }
    case 'next': {
      const it = upcoming(s);
      if (it) startItem(s, it, when(op, LEAD));
      else if (s.cur) stopAtEnd(s);
      else return;
      break;
    }
    case 'prev':
      if (at() > 4000 || !s.hist.length) {
        if (!s.cur) return;
        s.pos = 0;
        s.at = when(op, 200);
        s.ended = false;
      } else {
        if (s.cur) s.queue.unshift(s.cur);
        s.cur = s.hist.pop();
        s.pos = 0;
        s.at = when(op, LEAD);
        s.playing = true;
        s.ended = false;
      }
      break;
    case 'mode':
      s.mode = op.mode === 'queue' ? 'queue' : 'now';
      break;
    case 'radio':
      s.radio = !!op.on;
      if (!s.radio && s.ctx && s.ctx.auto) s.ctx = null;
      break;
    case 'perm':
      if (typeof op.id === 'string') {
        if (!s.members[op.id] || op.id === s.host) return;
        s.allow[op.id] = { add: !!op.add, ctl: !!op.ctl };
      } else {
        s.perms = { add: !!op.add, ctl: !!op.ctl };
        s.allow = {};
      }
      break;
    case 'lock':
      s.locked = !!op.on;
      break;
    default:
      return;
  }
  bump();
  wantRecs();
}

async function wantRecs() {
  const s = jam && jam.state;
  if (!s || s.host !== me.id || s.radio === false || !s.cur) return;
  const left = s.queue.length + (s.ctx ? s.ctx.items.length : 0);
  if (left >= 3 || Date.now() - recsAt < 20000 || !driver) return;
  recsAt = Date.now();
  const seeds = [...s.hist.slice(-6), s.cur].filter(x => x && !x.auto).map(x => x.t);
  const autoSeeds = [...s.hist.slice(-3), s.cur].filter(x => x && x.auto).map(x => x.t);
  const pool = seeds.length ? seeds.slice(-5) : autoSeeds.length ? autoSeeds : [s.cur.t];
  const exclude = [...s.hist, s.cur, ...s.queue, ...(s.ctx ? s.ctx.items : [])].filter(Boolean).map(x => x.t.id);
  const taste = await Stats.taste();
  const target = driver;
  if (!target) return;
  try {
    target.postMessage({ type: 'recs', seeds: pool, exclude, taste });
  } catch {}
}

async function kick(id) {
  const s = jam && jam.state;
  if (!s || s.host !== me.id || id === me.id || !s.members[id]) return;
  await rekey(id);
}

async function rekey(dropId) {
  const s = jam && jam.state;
  if (!s || s.host !== me.id) return;
  const j = jam;
  const secret = rid(24);
  const dropped = dropId ? s.members[dropId] : null;
  if (dropped) {
    delete s.members[dropId];
    delete s.allow[dropId];
  }
  const t = await jamTarget(j.id, secret);
  if (jam !== j) return;
  const others = Object.values(s.members).filter(m => m.id !== me.id);
  const old = await sha('chorus-old:' + j.secret);
  unroute(j.topic);
  j.secret = secret;
  j.key = t.key;
  j.topic = t.topic;
  routeJam(j);
  bump();
  await Promise.all(others.map(m => sendTo(m, { t: 'rekey', jam: { id: j.id, secret, old } })));
  if (dropped) await sendTo(dropped, { t: 'kicked', jam: j.id });
  presenceSoon();
}

function makeHost(id) {
  const s = jam && jam.state;
  if (!s || s.host !== me.id || id === me.id || !s.members[id]) return;
  s.host = id;
  s.v++;
  jam.hostAt = Date.now();
  jam.heard = Date.now();
  jam.samples = [];
  broadcast();
  save();
  push();
  burst();
  presenceSoon();
}

function hostTick(now) {
  const s = jam.state;
  jam.heard = now;
  if (!s.cur || !s.playing || !s.cur.t.dur) return;
  const end = s.at + (s.cur.t.dur - s.pos);
  if (now < end - 100) {
    waitEnd = 0;
    return;
  }
  const it = upcoming(s);
  if (it) {
    startItem(s, it, Math.max(now, end) + LEAD);
    bump();
    wantRecs();
  } else if (!waitEnd) {
    waitEnd = now;
    recsAt = 0;
    wantRecs();
  } else if (now - waitEnd > 6000) {
    waitEnd = 0;
    stopAtEnd(s);
    bump();
  }
}

function sweep(now) {
  const s = jam.state;
  let changed = false;
  for (const id of Object.keys(s.members)) {
    if (id !== me.id && now - (s.members[id].seen || 0) > 16000) {
      delete s.members[id];
      delete s.allow[id];
      changed = true;
    }
  }
  if (changed) {
    bump();
    presenceSoon();
  } else broadcast();
}

function takeover(now) {
  const s = jam.state;
  const order = Object.keys(s.members)
    .filter(id => id !== s.host)
    .sort();
  const rank = order.indexOf(me.id);
  if (rank < 0 || now - jam.heard < 10000 + rank * 5000) return;
  delete s.members[s.host];
  delete s.allow[s.host];
  becomeHost(s);
  s.v++;
  jam.heard = now;
  jam.hostAt = now;
  broadcast();
  save();
  push();
  presenceSoon();
}

function prune(now) {
  let changed = false;
  for (const [id, l] of live) {
    if (now - l.at > PRESENCE_TTL) {
      live.delete(id);
      changed = true;
    }
  }
  for (const [id, r] of Object.entries(requests)) {
    if (now - (r.at || 0) > 14 * 86400000) {
      delete requests[id];
      saveRequests();
      changed = true;
    }
  }
  for (const [id, inv] of invites) {
    if (now - inv.at > 120000) {
      invites.delete(id);
      changed = true;
    }
  }
  if (changed) push();
}

function fmtCode(c) {
  return c ? (c.slice(0, 4) + '-' + c.slice(4, 8) + '-' + c.slice(8)).toUpperCase() : '';
}

function view(info, port) {
  const s = jam && jam.state;
  const lastOf = id => {
    const list = dms[id];
    const x = list && list[list.length - 1];
    return x ? { text: x.text, ts: x.ts, mine: x.from === me.id } : null;
  };
  let jv = null;
  if (jam) {
    if (s) {
      const members = {};
      for (const [id, m] of Object.entries(s.members)) {
        const p = permsOf(s, id);
        members[id] = { id, name: m.name, avatar: m.avatar, url: m.url, add: p.add, ctl: p.ctl, friend: !!friends[id], asked: !!(requests[id] && requests[id].dir === 'out') };
      }
      const mine = permsOf(s, me.id);
      const lastChat = jam.chat[jam.chat.length - 1];
      jv = {
        ...s,
        members,
        id: jam.id,
        code: 'chorus-' + jam.id + '-' + jam.secret + '-' + s.host,
        skew: jam.skew,
        isHost: s.host === me.id,
        can: { add: mine.add || mine.ctl, ctl: mine.ctl },
        chat: info && info.thread === 'jam' ? jam.chat : [],
        last: lastChat ? { text: lastChat.text, ts: lastChat.ts, mine: lastChat.from === me.id, name: lastChat.who && lastChat.who.name } : null,
        unread: jam.unread
      };
    } else jv = { pending: true };
  }
  return {
    me: me ? profile() : null,
    guest: true,
    online: !!net,
    prefs,
    card: card ? fmtCode(card.code) : '',
    friends: Object.values(friends).map(f => {
      const l = live.get(f.id);
      return {
        id: f.id,
        name: f.name,
        avatar: f.avatar,
        url: f.url,
        on: !!l,
        np: l ? l.np : null,
        jam: l ? l.jam : null,
        unread: unread[f.id] || 0,
        last: lastOf(f.id),
        inJam: !!(s && s.members[f.id])
      };
    }),
    requests: Object.values(requests).map(r => ({ id: r.id, dir: r.dir, who: r.who })),
    invites: [...invites.entries()].map(([id, v]) => ({ id, kind: v.kind, who: v.who })),
    knocks: [...knocks],
    jam: jv,
    thread: info ? info.thread : null,
    dms: info && info.thread && friends[info.thread] ? dms[info.thread] || [] : [],
    tabs: ports.size,
    driver: port === driver,
    recap: recapReady()
  };
}

function recapReady() {
  const now = new Date().getFullYear();
  const done = Stats.years()
    .map(Number)
    .filter(y => y < now && y > prefs.recapSeen);
  return done.length ? done[done.length - 1] : null;
}

function push() {
  if (pushQueued) return;
  pushQueued = true;
  setTimeout(() => {
    pushQueued = false;
    for (const [p, info] of ports) {
      try {
        p.postMessage({ type: 'view', view: view(info, p) });
      } catch {}
    }
  }, 0);
}

function refreshSelf() {
  if (!jam || !jam.state) return;
  if (jam.state.host === me.id) {
    jam.state.members[me.id] = memberOf(profile());
    bump();
  } else {
    jamSend({ t: 'join', m: profile() });
  }
}

function isHost() {
  return !!(jam && jam.state && jam.state.host === me.id);
}

async function handle(port, m) {
  const info = ports.get(port);
  if (!info || !m || typeof m.type !== 'string') return;
  await identity();
  switch (m.type) {
    case 'hello':
      push();
      break;
    case 'css':
      try {
        const r = await fetch(chrome.runtime.getURL('chorus.css'));
        port.postMessage({ type: 'css', text: await r.text() });
      } catch {}
      break;
    case 'np': {
      const prev = info.np;
      const np = obj(m.np);
      info.np = { t: track(np.t), playing: !!np.playing, pos: num(np.pos), ts: num(np.ts) };
      const id = x => (x && x.t ? x.t.id : null);
      if (port === driver && (!prev || id(prev) !== id(info.np) || prev.playing !== info.np.playing)) presenceSoon();
      break;
    }
    case 'op':
      if (!jam || !jam.state || !m.op || typeof m.op !== 'object') return;
      if (isHost()) apply(m.op, me.id);
      else if (can(jam.state, me.id, m.op)) sendOp(m.op);
      else notify('noPerm');
      break;
    case 'start':
      await startJam();
      if (m.op && typeof m.op === 'object') apply(m.op, me.id);
      break;
    case 'recs':
      if (isHost() && Array.isArray(m.ts)) apply({ k: 'recs', ts: m.ts }, me.id);
      break;
    case 'lyrics': {
      const t = track(m.t);
      if (!t) break;
      const r = await lyricsFor(t);
      try {
        port.postMessage({ type: 'lyrics', id: t.id, synced: r.synced, plain: r.plain });
      } catch {}
      break;
    }
    case 'react':
      if (jam && jam.state && REACTIONS.includes(m.e)) {
        react(me.id, m.e);
        jamSend({ t: 'react', e: m.e });
      }
      break;
    case 'chat':
      if (typeof m.thread === 'string') await sendChat(m.thread, m.text);
      break;
    case 'thread':
      info.thread = typeof m.id === 'string' ? m.id.slice(0, 40) : null;
      info.open = !!m.open;
      if (info.open && info.thread) {
        if (info.thread === 'jam' && jam) {
          if (jam.unread) {
            jam.unread = 0;
            save();
          }
        } else if (unread[info.thread]) {
          delete unread[info.thread];
          saveDms();
        }
      }
      push();
      break;
    case 'joinCode': {
      const hit = /chorus-([a-z0-9]{10})-([a-z0-9]{24})-([0-9a-f]{20})/.exec(String(m.code || '').toLowerCase());
      if (!hit || !isCode(hit[1], 10) || !isCode(hit[2], 24) || !isHostId(hit[3])) {
        notify('badCode');
        break;
      }
      if (!jam || jam.id !== hit[1]) await join({ id: hit[1], secret: hit[2], host: hit[3] });
      break;
    }
    case 'invite':
      await inviteFriend(m.id);
      break;
    case 'knock':
      await knock(m.id);
      break;
    case 'answer':
      await answer(m.id, !!m.yes);
      break;
    case 'leave':
      await leaveJam();
      break;
    case 'claim':
      driver = port;
      push();
      presenceSoon();
      break;
    case 'nick':
      me.nick = cleanText(m.nick).slice(0, 32);
      await chrome.storage.local.set({ nick: me.nick });
      refreshSelf();
      presenceSoon();
      if (net) publishCard().catch(() => {});
      push();
      break;
    case 'prefs': {
      const p = obj(m.prefs);
      for (const k of ['share', 'open', 'record', 'shareStats']) if (typeof p[k] === 'boolean') prefs[k] = p[k];
      if (typeof p.recapSeen === 'number' && Number.isFinite(p.recapSeen)) prefs.recapSeen = p.recapSeen | 0;
      store({ prefs });
      presenceSoon();
      push();
      break;
    }
    case 'friendCode':
      await addByCode(m.code);
      break;
    case 'friendAdd': {
      const s = jam && jam.state;
      const mm = s && typeof m.id === 'string' ? s.members[m.id] : null;
      if (!mm || m.id === me.id || friends[m.id]) break;
      await online();
      await requestFriend(mm, mm);
      break;
    }
    case 'friendAnswer':
      await answerFriend(m.id, !!m.yes);
      break;
    case 'friendCancel':
      if (requests[m.id] && requests[m.id].dir === 'out') {
        delete requests[m.id];
        saveRequests();
        push();
      }
      break;
    case 'friendRemove': {
      const f = friends[m.id];
      if (!f) break;
      forget(m.id);
      await sendTo(f, { t: 'unf' });
      await rotatePresence();
      break;
    }
    case 'resetCard':
      await resetCard();
      break;
    case 'listen':
      if (prefs.record) await Stats.record(m.t, m.ms, !!m.play, !!(jam && jam.state));
      break;
    case 'skip':
      if (prefs.record) await Stats.skip(m.t);
      break;
    case 'stats':
      if (typeof m.who === 'string' && m.who) await friendStats(port, m.who);
      else {
        const period = ['month', 'year', 'all'].includes(m.period) ? m.period : 'month';
        const data = await Stats.summary(period, typeof m.year === 'number' ? m.year : null);
        port.postMessage({ type: 'stats', who: null, req: str(m.req, 20), data });
      }
      break;
    case 'statsClear':
      await Stats.clear();
      push();
      break;
    case 'statsExport':
      port.postMessage({ type: 'statsExport', data: await Stats.exportAll() });
      break;
    case 'kick':
      await kick(m.id);
      break;
    case 'makeHost':
      makeHost(m.id);
      break;
    case 'newCode':
      await rekey(null);
      break;
  }
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'tab' || !port.sender || port.sender.id !== chrome.runtime.id) return;
  const url = port.sender.url || (port.sender.tab && port.sender.tab.url) || '';
  if (!/^https:\/\/music\.youtube\.com\//.test(url)) return;
  ports.set(port, { np: null, thread: null, open: false });
  driver = port;
  idleSince = 0;
  port.onMessage.addListener(m => handle(port, m).catch(() => {}));
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    ports.delete(port);
    if (driver === port) driver = [...ports.keys()].pop() || null;
    push();
  });
  identity().then(() => {
    push();
    online().catch(() => {});
  });
});

setInterval(() => {
  const now = Date.now();
  beat++;
  if (!ports.size) {
    if (net || jam) {
      if (!idleSince) idleSince = now;
      else if (now - idleSince > 30000) shutdown();
    }
    return;
  }
  idleSince = 0;
  if (!net) {
    if (beat % 20 === 0) online().catch(() => {});
    return;
  }
  if (beat % 120 === 0) publishPresence().catch(() => {});
  if (beat % 8 === 0) prune(now);
  if (jam && jam.state) {
    if (jam.state.host === me.id) {
      hostTick(now);
      if (beat % 12 === 0) sweep(now);
    } else {
      if (beat % 16 === 0) ping();
      if (pendingOps.size) retryOps(now);
      takeover(now);
    }
  }
}, 250);
