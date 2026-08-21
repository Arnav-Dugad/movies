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
import { db, firebase } from './firebase.js';
import { toast } from './ui.js';

const KEY = id => `tv_${id}`;
const cacheKey = () => `cv_episode_progress_${state.user?.uid || 'guest'}`;
const col = () => db.collection('users').doc(state.user.uid).collection('progress');
const writeTimers = new Map();

const numbers = value => [...new Set((Array.isArray(value) ? value : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);

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
  entry.updatedAt = Date.now();
  if (!Object.keys(entry.seasons).length) { delete state.episodeProgress[key]; persist(key); return { key, entry: null }; }
  persist(key);
  return { key, entry };
}

const markLast = (entry, season, episode) => { entry.lastWatched = { season: +season, episode: +episode, at: Date.now() }; };

export function toggleEpisode(id, season, episode, meta = {}) {
  const wasWatched = isEpisodeWatched(id, season, episode);
  apply(id, meta, entry => {
    const list = new Set(entry.seasons[String(season)] || []);
    if (wasWatched) list.delete(+episode);
    else { list.add(+episode); markLast(entry, season, episode); }
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
    for (const current of Object.keys(structure).map(Number).sort((a, b) => a - b)) {
      if (current > +season) break;
      const cap = current === +season ? +episode : structure[current];
      const list = new Set(entry.seasons[String(current)] || []);
      const before = list.size;
      for (let index = 1; index <= cap; index++) list.add(index);
      added += list.size - before;
      entry.seasons[String(current)] = [...list].sort((a, b) => a - b);
    }
    markLast(entry, season, episode);
  });
  maybeCompleteShow(id, meta);
  return added;
}

export function setSeasonWatched(id, season, on, meta = {}) {
  apply(id, meta, entry => {
    if (!on) { delete entry.seasons[String(season)]; return; }
    const count = (entry.structure || {})[String(season)] || 0;
    const aired = entry.aired;
    // Never mark episodes that have not aired: the progress bar would claim a
    // completion the user cannot have.
    const cap = aired && +season === aired.season ? Math.min(count, aired.episode) : (aired && +season > aired.season ? 0 : count);
    entry.seasons[String(season)] = Array.from({ length: cap }, (_, index) => index + 1);
    if (cap) markLast(entry, season, cap);
  });
  if (on) maybeCompleteShow(id, meta);
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
  if (state.watched[`tv_${id}`]) return;
  completeHook?.(id, meta, progress);
}
