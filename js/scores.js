// ===== OUTSIDE SCORES =====
// IMDb, Rotten Tomatoes and Metacritic beside CineVerse's own TMDB score, from
// sources that cost nothing and need no key:
//
//   - IMDb comes from Cinemeta (v3-cinemeta.strem.io), the public catalogue
//     Stremio runs: one request per title returns the IMDb score, checked
//     against IMDb itself (Inception 8.8, Breaking Bad 9.5). Its per-episode
//     numbers are NOT IMDb's — Ozymandias comes back 8.4 where IMDb says 9.9,
//     and some shows come back unrated — so the episode grid uses TMDB's
//     ratings instead (js/episode-grid.js).
//   - Rotten Tomatoes and Metacritic come from Wikidata, where they are stored
//     as review scores with the reviewer named. Coverage is good for films and
//     thinner for television; a title without them simply shows fewer badges.
//
// Both are cached on the device for a day, so a title opened twice costs one
// request, and neither is ever on the critical path: the page renders first and
// the badges arrive when they arrive.
const CINEMETA = 'https://v3-cinemeta.strem.io/meta';
const WIKIDATA = 'https://query.wikidata.org/sparql';
const CACHE_KEY = 'cv_scores_v1';
const TTL = 24 * 60 * 60 * 1000;
const CACHE_CAP = 300;

// ---------- pure ----------

/** Pure: a 0-10 rating's band, for colour. */
export function bandFor(rating) {
  const value = +rating;
  if (!Number.isFinite(value) || value <= 0) return 'none';
  if (value >= 9) return 'great';
  if (value >= 8) return 'good';
  if (value >= 7) return 'fair';
  if (value >= 6) return 'weak';
  return 'poor';
}

/** Pure: "8.8" | 8.8 | "" → 8.8 or 0. */
export function normaliseRating(value) {
  const number = typeof value === 'string' ? parseFloat(value) : +value;
  return Number.isFinite(number) && number > 0 && number <= 10 ? Math.round(number * 10) / 10 : 0;
}

/**
 * Pure: Wikidata review scores → the two that are worth showing.
 * Rotten Tomatoes stores both a critics percentage ("87%") and an average
 * ("8.1/10"); the percentage is the Tomatometer everyone means.
 */
export function parseWikidataScores(bindings = []) {
  const out = { rt: 0, rtAverage: 0, metacritic: 0 };
  for (const row of bindings) {
    const by = String(row?.byLabel?.value || '').toLowerCase();
    const raw = String(row?.score?.value || '').trim();
    const percent = /^(\d{1,3})\s*%$/.exec(raw);
    const outOfTen = /^([\d.]+)\s*\/\s*10$/.exec(raw);
    const outOfHundred = /^(\d{1,3})\s*\/\s*100$/.exec(raw);
    if (by.includes('rotten')) {
      if (percent) out.rt = Math.max(out.rt, Math.min(100, +percent[1]));
      else if (outOfTen) out.rtAverage = Math.max(out.rtAverage, normaliseRating(outOfTen[1]));
    } else if (by.includes('metacritic')) {
      if (outOfHundred) out.metacritic = Math.max(out.metacritic, Math.min(100, +outOfHundred[1]));
      else if (percent) out.metacritic = Math.max(out.metacritic, Math.min(100, +percent[1]));
    }
  }
  return out;
}

/** Pure: is a cached entry still worth using? */
export const fresh = (entry, now = Date.now(), ttl = TTL) => !!entry && now - (+entry.at || 0) < ttl;

// ---------- device cache ----------
function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (_) { return {}; }
}
function writeCache(cache) {
  try {
    const keys = Object.keys(cache);
    if (keys.length > CACHE_CAP) {
      keys.sort((a, b) => (+cache[a].at || 0) - (+cache[b].at || 0)).slice(0, keys.length - CACHE_CAP).forEach(key => { delete cache[key]; });
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (_) {}
}

const inflight = new Map();

async function getJSON(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

async function fromCinemeta(imdbId, type) {
  const kind = type === 'tv' ? 'series' : 'movie';
  const data = await getJSON(`${CINEMETA}/${kind}/${encodeURIComponent(imdbId)}.json`);
  const meta = data?.meta || {};
  return { imdb: normaliseRating(meta.imdbRating) };
}

async function fromWikidata(imdbId) {
  const query = `SELECT ?byLabel ?score WHERE { ?item wdt:P345 "${imdbId}". ?item p:P444 ?statement. ?statement ps:P444 ?score. ?statement pq:P447 ?by. SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
  const data = await getJSON(`${WIKIDATA}?format=json&query=${encodeURIComponent(query)}`, { headers: { Accept: 'application/sparql-results+json' } });
  return parseWikidataScores(data?.results?.bindings || []);
}

/**
 * Every outside score for one title, from the cache when it is fresh.
 * Never throws: a source that is down leaves its field at 0.
 * @returns {Promise<{ imdb: number, rt: number, rtAverage: number, metacritic: number }>}
 */
export async function scoresFor(imdbId, type = 'movie') {
  const empty = { imdb: 0, rt: 0, rtAverage: 0, metacritic: 0 };
  if (!/^tt\d+$/.test(String(imdbId || ''))) return empty;
  const key = `${imdbId}_${type}`;
  const cache = readCache();
  const held = cache[key];
  if (fresh(held)) return { ...empty, ...held.value };
  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    const [meta, wiki] = await Promise.all([
      fromCinemeta(imdbId, type).catch(() => ({ imdb: 0 })),
      fromWikidata(imdbId).catch(() => ({ rt: 0, rtAverage: 0, metacritic: 0 })),
    ]);
    const value = { imdb: meta.imdb, rt: wiki.rt, rtAverage: wiki.rtAverage, metacritic: wiki.metacritic };
    const next = readCache();
    next[key] = { at: Date.now(), value };
    writeCache(next);
    return value;
  })().catch(() => empty).finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}
