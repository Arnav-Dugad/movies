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
  profile: { avatar: null, created: null, headline: '', bio: '', location: '', favoriteFilm: '', favoriteFilmId: null, favoriteFilmPoster: '', pinnedBadges: [] },
  // Loaded with the profile root doc, so recommendation controls cost no extra
  // Firestore read. History is capped before every write (recommend.js).
  recommendationFeedback: { dismissed: [], history: [] },
  notificationRead: [],
  notificationPreferences: { episodes: true, releases: true, streaming: true, providerChanges: true, mutedItems: [], mutedProviders: [], updatedAt: 0 },
  providerHistory: { region: 'IN', snapshots: {}, changes: [], updatedAt: 0 },
  // The latest compact stats snapshot is loaded by the same owner-only profile
  // read. Stats can reuse slower-changing insights without another Firestore read.
  statsSnapshot: null,
  lists: [],          // custom lists metadata (loaded by lists.js)
  wlList: 'watchlist',   // active chip on the My List page ('watched' | listId; defaults to the Watchlist list)
};

// ===== LOOKUP HELPERS =====
export function inWL(id, type){return state.watchlist.some(w => w.id === `${type}_${id}`);}
export function isWatched(id, type){return !!state.watched[`${type}_${id}`];}

// ===== RECENTLY VIEWED (per user, localStorage) =====
export function loadRecentlyViewed() {
  const uid = state.user ? state.user.uid : 'guest';
  if (document.documentElement.dataset.rememberViewed === 'off') state.recentlyViewed = [];
  else try { state.recentlyViewed = JSON.parse(localStorage.getItem('cv_recent_' + uid) || '[]'); }
  catch (e) { state.recentlyViewed = []; }
  if (!state.user) {
    try {
      const saved = JSON.parse(localStorage.getItem('cv_rec_feedback_guest') || '{}');
      state.recommendationFeedback = {
        dismissed: Array.isArray(saved.dismissed) ? saved.dismissed : [],
        history: Array.isArray(saved.history) ? saved.history : [],
      };
    } catch (_) { state.recommendationFeedback = { dismissed: [], history: [] }; }
  }
}
export function pushRecentlyViewed(item) {
  if (!item || !item.id) return;
  if (document.documentElement.dataset.rememberViewed === 'off') return;
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
