// ===== EPISODE PROGRESS =====
// Per-episode tracking for TV, and the Continue Watching queue built from it.
//
// One document per show at users/{uid}/progress/{tv_<id>}, holding the watched
// episode NUMBERS per season rather than a document per episode:
//
//   { seasons: { "1": [1,2,3], "2": [1] }, structure: { "1": 7, "2": 13 },
//     aired: { season: 2, episode: 4 }, lastWatched: {...} }
//
// `structure` (how many episodes each season has) and `aired` (the most recent
// episode to have aired) are refreshed whenever the detail page loads the show.
// Keeping them on the document is what lets the home rail compute "next up"
// instantly, with zero TMDB requests, on a cold page load.
import { state } from './state.js';
import { tmdb } from './api.js';
import { db, firebase } from './firebase.js';
import { toast } from './ui.js';
import { isEpisodeAvailable } from './episode-times.js';

const KEY = id => `tv_${id}`;
const cacheKey = () => `cv_episode_progress_${state.user?.uid || 'guest'}`;
const col = uid => db.collection('users').doc(uid || state.user.uid).collection('progress');
const writeTimers = new Map();
let progressUnsubscribe = null;
const DAY = 86400000;

const numbers = value => [...new Set((Array.isArray(value) ? value : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);

// Per-episode timestamps as compact tuples [season, episode, whenMs, bulk].
//
// `bulk` is what keeps the stats honest. Ticking episodes one at a time is real
// viewing; "mark season watched" or a legacy back-fill is bookkeeping. Both
// belong in the episodes-over-time chart, but only the first is a binge — so the
// binge record counts single ticks and says so.
//
// Only the most recent LOG_CAP survive per show: an unbounded array would
// eventually outgrow both the document limit and localStorage.
const LOG_CAP = 400;
const EPISODE_MODEL_V = 2;

const orderedSeasons = structure => Object.keys(structure || {}).map(Number).filter(n => n > 0).sort((a, b) => a - b);

// Most shows restart episode numbers at 1 each season. A few long-running shows
// (One Piece is the important example) use one global number even though TMDB
// divides the show into arc-like seasons. The old tracker only stored a count,
// then generated 1..count, so One Piece's S22 E1107 became sixty-seven fake
// episodes and the next button jumped to S23 E1.
function numberingModeFor(value, structure, aired) {
  if (value?.numberingMode === 'absolute') return 'absolute';
  if (value?.numberingMode === 'season' && +value?.episodeModelV >= EPISODE_MODEL_V) return 'season';
  const seasonSize = +(structure || {})[String(+aired?.season)] || 0;
  return seasonSize > 0 && +aired?.episode > seasonSize ? 'absolute' : 'season';
}

function episodeNumbersFor(entry, season) {
  const structure = entry?.structure || {};
  const count = +structure[String(+season)] || 0;
  if (!count) return [];
  if (entry.numberingMode !== 'absolute') return Array.from({ length: count }, (_, index) => index + 1);
  let before = 0;
  for (const current of orderedSeasons(structure)) {
    if (current >= +season) break;
    before += +structure[String(current)] || 0;
  }
  return Array.from({ length: count }, (_, index) => before + index + 1);
}

function normalizeEpisodeList(value, season, structure, numberingMode) {
  const raw = numbers(value);
  if (numberingMode !== 'absolute') return raw;
  const probe = { structure, numberingMode };
  const valid = episodeNumbersFor(probe, season);
  const validSet = new Set(valid);
  // Old documents contain local placeholders (1..season size). Translate only
  // values that are not already valid global episode numbers, making this
  // migration idempotent across cache, Firestore and transaction reads.
  return numbers(raw.map(episode => validSet.has(episode) ? episode : (episode <= valid.length ? valid[episode - 1] : episode)));
}

function normalizeLog(value, structure, numberingMode) {
  const mapped = (Array.isArray(value) ? value : []).map(row => {
    if (!Array.isArray(row) || numberingMode !== 'absolute') return row;
    const [season, episode, ...rest] = row;
    const translated = normalizeEpisodeList([episode], season, structure, numberingMode)[0];
    return translated ? [+season, translated, ...rest] : row;
  });
  return cleanLog(mapped);
}

// Rows are deduplicated by episode, keeping the EARLIEST stamp: after a merge two
// devices can each hold a row for the same episode with different moments, and
// the first time it was marked is the true one. Without this, one episode could
// appear twice in the episodes-over-time chart.
function cleanLog(value) {
  const rows = (Array.isArray(value) ? value : [])
    .filter(row => Array.isArray(row) && row.length >= 3 && row.slice(0, 3).every(cell => Number.isFinite(+cell)))
    .map(row => [+row[0], +row[1], +row[2], row[3] ? 1 : 0])
    .filter(row => row[0] > 0 && row[1] > 0 && row[2] > 0);
  const byEpisode = new Map();
  for (const row of rows) {
    const key = `${row[0]}_${row[1]}`;
    const held = byEpisode.get(key);
    // Earliest stamp wins; a single tick outranks a bulk mark at the same moment.
    if (!held || row[2] < held[2] || (row[2] === held[2] && !row[3])) byEpisode.set(key, row);
  }
  return [...byEpisode.values()].sort((a, b) => a[2] - b[2]).slice(-LOG_CAP);
}

// How many times each season has been seen, keyed by season number. Absent means
// "once, if it is complete" — exactly the rule the show-level count uses, so no
// migration is needed and a season only grows a number once it is rewatched.
const cleanSeasonPlays = value => {
  const out = {};
  for (const [season, count] of Object.entries(value && typeof value === 'object' ? value : {})) {
    const s = +season, n = Math.floor(+count);
    if (s > 0 && n > 1) out[String(s)] = Math.min(n, 999);
  }
  return out;
};

function sanitizeEntry(value) {
  if (!value || typeof value !== 'object') return null;
  let seasons = {}, removed = {};
  const structure = {};
  for (const [season, count] of Object.entries(value.structure || {})) {
    if (+season > 0 && +count > 0) structure[String(+season)] = +count;
  }
  const aired = value.aired && +value.aired.season > 0 && +value.aired.episode > 0
    ? { season: +value.aired.season, episode: +value.aired.episode } : null;
  const numberingMode = numberingModeFor(value, structure, aired);
  for (const [season, list] of Object.entries(value.seasons || {})) {
    const episodes = normalizeEpisodeList(list, +season, structure, numberingMode);
    if (episodes.length) seasons[String(+season)] = episodes;
  }
  // Episodes explicitly UN-ticked. Without these, merging two devices could only
  // union their watched sets, which resurrects every deliberate un-tick — see
  // mergeEntries.
  for (const [season, list] of Object.entries(value.removed || {})) {
    const key = String(+season);
    const watched = new Set(seasons[key] || []);
    const gone = normalizeEpisodeList(list, +season, structure, numberingMode).filter(episode => !watched.has(episode));
    if (gone.length) removed[key] = gone;
  }
  const lastWatched = value.lastWatched && +value.lastWatched.at
    ? { season: +value.lastWatched.season, episode: +value.lastWatched.episode, at: +value.lastWatched.at } : null;

  // Recover the exact intent behind the old One Piece failure. `markUpTo` saved
  // the real target in lastWatched (for example S22 E1107), but filled the whole
  // arc using local placeholders 1..67. A full local run plus a valid global
  // anchor is an unambiguous signature, so rebuild the contiguous position up to
  // that anchor and explicitly remove only the accidental overrun.
  if (numberingMode === 'absolute' && +value.episodeModelV < EPISODE_MODEL_V && lastWatched) {
    const anchorRange = episodeNumbersFor({ structure, numberingMode }, lastWatched.season);
    const rawAnchor = new Set(numbers(value.seasons?.[String(lastWatched.season)] || []));
    const fullLegacyRun = anchorRange.length > 0 && Array.from({ length: anchorRange.length }, (_, i) => i + 1).every(n => rawAnchor.has(n));
    if (fullLegacyRun && anchorRange.includes(lastWatched.episode)) {
      const previous = seasons;
      seasons = {};
      for (const season of orderedSeasons(structure)) {
        const wanted = episodeNumbersFor({ structure, numberingMode }, season)
          .filter(episode => season < lastWatched.season || (season === lastWatched.season && episode <= lastWatched.episode));
        if (wanted.length) seasons[String(season)] = wanted;
      }
      for (const [season, list] of Object.entries(previous)) {
        const overrun = list.filter(episode => +season > lastWatched.season || (+season === lastWatched.season && episode > lastWatched.episode));
        if (overrun.length) removed[String(+season)] = numbers([...(removed[String(+season)] || []), ...overrun]);
      }
    }
  }

  // Watched always wins inside one sanitized document.
  for (const [season, list] of Object.entries(removed)) {
    const watched = new Set(seasons[season] || []);
    const gone = list.filter(episode => !watched.has(episode));
    if (gone.length) removed[season] = gone; else delete removed[season];
  }
  return {
    tmdbId: +value.tmdbId || 0, title: String(value.title || ''), poster: String(value.poster || ''),
    backdrop: String(value.backdrop || ''), episodeRuntime: +value.episodeRuntime || 0,
    status: String(value.status || ''), seasons, structure, aired, numberingMode,
    episodeModelV: EPISODE_MODEL_V,
    lastWatched,
    removed,
    log: normalizeLog(value.log, structure, numberingMode),
    seasonPlays: cleanSeasonPlays(value.seasonPlays),
    caughtUpAt: +value.caughtUpAt || 0,
    completedAt: +value.completedAt || 0,
    metaCheckedAt: +value.metaCheckedAt || 0,
    legacyBackfillAt: +value.legacyBackfillAt || 0,
    legacy: !!value.legacy,
    updatedAt: +value.updatedAt || 0,
  };
}

// ---------- load / persist ----------
export function hydrateEpisodeProgressFromCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(cacheKey()) || '{}');
    const out = {};
    for (const [key, value] of Object.entries(raw)) { const entry = sanitizeEntry(value); if (entry) out[key] = entry; }
    state.episodeProgress = out;
  } catch (_) { state.episodeProgress = {}; }
}

function mirror() {
  try { localStorage.setItem(cacheKey(), JSON.stringify(state.episodeProgress)); } catch (_) {}
}

const syncComparable = entry => entry ? JSON.stringify({ ...entry, metaCheckedAt: 0 }) : 'null';

export async function loadEpisodeProgress() {
  if (!state.user) { state.episodeProgress = {}; return; }
  const uid = state.user.uid;
  hydrateEpisodeProgressFromCache();
  const local = { ...(state.episodeProgress || {}) };
  try {
    const snap = await col(uid).get();
    if (state.user?.uid !== uid) return;
    const server = {}, migrations = new Set();
    snap.docs.forEach(doc => {
      const raw = doc.data();
      const entry = sanitizeEntry(raw);
      if (entry) server[doc.id] = entry;
      if (entry && +raw?.episodeModelV < EPISODE_MODEL_V) migrations.add(doc.id);
    });
    const out = {};
    for (const key of new Set([...Object.keys(server), ...Object.keys(local)])) {
      const entry = mergeEntries(server[key], local[key]);
      if (entry) out[key] = entry;
    }
    state.episodeProgress = out;
    mirror();
    // A newer offline/local edit is reconciled after the read. Transactions keep
    // a simultaneous edit on another device intact.
    const dirty = Object.keys(out).filter(key => migrations.has(key) || syncComparable(out[key]) !== syncComparable(server[key] || null));
    await Promise.all(dirty.map(key => writeMerged(key, out[key], uid).catch(error => console.warn('episode progress reconcile', error))));
  } catch (error) { console.warn('loadEpisodeProgress', error); }
}

// ===== MERGING TWO DEVICES =====
// The document used to be written whole, with merge:false. Two devices ticking
// different episodes of the same show inside the debounce window each sent a
// complete document, and the second one silently erased the first one's tick.
//
// Unioning the watched sets is not a fix: it cannot tell "this device has not
// seen that tick yet" from "this device deliberately un-ticked it", so every
// un-tick would come back from the dead. Each season therefore carries a second
// set — `removed` — and every episode is in exactly one of three states: watched,
// removed, or never touched.
//
// That makes the merge total and, for the case that actually happens, lossless:
//
//   watched + never touched  -> watched   (the other device simply had not seen it)
//   removed + never touched  -> removed
//   watched + watched        -> watched
//   removed + removed        -> removed
//   watched + removed        -> the more recently edited document wins
//
// Only the last line is a real conflict, and it needs two devices to disagree
// about the SAME episode at the same time. Different episodes never collide.
const setOf = (map, season) => new Set((map || {})[String(season)] || []);
const mergeStructure = (a, b) => {
  const out = {};
  for (const season of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const count = Math.max(+(a || {})[season] || 0, +(b || {})[season] || 0);
    if (count) out[String(+season)] = count;
  }
  return out;
};
const laterAired = (a, b) => {
  if (!a) return b || null;
  if (!b) return a;
  return (+a.season > +b.season || (+a.season === +b.season && +a.episode >= +b.episode)) ? a : b;
};
const mergeMilestone = (server, local, field) => {
  const a = +server?.[field] || 0, b = +local?.[field] || 0;
  if (a && b) return Math.min(a, b);
  if (!a && !b) return 0;
  const holder = a ? server : local, clearer = a ? local : server;
  return (+clearer.updatedAt || 0) > (+holder.updatedAt || 0) ? 0 : (a || b);
};

export function mergeEntries(server, local) {
  if (!server) return local;
  if (!local) return server;
  // Ties go to the local copy: it is the one holding the edit being written.
  const localWins = (+local.updatedAt || 0) >= (+server.updatedAt || 0);
  const tied = (+local.updatedAt || 0) === (+server.updatedAt || 0);
  const newer = localWins ? local : server;
  const older = localWins ? server : local;

  const seasons = {}, removed = {};
  const allSeasons = new Set([
    ...Object.keys(server.seasons || {}), ...Object.keys(local.seasons || {}),
    ...Object.keys(server.removed || {}), ...Object.keys(local.removed || {}),
  ]);
  for (const season of allSeasons) {
    const newWatched = setOf(newer.seasons, season), newGone = setOf(newer.removed, season);
    const oldWatched = setOf(older.seasons, season), oldGone = setOf(older.removed, season);
    const watched = [], gone = [];
    for (const episode of new Set([...newWatched, ...newGone, ...oldWatched, ...oldGone])) {
      const inNew = newWatched.has(episode) ? 'w' : newGone.has(episode) ? 'r' : '';
      const inOld = oldWatched.has(episode) ? 'w' : oldGone.has(episode) ? 'r' : '';
      // A side with no opinion never overrules one that has one. When both have
      // an opinion and they agree, that is the answer. When they disagree the
      // newer document decides — unless the two were edited in the same
      // millisecond, where there is no "newer" and removal wins. That tie-break
      // is what makes the merge symmetric (merging A into B and B into A give the
      // same document), and it errs toward the safer mistake: an un-tick the
      // viewer has to redo beats an episode reappearing after they removed it.
      const verdict = !inOld ? inNew : !inNew ? inOld : inNew === inOld ? inNew : (tied ? 'r' : inNew);
      (verdict === 'w' ? watched : gone).push(episode);
    }
    if (watched.length) seasons[String(+season)] = watched.sort((a, b) => a - b);
    if (gone.length) removed[String(+season)] = gone.sort((a, b) => a - b);
  }

  // Rewatch counts only ever go up, so the higher number is the one that has seen
  // more of the history.
  const seasonPlays = {};
  for (const season of new Set([...Object.keys(server.seasonPlays || {}), ...Object.keys(local.seasonPlays || {})])) {
    const value = Math.max(+(server.seasonPlays || {})[season] || 0, +(local.seasonPlays || {})[season] || 0);
    if (value > 1) seasonPlays[String(+season)] = value;
  }

  return sanitizeEntry({
    ...older, ...newer,                          // metadata from the newer document
    tmdbId: newer.tmdbId || older.tmdbId || 0,
    title: newer.title || older.title || '',
    poster: newer.poster || older.poster || '',
    backdrop: newer.backdrop || older.backdrop || '',
    episodeRuntime: newer.episodeRuntime || older.episodeRuntime || 0,
    status: newer.status || older.status || '',
    numberingMode: newer.numberingMode === 'absolute' || older.numberingMode === 'absolute' ? 'absolute' : 'season',
    episodeModelV: EPISODE_MODEL_V,
    // Merge every season independently. Counting season keys was not enough: a
    // returning series can gain S2E9 while both documents still have two keys.
    structure: mergeStructure(server.structure, local.structure),
    aired: laterAired(server.aired, local.aired),
    seasons, removed, seasonPlays,
    log: cleanLog([...(server.log || []), ...(local.log || [])]),
    // Earliest genuine finish, so a merge cannot postpone a completion date.
    // Guarded because Math.min() with nothing to compare returns Infinity.
    caughtUpAt: mergeMilestone(server, local, 'caughtUpAt'),
    completedAt: mergeMilestone(server, local, 'completedAt'),
    metaCheckedAt: Math.max(+server.metaCheckedAt || 0, +local.metaCheckedAt || 0),
    legacyBackfillAt: Math.max(+server.legacyBackfillAt || 0, +local.legacyBackfillAt || 0),
    lastWatched: (+newer.lastWatched?.at || 0) >= (+older.lastWatched?.at || 0) ? newer.lastWatched : older.lastWatched,
    legacy: tied ? !!(server.legacy && local.legacy) : !!newer.legacy,
    updatedAt: Math.max(+server.updatedAt || 0, +local.updatedAt || 0),
  });
}

// One debounced write per show: marking a whole season episode-by-episode still
// costs a single document write instead of one per tick.
function persist(key) {
  mirror();
  document.dispatchEvent(new CustomEvent('cv:episode-progress', { detail: { key } }));
  if (!state.user) return;
  clearTimeout(writeTimers.get(key));
  const uid = state.user.uid;
  writeTimers.set(key, setTimeout(() => {
    writeTimers.delete(key);
    if (state.user?.uid !== uid) return;
    const entry = state.episodeProgress[key];
    if (!entry) { col().doc(key).delete().catch(error => console.warn('episode progress delete', error)); return; }
    writeMerged(key, entry, uid).catch(error => console.warn('episode progress sync', error));
  }, 600));
}

// Structure and aired-marker only, merged rather than replaced. `persist` writes
// the WHOLE document, so using it for a metadata refresh could overwrite the
// seasons another device just ticked with this device's older copy. This path
// cannot: it never sends `seasons`.
function persistMeta(key, fields) {
  mirror();
  document.dispatchEvent(new CustomEvent('cv:episode-progress', { detail: { key } }));
  if (!state.user) return;
  const uid = state.user.uid;
  col(uid).doc(key).set({ ...fields, updatedAt: Date.now(), serverUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true })
    .catch(error => { if (state.user?.uid === uid) console.warn('episode structure sync', error); });
}

// A transaction rather than a plain write: it reads what is actually on the
// server and merges this device's edit into it, so a tick made on a phone thirty
// seconds ago survives a tick made on a laptop now. One extra document read per
// debounced batch — a rounding error next to the reads the library cache saves.
async function writeMerged(key, entry, uid) {
  const ref = col(uid).doc(key);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const server = snapshot.exists ? sanitizeEntry(snapshot.data()) : null;
    const merged = mergeEntries(server, entry) || entry;
    transaction.set(ref, { ...merged, serverUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    // Adopt the merged result locally so this device immediately reflects what
    // the other one did, rather than waiting for the next full load.
    if (state.user?.uid === uid && state.episodeProgress[key]) {
      state.episodeProgress[key] = merged;
    }
  });
  if (state.user?.uid !== uid) return;
  mirror();
  document.dispatchEvent(new CustomEvent('cv:episode-progress', { detail: { key, merged: true } }));
}

export function resetEpisodeProgressForAuth() {
  progressUnsubscribe?.(); progressUnsubscribe = null;
  writeTimers.forEach(clearTimeout); writeTimers.clear();
  state.episodeProgress = {};
}

/** Merge live Firestore changes into the local ledger without losing offline edits. */
function startEpisodeProgressRealtime(uid) {
  progressUnsubscribe?.(); progressUnsubscribe = null;
  if (!uid) return;
  progressUnsubscribe = col(uid).onSnapshot(snapshot => {
    if (state.user?.uid !== uid) return;
    const server = {};
    snapshot.docs.forEach(doc => { const entry = sanitizeEntry(doc.data()); if (entry) server[doc.id] = entry; });
    const local = state.episodeProgress || {}, merged = {};
    for (const key of new Set([...Object.keys(server), ...Object.keys(local)])) {
      const entry = mergeEntries(server[key], local[key]);
      if (entry) merged[key] = entry;
    }
    state.episodeProgress = merged;
    mirror();
    document.dispatchEvent(new CustomEvent('cv:episode-progress', { detail: { live: true } }));
  }, error => console.warn('episode progress live sync', error));
}

// Everything the progress document needs about a show, derived from one TMDB
// /tv/{id} payload. Shared so the detail page and the legacy back-fill can never
// disagree about what a show's structure is.
export function tvShowMeta(det) {
  const structure = {};
  for (const season of det?.seasons || []) {
    if (season.season_number > 0 && season.episode_count > 0) structure[String(season.season_number)] = season.episode_count;
  }
  const last = det?.last_episode_to_air;
  const next = det?.next_episode_to_air;
  const aired = last?.season_number ? { season: last.season_number, episode: last.episode_number } : null;
  return {
    title: det?.name || '', poster: det?.poster_path || '', backdrop: det?.backdrop_path || '',
    episodeRuntime: (det?.episode_run_time || [])[0] || 0, status: det?.status || '',
    structure, aired,
    numberingMode: numberingModeFor({}, structure, aired),
    episodeModelV: EPISODE_MODEL_V,
    nextEpisode: next?.season_number ? { season_number: +next.season_number, episode_number: +next.episode_number, air_date: next.air_date || '' } : null,
  };
}

// Fetches a show's structure for callers that have no TMDB payload — a card, the
// watched toggle, the legacy back-fill.
//
// Cached on the device for a week, because the same shows get asked for again:
// a legacy back-fill that is interrupted and resumed, a show marked watched from
// a card after being opened earlier, a second pass after a reload. Kept short
// because a structure goes stale the moment a new season is announced — and the
// detail page refreshes it from live data on every view anyway
// (syncShowStructure), so a stale copy can never survive being looked at.
const META_CACHE_KEY = 'cv_show_meta_v1';
const META_TTL = 7 * 86400000;
let metaMemo = null;

function metaStore() {
  if (metaMemo) return metaMemo;
  try { metaMemo = JSON.parse(localStorage.getItem(META_CACHE_KEY) || '{}') || {}; }
  catch (_) { metaMemo = {}; }
  return metaMemo;
}

export async function fetchShowMeta(id, { force = false } = {}) {
  const key = String(+id || 0);
  const cached = metaStore()[key];
  if (!force && cached && Date.now() - (cached.at || 0) < META_TTL && Object.keys(cached.meta?.structure || {}).length) {
    return cached.meta;
  }
  const meta = tvShowMeta(await tmdb(`/tv/${id}`, {}, { cache: !force }));
  try {
    metaMemo[key] = { at: Date.now(), meta };
    const rows = Object.entries(metaMemo).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 200);
    localStorage.setItem(META_CACHE_KEY, JSON.stringify(Object.fromEntries(rows)));
  } catch (_) {}
  return meta;
}

// Build the show shape that really existed at a historical moment. The old
// backfill used today's full structure with an old watched date, which could
// mark seasons released years later as watched in the past.
export async function fetchHistoricalShowMeta(id, { cutoff = Date.now() } = {}) {
  const detail = await tmdb(`/tv/${id}`);
  const seasons = (detail.seasons || []).filter(season => season.season_number > 0 && season.episode_count > 0);
  const queue = [...seasons];
  const results = [];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (;;) {
      const season = queue.shift();
      if (!season) return;
      const payload = await tmdb(`/tv/${id}/season/${season.season_number}`);
      results.push(payload);
    }
  });
  await Promise.all(workers);
  const structure = {};
  let aired = null;
  for (const season of results) {
    const available = (season.episodes || []).filter(episode => isEpisodeAvailable(episode, { showId: id, now: cutoff }));
    const lastNumber = Math.max(0, ...available.map(episode => +episode.episode_number || 0));
    if (!available.length || !lastNumber) continue;
    // Count, never max episode number. They are the same for ordinary seasons,
    // but One Piece's 67-episode Egghead arc ends at global episode 1155.
    structure[String(+season.season_number)] = available.length;
    aired = laterAired(aired, { season: +season.season_number, episode: lastNumber });
  }
  return { ...tvShowMeta(detail), structure, aired, numberingMode: numberingModeFor({}, structure, aired), historicalCutoff: cutoff };
}

// ---------- reads ----------
export const showEntry = id => state.episodeProgress?.[KEY(id)] || null;

export function isEpisodeWatched(id, season, episode) {
  return !!showEntry(id)?.seasons?.[String(season)]?.includes(+episode);
}

export function seasonWatchedCount(id, season) {
  const entry = showEntry(id);
  if (!entry) return 0;
  const valid = new Set(episodeNumbersFor(entry, season));
  return (entry.seasons?.[String(season)] || []).filter(episode => !valid.size || valid.has(episode)).length;
}

/** One-based position across the whole series, independent of TMDB season cuts. */
export function absoluteEpisodePosition(entryOrId, season, episode) {
  const entry = typeof entryOrId === 'object' ? entryOrId : showEntry(entryOrId);
  if (!entry) return 0;
  let position = 0;
  for (const current of orderedSeasons(entry.structure)) {
    const list = episodeNumbersFor(entry, current);
    if (current === +season) {
      const index = list.indexOf(+episode);
      return index >= 0 ? position + index + 1 : 0;
    }
    position += list.length;
  }
  return 0;
}

/** Where a one-based whole-series position lives in TMDB's season structure. */
export function episodeAtPosition(entryOrId, position, { airedOnly = false } = {}) {
  const entry = typeof entryOrId === 'object' ? entryOrId : showEntry(entryOrId);
  let target = Math.floor(+position);
  if (!entry || target < 1) return null;
  for (const season of orderedSeasons(entry.structure)) {
    const list = airedOnly ? airedEpisodesFor(entry, season) : episodeNumbersFor(entry, season);
    if (target <= list.length) return { season, episode: list[target - 1], absolute: Math.floor(+position), numberingMode: entry.numberingMode || 'season' };
    target -= list.length;
  }
  return null;
}

/** Human-readable next-up label. Absolute-numbered anime should never say S23E1. */
export function episodeLabel(entryOrId, point, { compact = false } = {}) {
  const entry = typeof entryOrId === 'object' ? entryOrId : showEntry(entryOrId);
  if (!entry || !point) return '';
  const position = point.absolute || absoluteEpisodePosition(entry, point.season, point.episode);
  if (entry.numberingMode === 'absolute') return compact ? `EP ${point.episode}` : `Episode ${point.episode}`;
  return compact ? `S${point.season}:E${point.episode}` : `S${point.season} · E${point.episode}${position ? ` · Episode ${position} overall` : ''}`;
}

// How many episodes of one season have aired. Every bulk action caps at this, so
// progress can never claim a completion the viewer could not have reached.
// Previously computed inline in three places, which is three chances to disagree.
export function seasonAiredCount(id, season) {
  return airedEpisodesFor(showEntry(id), season).length;
}

function airedEpisodesFor(entry, season) {
  const candidates = episodeNumbersFor(entry, season);
  if (!candidates.length) return [];
  const aired = entry.aired;
  if (!aired) return [];
  if (+season < aired.season) return candidates;
  if (+season === aired.season) return candidates.filter(episode => episode <= aired.episode);
  return [];                                   // the season has not started airing
}

/** Separate the two meanings the old "complete" flag mixed together. */
export function seasonState(id, season) {
  const entry = showEntry(id);
  const total = +(entry?.structure || {})[String(+season)] || 0;
  const aired = seasonAiredCount(id, season);
  const done = new Set(showEntry(id)?.seasons?.[String(+season)] || []);
  let watchedAired = 0;
  for (const episode of airedEpisodesFor(entry, season)) if (done.has(episode)) watchedAired++;
  return {
    total, aired, watched: watchedAired,
    caughtUp: aired > 0 && watchedAired >= aired,
    completed: total > 0 && aired >= total && watchedAired >= total,
  };
}

/** Every currently available episode is ticked. */
export const isSeasonCaughtUp = (id, season) => seasonState(id, season).caughtUp;
/** Every episode in a fully released season is ticked. */
export const isSeasonComplete = (id, season) => seasonState(id, season).completed;

// ===== SEASON REWATCHES =====
// Rewatching one season is the common case for TV — nobody restarts a 60-episode
// run to see their favourite year again — so the show-level count in
// js/rewatch.js is the wrong unit here. A season carries its own tally, and only
// once it is complete: there is no such thing as a rewatch of something you have
// not finished.

/** Times this season has been seen. 0 until it is complete, then at least 1. */
export function seasonPlayCount(id, season) {
  if (!isSeasonComplete(id, season)) return 0;
  const n = Math.floor(+(showEntry(id)?.seasonPlays || {})[String(+season)] || 0);
  return n > 0 ? n : 1;
}

export function seasonPlayLabel(id, season) {
  const n = seasonPlayCount(id, season);
  if (n <= 1) return n === 1 ? 'Seen once' : '';
  return n === 2 ? 'Seen twice' : `Seen ${n} times`;
}

/**
 * Log another viewing of a finished season. Returns the new count, `null` if
 * signed out, or 0 when the season is not complete — you cannot rewatch what you
 * have not watched, and the caller should say so rather than silently counting.
 */
export function logSeasonRewatch(id, season, meta = {}) {
  if (!state.user) { document.dispatchEvent(new Event('cv:open-auth')); return null; }
  if (!isSeasonComplete(id, season)) return 0;
  const next = seasonPlayCount(id, season) + 1;
  apply(id, meta, entry => {
    entry.seasonPlays = { ...(entry.seasonPlays || {}), [String(+season)]: next };
    // A rewatch is viewing activity, so the show surfaces as recently watched —
    // but it adds no episodes, and therefore no rows to the episode log.
    markLast(entry, season, seasonAiredCount(id, season) || 1);
  });
  return next;
}

/** Undo the most recent season rewatch. Never drops below the original viewing. */
export function removeSeasonRewatch(id, season, meta = {}) {
  if (!state.user) { document.dispatchEvent(new Event('cv:open-auth')); return null; }
  const current = seasonPlayCount(id, season);
  if (current <= 1) return current;
  const next = current - 1;
  apply(id, meta, entry => {
    const plays = { ...(entry.seasonPlays || {}) };
    if (next > 1) plays[String(+season)] = next; else delete plays[String(+season)];
    entry.seasonPlays = plays;
  });
  return next;
}

/** Repeat viewings of finished seasons across every tracked show. */
export function seasonRewatchTotals() {
  let extraSeasons = 0, seasonsRewatched = 0, extraMinutes = 0;
  const rows = [];
  for (const entry of Object.values(state.episodeProgress || {})) {
    const id = entry.tmdbId;
    if (!id) continue;
    for (const [season, count] of Object.entries(entry.seasonPlays || {})) {
      const plays = seasonPlayCount(id, season);
      if (plays < 2) continue;               // dropped out of completion since
      const extra = plays - 1;
      seasonsRewatched++; extraSeasons += extra;
      const episodes = seasonAiredCount(id, season);
      if (entry.episodeRuntime > 0) extraMinutes += episodes * entry.episodeRuntime * extra;
      rows.push({
        id, season: +season, plays, extra, episodes,
        title: entry.title || 'TV show', poster: entry.poster || '',
      });
    }
  }
  rows.sort((a, b) => b.plays - a.plays || a.title.localeCompare(b.title) || a.season - b.season);
  return { extraSeasons, seasonsRewatched, extraMinutes, rows };
}

// How many episodes of this show have actually aired. Seasons before the current
// one are counted in full; the airing season only up to the last aired episode.
function airedTotal(entry) {
  const structure = entry?.structure || {};
  const seasons = Object.keys(structure).map(Number).sort((a, b) => a - b);
  if (!seasons.length) return 0;
  return seasons.reduce((total, season) => total + airedEpisodesFor(entry, season).length, 0);
}

export function showProgress(id) {
  const entry = showEntry(id);
  if (!entry) return { watched: 0, ticked: 0, total: 0, aired: 0, percent: 0, position: 0, started: false, caughtUp: false, seasonCompleted: false, completedSeasons: [], seriesCompleted: false, complete: false, lastWatched: null, numberingMode: 'season' };
  const structure = entry.structure || {};
  // Two counts, because they answer different questions. `ticked` is every box
  // the viewer has checked. `watched` is the subset that counts toward this
  // show's progress: inside a season the show still lists, and at or before the
  // last episode to have aired. A season the show dropped in a re-numbering must
  // not be able to satisfy "complete" on its own.
  const known = Object.keys(structure).length > 0;
  let ticked = 0, watched = 0;
  for (const [seasonKey, episodes] of Object.entries(entry.seasons || {})) {
    const valid = episodeNumbersFor(entry, +seasonKey);
    if (!valid.length) {
      // The show does not list this season. Either the structure has never been
      // synced — in which case the ticks are all we have and they count — or the
      // show dropped the season in a re-numbering, in which case counting them
      // would let a season that no longer exists complete the show on its own.
      ticked += episodes.length;
      if (!known) watched += episodes.length;
      continue;
    }
    const validSet = new Set(valid);
    const availableSet = new Set(airedEpisodesFor(entry, +seasonKey));
    ticked += episodes.filter(episode => validSet.has(episode)).length;
    // A deliberate single tick can be newer than TMDB's last_episode marker.
    // Keep that stronger user signal, matching the old behavior without relying
    // on local 1..count episode numbers.
    watched += episodes.filter(episode => validSet.has(episode) && (availableSet.has(episode) || !entry.aired || +seasonKey <= entry.aired.season)).length;
  }
  const total = Object.values(structure).reduce((sum, count) => sum + count, 0);
  // TMDB's `aired` marker lags real releases. Every bulk action caps at it, so a
  // tick beyond it can only have come from the viewer deliberately marking one
  // episode — the stronger signal. The denominator therefore never falls below
  // what they have marked; "11 of 10 aired" is a reporting bug, not a fact about
  // their viewing. Only ever raised, never invented: with no aired data at all
  // this stays 0 and nothing can read as complete.
  const airedBase = airedTotal(entry);
  const aired = airedBase > 0 ? Math.max(airedBase, watched) : 0;
  const caughtUp = aired > 0 && watched >= aired;
  const ended = ['ended', 'canceled', 'cancelled'].includes(String(entry.status || '').toLowerCase());
  const seriesCompleted = caughtUp && total > 0 && watched >= total && ended;
  const completedSeasons = Object.keys(structure).map(Number).filter(season => seasonState(id, season).completed);
  const seasonCompleted = completedSeasons.length > 0;
  let position = 0, foundGap = false;
  for (const season of orderedSeasons(structure)) {
    const done = new Set(entry.seasons?.[String(season)] || []);
    for (const episode of airedEpisodesFor(entry, season)) {
      if (!foundGap && done.has(episode)) position++;
      else foundGap = true;
    }
  }
  return {
    watched, ticked, total, aired,
    percent: aired ? Math.min(100, Math.round((watched / aired) * 100)) : 0,
    started: ticked > 0,
    caughtUp, seasonCompleted, completedSeasons, seriesCompleted,
    // Compatibility for older callers: "complete" now has one precise meaning.
    complete: seriesCompleted,
    lastWatched: entry.lastWatched,
    numberingMode: entry.numberingMode || 'season',
    position,
  };
}

// The first unwatched episode that has already aired, in season order.
export function nextUp(id) {
  const entry = showEntry(id);
  if (!entry) return null;
  const structure = entry.structure || {}, aired = entry.aired;
  for (const season of Object.keys(structure).map(Number).sort((a, b) => a - b)) {
    const done = new Set(entry.seasons?.[String(season)] || []);
    for (const episode of episodeNumbersFor(entry, season)) {
      if (done.has(episode)) continue;
      if (aired && (season > aired.season || (season === aired.season && episode > aired.episode))) return null;
      return { season, episode };
    }
  }
  return null;
}

// Shows with an available unwatched episode, most recently watched first.
export function resumeQueue(limit = 12) {
  return Object.entries(state.episodeProgress || {})
    .map(([key, entry]) => ({ key, entry, id: entry.tmdbId || +key.split('_')[1], progress: showProgress(entry.tmdbId || +key.split('_')[1]) }))
    .filter(row => row.progress.started && !row.progress.caughtUp && nextUp(row.id))
    .sort((a, b) => (b.entry.lastWatched?.at || 0) - (a.entry.lastWatched?.at || 0))
    .slice(0, limit)
    .map(row => ({ ...row, next: nextUp(row.id) }));
}

// ===== STATS =====
// Everything the Stats page needs, computed once. Runtime is only counted where
// the show actually reported one, and how much of the total that covers is
// reported alongside — an hours figure with unknown coverage is a guess.
export function episodeStats({ months = 12 } = {}) {
  const shows = [];
  let episodes = 0, minutes = 0, runtimeKnown = 0, completed = 0, caughtUp = 0, seasonsCompleted = 0, inProgress = 0;
  const perDay = new Map(), perMonth = new Map(), soloPerDay = new Map();

  for (const entry of Object.values(state.episodeProgress || {})) {
    const id = entry.tmdbId;
    if (!id) continue;
    const progress = showProgress(id);
    if (!progress.started) continue;
    episodes += progress.watched;
    if (entry.episodeRuntime > 0) { minutes += progress.watched * entry.episodeRuntime; runtimeKnown += progress.watched; }
    if (progress.seriesCompleted) completed++;
    if (progress.caughtUp) caughtUp++; else inProgress++;
    seasonsCompleted += progress.completedSeasons.length;
    shows.push({
      id, title: entry.title || 'TV show', poster: entry.poster || '',
      watched: progress.watched, aired: progress.aired, percent: progress.percent,
      complete: progress.seriesCompleted, caughtUp: progress.caughtUp, seasonCompleted: progress.seasonCompleted, lastAt: entry.lastWatched?.at || 0,
      completedAt: entry.completedAt || 0, runtime: entry.episodeRuntime || 0,
      next: progress.caughtUp ? null : nextUp(id),
    });
    for (const [, , at, bulk] of entry.log || []) {
      const date = new Date(at);
      if (Number.isNaN(date.getTime())) continue;
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const month = day.slice(0, 7);
      perDay.set(day, (perDay.get(day) || 0) + 1);
      perMonth.set(month, (perMonth.get(month) || 0) + 1);
      if (!bulk) soloPerDay.set(day, (soloPerDay.get(day) || 0) + 1);
    }
  }

  // A dense run of months so the chart has no gaps where nothing was watched.
  const now = new Date();
  const series = [];
  for (let back = months - 1; back >= 0; back--) {
    const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    series.push({ key, label: date.toLocaleDateString(undefined, { month: 'short' }), year: date.getFullYear(), count: perMonth.get(key) || 0 });
  }

  const bingeEntry = [...soloPerDay.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  // Today's own count, in the same units as the record: episodes ticked ONE AT A
  // TIME. A bulk mark is bookkeeping, and a record you set by pressing "mark
  // season watched" would not be worth chasing.
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todaySolo = soloPerDay.get(todayKey) || 0;
  const busiestEntry = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  const logged = [...perDay.values()].reduce((sum, count) => sum + count, 0);

  const seasonRewatches = seasonRewatchTotals();

  return {
    episodes, minutes, runtimeKnown,
    seasonRewatches,
    runtimeCoverage: episodes ? Math.round(runtimeKnown / episodes * 100) : 0,
    shows: shows.length, completed, caughtUp, seasonsCompleted, inProgress,
    completionRate: shows.length ? Math.round(completed / shows.length * 100) : 0,
    caughtUpRate: shows.length ? Math.round(caughtUp / shows.length * 100) : 0,
    series,
    logged,
    // The per-episode log is capped at LOG_CAP rows per show, so a long-running
    // series eventually loses its oldest entries. Every total above still counts
    // the episode; only its PLACE ON THE TIMELINE is gone. Reporting the gap is
    // the difference between a chart that is incomplete and one that is wrong.
    logCoverage: episodes ? Math.min(100, Math.round(logged / episodes * 100)) : 100,
    undated: Math.max(0, episodes - logged),
    binge: bingeEntry ? { day: bingeEntry[0], count: bingeEntry[1] } : null,
    todaySolo,
    // "One more and today is your best day." Deliberately narrow: it needs a
    // record that today does not already hold, at least one episode watched
    // today, and a gap of one or two. Anything looser would be nagging.
    recordChase: (() => {
      if (!bingeEntry || !todaySolo) return null;
      const [recordDay, record] = bingeEntry;
      if (recordDay === todayKey) return null;          // today already holds it
      const needed = record + 1 - todaySolo;
      return needed >= 1 && needed <= 2 ? { record, todaySolo, needed } : null;
    })(),
    busiest: busiestEntry ? { day: busiestEntry[0], count: busiestEntry[1] } : null,
    activeDays: perDay.size,
    byShow: shows.sort((a, b) => b.percent - a.percent || b.watched - a.watched),
    recent: [...shows].sort((a, b) => b.lastAt - a.lastAt).slice(0, 6),
  };
}

export function episodeTotals() {
  let episodes = 0, minutes = 0, shows = 0, completed = 0, caughtUp = 0;
  for (const entry of Object.values(state.episodeProgress || {})) {
    const id = entry.tmdbId;
    if (!id) continue;                       // same guard episodeStats already had
    const progress = showProgress(id);
    if (!progress.started) continue;
    shows++;
    episodes += progress.watched;
    minutes += progress.watched * (entry.episodeRuntime || 0);
    if (progress.seriesCompleted) completed++;
    if (progress.caughtUp) caughtUp++;
  }
  return { episodes, minutes, shows, completed, caughtUp };
}

// ---------- writes ----------
function ensure(id, meta = {}) {
  const key = KEY(id);
  const existing = state.episodeProgress[key];
  let entry = existing || sanitizeEntry({ tmdbId: id, seasons: {}, structure: {} });
  // Metadata always refreshes: a show that gained a season must not keep serving
  // a stale structure that hides the new episodes from "next up".
  if (meta.title) entry.title = meta.title;
  if (meta.poster) entry.poster = meta.poster;
  if (meta.backdrop) entry.backdrop = meta.backdrop;
  if (meta.episodeRuntime) entry.episodeRuntime = meta.episodeRuntime;
  if (meta.status) entry.status = meta.status;
  if (meta.structure && Object.keys(meta.structure).length) entry.structure = meta.structure;
  if (meta.aired !== undefined) entry.aired = meta.aired;
  if (meta.numberingMode) entry.numberingMode = meta.numberingMode;
  // Re-sanitize after metadata changes. This is where an old One Piece document
  // learns that its arc seasons use absolute numbering and repairs itself from
  // the saved lastWatched anchor.
  entry = sanitizeEntry(entry);
  entry.tmdbId = id;
  state.episodeProgress[key] = entry;
  return { key, entry };
}

// Called by the detail page on every show load, so structure/aired stay current
// even for a show the user has not started. Writes only when something changed.
export function syncShowStructure(id, meta) {
  const key = KEY(id);
  const before = state.episodeProgress[key];
  if (!before) return;
  const structureChanged = JSON.stringify(before.structure || {}) !== JSON.stringify(meta.structure || {});
  const airedChanged = JSON.stringify(before.aired || null) !== JSON.stringify(meta.aired || null);
  const statusChanged = !!meta.status && before.status !== meta.status;
  const numberingChanged = !!meta.numberingMode && before.numberingMode !== meta.numberingMode;
  const stale = Date.now() - (+before.metaCheckedAt || 0) >= DAY;
  if (!structureChanged && !airedChanged && !statusChanged && !numberingChanged && !stale) return false;
  if (!structureChanged && !airedChanged && !statusChanged && !numberingChanged) {
    // "Checked" is device cache data, not collection history. Mirroring it
    // locally avoids one Firestore write per tracked show every day while still
    // making each device perform its own daily freshness check.
    before.metaCheckedAt = Date.now();
    mirror();
    return false;
  }
  ensure(id, meta);
  const entry = state.episodeProgress[key];
  const now = Date.now();
  entry.metaCheckedAt = now;
  const progress = showProgress(id);
  if (!progress.caughtUp) { entry.caughtUpAt = 0; entry.completedAt = 0; }
  else {
    if (!entry.caughtUpAt) entry.caughtUpAt = entry.lastWatched?.at || now;
    entry.completedAt = progress.seriesCompleted ? (entry.completedAt || entry.caughtUpAt) : 0;
  }
  entry.updatedAt = now;
  if (numberingChanged) {
    // The numbering migration changes watched episode ids as well as metadata;
    // a metadata-only merge would leave Firestore holding the broken local ids.
    persist(key);
    return true;
  }
  persistMeta(key, {
    title: entry.title, poster: entry.poster, backdrop: entry.backdrop,
    episodeRuntime: entry.episodeRuntime, status: entry.status,
    structure: entry.structure, aired: entry.aired, metaCheckedAt: entry.metaCheckedAt,
    caughtUpAt: entry.caughtUpAt, completedAt: entry.completedAt,
    numberingMode: entry.numberingMode, episodeModelV: EPISODE_MODEL_V,
  });
  return true;
}

let trackerRefresh = null;

/** Refresh stale tracked-show structure with a small, free-tier-friendly pool. */
export async function refreshTrackedShows({ force = false, maxAge = DAY, concurrency = 3, onProgress } = {}) {
  if (!state.user) return { total: 0, refreshed: 0, changed: 0, failed: 0 };
  if (trackerRefresh && !force) return trackerRefresh;
  const owner = state.user.uid;
  const rows = Object.values(state.episodeProgress || {})
    .filter(entry => entry.tmdbId && (force || Date.now() - (+entry.metaCheckedAt || 0) >= maxAge));
  const run = (async () => {
    let refreshed = 0, changed = 0, failed = 0;
    const queue = [...rows];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (;;) {
        const entry = queue.shift();
        if (!entry || state.user?.uid !== owner) return;
        try {
          const meta = await fetchShowMeta(entry.tmdbId, { force: true });
          if (state.user?.uid !== owner) return;
          if (!meta || !Object.keys(meta.structure || {}).length) throw new Error('Missing show structure');
          if (syncShowStructure(entry.tmdbId, meta)) changed++;
          refreshed++;
        } catch (error) { failed++; console.warn('episode tracker refresh', entry.tmdbId, error); }
        onProgress?.({ total: rows.length, completed: refreshed + failed, refreshed, changed, failed });
      }
    });
    await Promise.all(workers);
    return { total: rows.length, refreshed, changed, failed };
  })();
  trackerRefresh = run;
  try { return await run; }
  finally { if (trackerRefresh === run) trackerRefresh = null; }
}

/** Daily on sign-in, plus immediately whenever a backgrounded app returns. */
export function initEpisodeRefresh() {
  const refresh = () => {
    if (!state.user || document.visibilityState === 'hidden') return;
    refreshTrackedShows().catch(error => console.warn('episode tracker daily refresh', error));
  };
  document.addEventListener('cv:auth', () => {
    startEpisodeProgressRealtime(state.user?.uid || '');
    refresh();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
}

function apply(id, meta, mutate) {
  if (!state.user) { document.dispatchEvent(new Event('cv:open-auth')); return null; }
  const { key, entry } = ensure(id, meta);
  mutate(entry);
  for (const [season, episodes] of Object.entries(entry.seasons)) if (!episodes.length) delete entry.seasons[season];
  entry.log = cleanLog(entry.log);
  entry.updatedAt = Date.now();
  // A document with nothing watched but tombstones still has something to say —
  // deleting it would let another device's stale copy re-add every episode on the
  // next merge. Only a genuinely empty document is dropped.
  const hasTombstones = Object.keys(entry.removed || {}).length > 0;
  if (!Object.keys(entry.seasons).length && !hasTombstones) { delete state.episodeProgress[key]; persist(key); return { key, entry: null }; }
  // `legacy` means "completed before per-episode tracking existed". The moment
  // real episode data is written the flag stops being true of the document.
  if (entry.legacy && entry.log.length) entry.legacy = false;
  // Un-ticking has to be able to undo a completion. Without this a show stayed
  // stamped as finished after its last episode was un-marked, and every surface
  // reading `completedAt` kept reporting a finish date for a show in progress.
  const after = showProgress(id);
  if (!after.caughtUp) {
    entry.caughtUpAt = 0;
    entry.completedAt = 0;
    // A rewatch count only means anything while the season is still complete.
    for (const season of Object.keys(entry.seasonPlays || {})) {
      if (!isSeasonComplete(id, season)) delete entry.seasonPlays[season];
    }
  }
  persist(key);
  return { key, entry };
}

const markLast = (entry, season, episode) => { entry.lastWatched = { season: +season, episode: +episode, at: Date.now() }; };

// Watched and removed are kept strictly disjoint by these two, which are the ONLY
// places either set is edited. An episode moving between them is what lets two
// devices merge without resurrecting an un-tick — see mergeEntries.
function setWatched(entry, season, episodes) {
  const key = String(+season);
  const list = new Set(entry.seasons[key] || []);
  const gone = new Set(entry.removed?.[key] || []);
  for (const episode of episodes) { list.add(+episode); gone.delete(+episode); }
  entry.seasons[key] = [...list].sort((a, b) => a - b);
  entry.removed = entry.removed || {};
  if (gone.size) entry.removed[key] = [...gone].sort((a, b) => a - b); else delete entry.removed[key];
}

function setUnwatched(entry, season, episodes) {
  const key = String(+season);
  const list = new Set(entry.seasons[key] || []);
  const gone = new Set(entry.removed?.[key] || []);
  for (const episode of episodes) { list.delete(+episode); gone.add(+episode); }
  entry.seasons[key] = [...list].sort((a, b) => a - b);
  entry.removed = entry.removed || {};
  if (gone.size) entry.removed[key] = [...gone].sort((a, b) => a - b); else delete entry.removed[key];
}

// One log row per newly-watched episode. Un-ticking removes its row so the
// episodes-over-time chart always matches what is actually marked.
function logEpisode(entry, season, episode, at = Date.now(), bulk = 0) {
  entry.log = [...(entry.log || []).filter(row => !(row[0] === +season && row[1] === +episode)), [+season, +episode, at, bulk ? 1 : 0]].slice(-LOG_CAP);
}
function unlogEpisode(entry, season, episode) {
  entry.log = (entry.log || []).filter(row => !(row[0] === +season && row[1] === +episode));
}

function availabilityMeta(meta, season, episode) {
  const direct = meta?.episode;
  if (+direct?.season_number === +season && +direct?.episode_number === +episode) return direct;
  const next = meta?.nextEpisode;
  if (+next?.season_number === +season && +next?.episode_number === +episode) return next;
  return null;
}

/**
 * Returns the episode's new watched state, or `null` when the write was refused
 * because nobody is signed in. Callers must treat null as "nothing happened" —
 * returning `true` there painted a tick for an episode that was never saved.
 */
export function toggleEpisode(id, season, episode, meta = {}) {
  if (!state.user) { document.dispatchEvent(new Event('cv:open-auth')); return null; }
  const wasWatched = isEpisodeWatched(id, season, episode);
  const episodeMeta = availabilityMeta(meta, season, episode);
  if (!wasWatched && episodeMeta && !isEpisodeAvailable(episodeMeta, { showId: id })) return 'unavailable';
  apply(id, meta, entry => {
    if (wasWatched) { setUnwatched(entry, season, [episode]); unlogEpisode(entry, season, episode); }
    else { setWatched(entry, season, [episode]); markLast(entry, season, episode); logEpisode(entry, season, episode); }
  });
  if (!wasWatched) maybeCompleteShow(id, meta);
  return !wasWatched;
}

// "I've seen everything up to here" — the single most useful bulk action when
// you start tracking a show you are already partway through.
export function markUpTo(id, season, episode, meta = {}) {
  if (!state.user) { document.dispatchEvent(new Event('cv:open-auth')); return null; }
  let added = 0;
  apply(id, meta, entry => {
    const structure = entry.structure || {};
    // Every episode carries the moment it was actually marked — no fabricated
    // spacing — and the bulk flag so the binge record can ignore them.
    const stamp = Date.now();
    for (const current of Object.keys(structure).map(Number).sort((a, b) => a - b)) {
      if (current > +season) break;
      // Capped at what has aired, exactly like "mark season watched" and "seen it
      // all". Without this, "up to here" was the one bulk action that could mark
      // episodes nobody could have watched yet.
      const available = airedEpisodesFor(entry, current)
        .filter(candidate => current < +season || candidate <= +episode);
      if (!available.length) continue;
      const list = new Set(entry.seasons[String(current)] || []);
      const fresh = [];
      for (const candidate of available) {
        if (list.has(candidate)) continue;
        fresh.push(candidate);
        logEpisode(entry, current, candidate, stamp, 1);
        added++;
      }
      if (fresh.length) setWatched(entry, current, fresh);
    }
    markLast(entry, season, episode);
  });
  maybeCompleteShow(id, meta);
  return added;
}

export function setSeasonWatched(id, season, on, meta = {}) {
  if (!state.user) { document.dispatchEvent(new Event('cv:open-auth')); return null; }
  apply(id, meta, entry => {
    if (!on) {
      // Every episode that WAS ticked becomes a tombstone, so another device
      // merging this document learns the season was deliberately cleared rather
      // than assuming this copy is simply behind.
      setUnwatched(entry, season, entry.seasons[String(season)] || []);
      delete entry.seasons[String(season)];
      entry.log = (entry.log || []).filter(row => row[0] !== +season);
      return;
    }
    // Never mark episodes that have not aired: the progress bar would claim a
    // completion the user cannot have. Shared with every other bulk action.
    const available = airedEpisodesFor(entry, season);
    const list = new Set(entry.seasons[String(season)] || []);
    const stamp = Date.now();
    const fresh = [];
    for (const episode of available) {
      if (list.has(episode)) continue;
      fresh.push(episode);
      logEpisode(entry, season, episode, stamp, 1);
    }
    // Re-ticking clears the tombstones the previous un-mark left behind.
    setWatched(entry, season, [...list, ...fresh]);
    if (available.length) markLast(entry, season, available.at(-1));
  });
  if (on) maybeCompleteShow(id, meta);
  return true;
}

// Mark every AIRED episode of every season. `meta.structure` is optional: when a
// card triggers this we have no show payload, so the structure is fetched first.
export async function markShowWatched(id, meta = {}, { fetchStructure = fetchShowMeta, stampFrom = 0 } = {}) {
  if (!state.user) { document.dispatchEvent(new Event('cv:open-auth')); return null; }
  let resolved = meta;
  const known = showEntry(id);
  if (!resolved.structure || !Object.keys(resolved.structure).length) {
    if (known?.structure && Object.keys(known.structure).length) resolved = { ...known, ...resolved, structure: known.structure, aired: known.aired };
    else if (fetchStructure) {
      const fetched = await fetchStructure(id).catch(() => null);
      if (!fetched) return 0;
      resolved = { ...resolved, ...fetched };
    } else return 0;
  }
  let added = 0;
  // A back-fill uses the date the show was ORIGINALLY marked watched, so a show
  // finished three years ago does not land in this month's activity chart.
  const stamp = stampFrom > 0 ? stampFrom : Date.now();
  apply(id, resolved, entry => {
    const structure = entry.structure || {};
    for (const season of Object.keys(structure).map(Number).sort((a, b) => a - b)) {
      const available = airedEpisodesFor(entry, season);
      if (!available.length) continue;
      const list = new Set(entry.seasons[String(season)] || []);
      const fresh = [];
      for (const episode of available) {
        if (list.has(episode)) continue;
        fresh.push(episode);
        logEpisode(entry, season, episode, stamp, 1);
        added++;
      }
      if (fresh.length) setWatched(entry, season, fresh);
      markLast(entry, season, available.at(-1));
    }
    if (stampFrom > 0) entry.lastWatched = { season: entry.lastWatched?.season || 1, episode: entry.lastWatched?.episode || 1, at: stampFrom };
  });
  maybeCompleteShow(id, resolved);
  return added;
}

/**
 * Set a whole-series position in one atomic local mutation. This is the safest
 * repair and onboarding action for long anime: entering 1107 marks exactly the
 * first 1107 aired episodes, removes accidental later ticks, and produces one
 * debounced Firestore transaction rather than 1,107 writes.
 */
export function setEpisodePosition(id, requested, meta = {}) {
  if (!state.user) { document.dispatchEvent(new Event('cv:open-auth')); return null; }
  const raw = Math.floor(+requested);
  if (!Number.isFinite(raw) || raw < 0) return { error: 'invalid', requested };
  let result = null;
  apply(id, meta, entry => {
    const aired = [];
    for (const season of orderedSeasons(entry.structure)) {
      for (const episode of airedEpisodesFor(entry, season)) aired.push({ season, episode });
    }
    const target = Math.min(raw, aired.length);
    const desired = new Set(aired.slice(0, target).map(point => `${point.season}_${point.episode}`));
    let added = 0, removedCount = 0;
    const stamp = Date.now();
    for (const season of orderedSeasons(entry.structure)) {
      const valid = episodeNumbersFor(entry, season);
      const watched = new Set(entry.seasons[String(season)] || []);
      const add = [], remove = [];
      for (const episode of valid) {
        const shouldWatch = desired.has(`${season}_${episode}`);
        if (shouldWatch && !watched.has(episode)) { add.push(episode); logEpisode(entry, season, episode, stamp, 1); added++; }
        else if (!shouldWatch && watched.has(episode)) { remove.push(episode); unlogEpisode(entry, season, episode); removedCount++; }
      }
      if (add.length) setWatched(entry, season, add);
      if (remove.length) setUnwatched(entry, season, remove);
    }
    const location = target ? aired[target - 1] : null;
    entry.lastWatched = location ? { ...location, at: stamp } : null;
    result = { requested: raw, position: target, capped: raw > aired.length, aired: aired.length, added, removed: removedCount, location };
  });
  if (result?.position) maybeCompleteShow(id, meta);
  return result;
}

export function clearShowProgress(id) {
  const key = KEY(id);
  const entry = state.episodeProgress[key];
  if (!entry) return;
  // Reset is an intent, not an absence. Deleting the document would let another
  // device's copy re-create every episode on its next merge, so the reset is
  // recorded as tombstones instead — the same mechanism a single un-tick uses.
  for (const [season, episodes] of Object.entries(entry.seasons || {})) setUnwatched(entry, season, episodes);
  entry.seasons = {};
  entry.log = [];
  entry.seasonPlays = {};
  entry.caughtUpAt = 0;
  entry.completedAt = 0;
  entry.lastWatched = null;
  entry.updatedAt = Date.now();
  persist(key);
}

// When every aired episode is ticked, the show itself is watched. Marking it here
// keeps stats, badges, and recommendations consistent with what the user just did.
let completeHook = null;
export function onShowComplete(fn) { completeHook = fn; }

function maybeCompleteShow(id, meta) {
  const progress = showProgress(id);
  if (!progress.caughtUp || !progress.aired) return;
  const entry = showEntry(id);
  // Persist explicitly rather than relying on the caller's pending debounce
  // still being open — the stamp is what every "finished on" figure reads.
  if (entry) {
    let changed = false;
    if (!entry.caughtUpAt) { entry.caughtUpAt = entry.lastWatched?.at || Date.now(); changed = true; }
    if (progress.seriesCompleted && !entry.completedAt) { entry.completedAt = entry.caughtUpAt; changed = true; }
    if (!progress.seriesCompleted && entry.completedAt) { entry.completedAt = 0; changed = true; }
    if (changed) persist(KEY(id));
  }
  if (state.watched[`tv_${id}`]) return;
  completeHook?.(id, meta, progress);
}

// ===== LEGACY BACK-FILL =====
// Shows marked watched before per-episode tracking existed have a `watched`
// document and no progress document, so they would read as 0% forever. This
// fills them in once, using the date they were originally marked.
//
// `fetchShow(id)` must resolve to { structure, aired, ... }; the caller supplies
// it so this module never imports the API layer. Ids are remembered on the
// device, so a show the user later un-ticks is not silently re-filled.
const backfillKey = () => `cv_episode_backfilled_${state.user?.uid || 'guest'}`;

function backfilledIds() {
  try { const value = JSON.parse(localStorage.getItem(backfillKey()) || '[]'); return new Set(Array.isArray(value) ? value.map(Number) : []); }
  catch (_) { return new Set(); }
}
function rememberBackfilled(ids) {
  try { localStorage.setItem(backfillKey(), JSON.stringify([...ids].slice(-600))); } catch (_) {}
}

export function pendingLegacyShows() {
  if (!state.user) return [];
  const done = backfilledIds();
  return Object.entries(state.watched)
    .filter(([key, doc]) => (doc.type || key.split('_')[0]) === 'tv')
    .map(([key, doc]) => ({ id: +(doc.tmdbId || key.split('_').at(-1) || 0), doc }))
    .filter(row => row.id && !done.has(row.id) && !showEntry(row.id));
}

export async function backfillLegacyShows(fetchShow, { limit = 40, concurrency = 3 } = {}) {
  const pending = pendingLegacyShows().slice(0, limit);
  if (!pending.length) return { filled: 0, episodes: 0 };
  const done = backfilledIds();
  let filled = 0, episodes = 0;
  const owner = state.user?.uid;
  const queue = [...pending];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      const row = queue.shift();
      if (!row) return;
      if (state.user?.uid !== owner) return;
      const stamp = +(row.doc.watchedAt?.seconds || 0) * 1000 || +row.doc.watchedAt || Date.now();
      const meta = await fetchShow(row.id, { cutoff: stamp }).catch(() => null);
      if (!meta || !Object.keys(meta.structure || {}).length) continue;
      const added = await markShowWatched(row.id, meta, { stampFrom: stamp });
      const entry = showEntry(row.id);
      if (entry) {
        entry.legacy = true;
        entry.legacyBackfillAt = Date.now();
        persist(KEY(row.id));
      }
      // Only successful reconstructions are remembered. A temporary TMDB or
      // offline failure must remain retryable on the next foreground refresh.
      done.add(row.id);
      filled++; episodes += added;
    }
  });
  await Promise.all(workers);
  rememberBackfilled(done);
  if (filled) document.dispatchEvent(new CustomEvent('cv:episode-progress', { detail: { backfill: filled } }));
  return { filled, episodes };
}

const watchedStamp = doc => +(doc?.watchedAt?.seconds || 0) * 1000 || +doc?.watchedAt || 0;

/**
 * Rebuild legacy history at its real historical cutoff, then refresh every
 * tracked show's current structure. Safe to run repeatedly: watched sets are
 * idempotent and explicit tombstones prevent a bad server copy resurfacing.
 */
export async function repairEpisodeProgress({ concurrency = 2, onProgress, fetchHistorical = fetchHistoricalShowMeta, refresh = refreshTrackedShows } = {}) {
  if (!state.user) return { total: 0, repaired: 0, refreshed: 0, failed: 0, removedFuture: 0 };
  const owner = state.user.uid;
  const watchedShows = Object.entries(state.watched || {})
    .filter(([key, doc]) => (doc.type || key.split('_')[0]) === 'tv')
    .map(([key, doc]) => ({ id: +(doc.tmdbId || key.split('_').at(-1) || 0), doc }))
    .filter(row => row.id);
  const queue = [...watchedShows];
  let repaired = 0, failed = 0, removedFuture = 0, completed = 0;
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      const row = queue.shift();
      if (!row || state.user?.uid !== owner) return;
      try {
        const cutoff = watchedStamp(row.doc) || Date.now();
        const historical = await fetchHistorical(row.id, { cutoff });
        if (!Object.keys(historical.structure || {}).length) throw new Error('No historical episodes found');
        const entry = showEntry(row.id);
        // Only unwind rows that carry the signature of the broken legacy pass:
        // bulk timestamps at the title's original watched time. Ordinary manual
        // episode ticks and later season marks are never touched.
        if (entry) {
          const legacyRows = new Set((entry.log || [])
            .filter(([, , at, bulk]) => bulk && Math.abs(at - cutoff) < 60000)
            .map(([season, episode]) => `${season}_${episode}`));
          for (const [season, episodes] of Object.entries(entry.seasons || {})) {
            const allowed = new Set(episodeNumbersFor(historical, +season));
            const bad = episodes.filter(episode => !allowed.has(episode) && legacyRows.has(`${season}_${episode}`));
            if (bad.length) {
              setUnwatched(entry, +season, bad);
              bad.forEach(episode => unlogEpisode(entry, +season, episode));
              removedFuture += bad.length;
            }
          }
        }
        await markShowWatched(row.id, historical, { stampFrom: cutoff });
        const repairedEntry = showEntry(row.id);
        if (repairedEntry) {
          repairedEntry.legacy = true;
          repairedEntry.legacyBackfillAt = Date.now();
          repairedEntry.updatedAt = Date.now();
          persist(KEY(row.id));
        }
        repaired++;
      } catch (error) { failed++; console.warn('episode progress repair', row.id, error); }
      completed++;
      onProgress?.({ total: watchedShows.length, completed, repaired, failed, removedFuture });
    }
  });
  await Promise.all(workers);
  if (state.user?.uid !== owner) return { total: watchedShows.length, repaired, refreshed: 0, failed, removedFuture };
  const current = await refresh({ force: true, onProgress: progress => onProgress?.({ ...progress, phase: 'refresh' }) });
  return { total: watchedShows.length, repaired, refreshed: current.refreshed, failed: failed + current.failed, removedFuture };
}
