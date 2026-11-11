export const TEXT_MAX = 500;

const ORIGIN = 'https://music.youtube.com/';
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const LIST = /^[A-Za-z0-9_-]{2,80}$/;

export function obj(x) {
  return x && typeof x === 'object' && !Array.isArray(x) ? x : {};
}

export function str(x, n) {
  return typeof x === 'string' ? x.slice(0, n) : '';
}

export function num(x) {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
}

export function videoId(x) {
  return typeof x === 'string' && VIDEO.test(x) ? x : '';
}

export function watchUrl(id) {
  return videoId(id) ? ORIGIN + 'watch?v=' + id : '';
}

export function ytUrl(u) {
  if (typeof u !== 'string' || u.length > 200 || !u.startsWith(ORIGIN)) return '';
  const rest = u.slice(ORIGIN.length);
  let m = /^watch\?v=([A-Za-z0-9_-]{11})(?:&list=([A-Za-z0-9_-]{2,80}))?$/.exec(rest);
  if (m) return u;
  m = /^playlist\?list=([A-Za-z0-9_-]{2,80})$/.exec(rest);
  if (m) return u;
  m = /^(?:browse|channel)\/([A-Za-z0-9_-]{2,80})$/.exec(rest);
  return m ? u : '';
}

export function listId(x) {
  return typeof x === 'string' && LIST.test(x) ? x : '';
}

export function ytImg(u) {
  if (typeof u !== 'string' || u.length > 400) return '';
  if (/^https:\/\/i\.ytimg\.com\/vi\/[A-Za-z0-9_-]{11}\/(?:default|mqdefault|hqdefault|sddefault|maxresdefault|hq720)\.jpg$/.test(u)) return u;
  if (/^https:\/\/(?:lh3|yt3)\.googleusercontent\.com\/[A-Za-z0-9_-]{16,360}(?:=[A-Za-z0-9-]{1,40})?$/.test(u)) return u;
  return '';
}

export function cleanText(t) {
  return String(typeof t === 'string' ? t : '')
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, ' ')
    .trim()
    .slice(0, TEXT_MAX);
}

export function whoOf(p) {
  p = obj(p);
  return { id: str(p.id, 40), name: cleanText(p.name).slice(0, 60), avatar: '', url: '' };
}

export function track(t) {
  t = obj(t);
  const id = videoId(t.id);
  if (!id || t.url !== watchUrl(id)) return null;
  return {
    id,
    url: watchUrl(id),
    title: cleanText(t.title).slice(0, 200),
    artist: cleanText(t.artist).slice(0, 120),
    art: ytImg(t.art),
    dur: Math.max(0, Math.min(num(t.dur), 6 * 3600000)),
    genre: cleanText(t.genre).slice(0, 60)
  };
}
