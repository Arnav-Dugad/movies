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

const KEY = id => `tv_${id}`;
const cacheKey = () => `cv_episode_progress_${state.user?.uid || 'guest'}`;
const col = () => db.collection('users').doc(state.user.uid).collection('progress');
const writeTimers = new Map();

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
  const seasons = {}, structure = {}, removed = {};
  for (const [season, list] of Object.entries(value.seasons || {})) {
    const episodes = numbers(list);
    if (episodes.length) seasons[String(+season)] = episodes;
  }
  // Episodes explicitly UN-ticked. Without these, merging two devices could only
  // union their watched sets, which resurrects every deliberate un-tick — see
  // mergeEntries.
  for (const [season, list] of Object.entries(value.removed || {})) {
    const key = String(+season);
    const watched = new Set(seasons[key] || []);
    const gone = numbers(list).filter(episode => !watched.has(episode));
    if (gone.length) removed[key] = gone;
  }
  for (const [season, count] of Object.entries(value.structure || {})) {
    if (+count > 0) structure[String(+season)] = +count;
  }
  const aired = value.aired && +value.aired.season > 0 && +value.aired.episode > 0
    ? { season: +value.aired.season, episode: +value.aired.episode } : null;
  return {
    tmdbId: +value.tmdbId || 0, title: String(value.title || ''), poster: String(value.poster || ''),
    backdrop: String(value.backdrop || ''), episodeRuntime: +value.episodeRuntime || 0,
    status: String(value.status || ''), seasons, structure, aired,
    lastWatched: value.lastWatched && +value.lastWatched.at ? { season: +value.lastWatched.season, episode: +value.lastWatched.episode, at: +value.lastWatched.at } : null,
    removed,
    log: cleanLog(value.log),
    seasonPlays: cleanSeasonPlays(value.seasonPlays),
    completedAt: +value.completedAt || 0,
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

export async function loadEpisodeProgress() {
  if (!state.user) { state.episodeProgress = {}; return; }
  hydrateEpisodeProgressFromCache();
  try {
    const snap = await col().get();
    const out = {};
    snap.docs.forEach(doc => { const entry = sanitizeEntry(doc.data()); if (entry) out[doc.id] = entry; });
    state.episodeProgress = out;
    mirror();
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
const earliest = (...values) => {
  const real = values.map(Number).filter(value => value > 0);
  return real.length ? Math.min(...real) : 0;
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
    // Structure and the aired marker come from whichever document has more of
    // them: a device that has opened the show recently knows more than one that
    // has not, regardless of which wrote last.
    structure: Object.keys(newer.structure || {}).length >= Object.keys(older.structure || {}).length ? newer.structure : older.structure,
    aired: newer.aired || older.aired || null,
    seasons, removed, seasonPlays,
    log: cleanLog([...(server.log || []), ...(local.log || [])]),
    // Earliest genuine finish, so a merge cannot postpone a completion date.
    // Guarded because Math.min() with nothing to compare returns Infinity.
    completedAt: earliest(server.completedAt, local.completedAt),
    lastWatched: (+newer.lastWatched?.at || 0) >= (+older.lastWatched?.at || 0) ? newer.lastWatched : older.lastWatched,
    legacy: !!(server.legacy && local.legacy),
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
  col().doc(key).set({ ...fields, updatedAt: Date.now(), serverUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true })
    .catch(error => { if (state.user?.uid === uid) console.warn('episode structure sync', error); });
}

// A transaction rather than a plain write: it reads what is actually on the
// server and merges this device's edit into it, so a tick made on a phone thirty
// seconds ago survives a tick made on a laptop now. One extra document read per
// debounced batch — a rounding error next to the reads the library cache saves.
async function writeMerged(key, entry, uid) {
  const ref = col().doc(key);
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
  writeTimers.forEach(clearTimeout); writeTimers.clear();
  state.episodeProgress = {};
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
  return {
    title: det?.name || '', poster: det?.poster_path || '', backdrop: det?.backdrop_path || '',
    episodeRuntime: (det?.episode_run_time || [])[0] || 0, status: det?.status || '',
    structure,
    aired: last?.season_number ? { season: last.season_number, episode: last.episode_number } : null,
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

export async function fetchShowMeta(id) {
  const key = String(+id || 0);
  const cached = metaStore()[key];
  if (cached && Date.now() - (cached.at || 0) < META_TTL && Object.keys(cached.meta?.structure || {}).length) {
    return cached.meta;
  }
  const meta = tvShowMeta(await tmdb(`/tv/${id}`));
  try {
    metaMemo[key] = { at: Date.now(), meta };
    const rows = Object.entries(metaMemo).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 200);
    localStorage.setItem(META_CACHE_KEY, JSON.stringify(Object.fromEntries(rows)));
  } catch (_) {}
  return meta;
}

// ---------- reads ----------
export const showEntry = id => state.episodeProgress?.[KEY(id)] || null;

export function isEpisodeWatched(id, season, episode) {
  return !!showEntry(id)?.seasons?.[String(season)]?.includes(+episode);
}

export function seasonWatchedCount(id, season) {
  return showEntry(id)?.seasons?.[String(season)]?.length || 0;
}

// How many episodes of one season have aired. Every bulk action caps at this, so
// progress can never claim a completion the viewer could not have reached.
// Previously computed inline in three places, which is three chances to disagree.
export function seasonAiredCount(id, season) {
  return airedCapFor(showEntry(id), season);
}

function airedCapFor(entry, season) {
  const cap = +(entry?.structure || {})[String(+season)] || 0;
  if (cap <= 0) return 0;
  const aired = entry.aired;
  if (!aired) return cap;
  if (+season < aired.season) return cap;
  if (+season === aired.season) return Math.max(0, Math.min(cap, aired.episode));
  return 0;                                   // the season has not started airing
}

/** Every aired episode of this season ticked. */
export function isSeasonComplete(id, season) {
  const need = seasonAiredCount(id, season);
  if (!need) return false;
  const done = new Set(showEntry(id)?.seasons?.[String(+season)] || []);
  for (let episode = 1; episode <= need; episode++) if (!done.has(episode)) return false;
  return true;
}

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
  const aired = entry.aired;
  if (!aired) return seasons.reduce((sum, season) => sum + structure[season], 0);
  let total = 0;
  for (const season of seasons) {
    if (season < aired.season) total += structure[season];
    else if (season === aired.season) total += Math.min(aired.episode, structure[season]);
  }
  return total;
}

export function showProgress(id) {
  const entry = showEntry(id);
  if (!entry) return { watched: 0, ticked: 0, total: 0, aired: 0, percent: 0, started: false, complete: false, lastWatched: null };
  const structure = entry.structure || {};
  // Two counts, because they answer different questions. `ticked` is every box
  // the viewer has checked. `watched` is the subset that counts toward this
  // show's progress: inside a season the show still lists, and at or before the
  // last episode to have aired. A season the show dropped in a re-numbering must
  // not be able to satisfy "complete" on its own.
  const known = Object.keys(structure).length > 0;
  let ticked = 0, watched = 0;
  for (const [seasonKey, episodes] of Object.entries(entry.seasons || {})) {
    const cap = +structure[seasonKey] || 0;
    if (!cap) {
      // The show does not list this season. Either the structure has never been
      // synced — in which case the ticks are all we have and they count — or the
      // show dropped the season in a re-numbering, in which case counting them
      // would let a season that no longer exists complete the show on its own.
      ticked += episodes.length;
      if (!known) watched += episodes.length;
      continue;
    }
    ticked += episodes.filter(episode => episode <= cap).length;
    watched += episodes.filter(episode => episode <= cap).length;
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
  return {
    watched, ticked, total, aired,
    percent: aired ? Math.min(100, Math.round((watched / aired) * 100)) : 0,
    started: ticked > 0,
    complete: aired > 0 && watched >= aired,
    lastWatched: entry.lastWatched,
  };
}

// The first unwatched episode that has already aired, in season order.
export function nextUp(id) {
  const entry = showEntry(id);
  if (!entry) return null;
  const structure = entry.structure || {}, aired = entry.aired;
  for (const season of Object.keys(structure).map(Number).sort((a, b) => a - b)) {
    const done = new Set(entry.seasons?.[String(season)] || []);
    for (let episode = 1; episode <= structure[season]; episode++) {
      if (done.has(episode)) continue;
      if (aired && (season > aired.season || (season === aired.season && episode > aired.episode))) return null;
      return { season, episode };
    }
  }
  return null;
}

// Shows with progress but not finished, most recently watched first.
export function resumeQueue(limit = 12) {
  return Object.entries(state.episodeProgress || {})
    .map(([key, entry]) => ({ key, entry, id: entry.tmdbId || +key.split('_')[1], progress: showProgress(entry.tmdbId || +key.split('_')[1]) }))
    .filter(row => row.progress.started && !row.progress.complete && nextUp(row.id))
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
  let episodes = 0, minutes = 0, runtimeKnown = 0, completed = 0, inProgress = 0;
  const perDay = new Map(), perMonth = new Map(), soloPerDay = new Map();

  for (const entry of Object.values(state.episodeProgress || {})) {
    const id = entry.tmdbId;
    if (!id) continue;
    const progress = showProgress(id);
    if (!progress.started) continue;
    episodes += progress.watched;
    if (entry.episodeRuntime > 0) { minutes += progress.watched * entry.episodeRuntime; runtimeKnown += progress.watched; }
    if (progress.complete) completed++; else inProgress++;
    shows.push({
      id, title: entry.title || 'TV show', poster: entry.poster || '',
      watched: progress.watched, aired: progress.aired, percent: progress.percent,
      complete: progress.complete, lastAt: entry.lastWatched?.at || 0,
      completedAt: entry.completedAt || 0, runtime: entry.episodeRuntime || 0,
      next: progress.complete ? null : nextUp(id),
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
    shows: shows.length, completed, inProgress,
    completionRate: shows.length ? Math.round(completed / shows.length * 100) : 0,
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
  let episodes = 0, minutes = 0, shows = 0, completed = 0;
  for (const entry of Object.values(state.episodeProgress || {})) {
    const id = entry.tmdbId;
    if (!id) continue;                       // same guard episodeStats already had
    const progress = showProgress(id);
    if (!progress.started) continue;
    shows++;
    episodes += progress.watched;
    minutes += progress.watched * (entry.episodeRuntime || 0);
    if (progress.complete) completed++;
  }
  return { episodes, minutes, shows, completed };
}

// ---------- writes ----------
function ensure(id, meta = {}) {
  const key = KEY(id);
  const existing = state.episodeProgress[key];
  const entry = existing || sanitizeEntry({ tmdbId: id, seasons: {}, structure: {} });
  // Metadata always refreshes: a show that gained a season must not keep serving
  // a stale structure that hides the new episodes from "next up".
  if (meta.title) entry.title = meta.title;
  if (meta.poster) entry.poster = meta.poster;
  if (meta.backdrop) entry.backdrop = meta.backdrop;
  if (meta.episodeRuntime) entry.episodeRuntime = meta.episodeRuntime;
  if (meta.status) entry.status = meta.status;
  if (meta.structure && Object.keys(meta.structure).length) entry.structure = meta.structure;
  if (meta.aired !== undefined) entry.aired = meta.aired;
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
  if (!structureChanged && !airedChanged) return;
  ensure(id, meta);
  const entry = state.episodeProgress[key];
  entry.updatedAt = Date.now();
  persistMeta(key, { structure: entry.structure, aired: entry.aired });
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
  if (!after.complete) {
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

/**
 * Returns the episode's new watched state, or `null` when the write was refused
 * because nobody is signed in. Callers must treat null as "nothing happened" —
 * returning `true` there painted a tick for an episode that was never saved.
 */
export function toggleEpisode(id, season, episode, meta = {}) {
  if (!state.user) { document.dispatchEvent(new Event('cv:open-auth')); return null; }
  const wasWatched = isEpisodeWatched(id, season, episode);
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
      const airedCap = airedCapFor(entry, current);
      if (airedCap <= 0) continue;
      const cap = Math.min(airedCap, current === +season ? +episode : structure[current]);
      const list = new Set(entry.seasons[String(current)] || []);
      const fresh = [];
      for (let index = 1; index <= cap; index++) {
        if (list.has(index)) continue;
        fresh.push(index);
        logEpisode(entry, current, index, stamp, 1);
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
    const cap = airedCapFor(entry, season);
    const list = new Set(entry.seasons[String(season)] || []);
    const stamp = Date.now();
    const fresh = [];
    for (let index = 1; index <= cap; index++) {
      if (list.has(index)) continue;
      fresh.push(index);
      logEpisode(entry, season, index, stamp, 1);
    }
    // Re-ticking clears the tombstones the previous un-mark left behind.
    setWatched(entry, season, [...list, ...fresh]);
    if (cap) markLast(entry, season, cap);
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
      const cap = airedCapFor(entry, season);
      if (cap <= 0) continue;
      const list = new Set(entry.seasons[String(season)] || []);
      const fresh = [];
      for (let index = 1; index <= cap; index++) {
        if (list.has(index)) continue;
        fresh.push(index);
        logEpisode(entry, season, index, stamp, 1);
        added++;
      }
      if (fresh.length) setWatched(entry, season, fresh);
      markLast(entry, season, cap);
    }
    if (stampFrom > 0) entry.lastWatched = { season: entry.lastWatched?.season || 1, episode: entry.lastWatched?.episode || 1, at: stampFrom };
  });
  maybeCompleteShow(id, resolved);
  return added;
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
  if (!progress.complete || !progress.aired) return;
  const entry = showEntry(id);
  // Persist explicitly rather than relying on the caller's pending debounce
  // still being open — the stamp is what every "finished on" figure reads.
  if (entry && !entry.completedAt) { entry.completedAt = entry.lastWatched?.at || Date.now(); persist(KEY(id)); }
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
      // Recorded either way: a show TMDB can no longer resolve must not be
      // retried on every single page load.
      done.add(row.id);
      const meta = await fetchShow(row.id).catch(() => null);
      if (!meta || !Object.keys(meta.structure || {}).length) continue;
      const stamp = +(row.doc.watchedAt?.seconds || 0) * 1000 || Date.now();
      const added = await markShowWatched(row.id, meta, { stampFrom: stamp });
      if (added > 0) { filled++; episodes += added; }
    }
  });
  await Promise.all(workers);
  rememberBackfilled(done);
  if (filled) document.dispatchEvent(new CustomEvent('cv:episode-progress', { detail: { backfill: filled } }));
  return { filled, episodes };
}
