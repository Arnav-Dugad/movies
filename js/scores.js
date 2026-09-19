// ===== OUTSIDE SCORES =====
// IMDb, Rotten Tomatoes and Metacritic beside CineVerse's own TMDB score, from
// sources that cost nothing and need no key:
//
//   - IMDb comes from Cinemeta (v3-cinemeta.strem.io), the public catalogue
//     Stremio runs: one request per title returns the IMDb score, checked
//     against IMDb itself (Inception 8.8, Breaking Bad 9.5). Its per-episode
//     numbers are NOT IMDb's — Ozymandias comes back 8.4 where IMDb says 9.9,
//     and some shows come back unrated — so the episode grid uses TMDB's
//     ratings instead (the season heatmap's Numbers view, js/season-heatmap.js).
//   - Rotten Tomatoes and Metacritic come from Wikidata, where they are stored
//     as review scores with the reviewer named. Coverage is good for films and
//     thinner for television; a title without them simply shows fewer badges.
//   - OMDb fills the gaps for anyone who wants it. It needs a key, but a free
//     one covers a thousand titles a day, and it carries IMDb, the Tomatometer
//     and Metacritic for television as well as film. Paste it into
//     Settings → Discovery → OMDb key and it becomes the first source asked;
//     with no key nothing changes and nothing is sent anywhere.
//
// Both are cached on the device for a day, so a title opened twice costs one
// request, and neither is ever on the critical path: the page renders first and
// the badges arrive when they arrive.
import { prefs } from './prefs.js';
import { tmdb } from './api.js';

const CINEMETA = 'https://v3-cinemeta.strem.io/meta';
const OMDB = 'https://www.omdbapi.com/';
const ID_CACHE_KEY = 'cv_imdb_ids_v1';
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

/**
 * Pure: OMDb's payload → every score it carries. Its `Ratings` array names each
 * source ("Internet Movie Database", "Rotten Tomatoes", "Metacritic"); asking
 * with `tomatoes=true` can also return the audience meter beside the critics'
 * one, which is the only free source for the second half of the Tomatometer.
 * Those fields come back "N/A" on some keys, and "N/A" is not a score.
 */
export function parseOmdb(data = {}) {
  const out = { imdb: 0, rt: 0, rtAverage: 0, rtAudience: 0, metacritic: 0 };
  if (!data || data.Response === 'False') return out;
  out.imdb = normaliseRating(data.imdbRating);
  for (const row of Array.isArray(data.Ratings) ? data.Ratings : []) {
    const source = String(row?.Source || '').toLowerCase();
    const value = String(row?.Value || '');
    if (source.includes('rotten')) {
      const percent = /^(\d{1,3})%$/.exec(value.trim());
      if (percent) out.rt = Math.min(100, +percent[1]);
    } else if (source.includes('metacritic')) {
      const score = /^(\d{1,3})\/100$/.exec(value.trim());
      if (score) out.metacritic = Math.min(100, +score[1]);
    }
  }
  const meta = /^(\d{1,3})$/.exec(String(data.Metascore || '').trim());
  if (!out.metacritic && meta) out.metacritic = Math.min(100, +meta[1]);
  // The critics' and the audience's meters, where the key is allowed them.
  const critics = /^(\d{1,3})%?$/.exec(String(data.tomatoMeter || '').trim());
  if (!out.rt && critics) out.rt = Math.min(100, +critics[1]);
  const audience = /^(\d{1,3})%?$/.exec(String(data.tomatoUserMeter || '').trim());
  if (audience) out.rtAudience = Math.min(100, +audience[1]);
  const average = /^([\d.]+)$/.exec(String(data.tomatoRating || '').trim());
  if (!out.rtAverage && average) out.rtAverage = normaliseRating(average[1]);
  return out;
}

/** Pure: which of two score sets to keep per field (a real number beats a zero). */
export function mergeScores(primary = {}, fallback = {}) {
  const pick = key => (+primary[key] > 0 ? +primary[key] : +fallback[key] || 0);
  return { imdb: pick('imdb'), rt: pick('rt'), rtAverage: pick('rtAverage'), rtAudience: pick('rtAudience'), metacritic: pick('metacritic') };
}

/**
 * Pure: what an OMDb answer says about the key that asked for it.
 * OMDb answers 200 with `Response: "False"` for a key it will not serve, so the
 * message is the only thing that tells a spent quota from a dead key.
 * @returns {'ok'|'quota'|'invalid'|'error'}
 */
export function omdbVerdict(data, status = 200) {
  if (status === 401) return 'invalid';
  if (!data || typeof data !== 'object') return 'error';
  if (data.Response !== 'False') return 'ok';
  const message = String(data.Error || '').toLowerCase();
  if (message.includes('limit')) return 'quota';
  if (message.includes('key')) return 'invalid';
  // "Incorrect IMDb ID" and friends are about the title, not the key.
  return 'ok';
}

/** Pure: a key that looks like an OMDb key (eight hex characters), trimmed. */
export function cleanOmdbKey(value) {
  const key = String(value || '').trim();
  return /^[0-9a-zA-Z]{6,16}$/.test(key) ? key : '';
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

async function fromOmdb(imdbId, key) {
  const response = await fetch(`${OMDB}?i=${encodeURIComponent(imdbId)}&tomatoes=true&apikey=${encodeURIComponent(key)}`);
  const data = await response.json().catch(() => null);
  const verdict = omdbVerdict(data, response.status);
  if (verdict !== 'ok') { noteOmdbTrouble(key, verdict); throw new Error(verdict); }
  clearOmdbTrouble(key);
  return parseOmdb(data);
}

// ---------- a key that stops working ----------
// A key is pasted once and then forgotten, so the site has to be the one that
// notices when it stops being served — a spent daily quota or a revoked key.
// Said once per key per verdict, never on every title: the mark is kept on the
// device, and clears itself the moment the key answers again.
const TROUBLE_KEY = 'cv_omdb_trouble_v1';
const readTrouble = () => { try { return JSON.parse(localStorage.getItem(TROUBLE_KEY) || '{}') || {}; } catch (_) { return {}; } };

/** Pure: what to say about a key that came back refused. */
export function omdbTroubleMessage(verdict) {
  if (verdict === 'quota') return 'Your OMDb key has used up today\u2019s requests. Ratings fall back to the free sources until it resets.';
  if (verdict === 'invalid') return 'Your OMDb key was refused. Check it in Settings \u2192 Discovery, or clear it to use the free sources.';
  return 'OMDb could not be reached. Ratings fall back to the free sources.';
}

function noteOmdbTrouble(key, verdict) {
  const held = readTrouble();
  if (held.key === key && held.verdict === verdict) return;
  try { localStorage.setItem(TROUBLE_KEY, JSON.stringify({ key, verdict, at: Date.now() })); } catch (_) {}
  document.dispatchEvent(new CustomEvent('cv:omdb-trouble', { detail: { verdict, message: omdbTroubleMessage(verdict) } }));
}

function clearOmdbTrouble(key) {
  const held = readTrouble();
  if (held.key !== key) return;
  try { localStorage.removeItem(TROUBLE_KEY); } catch (_) {}
}

/** Forget a key's trouble, so a corrected key is watched again from scratch. */
export function resetOmdbTrouble() {
  try { localStorage.removeItem(TROUBLE_KEY); } catch (_) {}
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
  const empty = { imdb: 0, rt: 0, rtAverage: 0, rtAudience: 0, metacritic: 0 };
  if (!/^tt\d+$/.test(String(imdbId || ''))) return empty;
  const key = `${imdbId}_${type}`;
  const cache = readCache();
  const held = cache[key];
  if (fresh(held)) return { ...empty, ...held.value };
  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    // Named apart from `key` above: shadowing the cache key filed every score
    // under the OMDb key instead of the title.
    const omdbKey = cleanOmdbKey(prefs.omdbKey);
    const [meta, wiki, omdb] = await Promise.all([
      fromCinemeta(imdbId, type).catch(() => ({ imdb: 0 })),
      fromWikidata(imdbId).catch(() => ({ rt: 0, rtAverage: 0, metacritic: 0 })),
      omdbKey ? fromOmdb(imdbId, omdbKey).catch(() => null) : Promise.resolve(null),
    ]);
    // OMDb first where it answered, then the keyless pair — so a key fills the
    // Tomatometer in for television without changing anything else.
    const value = mergeScores(omdb || {}, { imdb: meta.imdb, rt: wiki.rt, rtAverage: wiki.rtAverage, metacritic: wiki.metacritic });
    const next = readCache();
    next[key] = { at: Date.now(), value };
    writeCache(next);
    return value;
  })().catch(() => empty).finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}


// ---------- knowing a title's IMDb id ----------
// A saved title carries its TMDB id, not its IMDb one. TMDB hands the id over in
// a small request per title, and the answer never changes, so it is kept for
// good on the device.
function readIds() {
  try { return JSON.parse(localStorage.getItem(ID_CACHE_KEY) || '{}') || {}; } catch (_) { return {}; }
}
function writeIds(ids) {
  try { localStorage.setItem(ID_CACHE_KEY, JSON.stringify(ids)); } catch (_) {}
}

/** The IMDb id for a TMDB title, from the device where it is already known. */
export async function imdbIdFor(tmdbId, type = 'movie') {
  const id = +tmdbId;
  if (!id) return '';
  const key = `${type}_${id}`;
  const ids = readIds();
  if (ids[key] !== undefined) return ids[key] || '';
  try {
    const data = await tmdb(`/${type === 'tv' ? 'tv' : 'movie'}/${id}/external_ids`);
    const imdbId = /^tt\d+$/.test(String(data?.imdb_id || '')) ? data.imdb_id : '';
    const next = readIds();
    next[key] = imdbId;
    writeIds(next);
    return imdbId;
  } catch (_) { return ''; }
}

/** Every score CineVerse holds for a title, by TMDB id, or null while unknown. */
export function cachedScoresFor(tmdbId, type = 'movie') {
  const imdbId = readIds()[`${type}_${+tmdbId}`];
  if (!imdbId) return null;
  const held = readCache()[`${imdbId}_${type}`];
  return fresh(held) ? held.value : null;
}

let prefetching = false;
/**
 * Fill the cache for a list of saved titles, a few at a time, so My List can
 * sort by IMDb without every card waiting on a request. Runs at most once at a
 * time and stops as soon as the list it was given is done.
 * @param {{ tmdbId: number, type: string }[]} items
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function prefetchScores(items = [], onProgress) {
  if (prefetching) return 0;
  const wanted = items
    .map(item => ({ id: +(item.tmdbId || item.id), type: item.type === 'tv' ? 'tv' : 'movie' }))
    .filter(item => item.id && !cachedScoresFor(item.id, item.type))
    .slice(0, 120);
  if (!wanted.length) return 0;
  prefetching = true;
  let done = 0;
  const worker = async () => {
    while (wanted.length) {
      const item = wanted.shift();
      const imdbId = await imdbIdFor(item.id, item.type);
      if (imdbId) await scoresFor(imdbId, item.type);
      done++;
      onProgress?.(done, done + wanted.length);
    }
  };
  try { await Promise.all([worker(), worker(), worker()]); } finally { prefetching = false; }
  return done;
}
