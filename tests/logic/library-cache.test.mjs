// The sign-in cache skips four library collection reads when a counter on the profile
// document says nothing has changed. The property that makes that safe to rely
// on: a false MISS is possible and harmless, a false HIT is impossible.
//
// A false hit would need this device's counter to exceed the server's, which
// cannot happen — the local number is only ever advanced by this device's own
// increments, and any other device's write pushes the server ahead of it. These
// tests pin that, plus the three guards around it: the dirty flag, the expiry,
// and the size ceiling.
import { check, summary } from './harness.mjs';

// Resolved from this file so the suite runs from any checkout, on any OS.
const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const cache = await import(SRC + 'library-cache.js');

const UID = 'user-1';
const KEY = `cv_lib_cache_v1_${UID}`;
const DIRTY = `cv_lib_dirty_v1_${UID}`;

const wipe = () => { localStorage.removeItem(KEY); localStorage.removeItem(DIRTY); };
const stored = () => { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; };

function seedLibrary() {
  state.user = { uid: UID };
  state.watchlist = [{ id: 'movie_1', title: 'A' }, { id: 'tv_2', title: 'B' }];
  state.watched = { movie_3: { tmdbId: 3, type: 'movie', title: 'C' } };
  state.ratings = { movie_3: 8 };
  state.lists = [{ id: 'watchlist', name: 'Watchlist' }];
}
const emptyLibrary = () => { state.watchlist = []; state.watched = {}; state.ratings = {}; state.lists = []; };

// ================= a round trip restores exactly what was stored ============
wipe(); cache.clearLibraryCache(UID); seedLibrary();
check('writing a cache at a real version succeeds', cache.writeCache(UID, 5) === true);
check('and the stored snapshot carries that version', stored().version === 5, stored()?.version);
check('and it is tied to the account it came from', stored().uid === UID);
check('writing clears the dirty flag', localStorage.getItem(DIRTY) === null);

emptyLibrary();
check('hydrating reports the version it holds', cache.hydrateFromCache(UID) === 5, cache.hydrateFromCache(UID));
check('the watchlist comes back', state.watchlist.length === 2, state.watchlist.length);
check('the watched map comes back', Object.keys(state.watched).length === 1);
check('ratings come back', state.ratings.movie_3 === 8);
check('lists come back', state.lists.length === 1);
check('the in-memory version tracks the cache', cache.currentLibraryVersion() === 5);

// ================= the guards ==============================================
check('another account cannot read this snapshot', cache.hydrateFromCache('someone-else') === 0);
check('and no uid at all reads nothing', cache.hydrateFromCache('') === 0);

localStorage.setItem(DIRTY, '1');
check('a dirty flag forces a full read even with a valid snapshot', cache.hydrateFromCache(UID) === 0);
localStorage.removeItem(DIRTY);
check('clearing the flag makes it usable again', cache.hydrateFromCache(UID) === 5);

// A snapshot with no version can never match a server version, so it is refused
// outright rather than being compared.
seedLibrary();
cache.writeCache(UID, 5);
localStorage.setItem(KEY, JSON.stringify({ ...stored(), version: 0 }));
check('a snapshot with no version is refused', cache.hydrateFromCache(UID) === 0);

cache.writeCache(UID, 5);
localStorage.setItem(KEY, JSON.stringify({ ...stored(), at: Date.now() - 8 * 86400000 }));
check('a snapshot older than seven days is refused', cache.hydrateFromCache(UID) === 0);

cache.writeCache(UID, 5);
localStorage.setItem(KEY, JSON.stringify({ ...stored(), at: Date.now() + 86400000 }));
check('a snapshot dated in the future is refused', cache.hydrateFromCache(UID) === 0,
  'a clock that jumped back must not make a stale snapshot look fresh');

localStorage.setItem(KEY, '{ not json');
check('unreadable storage is refused rather than throwing', cache.hydrateFromCache(UID) === 0);

// ================= a version we cannot establish is forgotten ==============
// Keeping the old belief would let a later increment build on a number the
// server never had, which is the one way a false hit could be manufactured.
wipe(); cache.clearLibraryCache(UID); seedLibrary();
cache.writeCache(UID, 9);
check('a real version is remembered', cache.currentLibraryVersion() === 9);
check('writing at version 0 is refused', cache.writeCache(UID, 0) === false);
check('and the remembered version is dropped, not kept', cache.currentLibraryVersion() === 0,
  cache.currentLibraryVersion());
check('a negative version is refused too', cache.writeCache(UID, -3) === false);

// ================= the size ceiling ========================================
wipe(); cache.clearLibraryCache(UID);
state.user = { uid: UID };
emptyLibrary();
// Comfortably past the 3 MB ceiling.
for (let i = 0; i < 4000; i++) {
  state.watched[`movie_${i}`] = { tmdbId: i, type: 'movie', title: 'x'.repeat(900), genres: [1, 2, 3] };
}
check('a library too large to store is refused', cache.writeCache(UID, 4) === false);
check('and nothing is left behind to be read back', localStorage.getItem(KEY) === null);
check('the cache reports itself disabled', cache.libraryCacheDisabled() === true);
check('further writes stay refused while disabled', cache.writeCache(UID, 5) === false);
cache.clearLibraryCache(UID);
check('clearing the cache re-enables it', cache.libraryCacheDisabled() === false);

// ================= sign-out ================================================
wipe(); cache.clearLibraryCache(UID); seedLibrary();
cache.writeCache(UID, 11);
cache.resetLibraryRuntime();
check('a session ending forgets the counter', cache.currentLibraryVersion() === 0);
check('but keeps the snapshot for the next sign-in', stored() !== null && stored().version === 11);
check('which is still usable', cache.hydrateFromCache(UID) === 11);

cache.clearLibraryCache(UID);
check('an explicit clear removes the snapshot', stored() === null);
check('and the dirty flag with it', localStorage.getItem(DIRTY) === null);
check('leaving nothing to hydrate', cache.hydrateFromCache(UID) === 0);

// ================= bumping ==================================================
wipe(); cache.clearLibraryCache(UID); seedLibrary();
state.user = null;
cache.bumpLibraryVersion();
check('a bump with nobody signed in does nothing', localStorage.getItem(DIRTY) === null);

state.user = { uid: UID };
cache.writeCache(UID, 2);
cache.bumpLibraryVersion();
check('a bump marks the cache dirty immediately', localStorage.getItem(DIRTY) === '1',
  'the flag is set before the write is attempted, so a lost increment costs a read rather than showing stale data');
check('and a dirty cache is not trusted until the increment lands',
  cache.hydrateFromCache(UID) === 0);

summary();
