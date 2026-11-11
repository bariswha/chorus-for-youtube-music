function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function safeImg(u) {
  if (typeof u !== 'string' || u.length > 400) return '';
  if (/^https:\/\/i\.ytimg\.com\/vi\/[A-Za-z0-9_-]{11}\/(?:default|mqdefault|hqdefault|sddefault|maxresdefault|hq720)\.jpg$/.test(u)) return u;
  return /^https:\/\/(?:lh3|yt3)\.googleusercontent\.com\/[A-Za-z0-9_-]{16,360}(?:=[A-Za-z0-9-]{1,40})?$/.test(u) ? u : '';
}

const YT_PATH = /^\/(?:watch\?v=[A-Za-z0-9_-]{11}(?:&list=[A-Za-z0-9_-]{2,80})?|playlist\?list=[A-Za-z0-9_-]{2,80}|(?:browse|channel)\/[A-Za-z0-9_-]{2,80})$/;

function safePath(u) {
  if (typeof u !== 'string' || !u.startsWith('https://music.youtube.com/')) return '';
  const path = u.slice('https://music.youtube.com'.length);
  return YT_PATH.test(path) ? path : '';
}

function attrs(o) {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
    .join('');
}

function idTag(id, friend, v) {
  if (!id || (v && v.me && id === v.me.id)) return '';
  return friend ? `<span class="chorus-idtag is-friend">${esc(tr('friendTag'))}</span>` : `<span class="chorus-idtag">#${esc(String(id).slice(0, 4).toUpperCase())}</span>`;
}

function hue(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function avatar(p, size, dot) {
  const url = safeImg(p && p.avatar);
  const name = String((p && p.name) || '?').trim() || '?';
  const status = dot ? `<i class="chorus-presence${dot === 'on' ? ' is-on' : ''}"></i>` : '';
  if (url) return `<span class="chorus-av chorus-av${size}" style="background-image:url('${esc(url)}')">${status}</span>`;
  return `<span class="chorus-av chorus-av${size} chorus-av-letter" style="--chorus-h:${hue(name)}"><b>${esc([...name][0].toUpperCase())}</b>${status}</span>`;
}

function artwork(t, size) {
  const url = safeImg(t && t.art);
  return `<span class="chorus-art chorus-art${size}"${url ? ` style="background-image:url('${esc(url)}')"` : ''}></span>`;
}

function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

function hhmm(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function position(s) {
  if (!s || !s.cur || s.ended) return 0;
  const p = s.playing ? s.pos + (Date.now() + (s.skew || 0) - s.at) : s.pos;
  return Math.max(0, Math.min(p, s.cur.t.dur || p));
}

function rich(text) {
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(/https:\/\/music\.youtube\.com\/[^\s<>"'`]+/g)) {
    out.push(esc(text.slice(last, m.index)));
    const path = safePath(m[0]);
    out.push(path ? `<a href="${esc(path)}" data-nav>${esc(m[0].slice(8))}</a>` : esc(m[0]));
    last = m.index + m[0].length;
  }
  out.push(esc(text.slice(last)));
  return out.join('');
}

const ICON = {
  jam: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.25A5.75 5.75 0 002.25 8v4.25c0 .97.78 1.75 1.75 1.75h1.5V9.25H3.75V8a4.25 4.25 0 018.5 0v1.25H10.5V14H12c.97 0 1.75-.78 1.75-1.75V8A5.75 5.75 0 008 2.25z" fill="currentColor"/></svg>',
  close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.94 8l-4.47 4.47 1.06 1.06L8 9.06l4.47 4.47 1.06-1.06L9.06 8l4.47-4.47-1.06-1.06L8 6.94 3.53 2.47 2.47 3.53 6.94 8z" fill="currentColor"/></svg>',
  gear: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M6.7 1h2.6l.4 1.9 1.2.7 1.8-.6 1.3 2.3-1.4 1.3v1.4l1.4 1.3-1.3 2.3-1.8-.6-1.2.7-.4 1.9H6.7l-.4-1.9-1.2-.7-1.8.6L2 10.3l1.4-1.3V7.6L2 6.3l1.3-2.3 1.8.6 1.2-.7L6.7 1zM8 10.25a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.53 2.47L2 8l5.53 5.53 1.06-1.06-3.72-3.72H14v-1.5H4.87l3.72-3.72-1.06-1.06z" fill="currentColor"/></svg>',
  add: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 3.25h9v1.5H1zM1 7.25h9v1.5H1zM1 11.25h6v1.5H1zM12.25 9v-2.5h1.5V9H16v1.5h-2.25V13h-1.5v-2.5H10V9z" fill="currentColor"/></svg>',
  next: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.32 4.42a.5.5 0 000-.84L1.77 1.98A.5.5 0 001 2.4v3.2a.5.5 0 00.77.42l2.55-1.6zM7 4.75h8v-1.5H7zM7 9.75h8v-1.5H7zM1 14.75h14v-1.5H1z" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.322 7.576a.5.5 0 0 1 0 .848l-6.557 4.098A.5.5 0 0 1 5 12.098V3.902a.5.5 0 0 1 .765-.424l6.557 4.098Z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3h2.25v10H4.5zM9.25 3h2.25v10H9.25z" fill="currentColor"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.44 3c-.25 0-.44.2-.44.45v17.1c0 .25.2.45.44.45h1.78c.25 0 .45-.2.45-.45v-7.99l12.65 8.01c.3.19.68-.03.68-.38V3.81c0-.35-.38-.57-.68-.38L6.67 11.44V3.45c0-.25-.2-.45-.45-.45H4.44z" fill="currentColor"/></svg>',
  skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.78 3c-.25 0-.45.2-.45.45v7.99L4.68 3.43c-.3-.19-.68.03-.68.38v16.38c0 .35.38.57.68.38l12.65-8.01v7.99c0 .25.2.45.45.45h1.78c.24 0 .44-.2.44-.45V3.45c0-.25-.2-.45-.44-.45h-1.78z" fill="currentColor"/></svg>',
  remove: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.94 8l-4.47 4.47 1.06 1.06L8 9.06l4.47 4.47 1.06-1.06L9.06 8l4.47-4.47-1.06-1.06L8 6.94 3.53 2.47 2.47 3.53 6.94 8z" fill="currentColor"/></svg>',
  grip: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3h2v2H5zM9 3h2v2H9zM5 7h2v2H5zM9 7h2v2H9zM5 11h2v2H5zM9 11h2v2H9z" fill="currentColor"/></svg>',
  copy: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 1h9v10h-2.5V9.5h1v-7h-6v1H5V1zM2 5h9v10H2V5zm1.5 1.5v7h6v-7h-6z" fill="currentColor"/></svg>',
  mic: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1a2.75 2.75 0 00-2.75 2.75v4a2.75 2.75 0 005.5 0v-4A2.75 2.75 0 008 1zM3.5 7.5H2v.25a6 6 0 005.25 5.95V15h1.5v-1.3A6 6 0 0014 7.75V7.5h-1.5v.25a4.5 4.5 0 01-9 0V7.5z" fill="currentColor"/></svg>',
  spark: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6L8 1zM13 11l.7 1.3L15 13l-1.3.7L13 15l-.7-1.3L11 13l1.3-.7L13 11z" fill="currentColor"/></svg>',
  chat: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v6a1.5 1.5 0 01-1.5 1.5H7l-3.2 2.7A.5.5 0 013 13.3V11h.5A1.5 1.5 0 012 9.5v-6zm1.5 0v6H4.5v1.6L6.5 9.5h6v-6h-9z" fill="currentColor"/></svg>',
  people: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2.5a2.75 2.75 0 110 5.5 2.75 2.75 0 010-5.5zm0 1.5a1.25 1.25 0 100 2.5A1.25 1.25 0 006 4zM1 13c0-2.2 2.2-3.75 5-3.75s5 1.55 5 3.75v.75H1V13zm1.6-.75h6.8C9.05 11.4 7.8 10.75 6 10.75s-3.05.65-3.4 1.5zM11 3a2.5 2.5 0 012.2 3.7 2.5 2.5 0 01-1.7 1.25l-.45-1.43A1 1 0 0011 4.5V3zm1.3 6.2c1.6.45 2.7 1.6 2.7 3.05v1.5h-2.3v-1.5h.75c-.1-.6-.7-1.2-1.6-1.5l.45-1.55z" fill="currentColor"/></svg>',
  send: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.7 1.6a.5.5 0 01.55-.07l12.5 6a.5.5 0 010 .9l-12.5 6a.5.5 0 01-.7-.57L2.9 8 1.55 2.14a.5.5 0 01.15-.54zM4.2 8.75l-.9 3.9L12.3 8 3.3 3.35l.9 3.9H8v1.5H4.2z" fill="currentColor"/></svg>',
  more: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm5 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm5 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" fill="currentColor"/></svg>',
  music: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 1.6v9.15A2.25 2.25 0 1112 8.63V4.9L6.5 6.1v6.15A2.25 2.25 0 115 10.13V3.1l8.5-1.5z" fill="currentColor"/></svg>',
  personAdd: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2.5a2.75 2.75 0 110 5.5 2.75 2.75 0 010-5.5zM6 4a1.25 1.25 0 100 2.5A1.25 1.25 0 006 4zM1 13c0-2.2 2.2-3.75 5-3.75 1 0 1.9.2 2.7.55L8 11.1a5 5 0 00-2-.35c-1.8 0-3.05.65-3.4 1.5H8v1.5H1V13zm11.25-4v1.75H14v1.5h-1.75V14h-1.5v-1.75H9v-1.5h1.75V9h1.5z" fill="currentColor"/></svg>',
  chart: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 14.5V1.5h1.5v11.5h11v1.5H2zm3-3V8h1.75v3.5H5zm3.25 0V5h1.75v6.5H8.25zm3.25 0V3h1.75v8.5H11.5z" fill="currentColor"/></svg>',
  moon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.2 1.6a.75.75 0 01.2.8A5.25 5.25 0 0013.6 9.6a.75.75 0 01.98.95A6.75 6.75 0 115.4 1.42a.75.75 0 01.8.18zM4.6 3.4a5.25 5.25 0 107.95 7.95A6.75 6.75 0 014.6 3.4z" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5A3.25 3.25 0 004.75 4.75V6.5H3.5v8h9v-8h-1.25V4.75A3.25 3.25 0 008 1.5zm1.75 5V4.75a1.75 1.75 0 10-3.5 0V6.5h3.5zM5 8h6v5H5V8z" fill="currentColor"/></svg>'
};

const REACTIONS = ['❤️', '🔥', '😂', '🥹', '🎉'];

function sameNode(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
  if (a.nodeType !== 1) return true;
  return (a.getAttribute('data-key') || '') === (b.getAttribute('data-key') || '');
}

function patch(dom, next) {
  if (dom.nodeType !== 1) {
    if (dom.nodeValue !== next.nodeValue) dom.nodeValue = next.nodeValue;
    return;
  }
  for (const a of [...dom.attributes]) if (!next.hasAttribute(a.name)) dom.removeAttribute(a.name);
  for (const a of next.attributes) if (dom.getAttribute(a.name) !== a.value) dom.setAttribute(a.name, a.value);
  if (dom.tagName === 'INPUT') {
    const v = next.getAttribute('value') || '';
    if (dom.getRootNode().activeElement !== dom && dom.value !== v && !dom.dataset.keep) dom.value = v;
    return;
  }
  patchChildren(dom, next);
}

function patchChildren(dom, next) {
  const keyed = new Map();
  for (const c of dom.children) if (c.dataset.key) keyed.set(c.dataset.key, c);
  const kids = [...next.childNodes];
  let i = 0;
  for (const nk of kids) {
    const cur = dom.childNodes[i] || null;
    const key = nk.nodeType === 1 ? nk.getAttribute('data-key') : null;
    let match = null;
    if (key) {
      match = keyed.get(key) || null;
      keyed.delete(key);
    } else if (cur && sameNode(cur, nk)) {
      match = cur;
    }
    if (match) {
      if (match !== cur) dom.insertBefore(match, cur);
      patch(match, nk);
    } else {
      const node = document.importNode(nk, true);
      if (key && node.classList) node.classList.add('chorus-enter');
      dom.insertBefore(node, cur);
    }
    i++;
  }
  while (dom.childNodes.length > kids.length) dom.removeChild(dom.lastChild);
}

function sw(on, attr) {
  return `<span class="chorus-switch${on ? ' is-on' : ''}"${attr || ''}><i></i></span>`;
}

function btn(label, act, kind, data) {
  return `<button type="button" class="chorus-b chorus-b-${kind || 'sec'}"${attrs({ 'data-act': act, ...(data || {}) })}>${esc(label)}</button>`;
}

function ibtn(icon, label, act, data, extra) {
  return `<button type="button" class="chorus-ib${extra ? ' ' + extra : ''}"${attrs({ 'data-act': act, title: label, 'aria-label': label, ...(data || {}) })}>${icon}</button>`;
}

const UI = {
  onAction: () => {},
  view: null,
  panel: null,
  toasts: null,
  isOpen: false,
  tab: 'jam',
  page: null,
  thread: null,
  menu: null,
  confirm: null,
  dragQid: null,
  lastHtml: '',
  lyrics: new Map(),
  lastLine: -2,
  userScroll: 0,
  soloTick: null,
  stick: true,
  sentThread: '',
  stats: new Map(),
  statsWho: null,
  statsPeriod: 'month',
  recapYear: 0,
  sleep: null,

  init() {
    this.host = document.createElement('div');
    this.host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483000;display:none';
    this.root = this.host.attachShadow({ mode: 'closed' });
    this.sheet = document.createElement('style');
    this.root.appendChild(this.sheet);
    this.panel = document.createElement('div');
    this.panel.className = 'chorus-ui chorus-panel';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Chorus');
    this.root.appendChild(this.panel);
    this.toasts = document.createElement('div');
    this.toasts.className = 'chorus-ui chorus-toasts';
    this.toasts.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.toasts);
    document.body.appendChild(this.host);
    this.bindPanel();
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        this.inject();
      });
    }).observe(document.body, { childList: true, subtree: true });
    this.watchMenus();
    this.inject();
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.isOpen && !this.docked()) this.toggle(false);
    });
    document.addEventListener('mousedown', e => {
      if (!this.isOpen || this.docked()) return;
      if (e.target === this.host || !(e.target instanceof Element) || e.target.closest('.chorus-btn, .chorus-lbtn, .chorus-hd, ytmusic-popup-container, tp-yt-iron-dropdown')) return;
      this.toggle(false);
    });
    let resizing = false;
    window.addEventListener('resize', () => {
      if (resizing) return;
      resizing = true;
      requestAnimationFrame(() => {
        resizing = false;
        this.layout();
      });
    });
    setInterval(() => this.progress(), 100);
    const scrolled = () => {
      this.userScroll = Date.now();
    };
    this.panel.addEventListener('wheel', scrolled, { passive: true });
    this.panel.addEventListener('touchmove', scrolled, { passive: true });
    this.panel.addEventListener(
      'scroll',
      e => {
        if (e.target.classList && e.target.classList.contains('chorus-thread-body')) {
          const b = e.target;
          this.stick = b.scrollHeight - b.scrollTop - b.clientHeight < 48;
        }
      },
      true
    );
    I18N.onChange(() => {
      this.lastHtml = '';
      this.render();
      this.inject(true);
    });
    let keep = false;
    try {
      keep = localStorage.getItem('chorus.open') === '1';
    } catch {}
    if (keep) this.toggle(true);
  },

  docked() {
    return false;
  },

  setCss(text) {
    if (typeof text !== 'string' || !text) return;
    this.sheet.textContent = text;
    this.host.style.display = 'block';
  },

  layout() {
    const d = this.docked();
    this.panel.classList.toggle('is-docked', d);
    document.documentElement.classList.toggle('chorus-docked', d);
  },

  toggle(force) {
    this.isOpen = typeof force === 'boolean' ? force : !this.isOpen;
    this.panel.classList.toggle('is-open', this.isOpen);
    this.layout();
    this.indicators();
    try {
      localStorage.setItem('chorus.open', this.isOpen ? '1' : '0');
    } catch {}
    if (this.isOpen) this.render();
    else {
      this.page = null;
      this.menu = null;
      this.confirm = null;
    }
    this.syncThread();
  },

  open(page, thread) {
    this.page = page || null;
    if (page === 'thread') {
      this.thread = thread;
      this.stick = true;
    }
    this.menu = null;
    this.confirm = null;
    this.lastLine = -2;
    this.userScroll = 0;
    if (this.isOpen) this.render();
    else this.toggle(true);
    this.indicators();
    this.syncThread();
    if (page === 'thread') setTimeout(() => this.focusCompose(), 60);
  },

  goTab(tab) {
    this.tab = tab;
    this.page = null;
    this.menu = null;
    this.confirm = null;
    if (!this.isOpen) this.toggle(true);
    else this.render();
    this.syncThread();
  },

  syncThread() {
    const id = this.isOpen && this.page === 'thread' ? this.thread : null;
    const key = (id || '') + ':' + this.isOpen;
    if (key === this.sentThread) return;
    this.sentThread = key;
    this.onAction('thread', { id, open: !!id });
  },

  focusCompose() {
    const input = this.panel.querySelector('input[data-role="compose"]');
    if (input && !input.disabled) input.focus();
  },

  solo(m) {
    const prev = this.soloTick;
    this.soloTick = m;
    if ((prev && prev.t && prev.t.id) !== (m.t && m.t.id)) {
      this.indicators();
      if (!this.jam() && this.page === 'lyrics') {
        this.lastLine = -2;
        this.render();
      }
    }
  },

  track() {
    const j = this.jam();
    if (j) return j.cur && !j.ended ? j.cur.t : null;
    return this.soloTick && this.soloTick.t;
  },

  pos() {
    const j = this.jam();
    if (j) return position(j);
    const m = this.soloTick;
    if (!m) return 0;
    return m.playing && !m.buf ? m.pos + (Date.now() - m.ts) : m.pos;
  },

  update(view) {
    this.view = view;
    if (this.page === 'thread' && this.thread !== 'jam' && view && !view.friends.some(f => f.id === this.thread)) this.page = null;
    if (this.page === 'thread' && this.thread === 'jam' && !this.jam()) this.page = null;
    this.render();
    this.indicators();
  },

  jam() {
    const v = this.view;
    return v && v.jam && !v.jam.pending && v.jam.v ? v.jam : null;
  },

  inJam() {
    return !!this.jam();
  },

  badges() {
    const v = this.view;
    if (!v) return { jam: 0, chat: 0, friends: 0 };
    const j = this.jam();
    const chat = (j ? j.unread || 0 : 0) + v.friends.reduce((n, f) => n + (f.unread || 0), 0);
    return { jam: v.invites.length, chat, friends: v.requests.filter(r => r.dir === 'in').length };
  },

  indicators() {
    const j = this.jam();
    const n = j ? Object.keys(j.members).length : 0;
    const b = this.badges();
    const alert = b.jam + b.chat + b.friends > 0;
    document.querySelectorAll('.chorus-btn').forEach(el => {
      el.classList.toggle('chorus-on', !!j || alert);
      el.title = j ? `Jam · ${n}` : 'Chorus';
      el.classList.toggle('is-selected', this.isOpen && this.page !== 'lyrics');
    });
    const L = this.lyricsOf();
    const has = !!(L && L !== 'loading' && (L.synced || L.plain));
    document.querySelectorAll('.chorus-lbtn').forEach(el => {
      el.classList.toggle('is-selected', this.isOpen && this.page === 'lyrics');
      el.classList.toggle('chorus-on', has);
    });
    document.querySelectorAll('.chorus-hd').forEach(h => h.classList.toggle('chorus-on', !!j || alert));
  },

  barButton(cls, icon, label, run) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls + ' chorus-barbtn';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = `${icon}<span class="chorus-dot"></span>`;
    b.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (e.isTrusted) run();
    });
    return b;
  },

  inject(relabel) {
    if (relabel) {
      document.querySelectorAll('.chorus-lbtn').forEach(b => {
        b.title = tr('lyrics');
        b.setAttribute('aria-label', tr('lyrics'));
      });
      document.querySelectorAll('.chorus-hd').forEach(a => (a.title = tr('jamHint')));
      document.querySelectorAll('.chorus-menugroup').forEach(x => x.remove());
    }
    const right = document.querySelector('ytmusic-miniplayer .ytMusicMiniPlayerRightSection, ytmusic-player-bar .right-controls-buttons');
    if (right && !right.querySelector('.chorus-btn')) {
      right.insertBefore(this.barButton('chorus-btn', ICON.jam, 'Chorus', () => this.toggle()), right.firstChild);
      this.indicators();
    }
    if (right && !right.querySelector('.chorus-lbtn')) {
      const b = this.barButton('chorus-lbtn', ICON.mic, tr('lyrics'), () => {
        if (this.isOpen && this.page === 'lyrics') this.toggle(false);
        else this.open('lyrics');
      });
      right.insertBefore(b, right.querySelector('.chorus-btn'));
      this.indicators();
    }
    const nav = document.querySelector('ytmusic-nav-bar #right-content');
    if (nav && !nav.querySelector('.chorus-hd')) {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'chorus-hd';
      d.title = tr('jamHint');
      d.innerHTML = '<span>Jam</span><span class="chorus-dot"></span>';
      d.addEventListener('click', e => {
        e.preventDefault();
        if (e.isTrusted) this.toggle();
      });
      nav.insertBefore(d, nav.firstChild);
      this.indicators();
    }
    this.menuSync();
  },

  watchMenus() {
    const OWNER = 'ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer, ytmusic-player-queue-item, ytmusic-miniplayer, ytmusic-player-bar, ytmusic-responsive-header-renderer, ytmusic-detail-header-renderer';
    const grab = (e, needMenu) => {
      if (!e.isTrusted || !(e.target instanceof Element)) return;
      if (e.target.closest('ytmusic-popup-container, .chorus-ui')) return;
      if (needMenu && !e.target.closest('ytmusic-menu-renderer, .ytMusicMiniPlayerMenuButton, ytmusic-player-bar .middle-controls-buttons')) return;
      const owner = e.target.closest(OWNER);
      if (!owner) return;
      const mark = Math.random().toString(36).slice(2, 12);
      document.querySelectorAll('[data-chorus-pick]').forEach(x => x.removeAttribute('data-chorus-pick'));
      owner.setAttribute('data-chorus-pick', mark);
      this.pick = { mark, at: Date.now(), item: null };
      this.onAction('pick', { mark });
    };
    document.addEventListener('pointerdown', e => grab(e, true), true);
    document.addEventListener('contextmenu', e => grab(e, false), true);
  },

  picked(mark, item) {
    if (!this.pick || this.pick.mark !== mark) return;
    this.pick.item = item;
    this.menuSync();
  },

  menuSync() {
    const pops = [...document.querySelectorAll('ytmusic-popup-container ytmusic-menu-popup-renderer')];
    const pop = pops.find(p => {
      const dd = p.closest('tp-yt-iron-dropdown');
      return dd && dd.style.display !== 'none' && dd.getAttribute('aria-hidden') !== 'true' && p.getClientRects().length > 0;
    });
    for (const p of pops) if (p !== pop) p.querySelectorAll('.chorus-menugroup').forEach(x => x.remove());
    if (!pop) return;
    const pk = this.pick;
    const item = pk && Date.now() - pk.at < 5000 ? pk.item : null;
    const group = pop.querySelector('.chorus-menugroup');
    const j = this.jam();
    const key = item ? [pk.mark, tr('addToJam'), j ? j.can.add : '-', j ? j.can.ctl : '-'].join(':') : '';
    if (group && group.dataset.key === key) return;
    if (group) group.remove();
    if (!item) return;
    const list = pop.querySelector('#items');
    if (!list) return;
    const canAdd = !j || j.can.add;
    const canCtl = !j || j.can.ctl;
    const g = document.createElement('div');
    g.className = 'chorus-ui chorus-menugroup';
    g.dataset.key = key;
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'keydown']) g.addEventListener(type, e => e.stopPropagation());
    const make = (label, icon, mode) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chorus-menuitem';
      b.setAttribute('role', 'menuitem');
      b.innerHTML = `<span class="chorus-menuicon">${icon}</span><span class="chorus-menulabel">${esc(label)}</span>`;
      b.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (!e.isTrusted) return;
        this.onAction('menu', { close: true });
        this.onAction('add', { ref: item.ref, mode });
      });
      return b;
    };
    const set = item.kind === 'set';
    if (canAdd) g.appendChild(make(tr(set ? 'addAllToJam' : 'addToJam'), ICON.add, 'end'));
    if (j && canCtl) g.appendChild(make(tr('playNextInJam'), ICON.next, 'next'));
    if ((set || j) && canCtl) g.appendChild(make(tr('playNowInJam'), ICON.play, 'now'));
    if (!g.childNodes.length) return;
    list.insertBefore(g, list.firstChild);
    this.onAction('menu', { close: false });
  },

  bindPanel() {
    const p = this.panel;
    p.addEventListener('click', e => {
      if (!e.isTrusted) return;
      const link = e.target.closest('a[data-nav]');
      if (link) {
        e.preventDefault();
        this.navigate(link.getAttribute('href'));
        return;
      }
      const t = e.target.closest('[data-act]');
      if (!t || t.tagName === 'INPUT' || t.disabled) return;
      e.preventDefault();
      const act = t.dataset.act;
      const d = t.dataset;
      switch (act) {
        case 'close':
          return this.toggle(false);
        case 'page':
          return this.open(d.page);
        case 'back':
          this.page = null;
          this.menu = null;
          this.render();
          this.syncThread();
          return;
        case 'tab':
          return this.goTab(d.mode);
        case 'thread':
          return this.open('thread', d.id);
        case 'menu':
          this.menu = this.menu === d.id ? null : d.id;
          this.confirm = null;
          return this.render();
        case 'confirm':
          this.confirm = d.id;
          return this.render();
        case 'cancelConfirm':
          this.confirm = null;
          this.menu = null;
          return this.render();
        case 'seekbar': {
          const r = t.getBoundingClientRect();
          this.onAction('seekTo', { ratio: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) });
          return;
        }
        case 'copycode': {
          const j = this.jam();
          if (j && j.code) this.copy(j.code, tr('codeCopied'));
          return;
        }
        case 'copycard':
          if (this.view && this.view.card) this.copy(this.view.card, tr('cardCopied'));
          return;
        case 'joincode':
          return this.submit('code', 'joincode');
        case 'friendcode':
          return this.submit('friend', 'friendCode');
        case 'send':
          return this.send();
        case 'shareTrack': {
          const tk = this.track();
          const input = p.querySelector('input[data-role="compose"]');
          if (tk && input && !input.disabled) {
            input.value = (input.value ? input.value.trimEnd() + ' ' : '') + tk.url;
            input.focus();
          }
          return;
        }
        case 'lang':
          return I18N.set(d.mode);
        case 'statsOpen':
          return this.openStats(d.id || null);
        case 'period':
          this.statsPeriod = d.mode;
          this.render();
          return this.askStats();
        case 'recap':
          return this.openRecap(+d.mode);
        case 'copyRecap':
          return this.copy(this.recapText(), tr('recapCopied'));
        case 'sleep':
          this.onAction('sleep', { mode: d.mode });
          return this.render();
        case 'statsClearAsk':
          this.confirm = 'stats';
          return this.render();
      }
      if (act === 'statsClear') {
        this.confirm = null;
        this.stats.clear();
      }
      if (act === 'kick' || act === 'friendRemove') {
        this.menu = null;
        this.confirm = null;
      }
      if (act === 'makeHost') this.menu = null;
      this.onAction(act, { id: d.id, qid: d.qid, mode: d.mode, yes: d.yes === '1', ms: d.ms ? +d.ms : undefined });
    });
    p.addEventListener('change', e => {
      if (!e.isTrusted) return;
      if (e.target.matches('input[data-act]')) this.onAction(e.target.dataset.act, { value: e.target.value });
    });
    p.addEventListener('keydown', e => {
      if (!e.isTrusted || e.key !== 'Enter' || e.isComposing) return;
      const role = e.target.dataset && e.target.dataset.role;
      if (role === 'compose') {
        e.preventDefault();
        this.send();
      } else if (role === 'code') this.submit('code', 'joincode');
      else if (role === 'friend') this.submit('friend', 'friendCode');
      else if (e.target.matches('input[data-act]')) e.target.blur();
    });
    p.addEventListener('dragstart', e => {
      const li = e.target.closest('.chorus-item[draggable="true"]');
      if (!li) return;
      this.dragQid = li.dataset.qid;
      li.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', this.dragQid);
    });
    p.addEventListener('dragover', e => {
      if (!this.dragQid) return;
      e.preventDefault();
      const li = e.target.closest('.chorus-item');
      p.querySelectorAll('.drop-before, .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
      if (li && li.dataset.qid !== this.dragQid) {
        const r = li.getBoundingClientRect();
        li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
      }
    });
    p.addEventListener('drop', e => {
      if (!this.dragQid || !e.isTrusted) return;
      e.preventDefault();
      const li = e.target.closest('.chorus-item');
      const q = (this.jam() && this.jam().queue) || [];
      const from = q.findIndex(x => x.qid === this.dragQid);
      if (li && from >= 0 && li.dataset.qid !== this.dragQid) {
        let to = q.findIndex(x => x.qid === li.dataset.qid);
        if (to < 0) {
          this.endDrag();
          return;
        }
        if (li.classList.contains('drop-after')) to++;
        if (from < to) to--;
        const qid = this.dragQid;
        this.endDrag();
        if (to !== from) this.onAction('move', { qid, to });
        return;
      }
      this.endDrag();
    });
    p.addEventListener('dragend', () => this.endDrag());
  },

  submit(role, act) {
    const input = this.panel.querySelector(`input[data-role="${role}"]`);
    const value = input && input.value.trim();
    if (!value) return;
    this.onAction(act, { value });
    input.value = '';
  },

  send() {
    const input = this.panel.querySelector('input[data-role="compose"]');
    const text = input && input.value.trim();
    if (!text || !this.thread || input.disabled) return;
    this.stick = true;
    this.onAction('chat', { id: this.thread, value: text });
    input.value = '';
    input.focus();
  },

  endDrag() {
    if (!this.dragQid) return;
    this.dragQid = null;
    this.panel.querySelectorAll('.is-dragging, .drop-before, .drop-after').forEach(x => x.classList.remove('is-dragging', 'drop-before', 'drop-after'));
    this.render();
  },

  copy(text, msg) {
    const done = () => this.toast(msg);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => {});
  },

  navigate(path) {
    if (typeof path === 'string' && YT_PATH.test(path)) this.onAction('nav', { path });
  },

  render() {
    if (!this.isOpen || this.dragQid) return;
    const html = this.html(this.view);
    if (html === this.lastHtml && this.panel.childNodes.length) return;
    this.lastHtml = html;
    const next = document.createElement('div');
    next.innerHTML = html;
    patchChildren(this.panel, next);
    this.lastLine = -2;
    this.progress();
    if (this.page === 'thread' && this.stick) {
      const b = this.panel.querySelector('.chorus-thread-body');
      if (b) b.scrollTop = b.scrollHeight;
    }
  },

  setLyrics(id, data) {
    this.lyrics.set(String(id), data);
    if (this.lyrics.size > 100) this.lyrics.delete(this.lyrics.keys().next().value);
    this.lastLine = -2;
    this.render();
    this.indicators();
  },

  lyricsOf() {
    const t = this.track();
    return t ? this.lyrics.get(String(t.id)) : undefined;
  },

  lineAt(lines, pos) {
    let lo = 0;
    let hi = lines.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid][0] <= pos + 150) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return idx;
  },

  progress() {
    if (!this.isOpen) return;
    if (this.sleep) {
      const chip = this.panel.querySelector('.chorus-sleep-left');
      const text = this.sleepLeft();
      if (chip && chip.textContent !== text) chip.textContent = text;
    }
    const j = this.jam();
    if (!this.track()) return;
    const pos = this.pos();
    const bar = this.panel.querySelector('.chorus-prog-fill');
    if (bar && j && j.cur) {
      const dur = j.cur.t.dur || 0;
      bar.style.transform = `scaleX(${dur ? Math.min(1, pos / dur) : 0})`;
      const t = this.panel.querySelector('.chorus-time-cur');
      if (t) t.textContent = clock(pos);
    }
    const L = this.lyricsOf();
    if (!L || !L.synced) return;
    const idx = this.lineAt(L.synced, pos);
    const peek = this.panel.querySelector('.chorus-nowline');
    if (peek) {
      const text = idx >= 0 ? L.synced[idx][1] : '';
      if (peek.textContent !== text) peek.textContent = text;
    }
    if (this.page !== 'lyrics' || idx === this.lastLine) return;
    this.lastLine = idx;
    const lines = this.panel.querySelectorAll('.chorus-line');
    lines.forEach((el, i) => {
      el.classList.toggle('is-on', i === idx);
      el.classList.toggle('is-past', i < idx);
    });
    const body = this.panel.querySelector('.chorus-body');
    const el = lines[Math.max(0, idx)];
    if (body && el && Date.now() - this.userScroll > 3000) {
      const top = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
      body.scrollTo({ top: top - body.clientHeight * 0.4, behavior: 'smooth' });
    }
  },

  html(v) {
    const jam = this.jam();
    const page = this.page;
    if (page === 'lyrics') return this.headHtml(v, jam) + `<div class="chorus-body chorus-lyr-body" data-key="lyrics">${this.lyricsHtml()}</div>`;
    if (!v || !v.me) return this.headHtml(v, null) + `<div class="chorus-body" data-key="boot"><div class="chorus-loading"><span class="chorus-spin"></span>${esc(tr('connecting'))}</div></div>`;
    if (page === 'settings') return this.headHtml(v, jam) + `<div class="chorus-body" data-key="settings">${this.settingsHtml(v, jam)}</div>`;
    if (page === 'thread') return this.headHtml(v, jam) + this.threadHtml(v, jam);
    if (page === 'stats') return this.headHtml(v, jam) + `<div class="chorus-body" data-key="stats:${esc(this.statsWho || 'me')}">${this.statsHtml(v)}</div>`;
    if (page === 'recap') return this.headHtml(v, jam) + `<div class="chorus-body chorus-recap" data-key="recap:${this.recapYear}">${this.recapHtml()}</div>`;
    let body;
    if (this.tab === 'chat') body = this.chatListHtml(v, jam);
    else if (this.tab === 'friends') body = this.friendsHtml(v, jam);
    else body = this.jamTabHtml(v, jam);
    const off = v.online ? '' : `<div class="chorus-offline" data-key="offline"><span class="chorus-spin"></span>${esc(tr('reconnecting'))}</div>`;
    return this.headHtml(v, jam) + this.tabsHtml() + off + `<div class="chorus-body" data-key="tab-${this.tab}">${body}</div>`;
  },

  headHtml(v, jam) {
    const page = this.page;
    let left;
    if (page) {
      let title = tr(page === 'lyrics' ? 'lyrics' : page === 'stats' ? 'stats' : page === 'recap' ? 'recap' : 'settings');
      let extra = '';
      if (page === 'stats' && this.statsWho) {
        const f = v && v.friends.find(x => x.id === this.statsWho);
        extra = f ? `<span class="chorus-head-sub">${esc(f.name)}</span>` : '';
      }
      if (page === 'recap') title = tr('recapTitle', { year: this.recapYear });
      if (page === 'thread') {
        if (this.thread === 'jam') {
          title = tr('jamChat');
          extra = jam ? `<span class="chorus-head-sub">${esc(tr('people', { n: Object.keys(jam.members).length }))}</span>` : '';
        } else {
          const f = v && v.friends.find(x => x.id === this.thread);
          title = f ? f.name : '';
          extra = f ? `<span class="chorus-head-sub">${esc(f.on ? tr('online') : tr('offline'))}</span>` : '';
        }
      }
      left = `${ibtn(ICON.back, tr('back'), 'back')}<div class="chorus-title-stack"><span class="chorus-title-t is-sub">${esc(title)}</span>${extra}</div>`;
    } else {
      left = `<span class="chorus-title-t">Chorus</span>${jam ? `<span class="chorus-live"><i></i>${esc(tr('live'))}</span>` : ''}`;
    }
    const stack =
      jam && !page
        ? `<div class="chorus-stack" title="${esc(
            Object.values(jam.members)
              .map(m => m.name)
              .join(', ')
          )}">${Object.values(jam.members)
            .slice(0, 4)
            .map(m => avatar(m, 24))
            .join('')}</div>`
        : '';
    const gear = !page && v && v.me ? ibtn(ICON.chart, tr('stats'), 'statsOpen') + ibtn(ICON.gear, tr('settings'), 'page', { 'data-page': 'settings' }) : '';
    const sleep = this.sleep ? `<button type="button" class="chorus-sleepchip" data-act="sleep" data-mode="off" title="${esc(tr('sleepCancel'))}">${ICON.moon}<span class="chorus-sleep-left">${esc(this.sleepLeft())}</span></button>` : '';
    return `<div class="chorus-head" data-key="head"><div class="chorus-title">${left}</div><div class="chorus-head-r">${sleep}${stack}${gear}${ibtn(ICON.close, tr('close'), 'close')}</div></div>`;
  },

  tabsHtml() {
    const b = this.badges();
    const tab = (id, label) => {
      const n = b[id];
      return `<button type="button" role="tab" class="chorus-tab${this.tab === id ? ' is-on' : ''}" aria-selected="${this.tab === id}" data-act="tab" data-mode="${id}">${esc(label)}${n ? `<span class="chorus-badge">${n > 99 ? '99+' : n}</span>` : ''}</button>`;
    };
    return `<div class="chorus-tabs" role="tablist" data-key="tabs">${tab('jam', 'Jam')}${tab('chat', tr('chat'))}${tab('friends', tr('friends'))}</div>`;
  },

  invitesHtml(v) {
    let h = '';
    for (const inv of v.invites) {
      h += `<div class="chorus-callout" data-key="inv:${esc(inv.id)}">${avatar(inv.who, 32)}<div class="chorus-meta"><span class="chorus-t is-wrap">${esc(tr(inv.kind === 'invite' ? 'invited' : 'knocked', { name: inv.who.name }))}</span></div><div class="chorus-acts">${btn(tr('accept'), 'answer', 'pri', { 'data-id': inv.id, 'data-yes': '1' })}${btn(tr('decline'), 'answer', 'sec', { 'data-id': inv.id, 'data-yes': '0' })}</div></div>`;
    }
    return h;
  },

  recapBanner(v) {
    if (!v.recap) return '';
    return `<button type="button" class="chorus-banner" data-key="recapbanner" data-act="recap" data-mode="${v.recap}"><span class="chorus-banner-i">${ICON.spark}</span><span class="chorus-meta"><b>${esc(tr('recapReady', { year: v.recap }))}</b><span>${esc(tr('recapReadyHint'))}</span></span><span class="chorus-banner-go">${esc(tr('open'))}</span></button>`;
  },

  jamTabHtml(v, jam) {
    let h = this.recapBanner(v) + this.invitesHtml(v);
    if (v.jam && v.jam.pending) return h + `<div class="chorus-loading" data-key="joining"><span class="chorus-spin"></span>${esc(tr('joining'))}</div>`;
    if (jam) return h + this.jamHtml(v, jam);
    h += `<div class="chorus-hero" data-key="intro"><div class="chorus-hero-icon">${ICON.jam}</div><div class="chorus-hero-t">${esc(tr('introTitle'))}</div><div class="chorus-hero-s">${esc(tr('introSub'))}</div>${btn(tr('start'), 'start', 'pri chorus-b-lg', { disabled: !v.online })}</div>`;
    h += `<div class="chorus-sec" data-key="jhead"><span class="chorus-sec-t">${esc(tr('joinTitle'))}</span></div><div class="chorus-inputrow" data-key="join"><input type="text" data-role="code" placeholder="${esc(tr('joinPlaceholder'))}" spellcheck="false" autocomplete="off" aria-label="${esc(tr('joinTitle'))}">${btn(tr('join'), 'joincode', 'sec', { disabled: !v.online })}</div>`;
    const jamming = v.friends.filter(f => f.on && f.jam);
    if (jamming.length) {
      h += `<div class="chorus-sec" data-key="fjhead"><span class="chorus-sec-t">${esc(tr('friendsJamming'))}</span></div>`;
      h += jamming.map(f => this.friendRow(v, null, f)).join('');
    }
    return h;
  },

  jamHtml(v, jam) {
    let h = '';
    if (!v.driver) h += `<div class="chorus-note chorus-note-row" data-key="tab"><span>${esc(tr('otherTab'))}</span>${btn(tr('playHere'), 'claim', 'sec')}</div>`;
    h += this.nowHtml(v, jam);
    h += this.inviteHtml(v, jam);
    h += this.queueHtml(v, jam);
    h += this.peopleHtml(v, jam);
    return h;
  },

  permNote(jam) {
    if (jam.isHost || jam.can.ctl) return '';
    return `<div class="chorus-permnote" data-key="permnote">${ICON.lock}<span>${esc(tr(jam.can.add ? 'permAddOnly' : 'permNone'))}</span></div>`;
  },

  nowHtml(v, jam) {
    const ctl = jam.can.ctl;
    if (!jam.cur) {
      return `<div class="chorus-now is-empty" data-key="now"><span class="chorus-art chorus-art64"></span><div class="chorus-meta"><span class="chorus-t">${esc(tr('nothing'))}</span><span class="chorus-a">${esc(tr(jam.can.add ? 'nothingHint' : 'nothingWait'))}</span></div></div>${this.permNote(jam)}`;
    }
    const t = jam.cur.t;
    const playing = jam.playing && !jam.ended;
    const label = jam.ended ? tr('ended') : tr('nowPlaying');
    const L = this.lyricsOf();
    const has = L && L !== 'loading' && (L.synced || L.plain);
    const hasNext = jam.queue.length || (jam.ctx && jam.ctx.items.length);
    const lyr = ibtn(ICON.mic, tr('lyrics'), 'page', { 'data-page': 'lyrics' }, 'chorus-ctrl chorus-ctrl-lyr' + (has ? ' is-on' : ''));
    const peek = L && L !== 'loading' && L.synced ? '<div class="chorus-nowline" data-act="page" data-page="lyrics"></div>' : '';
    const dis = ctl ? {} : { disabled: true };
    return `<div class="chorus-now${jam.ended ? ' is-ended' : ''}" data-key="now">
      <div class="chorus-now-top">${artwork(t, 64)}<div class="chorus-meta"><span class="chorus-kicker">${playing ? '<span class="chorus-eq is-on is-tiny"><i></i><i></i><i></i></span>' : ''}${esc(label)}</span><a class="chorus-t chorus-now-t" href="${esc(safePath(t.url))}" data-nav>${esc(t.title)}</a><span class="chorus-a">${esc(t.artist)}</span>${this.byHtml(jam.cur, v)}</div></div>${peek}
      <div class="chorus-player"><span class="chorus-time chorus-time-cur"></span><div class="chorus-prog${ctl ? '' : ' is-locked'}"${ctl ? ' data-act="seekbar"' : ''} role="slider" aria-label="${esc(tr('seek'))}" aria-valuemin="0" aria-valuemax="${Math.round((t.dur || 0) / 1000)}"><div class="chorus-prog-track"><div class="chorus-prog-fill"></div></div></div><span class="chorus-time">${clock(t.dur || 0)}</span></div>
      <div class="chorus-ctrls">${lyr}<button type="button" class="chorus-ctrl" data-act="prev"${attrs({ title: tr('prev'), 'aria-label': tr('prev'), ...dis })}>${ICON.prev}</button><button type="button" class="chorus-ctrl chorus-ctrl-main" data-act="toggle"${attrs({ title: tr(playing ? 'pause' : 'play'), 'aria-label': tr(playing ? 'pause' : 'play'), ...dis })}>${playing ? ICON.pause : ICON.play}</button><button type="button" class="chorus-ctrl" data-act="next"${attrs({ title: tr('next'), 'aria-label': tr('next'), disabled: !ctl || !hasNext })}>${ICON.skip}</button></div>
      <div class="chorus-reacts">${REACTIONS.map(e => `<button type="button" class="chorus-react" data-act="react" data-mode="${e}" aria-label="${e}">${e}</button>`).join('')}</div>
    </div>${this.permNote(jam)}`;
  },

  inviteHtml(v, jam) {
    if (!jam.code) return '';
    const short = jam.code.slice(0, 15) + '…';
    let h = `<div class="chorus-invitebox" data-key="invitebox"><div class="chorus-meta"><span class="chorus-t">${esc(tr('inviteTitle'))}</span><span class="chorus-a chorus-mono">${esc(short)}</span></div>${`<button type="button" class="chorus-b chorus-b-pri" data-act="copycode">${ICON.copy}<span>${esc(tr('copyCode'))}</span></button>`}</div>`;
    const ready = v.friends.filter(f => f.on && !f.inJam);
    if (ready.length) {
      h += `<div class="chorus-quick" data-key="quick"><span class="chorus-quick-t">${esc(tr('onlineFriends'))}</span>${ready
        .slice(0, 6)
        .map(f => `<button type="button" class="chorus-qf" data-act="invite" data-id="${esc(f.id)}" title="${esc(tr('inviteName', { name: f.name }))}">${avatar(f, 20)}<span>${esc(f.name)}</span><b>+</b></button>`)
        .join('')}</div>`;
    }
    return h;
  },

  peopleHtml(v, jam) {
    const members = Object.values(jam.members).sort((a, b) => (a.id === jam.host ? -1 : b.id === jam.host ? 1 : a.id === v.me.id ? -1 : b.id === v.me.id ? 1 : 0));
    let h = `<div class="chorus-sec" data-key="phead"><span class="chorus-sec-t">${esc(tr('peopleTitle'))}</span><span class="chorus-sec-sub">${members.length}</span>${jam.locked ? `<span class="chorus-pill" title="${esc(tr('lockedHint'))}">${ICON.lock}${esc(tr('lockedShort'))}</span>` : ''}</div><div class="chorus-people" data-key="people">`;
    for (const m of members) {
      const self = m.id === v.me.id;
      const host = m.id === jam.host;
      let right = '';
      if (jam.isHost && !self) {
        right = `<div class="chorus-perms"><button type="button" class="chorus-perm${m.add ? ' is-on' : ''}" data-act="perm" data-id="${esc(m.id)}" data-mode="add" aria-pressed="${!!m.add}" title="${esc(tr('permAddHint'))}">${esc(tr('permAdd'))}</button><button type="button" class="chorus-perm${m.ctl ? ' is-on' : ''}" data-act="perm" data-id="${esc(m.id)}" data-mode="ctl" aria-pressed="${!!m.ctl}" title="${esc(tr('permCtlHint'))}">${esc(tr('permCtl'))}</button></div>${ibtn(ICON.more, tr('more'), 'menu', { 'data-id': m.id, 'aria-expanded': this.menu === m.id ? 'true' : 'false' })}`;
      } else if (!self && !m.friend) {
        right = m.asked ? `<span class="chorus-muted-s">${esc(tr('requested'))}</span>` : ibtn(ICON.personAdd, tr('addFriend'), 'friendAdd', { 'data-id': m.id });
      }
      const badge = host ? `<em class="chorus-host">${esc(tr('host'))}</em>` : !jam.isHost && self ? '' : '';
      h += `<div class="chorus-person${this.menu === m.id ? ' is-open' : ''}" data-key="m:${esc(m.id)}">${avatar(m, 32)}<div class="chorus-meta"><span class="chorus-t">${esc(self ? tr('youName', { name: m.name }) : m.name)}${idTag(m.id, m.friend, v)}${badge}</span>${host || jam.isHost ? '' : `<span class="chorus-a">${esc(tr(m.ctl ? 'roleCtl' : m.add ? 'roleAdd' : 'roleListen'))}</span>`}</div>${right}</div>`;
      if (jam.isHost && this.menu === m.id && !self) {
        h += `<div class="chorus-menu" data-key="mm:${esc(m.id)}">${btn(tr('makeHost'), 'makeHost', 'sec', { 'data-id': m.id })}${m.friend || m.asked ? '' : btn(tr('addFriend'), 'friendAdd', 'sec', { 'data-id': m.id })}${btn(tr('removeFromJam'), 'kick', 'danger', { 'data-id': m.id })}</div>`;
      }
    }
    h += '</div>';
    return h;
  },

  itemHtml(it, i, v, jam, prio) {
    const ctl = jam.can.ctl;
    const mine = it.by && it.by === v.me.id;
    let acts = '';
    if (ctl) acts += ibtn(ICON.play, tr('playNow'), 'jump', { 'data-qid': it.qid });
    if (ctl && !prio) acts += ibtn(ICON.add, tr('promote'), 'promote', { 'data-qid': it.qid });
    if (ctl || (prio && mine)) acts += ibtn(ICON.remove, tr('remove'), 'remove', { 'data-qid': it.qid });
    const drag = prio && ctl;
    return `<li class="chorus-item${prio ? '' : ' is-ctx'}${drag ? ' is-drag' : ''}"${drag ? ' draggable="true"' : ''} data-key="q:${esc(it.qid)}" data-qid="${esc(it.qid)}"><span class="chorus-idx"><span class="chorus-num">${i + 1}</span>${drag ? `<span class="chorus-grip">${ICON.grip}</span>` : ''}</span>${artwork(it.t, 40)}<div class="chorus-meta"><a class="chorus-t" href="${esc(safePath(it.t.url))}" data-nav draggable="false">${esc(it.t.title)}</a><span class="chorus-a">${esc(it.t.artist)}</span></div><span class="chorus-dur">${clock(it.t.dur || 0)}</span>${prio ? this.byHtml(it, v, true) : ''}${acts ? `<div class="chorus-item-acts">${acts}</div>` : ''}</li>`;
  },

  queueHtml(v, jam) {
    const q = jam.queue;
    const ctx = jam.ctx && jam.ctx.items.length ? jam.ctx : null;
    const ctl = jam.can.ctl;
    let h = '';
    if (q.length) {
      const total = q.reduce((n, it) => n + (it.t.dur || 0), 0);
      h += `<div class="chorus-sec" data-key="qhead"><span class="chorus-sec-t">${esc(tr('upNext'))}</span><span class="chorus-sec-sub">${esc(tr('tracks', { n: q.length }))} · ${esc(tr('minutes', { n: Math.max(1, Math.round(total / 60000)) }))}</span>${ctl ? `<button type="button" class="chorus-link" data-act="clear" data-mode="queue">${esc(tr('clear'))}</button>` : ''}</div>`;
      h += `<ul class="chorus-queue" data-key="queue">${q.map((it, i) => this.itemHtml(it, i, v, jam, true)).join('')}</ul>`;
    }
    if (ctx) {
      const shown = ctx.items.slice(0, 50);
      const more = ctx.items.length - shown.length;
      const title = ctx.auto ? tr('forYou') : tr('nextFrom', { title: ctx.title || tr('list') });
      h += `<div class="chorus-sec" data-key="chead"><span class="chorus-sec-t">${ctx.auto ? `<span class="chorus-spark">${ICON.spark}</span>` : ''}${esc(title)}</span><span class="chorus-sec-sub">${esc(tr('tracks', { n: ctx.items.length }))}</span>${ctl ? `<button type="button" class="chorus-link" data-act="clear" data-mode="ctx">${esc(tr('clear'))}</button>` : ''}</div>`;
      h += `<ul class="chorus-queue" data-key="ctx">${shown.map((it, i) => this.itemHtml(it, q.length + i, v, jam, false)).join('')}</ul>`;
      if (more > 0) h += `<div class="chorus-more" data-key="cmore">${esc(tr('more', { n: more }))}</div>`;
    }
    if (!q.length && !ctx) h += `<div class="chorus-sec" data-key="qhead"><span class="chorus-sec-t">${esc(tr('upNext'))}</span></div><div class="chorus-empty" data-key="qempty"><b>${esc(tr('emptyQueue'))}</b>${jam.can.add ? `<span>${esc(tr('emptyQueueHint'))}</span>` : ''}</div>`;
    if (jam.isHost) {
      const r = jam.radio !== false;
      h += `<button type="button" class="chorus-row-switch" data-key="auto" data-act="radio" role="switch" aria-checked="${r}"><span class="chorus-spark">${ICON.spark}</span><span class="chorus-row-switch-t"><b>${esc(tr('radio'))}</b><span>${esc(tr('radioHint'))}</span></span>${sw(r)}</button>`;
    }
    return h;
  },

  byHtml(it, v, compact) {
    if (!it.who || !it.who.id) {
      return compact ? `<span class="chorus-by chorus-by-compact" title="${esc(tr('autoplay'))}"><span class="chorus-by-auto"></span></span>` : `<span class="chorus-by"><span class="chorus-by-auto"></span><span>${esc(tr('autoplay'))}</span></span>`;
    }
    const name = it.who.id === v.me.id ? tr('you') : it.who.name;
    if (compact) return `<span class="chorus-by chorus-by-compact" title="${esc(tr('addedBy', { name }))}">${avatar(it.who, 20)}</span>`;
    return `<span class="chorus-by">${avatar(it.who, 16)}<span>${esc(tr('addedBy', { name }))}</span></span>`;
  },

  status(f) {
    if (!f.on) return `<span class="chorus-a">${esc(tr('offline'))}</span>`;
    if (f.jam) return `<span class="chorus-a chorus-a-live">${esc(tr('inAJam', { n: f.jam.n }))}</span>`;
    if (f.np) return `<span class="chorus-a chorus-np"><span class="chorus-eq is-on is-tiny"><i></i><i></i><i></i></span>${esc(f.np.title)} · ${esc(f.np.artist)}</span>`;
    return `<span class="chorus-a">${esc(tr('online'))}</span>`;
  },

  friendRow(v, jam, f) {
    let act = '';
    if (v.knocks.includes(f.id)) act = btn(tr('requested'), 'noop', 'sec', { disabled: true });
    else if (f.on && f.jam && !f.inJam) act = btn(tr('join'), 'knock', 'sec', { 'data-id': f.id });
    else if (f.on && jam && !f.inJam) act = btn(tr('invite'), 'invite', 'pri', { 'data-id': f.id });
    else if (f.on && !jam) act = btn(tr('invite'), 'invite', 'sec', { 'data-id': f.id });
    const msg = ibtn(ICON.chat, tr('message'), 'thread', { 'data-id': f.id }, f.unread ? 'has-badge' : '');
    let h = `<div class="chorus-person${this.menu === f.id ? ' is-open' : ''}" data-key="f:${esc(f.id)}">${avatar(f, 32, f.on ? 'on' : 'off')}<div class="chorus-meta"><span class="chorus-t">${esc(f.name)}</span>${this.status(f)}</div>${act}${msg}${ibtn(ICON.more, tr('more'), 'menu', { 'data-id': f.id })}</div>`;
    if (this.menu === f.id) {
      if (this.confirm === f.id) {
        h += `<div class="chorus-menu" data-key="fm:${esc(f.id)}"><span class="chorus-menu-t">${esc(tr('removeConfirm', { name: f.name }))}</span>${btn(tr('remove'), 'friendRemove', 'danger', { 'data-id': f.id })}${btn(tr('cancel'), 'cancelConfirm', 'sec')}</div>`;
      } else {
        h += `<div class="chorus-menu" data-key="fm:${esc(f.id)}">${btn(tr('viewStats'), 'statsOpen', 'sec', { 'data-id': f.id })}${btn(tr('removeFriend'), 'confirm', 'danger', { 'data-id': f.id })}</div>`;
      }
    }
    return h;
  },

  friendsHtml(v, jam) {
    let h = `<div class="chorus-card" data-key="card"><div class="chorus-card-row"><div class="chorus-meta"><span class="chorus-kicker">${esc(tr('yourCode'))}</span><span class="chorus-code">${esc(v.card)}</span></div><button type="button" class="chorus-b chorus-b-sec" data-act="copycard">${ICON.copy}<span>${esc(tr('copy'))}</span></button></div><div class="chorus-inputrow"><input type="text" data-role="friend" placeholder="${esc(tr('friendPlaceholder'))}" spellcheck="false" autocomplete="off" maxlength="40" aria-label="${esc(tr('addFriend'))}">${btn(tr('add'), 'friendcode', 'pri', { disabled: !v.online })}</div></div>`;
    const incoming = v.requests.filter(r => r.dir === 'in');
    const outgoing = v.requests.filter(r => r.dir === 'out');
    if (incoming.length) {
      h += `<div class="chorus-sec" data-key="rin"><span class="chorus-sec-t">${esc(tr('requestsIn'))}</span><span class="chorus-sec-sub">${incoming.length}</span></div>`;
      for (const r of incoming) h += `<div class="chorus-callout" data-key="ri:${esc(r.id)}">${avatar(r.who, 32)}<div class="chorus-meta"><span class="chorus-t">${esc(r.who.name)}</span><span class="chorus-a">${esc(tr('wantsFriend'))}</span></div><div class="chorus-acts">${btn(tr('accept'), 'friendAnswer', 'pri', { 'data-id': r.id, 'data-yes': '1' })}${btn(tr('decline'), 'friendAnswer', 'sec', { 'data-id': r.id, 'data-yes': '0' })}</div></div>`;
    }
    const list = [...v.friends].sort((a, b) => (b.on - a.on) || ((b.jam ? 1 : 0) - (a.jam ? 1 : 0)) || a.name.localeCompare(b.name));
    const on = list.filter(f => f.on);
    const off = list.filter(f => !f.on);
    if (on.length) h += `<div class="chorus-sec" data-key="fon"><span class="chorus-sec-t">${esc(tr('online'))}</span><span class="chorus-sec-sub">${on.length}</span></div>` + on.map(f => this.friendRow(v, jam, f)).join('');
    if (off.length) h += `<div class="chorus-sec" data-key="foff"><span class="chorus-sec-t">${esc(tr('offline'))}</span><span class="chorus-sec-sub">${off.length}</span></div>` + off.map(f => this.friendRow(v, jam, f)).join('');
    if (outgoing.length) {
      h += `<div class="chorus-sec" data-key="rout"><span class="chorus-sec-t">${esc(tr('requestsOut'))}</span></div>`;
      for (const r of outgoing) h += `<div class="chorus-person" data-key="ro:${esc(r.id)}">${avatar(r.who, 32)}<div class="chorus-meta"><span class="chorus-t">${esc(r.who.name)}</span><span class="chorus-a">${esc(tr('waiting'))}</span></div>${btn(tr('cancel'), 'friendCancel', 'sec', { 'data-id': r.id })}</div>`;
    }
    if (!list.length && !incoming.length && !outgoing.length) h += `<div class="chorus-empty" data-key="fempty">${ICON.people}<b>${esc(tr('noFriends'))}</b><span>${esc(tr('noFriendsHint'))}</span></div>`;
    return h;
  },

  chatListHtml(v, jam) {
    let h = '';
    const preview = (last, fallback) => {
      if (!last) return `<span class="chorus-a">${esc(fallback)}</span>`;
      const who = last.mine ? tr('you') + ': ' : last.name ? last.name + ': ' : '';
      return `<span class="chorus-a">${esc(who + last.text)}</span>`;
    };
    if (jam) {
      h += `<button type="button" class="chorus-thread-row" data-key="t:jam" data-act="thread" data-id="jam"><span class="chorus-av chorus-av32 chorus-av-jam">${ICON.people}</span><div class="chorus-meta"><span class="chorus-t">${esc(tr('jamChat'))}</span>${preview(jam.last, tr('jamChatHint'))}</div>${jam.last ? `<span class="chorus-time-s">${hhmm(jam.last.ts)}</span>` : ''}${jam.unread ? `<span class="chorus-badge">${jam.unread}</span>` : ''}</button>`;
    }
    const list = [...v.friends].sort((a, b) => ((b.last && b.last.ts) || 0) - ((a.last && a.last.ts) || 0) || b.on - a.on || a.name.localeCompare(b.name));
    for (const f of list) {
      h += `<button type="button" class="chorus-thread-row" data-key="t:${esc(f.id)}" data-act="thread" data-id="${esc(f.id)}">${avatar(f, 32, f.on ? 'on' : 'off')}<div class="chorus-meta"><span class="chorus-t">${esc(f.name)}</span>${preview(f.last, f.on ? tr('online') : tr('offline'))}</div>${f.last ? `<span class="chorus-time-s">${hhmm(f.last.ts)}</span>` : ''}${f.unread ? `<span class="chorus-badge">${f.unread}</span>` : ''}</button>`;
    }
    if (!h) h = `<div class="chorus-empty" data-key="cempty">${ICON.chat}<b>${esc(tr('noChats'))}</b><span>${esc(tr('noChatsHint'))}</span>${btn(tr('findFriends'), 'tab', 'sec', { 'data-mode': 'friends' })}</div>`;
    return h;
  },

  threadHtml(v, jam) {
    const isJam = this.thread === 'jam';
    const f = isJam ? null : v.friends.find(x => x.id === this.thread);
    const msgs = isJam ? (jam && jam.chat) || [] : v.dms;
    let body = '';
    let prev = null;
    for (const m of msgs) {
      const mine = m.from === v.me.id;
      const who = isJam ? m.who || (jam && jam.members[m.from]) || { name: '?' } : mine ? v.me : f;
      const first = !prev || prev.from !== m.from || m.ts - prev.ts > 300000;
      if (!prev || m.ts - prev.ts > 1800000) body += `<div class="chorus-day" data-key="d:${esc(m.mid)}">${hhmm(m.ts)}</div>`;
      body += `<div class="chorus-msg${mine ? ' is-mine' : ''}${first ? ' is-first' : ''}" data-key="m:${esc(m.mid)}">${!mine && isJam ? (first ? avatar(who, 24) : '<span class="chorus-av-gap"></span>') : ''}<div class="chorus-bubble-wrap">${!mine && isJam && first ? `<span class="chorus-msg-name">${esc(who.name)}${idTag(m.from, !!(jam && jam.members[m.from] && jam.members[m.from].friend) || v.friends.some(x => x.id === m.from), v)}</span>` : ''}<div class="chorus-bubble" title="${esc(hhmm(m.ts))}">${rich(m.text)}</div></div></div>`;
      prev = m;
    }
    if (!msgs.length) body = `<div class="chorus-thread-empty" data-key="empty">${isJam ? ICON.people : avatar(f, 48)}<b>${esc(isJam ? tr('jamChat') : f ? f.name : '')}</b><span>${esc(tr(isJam ? 'jamChatHint' : 'dmHint'))}</span><small class="chorus-warn">${esc(tr('chatWarn'))}</small></div>`;
    const offline = !isJam && f && !f.on;
    const disabled = !v.online || offline || (isJam && !jam);
    const note = offline ? `<div class="chorus-compose-note" data-key="cnote">${esc(tr('dmOffline', { name: f.name }))}</div>` : '';
    const share = this.track() ? ibtn(ICON.music, tr('shareTrack'), 'shareTrack', disabled ? { disabled: true } : {}) : '';
    return `<div class="chorus-body chorus-thread-body" data-key="thread:${esc(this.thread)}">${body}</div>${note}<div class="chorus-compose" data-key="compose:${esc(this.thread)}">${share}<input type="text" data-role="compose" data-keep="1" maxlength="500" placeholder="${esc(tr('messagePlaceholder'))}" aria-label="${esc(tr('messagePlaceholder'))}" autocomplete="off"${disabled ? ' disabled' : ''}>${ibtn(ICON.send, tr('send'), 'send', disabled ? { disabled: true } : {}, 'chorus-send')}</div>`;
  },

  lyricsHtml() {
    const t = this.track();
    if (!t) return `<div class="chorus-empty" data-key="lnone">${ICON.mic}<b>${esc(tr('noTrack'))}</b></div>`;
    const L = this.lyricsOf();
    const h = `<div class="chorus-lyr-head" data-key="lhead">${artwork(t, 40)}<div class="chorus-meta"><span class="chorus-t">${esc(t.title)}</span><span class="chorus-a">${esc(t.artist)}</span></div></div>`;
    if (!L || L === 'loading') return h + `<div class="chorus-loading" data-key="lload"><span class="chorus-spin"></span>${esc(tr('lyricsLoading'))}</div>`;
    if (L.synced) {
      return h + `<div class="chorus-lyrics is-synced" data-key="lsync:${esc(t.id)}">${L.synced.map(([ms, line], i) => `<p class="chorus-line" data-act="line" data-ms="${+ms || 0}" data-key="l:${i}">${line ? esc(line) : '♪'}</p>`).join('')}</div><div class="chorus-credit" data-key="lcredit">LRCLIB</div>`;
    }
    if (L.plain) {
      return (
        h +
        `<div class="chorus-lyrics" data-key="lplain:${esc(t.id)}">${String(L.plain)
          .split(/\r?\n/)
          .map(line => `<p>${esc(line) || '&nbsp;'}</p>`)
          .join('')}</div><div class="chorus-more" data-key="lnote">${esc(tr('unsynced'))} · LRCLIB</div>`
      );
    }
    return h + `<div class="chorus-empty" data-key="lempty"><b>${esc(tr('noLyrics'))}</b></div>`;
  },

  field(key, title, body, hint) {
    return `<div class="chorus-field" data-key="${key}"><div class="chorus-field-t">${esc(title)}</div>${hint ? `<div class="chorus-field-h">${esc(hint)}</div>` : ''}${body}</div>`;
  },

  switchRow(act, mode, on, title, hint) {
    return `<button type="button" class="chorus-row-switch is-plain" data-act="${act}" data-mode="${mode}" role="switch" aria-checked="${!!on}"><span class="chorus-row-switch-t"><b>${esc(title)}</b>${hint ? `<span>${esc(hint)}</span>` : ''}</span>${sw(on)}</button>`;
  },

  settingsHtml(v, jam) {
    let h = '';
    if (v.guest) h += this.field('f-name', tr('yourName'), `<div class="chorus-inputrow"><input type="text" maxlength="32" value="${esc(v.me.name)}" data-act="nick" spellcheck="false" autocomplete="off" aria-label="${esc(tr('yourName'))}"></div>`, tr('yourNameHint'));
    const pref = I18N.pref();
    const seg = (mode, label) => `<button type="button" role="radio" aria-checked="${pref === mode}" class="${pref === mode ? 'is-on' : ''}" data-act="lang" data-mode="${mode}">${esc(label)}</button>`;
    h += this.field('f-lang', tr('language'), `<div class="chorus-seg" role="radiogroup">${seg('auto', tr('langAuto'))}${seg('en', 'English')}${seg('tr', 'Türkçe')}</div>`);
    h += this.field('f-privacy', tr('privacy'), this.switchRow('pref', 'share', v.prefs.share, tr('shareListening'), tr('shareListeningHint')) + this.switchRow('pref', 'open', v.prefs.open, tr('openJam'), tr('openJamHint')));
    if (jam && jam.isHost) {
      const q = jam.mode === 'queue';
      let body = `<div class="chorus-sub-t">${esc(tr('whenOpen'))}</div><div class="chorus-seg" role="radiogroup"><button type="button" role="radio" aria-checked="${!q}" class="${q ? '' : 'is-on'}" data-act="mode" data-mode="now">${esc(tr('modeNow'))}</button><button type="button" role="radio" aria-checked="${q}" class="${q ? 'is-on' : ''}" data-act="mode" data-mode="queue">${esc(tr('modeQueue'))}</button></div>`;
      body += `<div class="chorus-sub-t">${esc(tr('everyoneCan'))}</div>`;
      body += this.switchRow('defperm', 'add', jam.perms.add, tr('permAddLong'), tr('permAddHint'));
      body += this.switchRow('defperm', 'ctl', jam.perms.ctl, tr('permCtlLong'), tr('permCtlHint'));
      body += this.switchRow('lock', 'lock', jam.locked, tr('lockJam'), tr('lockedHint'));
      body += `<div class="chorus-btnrow">${btn(tr('newCode'), 'newCode', 'sec')}</div>`;
      h += this.field('f-jam', tr('jamSettings'), body);
    }
    const sl = this.sleep;
    const sseg = (mode, label) => {
      const on = mode === 'off' ? !sl : sl && sl.mode === mode;
      return `<button type="button" role="radio" aria-checked="${!!on}" class="${on ? 'is-on' : ''}" data-act="sleep" data-mode="${mode}">${esc(label)}</button>`;
    };
    h += this.field('f-sleep', tr('sleepTimer'), `<div class="chorus-seg chorus-seg-wrap" role="radiogroup">${sseg('off', tr('off'))}${sseg('15', tr('minShort', { n: 15 }))}${sseg('30', tr('minShort', { n: 30 }))}${sseg('60', tr('minShort', { n: 60 }))}${sseg('end', tr('sleepEnd'))}</div>`, sl ? tr('sleepActive', { t: this.sleepLeft() }) : tr('sleepHint'));
    let st = this.switchRow('pref', 'record', v.prefs.record, tr('recordStats'), tr('recordStatsHint')) + this.switchRow('pref', 'shareStats', v.prefs.shareStats, tr('shareStats'), tr('shareStatsHint'));
    st += this.confirm === 'stats' ? `<div class="chorus-menu" data-key="sclear"><span class="chorus-menu-t">${esc(tr('clearStatsConfirm'))}</span>${btn(tr('clearStats'), 'statsClear', 'danger')}${btn(tr('cancel'), 'cancelConfirm', 'sec')}</div>` : `<div class="chorus-btnrow">${btn(tr('viewStats'), 'statsOpen', 'sec')}${btn(tr('exportStats'), 'statsExport', 'sec')}${btn(tr('clearStats'), 'statsClearAsk', 'danger')}</div>`;
    h += this.field('f-stats', tr('stats'), st);
    if (jam) h += `<div class="chorus-field" data-key="f-leave">${btn(tr('leave'), 'leave', 'danger')}</div>`;
    h += this.field('f-card', tr('friendCode'), `<div class="chorus-btnrow"><span class="chorus-code">${esc(v.card)}</span>${btn(tr('resetCode'), 'resetCard', 'sec')}</div>`, tr('resetCodeHint'));
    h += `<div class="chorus-about" data-key="about">${ICON.lock}<span>${esc(tr('about'))}</span></div>`;
    return h;
  },

  statsKey() {
    return (this.statsWho || 'me') + ':' + (this.page === 'recap' ? 'year' : this.statsPeriod) + ':' + (this.page === 'recap' ? this.recapYear : '');
  },

  openStats(who) {
    this.statsWho = who || null;
    if (!this.statsPeriod) this.statsPeriod = 'month';
    this.open('stats');
    this.askStats();
  },

  openRecap(year) {
    this.statsWho = null;
    this.recapYear = year;
    this.open('recap');
    this.askStats();
    const v = this.view;
    if (v && v.recap && year >= v.recap) this.onAction('recapSeen', { year });
  },

  askStats() {
    const key = this.statsKey();
    const cached = this.stats.get(key);
    if (cached && cached.at && Date.now() - cached.at < 20000) return;
    if (!cached) this.stats.set(key, { loading: true });
    this.onAction('stats', { who: this.statsWho, period: this.page === 'recap' ? 'year' : this.statsPeriod, year: this.page === 'recap' ? this.recapYear : null, req: key });
    this.render();
  },

  setStats(m) {
    if (m.who) {
      for (const period of ['month', 'year', 'all']) {
        const key = m.who + ':' + period + ':';
        if (m.data) this.stats.set(key, { at: Date.now(), data: m.data[period] });
        else this.stats.set(key, { at: Date.now(), denied: !!m.denied, error: !!m.error });
      }
    } else if (m.req) {
      this.stats.set(m.req, { at: Date.now(), data: m.data });
    }
    if (this.stats.size > 40) this.stats.delete(this.stats.keys().next().value);
    this.render();
  },

  fmt(n) {
    try {
      return new Intl.NumberFormat(I18N.lang() === 'tr' ? 'tr-TR' : 'en-US').format(Math.round(n));
    } catch {
      return String(Math.round(n));
    }
  },

  mins(ms) {
    return this.fmt(ms / 60000);
  },

  day(key) {
    const [y, m, d] = String(key).split('-').map(Number);
    try {
      return new Date(y, m - 1, d).toLocaleDateString(I18N.lang() === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'long' });
    } catch {
      return key;
    }
  },

  statsBody(entry, own) {
    if (!entry || entry.loading) return `<div class="chorus-loading" data-key="sload"><span class="chorus-spin"></span>${esc(tr('statsLoading'))}</div>`;
    if (entry.denied) return `<div class="chorus-empty" data-key="sden">${ICON.lock}<b>${esc(tr('statsPrivate'))}</b><span>${esc(tr('statsPrivateHint'))}</span></div>`;
    if (entry.error) return `<div class="chorus-empty" data-key="serr"><b>${esc(tr('statsUnreachable'))}</b><span>${esc(tr('statsUnreachableHint'))}</span></div>`;
    const s = entry.data;
    if (!s || !s.ms) return `<div class="chorus-empty" data-key="snone">${ICON.chart}<b>${esc(tr('statsEmpty'))}</b><span>${esc(tr(own ? 'statsEmptyHint' : 'statsEmptyFriend'))}</span></div>`;
    let h = `<div class="chorus-kpis" data-key="kpis"><div class="chorus-kpi is-main"><b>${this.mins(s.ms)}</b><span>${esc(tr('kpiMinutes'))}</span></div><div class="chorus-kpi"><b>${this.fmt(s.plays)}</b><span>${esc(tr('kpiPlays'))}</span></div><div class="chorus-kpi"><b>${this.fmt(s.unique)}</b><span>${esc(tr('kpiTracks'))}</span></div><div class="chorus-kpi"><b>${this.fmt(s.artistsCount)}</b><span>${esc(tr('kpiArtists'))}</span></div></div>`;
    if (s.tracks.length) {
      h += `<div class="chorus-sec" data-key="sth"><span class="chorus-sec-t">${esc(tr('topTracks'))}</span></div><ol class="chorus-rank" data-key="st">`;
      h += s.tracks
        .map((x, i) => `<li class="chorus-rank-row" data-key="st:${esc(x.t.id)}"><span class="chorus-rank-n">${i + 1}</span>${artwork(x.t, 40)}<div class="chorus-meta"><a class="chorus-t" href="${esc(safePath(x.t.url))}" data-nav>${esc(x.t.title)}</a><span class="chorus-a">${esc(x.t.artist)}</span></div><div class="chorus-rank-v"><b>${esc(tr('minShort', { n: this.mins(x.ms) }))}</b><span>${esc(tr('playsShort', { n: this.fmt(x.plays) }))}</span></div></li>`)
        .join('');
      h += '</ol>';
    }
    if (s.artists.length) {
      const max = s.artists[0].ms || 1;
      h += `<div class="chorus-sec" data-key="sah"><span class="chorus-sec-t">${esc(tr('topArtists'))}</span></div><ol class="chorus-rank" data-key="sa">`;
      h += s.artists
        .map((a, i) => `<li class="chorus-rank-row" data-key="sa:${i}"><span class="chorus-rank-n">${i + 1}</span>${avatar({ name: a.name, avatar: a.art }, 32)}<div class="chorus-meta"><span class="chorus-t">${esc(a.name)}</span><span class="chorus-bar"><i style="width:${Math.max(4, Math.round((a.ms / max) * 100))}%"></i></span></div><div class="chorus-rank-v"><b>${esc(tr('minShort', { n: this.mins(a.ms) }))}</b></div></li>`)
        .join('');
      h += '</ol>';
    }
    if (s.genres.length) h += `<div class="chorus-sec" data-key="sgh"><span class="chorus-sec-t">${esc(tr('topGenres'))}</span></div><div class="chorus-chips" data-key="sg">${s.genres.map((g, i) => `<span class="chorus-chip${i === 0 ? ' is-top' : ''}">${esc(g.name)}</span>`).join('')}</div>`;
    if (s.hours && s.hours.some(Boolean)) {
      const max = Math.max(...s.hours) || 1;
      h += `<div class="chorus-sec" data-key="shh"><span class="chorus-sec-t">${esc(tr('byHour'))}</span>${s.persona ? `<span class="chorus-sec-sub">${esc(tr('persona_' + s.persona))}</span>` : ''}</div><div class="chorus-hours" data-key="sh">${s.hours.map((v, i) => `<i style="height:${Math.max(3, Math.round((v / max) * 100))}%" title="${i}:00 · ${esc(tr('minShort', { n: this.mins(v) }))}"></i>`).join('')}</div><div class="chorus-hours-axis" data-key="sha"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>`;
    }
    if (s.busiest) h += `<div class="chorus-fact" data-key="sbusy">${ICON.spark}<span>${esc(tr('busiest', { day: this.day(s.busiest.day), n: this.mins(s.busiest.ms) }))}</span></div>`;
    return h;
  },

  statsHtml(v) {
    const own = !this.statsWho;
    const period = this.statsPeriod;
    const seg = (p, label) => `<button type="button" role="radio" aria-checked="${period === p}" class="${period === p ? 'is-on' : ''}" data-act="period" data-mode="${p}">${esc(label)}</button>`;
    let h = `<div class="chorus-seg chorus-seg-full" role="radiogroup" data-key="speriod">${seg('month', tr('period30'))}${seg('year', tr('periodYear'))}${seg('all', tr('periodAll'))}</div>`;
    const entry = this.stats.get(this.statsKey());
    h += this.statsBody(entry, own);
    if (own) {
      const years = (entry && entry.data && entry.data.years) || [];
      const now = new Date().getFullYear();
      const list = [...new Set([...years.map(Number), now])].sort((a, b) => b - a);
      h += `<div class="chorus-sec" data-key="srh"><span class="chorus-sec-t">${esc(tr('recaps'))}</span></div><div class="chorus-recaps" data-key="sr">${list
        .map(y => `<button type="button" class="chorus-recap-card${y === now ? ' is-now' : ''}" data-act="recap" data-mode="${y}"><b>${y}</b><span>${esc(tr(y === now ? 'yearSoFar' : 'yearRecap'))}</span></button>`)
        .join('')}</div>`;
      h += `<div class="chorus-about" data-key="sprivacy">${ICON.lock}<span>${esc(tr(v.prefs.shareStats ? 'statsSharedNote' : 'statsLocalNote'))}</span></div>`;
    }
    return h;
  },

  recapHtml() {
    const y = this.recapYear;
    const entry = this.stats.get(this.statsKey());
    if (!entry || entry.loading) return `<div class="chorus-loading" data-key="rload"><span class="chorus-spin"></span>${esc(tr('statsLoading'))}</div>`;
    const s = entry.data;
    if (!s || !s.ms) return `<div class="chorus-empty" data-key="rnone">${ICON.chart}<b>${esc(tr('recapEmpty', { year: y }))}</b></div>`;
    const done = y < new Date().getFullYear();
    const topArtist = s.artists[0];
    const topTrack = s.tracks[0];
    const minutes = this.mins(s.ms);
    let h = `<div class="chorus-story is-hero" data-key="r1"><span class="chorus-story-k">${esc(tr(done ? 'recapYour' : 'recapSoFar', { year: y }))}</span><b class="chorus-story-big">${minutes}</b><span class="chorus-story-s">${esc(tr('recapMinutes'))}</span><span class="chorus-story-f">${esc(tr('recapDays', { d: this.fmt(s.daysCount) }))}</span></div>`;
    if (topArtist) h += `<div class="chorus-story is-artist" data-key="r2"><span class="chorus-story-k">${esc(tr('recapTopArtist'))}</span>${avatar({ name: topArtist.name, avatar: topArtist.art }, 96)}<b class="chorus-story-name">${esc(topArtist.name)}</b><span class="chorus-story-s">${esc(tr('recapArtistMins', { n: this.mins(topArtist.ms) }))}</span></div>`;
    if (topTrack) {
      h += `<div class="chorus-story is-tracks" data-key="r3"><span class="chorus-story-k">${esc(tr('recapTopTracks'))}</span><ol class="chorus-rank">${s.tracks
        .slice(0, 5)
        .map((x, i) => `<li class="chorus-rank-row"><span class="chorus-rank-n">${i + 1}</span>${artwork(x.t, 40)}<div class="chorus-meta"><a class="chorus-t" href="${esc(safePath(x.t.url))}" data-nav>${esc(x.t.title)}</a><span class="chorus-a">${esc(x.t.artist)}</span></div><div class="chorus-rank-v"><b>${esc(tr('playsShort', { n: this.fmt(x.plays) }))}</b></div></li>`)
        .join('')}</ol></div>`;
    }
    if (s.persona || (s.genres[0] && s.genres[0].name)) {
      h += `<div class="chorus-story is-vibe" data-key="r4"><span class="chorus-story-k">${esc(tr('recapVibe'))}</span>${s.genres[0] ? `<b class="chorus-story-name">${esc(s.genres[0].name)}</b><span class="chorus-story-s">${esc(tr('recapGenre'))}</span>` : ''}${s.persona ? `<span class="chorus-story-f">${esc(tr('personaLong_' + s.persona))}</span>` : ''}</div>`;
    }
    h += `<div class="chorus-story is-numbers" data-key="r5"><span class="chorus-story-k">${esc(tr('recapNumbers'))}</span><div class="chorus-kpis"><div class="chorus-kpi"><b>${this.fmt(s.plays)}</b><span>${esc(tr('kpiPlays'))}</span></div><div class="chorus-kpi"><b>${this.fmt(s.unique)}</b><span>${esc(tr('kpiTracks'))}</span></div><div class="chorus-kpi"><b>${this.fmt(s.artistsCount)}</b><span>${esc(tr('kpiArtists'))}</span></div><div class="chorus-kpi"><b>${this.mins(s.jam)}</b><span>${esc(tr('kpiJam'))}</span></div></div>${s.busiest ? `<span class="chorus-story-f">${esc(tr('busiest', { day: this.day(s.busiest.day), n: this.mins(s.busiest.ms) }))}</span>` : ''}</div>`;
    h += `<div class="chorus-btnrow is-center" data-key="r6"><button type="button" class="chorus-b chorus-b-pri chorus-b-lg" data-act="copyRecap">${ICON.copy}<span>${esc(tr('recapShare'))}</span></button></div>`;
    return h;
  },

  recapText() {
    const entry = this.stats.get(this.statsKey());
    const s = entry && entry.data;
    if (!s) return '';
    const lines = [tr('shareHead', { year: this.recapYear }), tr('shareMinutes', { n: this.mins(s.ms) })];
    if (s.artists[0]) lines.push(tr('shareArtist', { name: s.artists[0].name }));
    if (s.tracks[0]) lines.push(tr('shareTop', { title: s.tracks[0].t.title, artist: s.tracks[0].t.artist }));
    if (s.genres[0]) lines.push(tr('shareGenre', { name: s.genres[0].name }));
    lines.push(tr('shareFoot'));
    return lines.join('\n');
  },

  sleepLeft() {
    const s = this.sleep;
    if (!s) return '';
    if (s.end) return tr('sleepEndShort');
    const left = Math.max(0, s.at - Date.now());
    return clock(left);
  },

  react(e, who, mine) {
    const card = this.isOpen && !this.page && this.tab === 'jam' ? this.panel.querySelector('.chorus-now') : null;
    if (card) {
      const r = card.getBoundingClientRect();
      const f = document.createElement('span');
      f.className = 'chorus-float';
      f.textContent = e;
      f.style.left = r.left + r.width * (0.15 + Math.random() * 0.7) + 'px';
      f.style.top = r.bottom - 48 + 'px';
      this.root.appendChild(f);
      setTimeout(() => f.remove(), 1700);
    }
    if (!mine && who) this.toast(`${who.name} ${e}`, { who, ttl: 2500 });
  },

  toast(text, opts = {}) {
    const el = document.createElement('div');
    el.className = 'chorus-toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `${opts.who ? avatar(opts.who, 24) : opts.track ? artwork(opts.track, 24) : ''}<span class="chorus-toast-text">${esc(text)}</span>`;
    const close = () => {
      el.classList.remove('is-in');
      setTimeout(() => el.remove(), 200);
    };
    for (const a of opts.actions || []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chorus-toast-btn' + (a.primary ? ' is-primary' : '');
      b.textContent = a.label;
      b.addEventListener('click', e => {
        if (!e.isTrusted) return;
        a.run();
        close();
      });
      el.appendChild(b);
    }
    this.toasts.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    setTimeout(close, opts.ttl || 4000);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }
};
