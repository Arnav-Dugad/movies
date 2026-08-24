// ===== LIVE PRIVATE LIBRARY SYNC =====
// The local cache remains a fast first paint, never a correctness gate. These
// listeners make watched titles, lists and ratings converge while both devices
// are open, and Firestore only bills changed documents after the initial read.
import { db } from './firebase.js';
import { state } from './state.js';

let stops = [];
let announceTimer = null;

function stopAll() {
  stops.forEach(stop => { try { stop(); } catch (_) {} });
  stops = [];
  clearTimeout(announceTimer); announceTimer = null;
}

function announce() {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => document.dispatchEvent(new Event('cv:library-sync')), 45);
}

// Firestore's first onSnapshot delivery contains every document even when the
// authoritative sign-in read has already put the exact same data in state. A
// deep, stable comparison keeps that acknowledgement from repainting Home four
// times (watchlist, watched, ratings and lists) during the opening animation.
function stable(value) {
  if (value == null || typeof value !== 'object') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (Array.isArray(value)) return value.map(stable);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
const unchanged = (before, after) => JSON.stringify(stable(before)) === JSON.stringify(stable(after));

export function initLibraryRealtime() {
  document.addEventListener('cv:auth', () => {
    stopAll();
    const uid = state.user?.uid;
    if (!uid) return;
    const root = db.collection('users').doc(uid);
    const listen = (query, apply, label) => {
      stops.push(query.onSnapshot(snapshot => {
        if (state.user?.uid !== uid) return;
        if (apply(snapshot) !== false) announce();
      }, error => console.warn(`${label} live sync`, error)));
    };
    listen(root.collection('watchlist').orderBy('added', 'desc'), snapshot => {
      const next = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (unchanged(state.watchlist, next)) return false;
      state.watchlist = next; return true;
    }, 'watchlist');
    listen(root.collection('watched'), snapshot => {
      const next = Object.fromEntries(snapshot.docs.map(doc => [doc.id, doc.data()]));
      if (unchanged(state.watched, next)) return false;
      state.watched = next; return true;
    }, 'watched');
    listen(root.collection('ratings'), snapshot => {
      const next = Object.fromEntries(snapshot.docs.map(doc => [doc.id, +doc.data().score || 0]));
      if (unchanged(state.ratings, next)) return false;
      state.ratings = next; return true;
    }, 'ratings');
    listen(root.collection('lists'), snapshot => {
      // An empty list collection is only the short first-use/offline window;
      // loadLists seeds the non-deletable defaults. Do not flash them away.
      if (snapshot.empty) return;
      const next = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => (+a.order || 0) - (+b.order || 0) || String(a.name || '').localeCompare(String(b.name || '')));
      if (unchanged(state.lists, next)) return false;
      state.lists = next; return true;
    }, 'lists');
  });
}
