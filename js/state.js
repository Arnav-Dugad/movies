// ===== CENTRAL STATE =====
export const state = {
  user: null,
  watchlist: [],
  ratings: {},
  watched: {},
  heroItems: [],
  heroIdx: 0,
  heroTimer: null,
  heroPaused: false,
  searchFilt: 'multi',
  mPg: 1, tPg: 1,
  mGenre: '', tGenre: '',
  cdIntervals: [],
  wlFilter: 'all',
  watchedFilter: 'all',
  searchHistory: [],
  recentlyViewed: [],
  region: 'IN',
  // Loaded from users/{uid} on sign-in: { avatar: {emoji,grad}|null, created }.
  profile: { avatar: null, created: null },
  lists: [],          // custom lists metadata (loaded by lists.js)
  wlList: 'all',      // active chip on the My List page ('all' | 'watched' | listId)
};

// ===== LOOKUP HELPERS =====
export function inWL(id, type){return state.watchlist.some(w => w.id === `${type}_${id}`);}
export function isWatched(id, type){return !!state.watched[`${type}_${id}`];}

// ===== RECENTLY VIEWED (per user, localStorage) =====
export function loadRecentlyViewed() {
  const uid = state.user ? state.user.uid : 'guest';
  try { state.recentlyViewed = JSON.parse(localStorage.getItem('cv_recent_' + uid) || '[]'); }
  catch (e) { state.recentlyViewed = []; }
}
export function pushRecentlyViewed(item) {
  if (!item || !item.id) return;
  const uid = state.user ? state.user.uid : 'guest';
  state.recentlyViewed = state.recentlyViewed.filter(r => !(r.id === item.id && r.type === item.type));
  state.recentlyViewed.unshift({
    id: item.id, type: item.type,
    title: item.title, poster: item.poster || '',
    genres: item.genres || [], ts: Date.now()
  });
  state.recentlyViewed = state.recentlyViewed.slice(0, 20);
  try { localStorage.setItem('cv_recent_' + uid, JSON.stringify(state.recentlyViewed)); } catch (e) {}
}
