// ===== FRANCHISE & COLLECTION COMPLETION =====
// "Part of the Alien Collection" was a link and nothing more — it never said how
// much of it you had actually seen, which is the only thing a tracker should be
// able to answer instantly.
//
// Completion is measured against RELEASED parts only, for the same reason the
// episode tracker caps at the last aired episode: a collection with an announced
// sequel is not 80% complete, it is complete, with more coming. Counting a film
// nobody can watch yet against you produces a number that can never reach 100.
import { tmdb, pool } from './api.js';
import { db } from './firebase.js';
import { state } from './state.js';

const CACHE_KEY = 'cv_collections_v1';
const CACHE_TTL = 7 * 86400000;    // new parts and release dates should surface promptly
const CACHE_MAX = 120;

let memo = null;
function store() {
  if (memo) return memo;
  try { memo = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; }
  catch (_) { memo = {}; }
  return memo;
}
function persist() {
  try {
    const entries = Object.entries(memo).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, CACHE_MAX);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch (_) {}
}

/** Forget cached collection shapes so newly announced/released parts appear now. */
export function clearFranchiseCache() {
  memo = {};
  try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
  familyMemo = {};
  try { localStorage.removeItem(FAMILY_CACHE); } catch (_) {}
}

const releaseState = (part, now, watched) => {
  const raw = part?.release_date;
  if (!raw) return watched?.[`movie_${part?.id}`] ? 'released' : 'unknown';
  const t = Date.parse(`${raw}T00:00:00`);
  if (Number.isNaN(t)) return watched?.[`movie_${part?.id}`] ? 'released' : 'unknown';
  return t <= now ? 'released' : 'upcoming';
};

/** Collection parts, from the device cache when it is fresh. */
export async function collectionParts(collectionId, { force = false } = {}) {
  const id = +collectionId;
  if (!id) return null;
  const cached = store()[id];
  if (!force && cached && Date.now() - (cached.at || 0) < CACHE_TTL) return cached;
  try {
    const d = await tmdb(`/collection/${id}`);
    const entry = {
      id, at: Date.now(),
      name: d.name || '',
      poster: d.poster_path || '',
      backdrop: d.backdrop_path || '',
      parts: [...new Map((d.parts || []).filter(p => p && +p.id > 0).map(p => [+p.id, p])).values()].map(p => ({
        id: p.id, title: p.title || p.name || '',
        poster: p.poster_path || '', release_date: p.release_date || '',
        vote: +(p.vote_average || 0),
      })),
    };
    memo[id] = entry; persist();
    return entry;
  } catch (_) { return cached || null; }
}

/**
 * How far through a collection the user is.
 * `parts` is the raw TMDB array or our cached shape — both carry id + release_date.
 */
export function collectionProgress(parts, { now = Date.now(), watched = state.watched } = {}) {
  const list = [...new Map((parts || []).filter(p => p && +p.id > 0).map(p => [+p.id, p])).values()];
  const released = list.filter(p => releaseState(p, now, watched) === 'released');
  const upcomingParts = list.filter(p => releaseState(p, now, watched) === 'upcoming');
  const unknownParts = list.filter(p => releaseState(p, now, watched) === 'unknown');
  const seenIds = new Set();
  for (const p of released) if (watched[`movie_${p.id}`]) seenIds.add(p.id);

  const ordered = [...released].sort((a, b) =>
    (Date.parse(`${a.release_date || '9999'}T00:00:00`) || 8.64e15) - (Date.parse(`${b.release_date || '9999'}T00:00:00`) || 8.64e15));
  const unseen = ordered.filter(p => !seenIds.has(p.id));

  return {
    total: list.length,
    released: released.length,
    upcoming: upcomingParts.length,
    unknown: unknownParts.length,
    upcomingParts,
    unknownParts,
    seen: seenIds.size,
    unseen,
    // The earliest released part not yet watched — "carry on from here".
    nextUp: unseen[0] || null,
    percent: released.length ? (seenIds.size / released.length) * 100 : 0,
    complete: released.length > 0 && seenIds.size === released.length,
    seenIds,
  };
}

/**
 * Every collection represented in the watch history, from the `collectionId`
 * stamped on watched docs by the metadata backfill. Sorted by how many parts of
 * it have been seen, so the biggest commitments come first.
 */
export function watchedCollections({ watched = state.watched } = {}) {
  const groups = new Map();
  for (const [key, doc] of Object.entries(watched)) {
    const cid = +(doc?.collectionId || 0);
    if (!cid || doc.type === 'tv') continue;
    if (!groups.has(cid)) groups.set(cid, { id: cid, name: doc.collectionName || '', poster: doc.collectionPoster || '', seen: [] });
    const group = groups.get(cid);
    if (!group.name && doc.collectionName) group.name = doc.collectionName;
    if (!group.poster && doc.collectionPoster) group.poster = doc.collectionPoster;
    const mediaId = +(doc.tmdbId || String(key).split('_').at(-1) || 0);
    if (mediaId && !group.seen.some(item => item.id === mediaId)) group.seen.push({ key, id: mediaId, title: doc.title || '' });
  }
  return [...groups.values()].sort((a, b) => b.seen.length - a.seen.length || a.name.localeCompare(b.name));
}

/**
 * Resolve the user's franchises against TMDB and rank them by what is worth
 * finishing. Bounded, because each collection not already cached is one request.
 */
export async function franchiseSummary({ limit = 12, now = Date.now() } = {}) {
  const watched = { ...(state.watched || {}) };
  const groups = watchedCollections({ watched }).slice(0, Math.max(1, Math.min(80, limit)));
  const rows = [];
  await pool(groups, async group => {
    const data = await collectionParts(group.id);
    if (!data || !data.parts.length) return;
    const progress = collectionProgress(data.parts, { now, watched });
    if (progress.released < 2) return;   // a "collection" of one is not a franchise
    rows.push({
      id: group.id,
      name: data.name || group.name || 'Untitled collection',
      poster: data.poster || group.poster || data.parts.find(part => part.poster)?.poster || '',
      backdrop: data.backdrop || '',
      // The whole running order, so a caller can show every entry and its state
      // without fetching the collection a second time.
      parts: [...data.parts].sort((a, b) =>
        (a.release_date || '9999').localeCompare(b.release_date || '9999') || a.id - b.id),
      ...progress,
    });
  }, 5);
  rows.sort((a, b) => b.seen - a.seen || a.name.localeCompare(b.name));
  const complete = rows.filter(r => r.complete);
  const inProgress = rows.filter(r => !r.complete && !isFranchiseDismissed(r.id))
    // Closest to done first, then fewest films left — the ones actually finishable.
    .sort((a, b) => b.percent - a.percent || a.unseen.length - b.unseen.length);
  return {
    rows,
    complete,
    // The rail respects dismissals; the Stats block deliberately does not, so a
    // series you set aside is still visible somewhere and can be brought back.
    dismissed: rows.filter(row => isFranchiseDismissed(row.id)),
    inProgress,
    // One film from finishing: the single most satisfying thing to surface.
    almost: inProgress.filter(r => r.unseen.length === 1),
    trackedParts: rows.reduce((sum, r) => sum + r.released, 0),
    seenParts: rows.reduce((sum, r) => sum + r.seen, 0),
  };
}

// ===== DISMISSED SERIES =====
// A franchise you have deliberately abandoned is not a recommendation, and the
// rail has no way to learn that from watch history — not finishing something is
// exactly what "still in progress" looks like. So it is asked, once, per series.
// Stored on the profile document, which sign-in already reads.
let dismissSaveTimer = null;
const dismissed = () => (state.franchisePrefs ||= { dismissed: [] }).dismissed;

export function hydrateFranchisePrefs(cloud) {
  const list = Array.isArray(cloud?.dismissed) ? cloud.dismissed.map(Number).filter(id => id > 0) : [];
  state.franchisePrefs = { dismissed: [...new Set(list)].slice(0, 80) };
}

export const isFranchiseDismissed = id => dismissed().includes(+id);

export function toggleFranchiseDismissed(id) {
  const list = dismissed(), index = list.indexOf(+id);
  if (index >= 0) list.splice(index, 1); else list.unshift(+id);
  state.franchisePrefs.dismissed = list.slice(0, 80);
  saveFranchisePrefs();
  return isFranchiseDismissed(id);
}

export function restoreAllFranchises() {
  state.franchisePrefs = { dismissed: [] };
  saveFranchisePrefs();
}

function saveFranchisePrefs() {
  document.dispatchEvent(new Event('cv:franchise-prefs'));
  const uid = state.user?.uid;
  if (!uid) return;
  clearTimeout(dismissSaveTimer);
  dismissSaveTimer = setTimeout(() => {
    if (state.user?.uid !== uid) return;
    db.collection('users').doc(uid).set({ franchisePrefs: state.franchisePrefs }, { merge: true })
      .catch(error => console.warn('franchise prefs save', error));
  }, 900);
}

/** "3 of 6 seen" / "Complete" — one honest phrase for a progress meter. */
export function progressLabel(progress) {
  if (!progress || !progress.released) return '';
  if (progress.complete) return progress.upcoming ? 'Complete so far' : 'Complete';
  return `${progress.seen} of ${progress.released} seen`;
}

// ===== TV FAMILIES =====
// TMDB has collections for film and nothing at all for television, so a Star Trek
// or a Law & Order cannot be answered the way a Dune can. What television does
// have is a naming convention: a franchise names itself in the title, before a
// colon or a dash.
//
// So this groups by name, and says so. It is deliberately strict — a show joins a
// family only when the separator is explicit, or when its whole title IS the stem
// another show declared — because a loose rule would put "Love, Death & Robots"
// in a family with "Love Island" and quietly invent a franchise nobody is in.
// Everything derived this way is labelled as name-matched in the interface, and
// the count is "found on TMDB", never "exists".

const FAMILY_SPLIT = /^(.{2,40}?)\s*[:\u2013\u2014]\s+\S/;   // "Stem: Rest", "Stem — Rest"
const FAMILY_DASH = /^(.{2,40}?)\s+-\s+\S/;                  // "Stem - Rest"
const MIN_FAMILY = 2;

/** The franchise a title declares in its own name, or '' when it declares none. */
export function titleStem(title) {
  const clean = String(title || '').trim();
  if (!clean) return '';
  const match = FAMILY_SPLIT.exec(clean) || FAMILY_DASH.exec(clean);
  if (!match) return '';
  const stem = match[1].trim();
  // Two-character stems are noise ("A: ...", "3: ..."), and a stem equal to the
  // whole title is not a stem at all. One WORD is fine and common — "Alien",
  // "Fargo", "Chernobyl" all name real families.
  return stem.length >= 3 && stem !== clean ? stem : '';
}

// Case and punctuation must never split one family in two. The ampersand is
// spelled out rather than dropped, because "Law & Order" and "Law and Order" are
// the same franchise and stripping the symbol would leave "law order" — matching
// neither. This is the only word-level rule here: anything looser starts merging
// families that merely share a word.
const foldKey = value => String(value || '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/**
 * Watched TV shows grouped into named families. A group needs two members, and a
 * show with no separator in its title joins only when its whole title matches a
 * stem some other show declared.
 */
export function tvFamilies({ watched = state.watched } = {}) {
  const shows = [];
  for (const [key, doc] of Object.entries(watched)) {
    const type = doc?.type || String(key).split('_')[0];
    if (type !== 'tv') continue;
    const title = doc?.title || '';
    if (!title) continue;
    shows.push({ key, id: +(doc.tmdbId || String(key).split('_').pop() || 0), title, poster: doc.poster || '' });
  }

  // Stems anyone actually declared. Only these can attract a separator-less title.
  const declared = new Map();
  for (const show of shows) {
    const stem = titleStem(show.title);
    if (stem) declared.set(foldKey(stem), stem);
  }
  if (!declared.size) return [];

  const groups = new Map();
  for (const show of shows) {
    const stem = titleStem(show.title);
    const fold = foldKey(stem || show.title);
    if (!declared.has(fold)) continue;             // neither declares nor matches one
    const name = declared.get(fold);
    if (!groups.has(fold)) groups.set(fold, { key: fold, name, seen: [] });
    groups.get(fold).seen.push(show);
  }

  return [...groups.values()]
    .filter(group => group.seen.length >= MIN_FAMILY)
    .sort((a, b) => b.seen.length - a.seen.length || a.name.localeCompare(b.name));
}

/** Does this TMDB search result actually belong to the family, or just mention it? */
function belongsToFamily(result, stem) {
  const title = String(result?.name || result?.original_name || '').trim();
  if (!title) return false;
  const fold = foldKey(title), stemFold = foldKey(stem);
  if (fold === stemFold) return true;
  const declared = titleStem(title);
  return !!declared && foldKey(declared) === stemFold;
}

const FAMILY_CACHE = 'cv_tv_families_v1';
let familyMemo = null;
function familyStore() {
  if (familyMemo) return familyMemo;
  try { familyMemo = JSON.parse(localStorage.getItem(FAMILY_CACHE) || '{}') || {}; }
  catch (_) { familyMemo = {}; }
  return familyMemo;
}

/** Every show TMDB knows in this family, by name. One search, cached for a month. */
export async function familyMembers(stem) {
  const key = foldKey(stem);
  const cached = familyStore()[key];
  if (cached && Date.now() - (cached.at || 0) < CACHE_TTL) return cached;
  try {
    const data = await tmdb('/search/tv', { query: stem });
    const members = (data.results || [])
      .filter(result => result && result.id && belongsToFamily(result, stem))
      .map(result => ({
        id: result.id, title: result.name || '', poster: result.poster_path || '',
        firstAir: result.first_air_date || '', vote: +(result.vote_average || 0),
      }))
      .sort((a, b) => (a.firstAir || '9999').localeCompare(b.firstAir || '9999'));
    const entry = { key, stem, at: Date.now(), members };
    familyMemo[key] = entry;
    try {
      const rows = Object.entries(familyMemo).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 60);
      localStorage.setItem(FAMILY_CACHE, JSON.stringify(Object.fromEntries(rows)));
    } catch (_) {}
    return entry;
  } catch (_) { return cached || { key, stem, at: 0, members: [] }; }
}

/**
 * Where the viewer stands in each TV family. Unlike the film version there is no
 * authoritative list to measure against, so `found` is what TMDB's search
 * returned — an honest denominator with a name, not a claim of completeness.
 */
export async function tvFamilySummary({ limit = 8, watched = state.watched } = {}) {
  const groups = tvFamilies({ watched }).slice(0, limit);
  const rows = [];
  for (const group of groups) {
    const data = await familyMembers(group.name);
    // Anything watched but missing from search still counts as seen: the search
    // is the weaker source, and dropping a show the viewer demonstrably watched
    // would be the one error this must not make.
    const byId = new Map();
    for (const member of data.members) byId.set(member.id, member);
    for (const show of group.seen) if (show.id && !byId.has(show.id)) byId.set(show.id, { id: show.id, title: show.title, poster: show.poster, firstAir: '' });
    const all = [...byId.values()].sort((a, b) => (a.firstAir || '9999').localeCompare(b.firstAir || '9999'));
    if (all.length < MIN_FAMILY) continue;

    const seenIds = new Set(group.seen.map(show => show.id).filter(Boolean));
    const unseen = all.filter(show => !seenIds.has(show.id));
    rows.push({
      key: group.key, name: group.name,
      poster: group.seen.find(show => show.poster)?.poster || all.find(show => show.poster)?.poster || '',
      found: all.length, seen: seenIds.size, unseen,
      nextUp: unseen[0] || null,
      percent: all.length ? (seenIds.size / all.length) * 100 : 0,
      complete: all.length > 0 && seenIds.size >= all.length,
    });
  }
  rows.sort((a, b) => b.percent - a.percent || b.seen - a.seen);
  return {
    rows,
    complete: rows.filter(row => row.complete),
    inProgress: rows.filter(row => !row.complete),
    seenShows: rows.reduce((sum, row) => sum + row.seen, 0),
    foundShows: rows.reduce((sum, row) => sum + row.found, 0),
  };
}
