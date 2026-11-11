const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = crypto.subtle;
const MAX_PACKET = 1 << 20;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIG = { name: 'ECDSA', hash: 'SHA-256' };
const ABC = 'abcdefghijkmnpqrstuvwxyz23456789';

export function cat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

function u16(n) {
  return Uint8Array.of(n >> 8, n & 255);
}

function str(s) {
  const b = enc.encode(s);
  return cat(u16(b.length), b);
}

function varlen(n) {
  const out = [];
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 128;
    out.push(d);
  } while (n > 0);
  return Uint8Array.from(out);
}

function packet(head, body) {
  return cat(Uint8Array.of(head), varlen(body.length), body);
}

export class Mqtt {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.buf = new Uint8Array(0);
    this.pid = 1;
    this.handlers = {};
    this.ready = false;
  }

  on(ev, fn) {
    this.handlers[ev] = fn;
    return this;
  }

  connect(clientId, will) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, ['mqtt']);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const timer = setTimeout(() => {
        reject(new Error('timeout'));
        ws.close();
      }, 7000);
      this.acked = ok => {
        clearTimeout(timer);
        if (!ok) {
          reject(new Error('refused'));
          ws.close();
          return;
        }
        this.ready = true;
        this.keep = setInterval(() => this.send(Uint8Array.of(0xc0, 0)), 20000);
        resolve();
      };
      ws.onopen = () => {
        let flags = 0x02;
        const payload = [str(clientId)];
        if (will) {
          flags |= 0x04;
          if (will.retain) flags |= 0x20;
          payload.push(str(will.topic), cat(u16(will.payload.length), will.payload));
        }
        ws.send(packet(0x10, cat(str('MQTT'), Uint8Array.of(4, flags), u16(45), ...payload)));
      };
      ws.onmessage = e => this.feed(new Uint8Array(e.data));
      ws.onerror = () => {};
      ws.onclose = () => {
        clearTimeout(timer);
        clearInterval(this.keep);
        const was = this.ready;
        this.ready = false;
        reject(new Error('closed'));
        if (was && this.handlers.close) this.handlers.close();
      };
    });
  }

  feed(chunk) {
    this.buf = this.buf.length ? cat(this.buf, chunk) : chunk;
    for (;;) {
      if (this.buf.length < 2) return;
      let len = 0;
      let mul = 1;
      let i = 1;
      let b;
      do {
        if (i >= this.buf.length) return;
        if (i > 4) return this.close();
        b = this.buf[i++];
        len += (b & 127) * mul;
        mul *= 128;
      } while (b & 128);
      if (len > MAX_PACKET) return this.close();
      if (this.buf.length < i + len) return;
      const head = this.buf[0];
      const body = this.buf.slice(i, i + len);
      this.buf = this.buf.slice(i + len);
      this.handle(head, body);
    }
  }

  handle(head, body) {
    const type = head >> 4;
    if (type === 2) {
      if (this.acked) this.acked(body[1] === 0);
      this.acked = null;
    } else if (type === 3) {
      if (body.length < 2) return;
      const tl = (body[0] << 8) | body[1];
      if (body.length < 2 + tl) return;
      const topic = dec.decode(body.subarray(2, 2 + tl));
      let p = 2 + tl;
      if ((head >> 1) & 3) p += 2;
      if (p > body.length) return;
      if (this.handlers.message) this.handlers.message(topic, body.slice(p));
    }
  }

  send(bytes) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(bytes);
  }

  nextId() {
    this.pid = (this.pid % 65535) + 1;
    return this.pid;
  }

  sub(topic) {
    this.send(packet(0x82, cat(u16(this.nextId()), str(topic), Uint8Array.of(0))));
  }

  unsub(topic) {
    this.send(packet(0xa2, cat(u16(this.nextId()), str(topic))));
  }

  pub(topic, payload, retain = false) {
    this.send(packet(retain ? 0x31 : 0x30, cat(str(topic), payload)));
  }

  close() {
    this.send(Uint8Array.of(0xe0, 0));
    if (this.ws) this.ws.close();
  }
}

export function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unb64(s) {
  const b = atob(s);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export function rid(n) {
  const out = [];
  while (out.length < n) {
    for (const x of crypto.getRandomValues(new Uint8Array(n * 2))) {
      if (x < 224 && out.length < n) out.push(ABC[x % 32]);
    }
  }
  return out.join('');
}

export function isCode(s, n) {
  return typeof s === 'string' && s.length === n && [...s].every(c => ABC.includes(c));
}

export function hashCode(hex, n) {
  let out = '';
  for (let i = 0; out.length < n; i += 2) out += ABC[parseInt(hex.slice(i, i + 2), 16) % 32];
  return out;
}

export async function sha(s) {
  const d = new Uint8Array(await subtle.digest('SHA-256', enc.encode(s)));
  return Array.from(d, x => x.toString(16).padStart(2, '0')).join('');
}

async function hkdf(material, info) {
  const base = await subtle.importKey('raw', material, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('chorus-ytm/1'), info: enc.encode(info) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function keyFrom(secret, info) {
  return hkdf(enc.encode(secret), info);
}

export async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  return cat(iv, ct);
}

export async function open(key, data) {
  if (!data || data.length < 29 || data.length > MAX_PACKET) return null;
  try {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) }, key, data.subarray(12));
    return JSON.parse(dec.decode(pt));
  } catch {
    return null;
  }
}

export function isKey(s) {
  return typeof s === 'string' && /^[A-Za-z0-9+/]{87}=$/.test(s);
}

export async function makeIdentity() {
  const s = await subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  const d = await subtle.generateKey(ECDH, true, ['deriveBits']);
  const sk = b64(new Uint8Array(await subtle.exportKey('raw', s.publicKey)));
  const dk = b64(new Uint8Array(await subtle.exportKey('raw', d.publicKey)));
  return {
    id: await idOf(sk, dk),
    sk,
    dk,
    sPriv: await subtle.exportKey('jwk', s.privateKey),
    dPriv: await subtle.exportKey('jwk', d.privateKey)
  };
}

const ids = new Map();

export async function idOf(sk, dk) {
  const k = sk + '.' + dk;
  if (!ids.has(k)) {
    if (ids.size > 500) ids.clear();
    ids.set(k, (await sha('chorus-id:' + k)).slice(0, 20));
  }
  return ids.get(k);
}

export function loadSign(jwk) {
  return subtle.importKey('jwk', jwk, ECDSA, false, ['sign']);
}

export function loadDh(jwk) {
  return subtle.importKey('jwk', jwk, ECDH, false, ['deriveBits']);
}

const verifiers = new Map();

async function verifier(sk) {
  if (!verifiers.has(sk)) {
    if (verifiers.size > 300) verifiers.clear();
    verifiers.set(sk, await subtle.importKey('raw', unb64(sk), ECDSA, false, ['verify']));
  }
  return verifiers.get(sk);
}

export async function sign(priv, text) {
  return b64(new Uint8Array(await subtle.sign(SIG, priv, enc.encode(text))));
}

export async function verify(sk, text, sig) {
  if (!isKey(sk) || typeof text !== 'string' || typeof sig !== 'string' || sig.length > 200) return false;
  try {
    return await subtle.verify(SIG, await verifier(sk), unb64(sig), enc.encode(text));
  } catch {
    return false;
  }
}

export async function sealTo(dk, obj) {
  const eph = await subtle.generateKey(ECDH, true, ['deriveBits']);
  const pub = await subtle.importKey('raw', unb64(dk), ECDH, false, []);
  const bits = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: pub }, eph.privateKey, 256));
  const ephRaw = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const key = await hkdf(cat(bits, ephRaw), 'inbox');
  return cat(ephRaw, await seal(key, obj));
}

export async function openBox(priv, data) {
  if (!data || data.length < 65 + 29 || data.length > MAX_PACKET) return null;
  try {
    const ephRaw = data.slice(0, 65);
    const pub = await subtle.importKey('raw', ephRaw, ECDH, false, []);
    const bits = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256));
    return await open(await hkdf(cat(bits, ephRaw), 'inbox'), data.subarray(65));
  } catch {
    return null;
  }
}
