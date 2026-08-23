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

export function initLibraryRealtime() {
  document.addEventListener('cv:auth', () => {
    stopAll();
    const uid = state.user?.uid;
    if (!uid) return;
    const root = db.collection('users').doc(uid);
    const listen = (query, apply, label) => {
      stops.push(query.onSnapshot(snapshot => {
        if (state.user?.uid !== uid) return;
        apply(snapshot); announce();
      }, error => console.warn(`${label} live sync`, error)));
    };
    listen(root.collection('watchlist').orderBy('added', 'desc'), snapshot => {
      state.watchlist = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }, 'watchlist');
    listen(root.collection('watched'), snapshot => {
      state.watched = Object.fromEntries(snapshot.docs.map(doc => [doc.id, doc.data()]));
    }, 'watched');
    listen(root.collection('ratings'), snapshot => {
      state.ratings = Object.fromEntries(snapshot.docs.map(doc => [doc.id, +doc.data().score || 0]));
    }, 'ratings');
    listen(root.collection('lists'), snapshot => {
      // An empty list collection is only the short first-use/offline window;
      // loadLists seeds the non-deletable defaults. Do not flash them away.
      if (snapshot.empty) return;
      state.lists = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => (+a.order || 0) - (+b.order || 0) || String(a.name || '').localeCompare(String(b.name || '')));
    }, 'lists');
  });
}
