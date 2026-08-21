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
  profile: { avatar: null, created: null, headline: '', bio: '', location: '', favoriteFilm: '', favoriteFilmId: null, favoriteFilmPoster: '', pinnedBadges: [], onboarded: false, seedGenres: [] },
  // Loaded with the profile root doc, so recommendation controls cost no extra
  // Firestore read. History is capped before every write (recommend.js).
  recommendationFeedback: { dismissed: [], history: [], rotation: 0, lastRecommendationActivityAt: 0, lastRotatedAt: 0 },
  notificationRead: [],
  notificationPreferences: { episodes: true, releases: true, streaming: true, departures: true, providerChanges: true, push: false, sound: false, mutedItems: [], mutedProviders: [], snoozed: {}, dismissed: [], updatedAt: 0 },
  providerHistory: { region: 'IN', snapshots: {}, changes: [], samples: [], updatedAt: 0 },
  // The latest compact stats snapshot is loaded by the same owner-only profile
  // read. Stats can reuse slower-changing insights without another Firestore read.
  statsSnapshot: null,
  // Which Stats sections are collapsed, keyed by block id. Mirrored onto the
  // owner profile doc so the layout follows the account, not the device.
  statsSections: {},
  lists: [],          // custom lists metadata (loaded by lists.js)
  wlList: 'watchlist',   // active chip on the My List page ('watched' | listId; defaults to the Watchlist list)
  // PIN-locked lists that have been opened during THIS page session. Deliberately
  // not persisted: reloading CineVerse always re-locks. Lives here (not in
  // list-lock.js) so lists.js can honour it without importing that module back.
  unlockedLists: new Set(),
  // Per-episode TV progress, keyed `tv_<id>`. Loaded from users/{uid}/progress
  // on sign-in and mirrored to localStorage so the Continue Watching rail can
  // paint before the network answers. See js/episodes.js.
  episodeProgress: {},
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
        rotation: Math.max(0, +(saved.rotation || 0)),
        lastRecommendationActivityAt: Math.max(0, +(saved.lastRecommendationActivityAt || 0)),
        lastRotatedAt: Math.max(0, +(saved.lastRotatedAt || 0)),
      };
    } catch (_) { state.recommendationFeedback = { dismissed: [], history: [], rotation: 0, lastRecommendationActivityAt: 0, lastRotatedAt: 0 }; }
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
    genres: item.genres || [], keywords: (item.keywords || []).slice(0, 15), ts: Date.now()
  });
  state.recentlyViewed = state.recentlyViewed.slice(0, 20);
  try { localStorage.setItem('cv_recent_' + uid, JSON.stringify(state.recentlyViewed)); } catch (e) {}
}
