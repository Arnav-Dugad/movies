// ===== FRANCHISE & COLLECTION COMPLETION =====
// "Part of the Alien Collection" was a link and nothing more — it never said how
// much of it you had actually seen, which is the only thing a tracker should be
// able to answer instantly.
//
// Completion is measured against RELEASED parts only, for the same reason the
// episode tracker caps at the last aired episode: a collection with an announced
// sequel is not 80% complete, it is complete, with more coming. Counting a film
// nobody can watch yet against you produces a number that can never reach 100.
import { tmdb } from './api.js';
import { state } from './state.js';

const CACHE_KEY = 'cv_collections_v1';
const CACHE_TTL = 30 * 86400000;   // parts lists barely change; a month is plenty
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

const isReleased = (part, now) => {
  const raw = part?.release_date;
  if (!raw) return true;                     // no date on record: don't punish it
  const t = Date.parse(`${raw}T00:00:00`);
  return Number.isNaN(t) ? true : t <= now;
};

/** Collection parts, from the device cache when it is fresh. */
export async function collectionParts(collectionId) {
  const id = +collectionId;
  if (!id) return null;
  const cached = store()[id];
  if (cached && Date.now() - (cached.at || 0) < CACHE_TTL) return cached;
  try {
    const d = await tmdb(`/collection/${id}`);
    const entry = {
      id, at: Date.now(),
      name: d.name || '',
      poster: d.poster_path || '',
      backdrop: d.backdrop_path || '',
      parts: (d.parts || []).filter(p => p && p.id).map(p => ({
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
  const list = (parts || []).filter(p => p && p.id);
  const released = list.filter(p => isReleased(p, now));
  const seenIds = new Set();
  for (const p of released) if (watched[`movie_${p.id}`]) seenIds.add(p.id);

  const ordered = [...released].sort((a, b) =>
    (Date.parse(`${a.release_date || '9999'}T00:00:00`) || 8.64e15) - (Date.parse(`${b.release_date || '9999'}T00:00:00`) || 8.64e15));
  const unseen = ordered.filter(p => !seenIds.has(p.id));

  return {
    total: list.length,
    released: released.length,
    upcoming: list.length - released.length,
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
    group.seen.push({ key, id: +(doc.tmdbId || 0), title: doc.title || '' });
  }
  return [...groups.values()].sort((a, b) => b.seen.length - a.seen.length || a.name.localeCompare(b.name));
}

/**
 * Resolve the user's franchises against TMDB and rank them by what is worth
 * finishing. Bounded, because each collection not already cached is one request.
 */
export async function franchiseSummary({ limit = 12, now = Date.now() } = {}) {
  const groups = watchedCollections().slice(0, limit);
  const rows = [];
  for (const group of groups) {
    const data = await collectionParts(group.id);
    if (!data || !data.parts.length) continue;
    const progress = collectionProgress(data.parts, { now });
    if (progress.released < 2) continue;   // a "collection" of one is not a franchise
    rows.push({
      id: group.id,
      name: data.name || group.name,
      poster: data.poster || group.poster,
      ...progress,
    });
  }
  const complete = rows.filter(r => r.complete);
  const inProgress = rows.filter(r => !r.complete)
    // Closest to done first, then fewest films left — the ones actually finishable.
    .sort((a, b) => b.percent - a.percent || a.unseen.length - b.unseen.length);
  return {
    rows,
    complete,
    inProgress,
    // One film from finishing: the single most satisfying thing to surface.
    almost: inProgress.filter(r => r.unseen.length === 1),
    trackedParts: rows.reduce((sum, r) => sum + r.released, 0),
    seenParts: rows.reduce((sum, r) => sum + r.seen, 0),
  };
}

/** "3 of 6 seen" / "Complete" — one honest phrase for a progress meter. */
export function progressLabel(progress) {
  if (!progress || !progress.released) return '';
  if (progress.complete) return progress.upcoming ? 'Complete so far' : 'Complete';
  return `${progress.seen} of ${progress.released} seen`;
}
