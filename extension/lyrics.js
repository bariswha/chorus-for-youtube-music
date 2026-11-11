const API = 'https://lrclib.net/api';
const cache = new Map();

function fold(s) {
  return String(s || '')
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9Ѐ-ӿ؀-ۿ぀-ヿ一-鿿가-힯]+/g, ' ')
    .trim();
}

function clean(t) {
  const raw = String(t.title || '').replace(/\s+[-–—|]\s+(canl[ıi]|live|akustik|acoustic|remix|cover|slowed|sped up|reverb|version|versiyon|edit)(?=$|[\s,.)\]]).*$/i, '');
  let artist = String(t.artist || '');
  let title = raw;
  const dash = raw.match(/^(.+?)\s+[-–—|]\s+(.+)$/);
  if (dash) {
    artist = dash[1];
    title = dash[2];
  }
  const noise = /\b(official|music|video|audio|lyrics?|lyric video|visualizer|clip|klip|hd|hq|4k|s[öo]zleri|remaster(ed)?|prod\.?.*)\b/gi;
  title = title
    .replace(/[([{【][^)\]}】]*[)\]}】]/g, ' ')
    .replace(/\s+(ft|feat|featuring)\.?\s.*$/i, '')
    .replace(noise, ' ')
    .replace(/["“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  artist = artist
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\b(official|music|records?|tv)\b/gi, ' ')
    .replace(/\s+(ft|feat|&|x|,)\s.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { title, artist };
}

function parse(lrc) {
  const lines = [];
  for (const row of String(lrc || '').split(/\r?\n/)) {
    const stamps = [...row.matchAll(/\[(\d{1,2}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const words = row.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) lines.push([Math.round((+s[1] * 60 + parseFloat(s[2].replace(':', '.'))) * 1000), words]);
  }
  return lines.sort((a, b) => a[0] - b[0]);
}

async function get(path) {
  try {
    const r = await fetch(API + path, { headers: { 'Lrclib-Client': 'Chorus' } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function pick(list, want, dur, strict) {
  if (!Array.isArray(list)) return null;
  const target = fold(want.title);
  let best = null;
  let bestScore = -Infinity;
  for (const x of list) {
    if (!x || x.instrumental) continue;
    const name = fold(x.trackName);
    if (!name || !(name.includes(target) || target.includes(name))) continue;
    const gap = dur ? Math.abs((x.duration || 0) - dur) : 0;
    const artistHit = !!fold(x.artistName) && (fold(want.artist).includes(fold(x.artistName)) || fold(x.artistName).includes(fold(want.artist)));
    if (strict && !artistHit) continue;
    let score = -Math.min(gap, 60);
    if (x.syncedLyrics && gap <= 4) score += 20;
    if (artistHit) score += 10;
    if (score > bestScore) {
      bestScore = score;
      best = x;
    }
  }
  return best;
}

function shape(x, dur) {
  if (!x) return { synced: null, plain: null };
  const synced = x.syncedLyrics && (!dur || Math.abs((x.duration || 0) - dur) <= 4) ? parse(x.syncedLyrics) : null;
  return { synced: synced && synced.length ? synced : null, plain: x.plainLyrics || null };
}

export async function lyricsFor(t) {
  const key = String(t.id);
  if (cache.has(key)) return cache.get(key);
  const job = (async () => {
    const want = clean(t);
    const dur = t.dur ? Math.round(t.dur / 1000) : 0;
    if (!want.title) return { synced: null, plain: null };
    if (want.artist && dur) {
      const exact = await get(`/get?artist_name=${encodeURIComponent(want.artist)}&track_name=${encodeURIComponent(want.title)}&duration=${dur}`);
      if (exact && (exact.syncedLyrics || exact.plainLyrics)) return shape(exact, dur);
    }
    if (want.artist) {
      const hit = pick(await get(`/search?artist_name=${encodeURIComponent(want.artist)}&track_name=${encodeURIComponent(want.title)}`), want, dur, false);
      if (hit) return shape(hit, dur);
    }
    const loose = pick(await get(`/search?q=${encodeURIComponent((want.artist + ' ' + want.title).trim())}`), want, dur, true);
    return shape(loose, dur);
  })();
  cache.set(key, job);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return job;
}
