import { obj, num, cleanText, track, str, ytImg } from './clean.js';

const KEY = 'stats';
const MAX_TRACKS = 4000;
const MAX_YEAR_TRACKS = 2500;
const RECENT_DAYS = 35;

let data = null;
let loading = null;
let timer = 0;

function blank() {
  return { v: 1, tracks: {}, years: {}, recent: {}, skips: {} };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function dayKey(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function load() {
  if (data) return Promise.resolve(data);
  if (!loading) {
    loading = chrome.storage.local.get(KEY).then(r => {
      const s = r[KEY];
      data = s && s.v === 1 && s.tracks && s.years ? { ...blank(), ...s } : blank();
      return data;
    });
  }
  return loading;
}

function flush(now) {
  clearTimeout(timer);
  timer = setTimeout(() => chrome.storage.local.set({ [KEY]: data }).catch(() => {}), now ? 0 : 4000);
}

function bump(map, key, ms) {
  if (!key) return;
  map[key] = (map[key] || 0) + ms;
}

function trimMap(map, max, score) {
  const keys = Object.keys(map);
  if (keys.length <= max) return;
  keys.sort((a, b) => score(map[a]) - score(map[b]));
  for (const k of keys.slice(0, keys.length - max)) delete map[k];
}

export async function record(raw, ms, play, jam) {
  const t = track(raw);
  ms = Math.max(0, Math.min(60000, num(ms)));
  if (!t || (!ms && !play)) return;
  await load();
  const now = new Date();
  const y = String(now.getFullYear());
  const day = dayKey(now);
  const e = data.tracks[t.id] || (data.tracks[t.id] = { t, ms: 0, plays: 0, first: now.getTime(), last: 0 });
  e.t = t;
  e.ms += ms;
  e.last = now.getTime();
  if (play) e.plays++;
  const Y = data.years[y] || (data.years[y] = { ms: 0, plays: 0, days: {}, hours: new Array(24).fill(0), tracks: {}, artists: {}, genres: {}, jam: 0 });
  Y.ms += ms;
  if (play) Y.plays++;
  bump(Y.days, day.slice(5), ms);
  Y.hours[now.getHours()] += ms;
  const yt = Y.tracks[t.id] || (Y.tracks[t.id] = [0, 0]);
  yt[0] += ms;
  if (play) yt[1]++;
  bump(Y.artists, t.artist, ms);
  bump(Y.genres, t.genre.toLowerCase(), ms);
  if (jam) Y.jam += ms;
  const R = data.recent[day] || (data.recent[day] = {});
  const rt = R[t.id] || (R[t.id] = [0, 0]);
  rt[0] += ms;
  if (play) rt[1]++;
  const days = Object.keys(data.recent).sort();
  for (const d of days.slice(0, Math.max(0, days.length - RECENT_DAYS))) delete data.recent[d];
  trimMap(data.tracks, MAX_TRACKS, x => x.ms + x.last / 1e7);
  trimMap(Y.tracks, MAX_YEAR_TRACKS, x => x[0]);
  if (play && data.skips[t.artist]) data.skips[t.artist] = Math.max(0, data.skips[t.artist] - 1);
  flush();
}

export async function skip(raw) {
  const t = track(raw);
  if (!t || !t.artist) return;
  await load();
  data.skips[t.artist] = Math.min(10, (data.skips[t.artist] || 0) + 1);
  trimMap(data.skips, 300, x => x);
  flush();
}

export async function clear() {
  data = blank();
  flush(true);
}

export async function exportAll() {
  await load();
  return data;
}

export async function taste() {
  await load();
  const artists = {};
  for (const e of Object.values(data.tracks)) bump(artists, e.t.artist, e.ms);
  const top = Object.entries(artists)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40);
  const max = top.length ? top[0][1] : 1;
  const recent = Object.values(data.tracks)
    .sort((a, b) => b.last - a.last)
    .slice(0, 300)
    .map(e => e.t.id);
  const genres = {};
  for (const e of Object.values(data.tracks)) bump(genres, e.t.genre.toLowerCase(), e.ms);
  return {
    love: Object.fromEntries(top.map(([a, ms]) => [a, Math.round((ms / max) * 100) / 100])),
    meh: { ...data.skips },
    genres: Object.fromEntries(
      Object.entries(genres)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
    ),
    recent
  };
}

function top(map, n) {
  return Object.entries(map)
    .filter(([k]) => k)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function topTracks(pairs, n) {
  return pairs
    .filter(([id]) => data.tracks[id])
    .sort((a, b) => b[1][0] - a[1][0])
    .slice(0, n)
    .map(([id, v]) => ({ t: data.tracks[id].t, ms: v[0], plays: v[1] }));
}

function artistArt(name) {
  let best = null;
  for (const e of Object.values(data.tracks)) if (e.t.artist === name && e.t.art && (!best || e.ms > best.ms)) best = e;
  return best ? best.t.art : '';
}

function persona(hours) {
  const sum = (a, b) => hours.slice(a, b).reduce((x, y) => x + y, 0);
  const night = sum(0, 5) + hours[22] + hours[23];
  const morning = sum(5, 11);
  const day = sum(11, 17);
  const evening = sum(17, 22);
  const best = Math.max(night, morning, day, evening);
  if (!best) return '';
  return best === night ? 'night' : best === morning ? 'morning' : best === day ? 'day' : 'evening';
}

export async function summary(period, year) {
  await load();
  const now = new Date();
  const years = Object.keys(data.years)
    .filter(y => data.years[y].ms > 0)
    .sort();
  let ms = 0;
  let plays = 0;
  let pairs = [];
  let artists = {};
  let genres = {};
  let hours = new Array(24).fill(0);
  let days = {};
  let jam = 0;
  if (period === 'year') {
    const y = String(year || now.getFullYear());
    const Y = data.years[y];
    if (Y) {
      ms = Y.ms;
      plays = Y.plays;
      pairs = Object.entries(Y.tracks);
      artists = Y.artists;
      genres = Y.genres;
      hours = Y.hours;
      jam = Y.jam;
      for (const [d, v] of Object.entries(Y.days)) days[y + '-' + d] = v;
    }
  } else if (period === 'month') {
    const cut = dayKey(new Date(now.getTime() - 29 * 86400000));
    const merged = {};
    for (const [d, R] of Object.entries(data.recent)) {
      if (d < cut) continue;
      for (const [id, v] of Object.entries(R)) {
        const m = merged[id] || (merged[id] = [0, 0]);
        m[0] += v[0];
        m[1] += v[1];
        days[d] = (days[d] || 0) + v[0];
      }
    }
    pairs = Object.entries(merged);
    for (const [id, v] of pairs) {
      ms += v[0];
      plays += v[1];
      const e = data.tracks[id];
      if (e) {
        bump(artists, e.t.artist, v[0]);
        bump(genres, e.t.genre.toLowerCase(), v[0]);
      }
    }
    hours = null;
  } else {
    for (const e of Object.values(data.tracks)) {
      pairs.push([e.t.id, [e.ms, e.plays]]);
      ms += e.ms;
      plays += e.plays;
      bump(artists, e.t.artist, e.ms);
      bump(genres, e.t.genre.toLowerCase(), e.ms);
    }
    for (const Y of Object.values(data.years)) {
      Y.hours.forEach((v, i) => (hours[i] += v));
      jam += Y.jam;
    }
  }
  const busiest = top(days, 1)[0];
  return {
    period,
    year: period === 'year' ? Number(year || now.getFullYear()) : null,
    years,
    ms,
    plays,
    unique: pairs.filter(([, v]) => v[0] > 0).length,
    artistsCount: Object.keys(artists).filter(Boolean).length,
    daysCount: Object.keys(days).length,
    jam,
    busiest: busiest ? { day: busiest[0], ms: busiest[1] } : null,
    hours,
    persona: hours ? persona(hours) : '',
    tracks: topTracks(pairs, 10),
    artists: top(artists, 8).map(([name, v]) => ({ name, ms: v, art: artistArt(name) })),
    genres: top(genres, 5).map(([name, v]) => ({ name, ms: v }))
  };
}

export async function shareable() {
  const [month, yearNow, all] = await Promise.all([summary('month'), summary('year'), summary('all')]);
  const slim = s => ({ ...s, hours: s.hours, busiest: s.busiest, years: [] });
  return { month: slim(month), year: slim(yearNow), all: slim(all) };
}

function cleanSummary(s) {
  s = obj(s);
  const hours = Array.isArray(s.hours) && s.hours.length === 24 ? s.hours.map(x => Math.max(0, num(x))) : null;
  const b = obj(s.busiest);
  return {
    period: ['month', 'year', 'all'].includes(s.period) ? s.period : 'all',
    year: s.year ? num(s.year) | 0 : null,
    years: [],
    ms: Math.max(0, num(s.ms)),
    plays: Math.max(0, num(s.plays)) | 0,
    unique: Math.max(0, num(s.unique)) | 0,
    artistsCount: Math.max(0, num(s.artistsCount)) | 0,
    daysCount: Math.max(0, num(s.daysCount)) | 0,
    jam: Math.max(0, num(s.jam)),
    busiest: b.day ? { day: str(b.day, 10), ms: Math.max(0, num(b.ms)) } : null,
    hours,
    persona: ['night', 'morning', 'day', 'evening'].includes(s.persona) ? s.persona : '',
    tracks: (Array.isArray(s.tracks) ? s.tracks.slice(0, 10) : [])
      .map(x => {
        const t = track(obj(x).t);
        return t ? { t, ms: Math.max(0, num(x.ms)), plays: Math.max(0, num(x.plays)) | 0 } : null;
      })
      .filter(Boolean),
    artists: (Array.isArray(s.artists) ? s.artists.slice(0, 8) : []).map(x => ({ name: cleanText(obj(x).name).slice(0, 120), ms: Math.max(0, num(x.ms)), art: ytImg(obj(x).art) })).filter(x => x.name),
    genres: (Array.isArray(s.genres) ? s.genres.slice(0, 5) : []).map(x => ({ name: cleanText(obj(x).name).slice(0, 60), ms: Math.max(0, num(x.ms)) })).filter(x => x.name)
  };
}

export function cleanShared(x) {
  x = obj(x);
  return { month: cleanSummary(x.month), year: cleanSummary(x.year), all: cleanSummary(x.all) };
}

export function years() {
  return data
    ? Object.keys(data.years)
        .filter(y => data.years[y].ms > 0)
        .sort()
    : [];
}
