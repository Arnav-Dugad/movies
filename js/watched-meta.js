// ===== WATCHED METADATA BACKFILL =====
// Enriches watched docs with everything the badge engine needs but the write path
// doesn't know: runtime (for hours-watched), director, and top-billed cast.
// Also fills the older poster/year/genres gap, so this is the ONE backfill for
// watched docs — a second pass would double the network cost, since tmdb() keys
// its cache on path+params and `?append_to_response=credits` is a distinct key.
//
// Lazy by design: only /watched and /stats trigger it, so users who visit neither
// never pay for it. Fire-and-forget — it never blocks a paint; `cv:meta-backfilled`
// re-renders whoever cares once the data lands.
import { tmdb, pool } from './api.js';
import { db } from './firebase.js';
import { state } from './state.js';

// Bump to re-backfill every doc after a schema change.
export const META_V = 1;

let running = false, done = false;

export function resetWatchedMeta() { running = false; done = false; }

function movieMeta(det) {
  const d = (det.credits?.crew || []).find(c => c.job === 'Director');
  return { runtime: det.runtime || 0, director: d?.name || '', directorId: d?.id || 0 };
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
  };
}

export async function ensureWatchedMeta() {
  if (running || done || !state.user) return;
  const uid = state.user.uid;
  const stale = Object.entries(state.watched)
    .filter(([, d]) => d.metaV !== META_V || !d.poster || !(d.genres && d.genres.length));
  if (!stale.length) { done = true; return; }

  running = true;
  let wrote = 0;
  try {
    await pool(stale, async ([key, d]) => {
      // Re-check identity per item: a sign-out/switch mid-flight must never write
      // one account's data into another's docs.
      if (!state.user || state.user.uid !== uid) return;
      const det = await tmdb(`/${d.type}/${d.tmdbId}`, { append_to_response: 'credits' }, { cache: false });
      const m = d.type === 'tv' ? tvMeta(det) : movieMeta(det);
      const gs = (det.genres || []).map(g => g.id);
      const cs = (det.credits?.cast || []).slice(0, 5).map(p => ({ id: p.id, name: p.name || '' }));
      const patch = {
        poster: det.poster_path || d.poster || '',
        year: d.year || (det.release_date || det.first_air_date || '').slice(0, 4),
        // Fall back to what we already had, like poster/year above. This pass runs
        // over EVERY doc with a stale metaV — including ones whose genres are
        // already good — so an unconditional overwrite would wipe real data
        // whenever a response comes back without a genres array.
        genres: gs.length ? gs : (d.genres || []),
        // Same defensive shape: never downgrade a known value to an empty one just
        // because a single response came back thin (matters on a metaV bump, when
        // these fields already hold good data from the previous version).
        runtime: m.runtime || d.runtime || 0,
        director: m.director || d.director || '',
        directorId: m.directorId || d.directorId || 0,
        // Store names alongside ids so "10 titles with Bryan Cranston" renders
        // without a /person round-trip per actor. Top 5 keeps the doc small.
        cast: cs.length ? cs : (d.cast || []),
        metaV: META_V,
      };
      if (state.watched[key]) state.watched[key] = { ...state.watched[key], ...patch };
      await db.collection('users').doc(uid).collection('watched').doc(key).set(patch, { merge: true });
      wrote++;
    }, 6);
    // Latch `done` only on a COMPLETE run. A partial run (network blip, TMDB 404)
    // must stay retryable on the next visit rather than wedging the flag.
    done = wrote === stale.length;
  } finally {
    running = false;
    if (wrote) document.dispatchEvent(new Event('cv:meta-backfilled'));
  }
}

export function initWatchedMeta() {
  // cv:auth fires on sign-in AND sign-out, so this also covers switching accounts
  // in one tab — otherwise the second account never gets ITS docs backfilled.
  document.addEventListener('cv:auth', resetWatchedMeta);
}
