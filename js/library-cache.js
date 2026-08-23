// ===== LIBRARY CACHE — fewer reads on sign-in =====
// Signing in read four whole library collections every time: watchlist, ratings,
// watched and lists. On a large library that is hundreds of document
// reads per page load to fetch data that had not changed since the last one.
//
// The fix is a version counter on the profile document — which sign-in already
// reads, so checking it is free. Every mutation increments it. On load we paint
// from a device cache immediately, then compare versions: equal means nothing has
// changed anywhere, and those four collection reads are skipped entirely.
// Episode progress is not versioned here: it always performs its own
// conflict-safe local/server merge, which removes a non-atomic dependency.
//
// WHY THIS CANNOT SERVE STALE DATA
// The local version is only ever advanced by our own increments, so it is always
// less than or equal to the server's (another device's write pushes the server
// ahead, never us). A false *miss* is therefore possible and harmless; a false
// *hit* would require our count to exceed the server's, which cannot happen. Three
// further guards cover the awkward cases: an increment that fails leaves a dirty
// flag that forces a full read until it lands, the cache expires after seven days
// regardless, and Settings has a manual refresh.
import { db, firebase } from './firebase.js';
import { state } from './state.js';

const CACHE_PREFIX = 'cv_lib_cache_v1_';
const DIRTY_PREFIX = 'cv_lib_dirty_v1_';
const MAX_AGE_MS = 7 * 86400000;
// localStorage is ~5 MB per origin and CineVerse keeps other things in it.
// A library too big to cache falls back to reading — slower, never wrong.
const MAX_BYTES = 3_000_000;
const BUMP_DELAY = 1200;   // coalesce a burst of edits into one increment

const cacheKey = uid => CACHE_PREFIX + uid;
const dirtyKey = uid => DIRTY_PREFIX + uid;

let bumpTimer = null;
let pendingBump = 0;       // increments waiting to be sent
let localVersion = 0;      // what we believe the server holds
let cacheDisabled = false; // set when this library will not fit

function readJSON(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
  catch (_) { return null; }
}

const isDirty = uid => { try { return localStorage.getItem(dirtyKey(uid)) === '1'; } catch (_) { return true; } };
const setDirty = (uid, on) => { try { on ? localStorage.setItem(dirtyKey(uid), '1') : localStorage.removeItem(dirtyKey(uid)); } catch (_) {} };

/** Forget the in-memory counters without deleting the stored snapshot. Used when
 *  a session ends on its own: the cache is still valid for the next sign-in. */
export function resetLibraryRuntime() {
  clearTimeout(bumpTimer); bumpTimer = null;
  pendingBump = 0; localVersion = 0; cacheDisabled = false;
}

/** Drop this device's cache entirely. Called on an explicit sign-out and by
 *  "Refresh library from cloud" in Settings. */
export function clearLibraryCache(uid) {
  cacheDisabled = false; localVersion = 0; pendingBump = 0;
  clearTimeout(bumpTimer); bumpTimer = null;
  if (!uid) return;
  try { localStorage.removeItem(cacheKey(uid)); localStorage.removeItem(dirtyKey(uid)); } catch (_) {}
}

/**
 * Paint from the device cache before the network answers, and report the version
 * it claims so the caller can decide whether a read is needed at all.
 * Returns 0 when there is nothing usable.
 */
export function hydrateFromCache(uid) {
  if (!uid || isDirty(uid)) return 0;
  const cached = readJSON(cacheKey(uid));
  if (!cached || cached.uid !== uid) return 0;
  if (!(cached.version > 0)) return 0;
  // A future-dated snapshot means the device clock moved backwards, and the
  // snapshot could be arbitrarily stale against the new clock — so it is refused
  // rather than trusted. A minute of tolerance covers ordinary clock skew.
  const age = Date.now() - +cached.at;
  if (!(age > -60000 && age < MAX_AGE_MS)) return 0;

  state.watchlist = Array.isArray(cached.watchlist) ? cached.watchlist : [];
  state.watched = cached.watched && typeof cached.watched === 'object' ? cached.watched : {};
  state.ratings = cached.ratings && typeof cached.ratings === 'object' ? cached.ratings : {};
  state.lists = Array.isArray(cached.lists) ? cached.lists : [];
  localVersion = cached.version;
  return cached.version;
}

/** Snapshot the four cached collections at the version the server now holds. */
export function writeCache(uid, version) {
  // No usable version means we know nothing about the server's counter; keeping
  // the old belief would let a later increment build on a number that was never
  // real. Forget it instead — the cost is one extra read.
  if (!(version > 0)) { localVersion = 0; return false; }
  if (!uid || cacheDisabled) return false;
  localVersion = version;
  try {
    const payload = JSON.stringify({
      uid, version, at: Date.now(),
      watchlist: state.watchlist, watched: state.watched,
      ratings: state.ratings, lists: state.lists,
    });
    if (payload.length > MAX_BYTES) { cacheDisabled = true; localStorage.removeItem(cacheKey(uid)); return false; }
    localStorage.setItem(cacheKey(uid), payload);
    setDirty(uid, false);
    return true;
  } catch (_) {
    // Quota, private mode, or storage disabled. Reading every time is correct,
    // just slower — never guess.
    cacheDisabled = true;
    try { localStorage.removeItem(cacheKey(uid)); } catch (__) {}
    return false;
  }
}

/**
 * Record that the library changed. Coalesced, because marking a season watched
 * fires many mutations in a second and they only need one increment between them.
 *
 * The dirty flag is set synchronously and cleared only when the increment lands,
 * so a bump lost to a closing tab or a dead connection costs this device one full
 * read next time instead of showing it stale data.
 */
export function bumpLibraryVersion() {
  const uid = state.user?.uid;
  if (!uid) return;
  pendingBump++;
  setDirty(uid, true);
  clearTimeout(bumpTimer);
  bumpTimer = setTimeout(() => flushBump(uid), BUMP_DELAY);
}

async function flushBump(uid) {
  bumpTimer = null;
  const n = pendingBump;
  if (!n || state.user?.uid !== uid) return;
  pendingBump = 0;
  try {
    await db.collection('users').doc(uid).set(
      { libraryVersion: firebase.firestore.FieldValue.increment(n) }, { merge: true });
    localVersion += n;
    // Re-snapshot at the new version so the very next load is a hit.
    writeCache(uid, localVersion);
  } catch (error) {
    pendingBump += n;               // keep it owed
    setDirty(uid, true);
    console.warn('libraryVersion bump failed', error);
  }
}

/** Send anything owed right now — on tab hide, and before sign-out. */
export function flushLibraryVersion() {
  const uid = state.user?.uid;
  if (uid && pendingBump) { clearTimeout(bumpTimer); flushBump(uid); }
}

export function initLibraryCache() {
  // Every module that writes to the library already announces it — watchlist,
  // watched, ratings, lists, backup restore, CSV import, and the metadata
  // backfill all end with `cv:wl-changed`. Episode progress deliberately has
  // its own local/server merge and never depends on this separate version.
  // Hooking the shared library event rather than each call site
  // means a write path added later is covered by the convention it already
  // follows, instead of by remembering to come back here.
  document.addEventListener('cv:wl-changed', bumpLibraryVersion);
  // pagehide fires on mobile tab kills where unload does not.
  addEventListener('pagehide', flushLibraryVersion);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushLibraryVersion(); });
}

/**
 * Called once after a full read. Establishes a version for accounts that predate
 * this file (they have no `libraryVersion`), so the *next* sign-in can be a hit.
 */
export async function ensureLibraryVersion(uid, serverVersion) {
  if (!uid) return 0;
  if (serverVersion > 0) return serverVersion;
  try {
    await db.collection('users').doc(uid).set({ libraryVersion: 1 }, { merge: true });
    return 1;
  } catch (_) { return 0; }
}

export const currentLibraryVersion = () => localVersion;
export const libraryCacheDisabled = () => cacheDisabled;
