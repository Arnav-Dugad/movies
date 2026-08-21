// ===== REWATCH TRACKING =====
// "Watched" was a boolean, which cannot answer the question people actually ask
// about their own library: what do I keep going back to? A watched entry is now a
// count. The first viewing is play 1; every rewatch appends a dated play.
//
// There is no migration. Entries written before this existed carry no `plays`
// field and read as exactly one play stamped with their `watchedAt`, so every
// account has a complete, honest history from the moment this ships — and a doc
// only grows the new fields once it is actually rewatched.
import { db } from './firebase.js';
import { state } from './state.js';

// Dates kept per title. A doc is capped at 1 MiB and this array shares it with
// the poster/genre/cast enrichment, so it is bounded — oldest plays fall off
// first, but `plays` itself keeps counting, so the total is never wrong.
const PLAY_CAP = 60;

export const watchedKey = (id, type) => `${type}_${id}`;

// Seconds → ms, tolerating the three shapes watchedAt can take: a Firestore
// Timestamp, the {seconds} mirror written on a local mark, and a bare number.
export function firstPlayMs(entry) {
  const at = entry?.watchedAt;
  if (!at) return 0;
  if (typeof at === 'number') return at;
  if (typeof at.toMillis === 'function') return at.toMillis();
  return +(at.seconds || 0) * 1000;
}

/** How many times a title has been seen. 0 when it is not marked watched at all. */
export function playCount(key) {
  const entry = state.watched[key];
  if (!entry) return 0;
  const n = Math.floor(+entry.plays || 0);
  return n > 0 ? n : 1;          // absent/garbage `plays` still means one viewing
}

/**
 * Every play date we know about, oldest first, in ms.
 * Shorter than `playCount` for legacy entries and for titles past the cap — the
 * count is the truth, this is the detail we happen to have.
 */
export function playDates(key) {
  const entry = state.watched[key];
  if (!entry) return [];
  const stored = Array.isArray(entry.playDates) ? entry.playDates.map(Number).filter(n => n > 0) : [];
  if (stored.length) return [...stored].sort((a, b) => a - b);
  const first = firstPlayMs(entry);
  return first ? [first] : [];
}

export function lastPlayMs(key) {
  const dates = playDates(key);
  return dates.length ? dates[dates.length - 1] : 0;
}

export const isRewatched = (key) => playCount(key) > 1;

/**
 * Log another viewing. Returns the new play count, or 0 if the title is not
 * marked watched (there is no such thing as a rewatch of something unwatched —
 * the caller should mark it watched instead).
 */
export async function logPlay(id, type, when = Date.now()) {
  const key = watchedKey(id, type);
  const entry = state.watched[key];
  if (!state.user || !entry) return 0;

  const plays = playCount(key) + 1;
  const dates = [...playDates(key), Math.floor(when)].sort((a, b) => a - b).slice(-PLAY_CAP);
  const patch = { plays, playDates: dates, lastPlayedAt: dates[dates.length - 1] };

  await db.collection('users').doc(state.user.uid).collection('watched').doc(key)
    .set(patch, { merge: true });
  state.watched[key] = { ...entry, ...patch };
  bumpLibrary();
  return plays;
}

/**
 * Undo the most recent rewatch. Never drops below one play — removing the
 * *original* viewing is "unmark as watched", a different action with different
 * consequences (episode progress, ratings), and it lives in watchlist.js.
 */
export async function removeLastPlay(id, type) {
  const key = watchedKey(id, type);
  const entry = state.watched[key];
  if (!state.user || !entry) return 0;
  const current = playCount(key);
  if (current <= 1) return 1;

  const plays = current - 1;
  const dates = playDates(key).slice(0, -1);
  const patch = { plays, playDates: dates, lastPlayedAt: dates[dates.length - 1] || firstPlayMs(entry) };

  await db.collection('users').doc(state.user.uid).collection('watched').doc(key)
    .set(patch, { merge: true });
  state.watched[key] = { ...entry, ...patch };
  bumpLibrary();
  return plays;
}

// Rewatches are a library mutation like any other. Announcing it the same way
// every other writer does refreshes the cards on screen AND advances the
// sign-in cache version, with no direct dependency on either.
function bumpLibrary() {
  document.dispatchEvent(new Event('cv:wl-changed'));
}

/**
 * Everything the stats page and the profile need, computed in one pass.
 * `runtimeOf` is injected so the caller decides how a title's length is measured
 * (stats.js reads the episode ledger for TV); omit it and time is left at 0.
 */
export function rewatchSummary({ runtimeOf = null } = {}) {
  const entries = Object.entries(state.watched);
  let titles = 0, totalPlays = 0, rewatchedTitles = 0, extraPlays = 0, extraMinutes = 0, timedTitles = 0;
  const ranked = [];

  for (const [key, entry] of entries) {
    const plays = playCount(key);
    if (!plays) continue;
    titles++; totalPlays += plays;
    const extra = plays - 1;
    if (extra > 0) {
      rewatchedTitles++; extraPlays += extra;
      const minutes = runtimeOf ? +runtimeOf(entry, key) || 0 : 0;
      if (minutes > 0) { extraMinutes += minutes * extra; timedTitles++; }
      ranked.push({
        key, plays, extra,
        title: entry.title || '',
        poster: entry.poster || '',
        type: entry.type || String(key).split('_')[0],
        id: +(entry.tmdbId || String(key).split('_').pop() || 0),
        last: lastPlayMs(key),
      });
    }
  }

  ranked.sort((a, b) => b.plays - a.plays || b.last - a.last || a.title.localeCompare(b.title));
  return {
    titles, totalPlays, rewatchedTitles, extraPlays,
    // Share of the library that has been returned to at least once.
    rewatchRate: titles ? (rewatchedTitles / titles) * 100 : 0,
    // Share of all viewings that were repeats — the "comfort viewing" figure.
    repeatShare: totalPlays ? (extraPlays / totalPlays) * 100 : 0,
    extraMinutes, timedTitles,
    top: ranked.slice(0, 12),
  };
}

/** Rewatches logged inside the last `days` days. Powers the activity pulse. */
export function rewatchesSince(days, now = Date.now()) {
  const cutoff = now - days * 86400000;
  let count = 0;
  for (const key of Object.keys(state.watched)) {
    if (playCount(key) < 2) continue;
    // Skip index 0: the first viewing is not a rewatch.
    const dates = playDates(key);
    for (let i = 1; i < dates.length; i++) if (dates[i] >= cutoff && dates[i] <= now) count++;
  }
  return count;
}

export function playLabel(key) {
  const n = playCount(key);
  if (n <= 1) return 'Seen once';
  if (n === 2) return 'Seen twice';
  return `Seen ${n} times`;
}
