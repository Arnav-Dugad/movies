// ===== WATCHED METADATA BACKFILL =====
// Enriches watched docs with everything the intelligence engine needs but the
// write path may not know: runtime, director, cast, and story-theme keywords.
// Also fills the older poster/year/genres gap, so this is the ONE backfill for
// watched docs — a second pass would double the network cost, since tmdb() keys
// its cache on path+params and `?append_to_response=credits` is a distinct key.
//
// Lazy by design: watch history, Stats, or personalized Home rails can trigger it.
// Fire-and-forget — it never blocks a paint; `cv:meta-backfilled` re-renders
// whichever surface cares once the data lands.
import { tmdb, pool } from './api.js';
import { db } from './firebase.js';
import { state } from './state.js';

// Bump to re-backfill every doc after a schema change.
export const META_V = 7;   // 7: collection membership, for franchise completion
const REPAIR_V = 1;

let running = false, done = false, repairing = false;
let continueTimer = null;

// A schema bump makes every watched document stale at once. Fetching a
// 500-title library in one sitting is a burst of 500 TMDB requests on somebody's
// phone, so a run does a slice and hands back. Progress is durable without a
// cursor file: each document records the `metaV` it was written at, so a run
// that is interrupted — by a closed tab, a dead connection, a sign-out — simply
// finds fewer stale documents next time and picks up exactly where it stopped.
const BATCH = 50;
const BATCH_GAP = 4000;   // pace between slices, so this never fights the UI

export function resetWatchedMeta() {
  running = false; done = false;
  clearTimeout(continueTimer); continueTimer = null;
}

/** How many watched documents still need enriching. Drives the Stats progress note. */
export function pendingMetaCount() {
  return staleDocs().length;
}

function staleDocs() {
  return Object.entries(state.watched)
    .map(([key, doc]) => ({ key, doc, ...identity(key, doc) }))
    .filter(item => item.id && item.type && (item.doc.metaV !== META_V || !item.doc.poster || !(item.doc.genres && item.doc.genres.length) || !item.doc.tmdbId || !item.doc.type));
}

function movieMeta(det) {
  const d = (det.credits?.crew || []).find(c => c.job === 'Director');
  return { runtime: det.runtime || 0, director: d?.name || '', directorId: d?.id || 0, directorProfile: d?.profile_path || '' };
}

function tvMeta(det) {
  // episode_run_time is [] for a lot of modern shows, hence the two fallbacks.
  // This is the whole SHOW's runtime, not "what you actually watched" — we don't
  // track per-episode viewing, so hours are surfaced as approximate (see stats).
  const ep = det.episode_run_time?.[0] || det.last_episode_to_air?.runtime || 45;
  return {
    runtime: ep * (det.number_of_episodes || 0),
    director: det.created_by?.[0]?.name || '',
    directorId: det.created_by?.[0]?.id || 0,
    directorProfile: det.created_by?.[0]?.profile_path || '',
  };
}

const releaseOf = det => det.release_date || det.first_air_date || '';
// Only movies belong to a TMDB collection. Stamping it here means franchise
// completion costs no extra request — it rides the enrichment fetch that already
// happens for runtime, credits, and keywords.
const collectionOf = (det, old = {}) => {
  const c = det.belongs_to_collection;
  if (!c || !c.id) return { collectionId: +(old.collectionId || 0), collectionName: old.collectionName || '', collectionPoster: old.collectionPoster || '' };
  return { collectionId: +c.id, collectionName: c.name || '', collectionPoster: c.poster_path || '' };
};
const keywordsOf = det => (det.keywords?.keywords || det.keywords?.results || [])
  .slice(0, 15).map(keyword => ({ id: +keyword.id, name: keyword.name || '' }))
  .filter(keyword => keyword.id && keyword.name);
const typeRuntime = (det, type, completed = false) => {
  if (type === 'movie') return +(det.runtime || 0);
  const episode = +(det.episode_run_time?.[0] || det.last_episode_to_air?.runtime || 0);
  return completed ? episode * +(det.number_of_episodes || 0) : episode;
};
const identity = (key, doc = {}) => {
  const split = String(key || '').lastIndexOf('_');
  const fallbackType = split > 0 ? String(key).slice(0, split) : '';
  const fallbackId = split > 0 ? +String(key).slice(split + 1) : 0;
  return { type: doc.type || fallbackType, id: +(doc.tmdbId || fallbackId || 0) };
};
const missingCommon = doc => !doc?.poster || !doc?.year || !doc?.releaseDate || !doc?.language || !doc?.runtime || !(doc?.genres && doc.genres.length);

function watchlistPatch(det, type, old) {
  const release = releaseOf(det), genres = (det.genres || []).map(genre => genre.id);
  return {
    tmdbId: +det.id || +(old.tmdbId || 0), type,
    title: det.title || det.name || old.title || '', poster: det.poster_path || old.poster || '',
    year: release.slice(0, 4) || old.year || '', releaseDate: release || old.releaseDate || '',
    genres: genres.length ? genres : (old.genres || []), runtime: typeRuntime(det, type) || old.runtime || 0,
    language: det.original_language || old.language || '',
    country: det.origin_country?.[0] || det.production_countries?.[0]?.iso_3166_1 || old.country || '',
    rating: +(det.vote_average || old.rating || 0), voteCount: +(det.vote_count || old.voteCount || 0), repairV: REPAIR_V,
  };
}

function watchedPatch(det, type, old) {
  const release = releaseOf(det), genres = (det.genres || []).map(genre => genre.id);
  const people = type === 'tv' ? tvMeta(det) : movieMeta(det);
  const episodeRuntime = type === 'tv' ? +(det.episode_run_time?.[0] || det.last_episode_to_air?.runtime || 0) : 0;
  const episodeCount = type === 'tv' ? +(det.number_of_episodes || 0) : 0;
  const cast = (det.credits?.cast || []).slice(0, 5).map(person => ({ id: person.id, name: person.name || '', profile: person.profile_path || '' }));
  return {
    tmdbId: +det.id || +(old.tmdbId || 0), type,
    title: det.title || det.name || old.title || '', poster: det.poster_path || old.poster || '',
    year: release.slice(0, 4) || old.year || '', releaseDate: release || old.releaseDate || '',
    genres: genres.length ? genres : (old.genres || []), keywords: keywordsOf(det).length ? keywordsOf(det) : (old.keywords || []), runtime: typeRuntime(det, type, true) || old.runtime || 0,
    episodeRuntime: episodeRuntime || old.episodeRuntime || 0, episodeCount: episodeCount || old.episodeCount || 0,
    language: det.original_language || old.language || '',
    country: det.origin_country?.[0] || det.production_countries?.[0]?.iso_3166_1 || old.country || '',
    tmdbRating: +(det.vote_average || old.tmdbRating || 0), voteCount: +(det.vote_count || old.voteCount || 0),
    director: people.director || old.director || '', directorId: people.directorId || old.directorId || 0,
    directorProfile: people.directorProfile || old.directorProfile || '', cast: cast.length ? cast : (old.cast || []),
    ...collectionOf(det, old),
    metaV: META_V, repairV: REPAIR_V,
  };
}

// Manual, user-triggered repair for the union of every saved and watched title.
// A title present in both collections is fetched once and updates both documents.
export async function repairCollectionMeta(onProgress = () => {}) {
  if (!state.user) return { total: 0, repaired: 0, failed: 0, auth: false };
  if (running || repairing) return { total: 0, repaired: 0, failed: 0, busy: true };
  const uid = state.user.uid, jobs = new Map();
  const ensureJob = (key, type, id) => {
    if (!jobs.has(key)) jobs.set(key, { key, type, id, watchlist: null, watched: null });
    return jobs.get(key);
  };
  state.watchlist.forEach(doc => {
    const key = doc.id || `${doc.type}_${doc.tmdbId}`, meta = identity(key, doc);
    if (meta.id && meta.type) ensureJob(key, meta.type, meta.id).watchlist = doc;
  });
  Object.entries(state.watched).forEach(([key, doc]) => {
    const meta = identity(key, doc);
    if (meta.id && meta.type) ensureJob(key, meta.type, meta.id).watched = doc;
  });
  const pending = [...jobs.values()].filter(job =>
    (job.watchlist && missingCommon(job.watchlist)) ||
    (job.watched && (missingCommon(job.watched) || !job.watched.keywords?.length || job.watched.metaV !== META_V || ((!job.watched.directorId || !job.watched.cast?.length) && job.watched.repairV !== REPAIR_V)))
  );
  if (!pending.length) return { total: 0, repaired: 0, failed: 0 };

  repairing = true;
  let repaired = 0, failed = 0, completed = 0;
  onProgress({ completed, total: pending.length, repaired, failed });
  try {
    await pool(pending, async job => {
      try {
        if (!state.user || state.user.uid !== uid) throw new Error('account changed');
        const det = await tmdb(`/${job.type}/${job.id}`, { append_to_response: 'credits,keywords' }, { cache: false });
        const writes = []; let savedPatch = null, seenPatch = null;
        if (job.watchlist) {
          savedPatch = watchlistPatch(det, job.type, job.watchlist);
          writes.push(db.collection('users').doc(uid).collection('watchlist').doc(job.key).set(savedPatch, { merge: true }));
        }
        if (job.watched) {
          seenPatch = watchedPatch(det, job.type, job.watched);
          writes.push(db.collection('users').doc(uid).collection('watched').doc(job.key).set(seenPatch, { merge: true }));
        }
        await Promise.all(writes);
        if (savedPatch) Object.assign(job.watchlist, savedPatch);
        if (seenPatch) state.watched[job.key] = { ...job.watched, ...seenPatch };
        repaired++;
      } catch (error) {
        console.warn('collection repair item', job.key, error); failed++;
      } finally {
        completed++;
        onProgress({ completed, total: pending.length, repaired, failed });
      }
    }, 4);
  } finally {
    repairing = false;
  }
  if (repaired) {
    done = Object.values(state.watched).every(doc => doc.metaV === META_V && !missingCommon(doc));
    document.dispatchEvent(new Event('cv:meta-backfilled'));
    document.dispatchEvent(new Event('cv:wl-changed'));
  }
  return { total: pending.length, repaired, failed };
}

export async function ensureWatchedMeta({ batch = BATCH } = {}) {
  if (running || done || !state.user) return;
  const uid = state.user.uid;
  const stale = staleDocs();
  if (!stale.length) { done = true; return; }

  const slice = stale.slice(0, Math.max(1, batch));
  const remaining = stale.length - slice.length;
  document.dispatchEvent(new CustomEvent('cv:meta-progress', { detail: { pending: stale.length, batch: slice.length } }));

  running = true;
  let wrote = 0;
  try {
    await pool(slice, async ({ key, doc: d, type, id }) => {
      // Re-check identity per item: a sign-out/switch mid-flight must never write
      // one account's data into another's docs.
      if (!state.user || state.user.uid !== uid) return;
      const det = await tmdb(`/${type}/${id}`, { append_to_response: 'credits,keywords' }, { cache: false });
      const m = type === 'tv' ? tvMeta(det) : movieMeta(det);
      const gs = (det.genres || []).map(g => g.id);
      const cs = (det.credits?.cast || []).slice(0, 5).map(p => ({ id: p.id, name: p.name || '', profile: p.profile_path || '' }));
      const episodeCount = type === 'tv' ? +(det.number_of_episodes || d.episodeCount || 0) : 0;
      const episodeRuntime = type === 'tv'
        ? +(det.episode_run_time?.[0] || det.last_episode_to_air?.runtime || (episodeCount && m.runtime ? m.runtime / episodeCount : 0) || d.episodeRuntime || 0)
        : 0;
      const patch = {
        tmdbId: id, type,
        poster: det.poster_path || d.poster || '',
        year: d.year || (det.release_date || det.first_air_date || '').slice(0, 4),
        releaseDate: d.releaseDate || det.release_date || det.first_air_date || '',
        language: det.original_language || d.language || '',
        country: det.origin_country?.[0] || det.production_countries?.[0]?.iso_3166_1 || d.country || '',
        tmdbRating: +(det.vote_average || d.tmdbRating || 0),
        voteCount: +(det.vote_count || d.voteCount || 0),
        // Fall back to what we already had, like poster/year above. This pass runs
        // over EVERY doc with a stale metaV — including ones whose genres are
        // already good — so an unconditional overwrite would wipe real data
        // whenever a response comes back without a genres array.
        genres: gs.length ? gs : (d.genres || []),
        keywords: keywordsOf(det).length ? keywordsOf(det) : (d.keywords || []),
        // Same defensive shape: never downgrade a known value to an empty one just
        // because a single response came back thin (matters on a metaV bump, when
        // these fields already hold good data from the previous version).
        runtime: m.runtime || d.runtime || 0,
        episodeRuntime, episodeCount,
        director: m.director || d.director || '',
        directorId: m.directorId || d.directorId || 0,
        directorProfile: m.directorProfile || d.directorProfile || '',
        // Store names alongside ids so "10 titles with Bryan Cranston" renders
        // without a /person round-trip per actor. Top 5 keeps the doc small.
        cast: cs.length ? cs : (d.cast || []),
        metaV: META_V,
      };
      await db.collection('users').doc(uid).collection('watched').doc(key).set(patch, { merge: true });
      if (state.watched[key]) state.watched[key] = { ...state.watched[key], ...patch };
      wrote++;
    }, 6);
    // Latch `done` only when this run finished the whole backlog. A partial run
    // (network blip, TMDB 404, or simply a slice) must stay retryable rather
    // than wedging the flag.
    done = wrote === slice.length && remaining === 0;
  } finally {
    running = false;
    if (wrote) {
      document.dispatchEvent(new Event('cv:meta-backfilled'));
      // These are real writes to the watched collection, so the sign-in cache has
      // to advance with them (js/library-cache.js). Without this the enrichment
      // landed in Firestore while every device kept serving the pre-enrichment
      // snapshot, and this one re-ran the whole backfill on the next visit.
      document.dispatchEvent(new Event('cv:wl-changed'));
    }
    // Keep going on a paced timer rather than in one burst. Only while the tab is
    // visible: a backgrounded tab has no reason to spend somebody's data.
    if (wrote && remaining > 0 && state.user?.uid === uid) {
      clearTimeout(continueTimer);
      continueTimer = setTimeout(() => {
        continueTimer = null;
        if (document.visibilityState === 'hidden') return;   // resumes on the next call
        ensureWatchedMeta({ batch });
      }, BATCH_GAP);
    }
  }
}

export function initWatchedMeta() {
  // cv:auth fires on sign-in AND sign-out, so this also covers switching accounts
  // in one tab — otherwise the second account never gets ITS docs backfilled.
  document.addEventListener('cv:auth', resetWatchedMeta);
  // A tab brought back to the foreground picks the backlog up again, since a
  // hidden tab deliberately drops its continuation.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !running && !done && state.user) ensureWatchedMeta();
  });
}
