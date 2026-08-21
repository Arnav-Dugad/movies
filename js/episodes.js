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
const cleanLog = value => (Array.isArray(value) ? value : [])
  .filter(row => Array.isArray(row) && row.length >= 3 && row.slice(0, 3).every(cell => Number.isFinite(+cell)))
  .map(row => [+row[0], +row[1], +row[2], row[3] ? 1 : 0])
  .filter(row => row[0] > 0 && row[1] > 0 && row[2] > 0)
  .sort((a, b) => a[2] - b[2])
  .slice(-LOG_CAP);

function sanitizeEntry(value) {
  if (!value || typeof value !== 'object') return null;
  const seasons = {}, structure = {};
  for (const [season, list] of Object.entries(value.seasons || {})) {
    const episodes = numbers(list);
    if (episodes.length) seasons[String(+season)] = episodes;
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
    log: cleanLog(value.log),
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
    col().doc(key).set({ ...entry, serverUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: false })
      .catch(error => console.warn('episode progress sync', error));
  }, 600));
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
export async function fetchShowMeta(id) { return tvShowMeta(await tmdb(`/tv/${id}`)); }

// ---------- reads ----------
export const showEntry = id => state.episodeProgress?.[KEY(id)] || null;

export function isEpisodeWatched(id, season, episode) {
  return !!showEntry(id)?.seasons?.[String(season)]?.includes(+episode);
}

export function seasonWatchedCount(id, season) {
  return showEntry(id)?.seasons?.[String(season)]?.length || 0;
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
  if (!entry) return { watched: 0, total: 0, aired: 0, percent: 0, started: false, complete: false, lastWatched: null };
  const structure = entry.structure || {};
  let watched = 0;
  for (const [season, episodes] of Object.entries(entry.seasons || {})) {
    // A season the show no longer lists (a re-numbering, a removed special) must
    // not push the count above the total and produce a >100% bar.
    const cap = structure[season];
    watched += cap ? episodes.filter(episode => episode <= cap).length : episodes.length;
  }
  const total = Object.values(structure).reduce((sum, count) => sum + count, 0);
  const aired = airedTotal(entry);
  return {
    watched, total, aired,
    percent: aired ? Math.min(100, Math.round((watched / aired) * 100)) : 0,
    started: watched > 0,
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
  const busiestEntry = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  const logged = [...perDay.values()].reduce((sum, count) => sum + count, 0);

  return {
    episodes, minutes, runtimeKnown,
    runtimeCoverage: episodes ? Math.round(runtimeKnown / episodes * 100) : 0,
    shows: shows.length, completed, inProgress,
    completionRate: shows.length ? Math.round(completed / shows.length * 100) : 0,
    series,
    logged,
    binge: bingeEntry ? { day: bingeEntry[0], count: bingeEntry[1] } : null,
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
  state.episodeProgress[key].updatedAt = Date.now();
  persist(key);
}

function apply(id, meta, mutate) {
  if (!state.user) { document.dispatchEvent(new Event('cv:open-auth')); return null; }
  const { key, entry } = ensure(id, meta);
  mutate(entry);
  for (const [season, episodes] of Object.entries(entry.seasons)) if (!episodes.length) delete entry.seasons[season];
  entry.log = cleanLog(entry.log);
  entry.updatedAt = Date.now();
  if (!Object.keys(entry.seasons).length) { delete state.episodeProgress[key]; persist(key); return { key, entry: null }; }
  // `legacy` means "completed before per-episode tracking existed". The moment
  // real episode data is written the flag stops being true of the document.
  if (entry.legacy && entry.log.length) entry.legacy = false;
  persist(key);
  return { key, entry };
}

const markLast = (entry, season, episode) => { entry.lastWatched = { season: +season, episode: +episode, at: Date.now() }; };

// One log row per newly-watched episode. Un-ticking removes its row so the
// episodes-over-time chart always matches what is actually marked.
function logEpisode(entry, season, episode, at = Date.now(), bulk = 0) {
  entry.log = [...(entry.log || []).filter(row => !(row[0] === +season && row[1] === +episode)), [+season, +episode, at, bulk ? 1 : 0]].slice(-LOG_CAP);
}
function unlogEpisode(entry, season, episode) {
  entry.log = (entry.log || []).filter(row => !(row[0] === +season && row[1] === +episode));
}

export function toggleEpisode(id, season, episode, meta = {}) {
  const wasWatched = isEpisodeWatched(id, season, episode);
  apply(id, meta, entry => {
    const list = new Set(entry.seasons[String(season)] || []);
    if (wasWatched) { list.delete(+episode); unlogEpisode(entry, season, episode); }
    else { list.add(+episode); markLast(entry, season, episode); logEpisode(entry, season, episode); }
    entry.seasons[String(season)] = [...list].sort((a, b) => a - b);
  });
  if (!wasWatched) maybeCompleteShow(id, meta);
  return !wasWatched;
}

// "I've seen everything up to here" — the single most useful bulk action when
// you start tracking a show you are already partway through.
export function markUpTo(id, season, episode, meta = {}) {
  let added = 0;
  apply(id, meta, entry => {
    const structure = entry.structure || {};
    // Every episode carries the moment it was actually marked — no fabricated
    // spacing — and the bulk flag so the binge record can ignore them.
    const stamp = Date.now();
    for (const current of Object.keys(structure).map(Number).sort((a, b) => a - b)) {
      if (current > +season) break;
      const cap = current === +season ? +episode : structure[current];
      const list = new Set(entry.seasons[String(current)] || []);
      for (let index = 1; index <= cap; index++) {
        if (list.has(index)) continue;
        list.add(index);
        logEpisode(entry, current, index, stamp, 1);
        added++;
      }
      entry.seasons[String(current)] = [...list].sort((a, b) => a - b);
    }
    markLast(entry, season, episode);
  });
  maybeCompleteShow(id, meta);
  return added;
}

export function setSeasonWatched(id, season, on, meta = {}) {
  apply(id, meta, entry => {
    if (!on) {
      delete entry.seasons[String(season)];
      entry.log = (entry.log || []).filter(row => row[0] !== +season);
      return;
    }
    const count = (entry.structure || {})[String(season)] || 0;
    const aired = entry.aired;
    // Never mark episodes that have not aired: the progress bar would claim a
    // completion the user cannot have.
    const cap = aired && +season === aired.season ? Math.min(count, aired.episode) : (aired && +season > aired.season ? 0 : count);
    const list = new Set(entry.seasons[String(season)] || []);
    const stamp = Date.now();
    for (let index = 1; index <= cap; index++) {
      if (list.has(index)) continue;
      list.add(index);
      logEpisode(entry, season, index, stamp, 1);
    }
    entry.seasons[String(season)] = [...list].sort((a, b) => a - b);
    if (cap) markLast(entry, season, cap);
  });
  if (on) maybeCompleteShow(id, meta);
}

// Mark every AIRED episode of every season. `meta.structure` is optional: when a
// card triggers this we have no show payload, so the structure is fetched first.
export async function markShowWatched(id, meta = {}, { fetchStructure = fetchShowMeta, stampFrom = 0 } = {}) {
  if (!state.user) { document.dispatchEvent(new Event('cv:open-auth')); return 0; }
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
    const structure = entry.structure || {}, aired = entry.aired;
    for (const season of Object.keys(structure).map(Number).sort((a, b) => a - b)) {
      const count = structure[season];
      const cap = aired ? (season < aired.season ? count : season === aired.season ? Math.min(count, aired.episode) : 0) : count;
      if (cap <= 0) continue;
      const list = new Set(entry.seasons[String(season)] || []);
      for (let index = 1; index <= cap; index++) {
        if (list.has(index)) continue;
        list.add(index);
        logEpisode(entry, season, index, stamp, 1);
        added++;
      }
      entry.seasons[String(season)] = [...list].sort((a, b) => a - b);
      markLast(entry, season, cap);
    }
    if (stampFrom > 0) entry.lastWatched = { season: entry.lastWatched?.season || 1, episode: entry.lastWatched?.episode || 1, at: stampFrom };
  });
  maybeCompleteShow(id, resolved);
  return added;
}

export function clearShowProgress(id) {
  const key = KEY(id);
  if (!state.episodeProgress[key]) return;
  delete state.episodeProgress[key];
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
  if (entry && !entry.completedAt) { entry.completedAt = entry.lastWatched?.at || Date.now(); mirror(); }
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
