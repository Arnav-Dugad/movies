// ===== ROUTER (History API, clean URLs) =====
import { $, forceUnlockScroll } from './ui.js';
import { registerActions } from './events.js';
import { loadMovies, loadTV } from './browse.js';
import { renderWL } from './watchlist.js';
import { renderWatched } from './watched.js';
import { initDiscover } from './discover.js';
import { renderStats } from './stats.js';
import { renderPersonalRows } from './home.js';
import { openSearch } from './search.js';
import { openDetail, closeDetail, openCollection } from './detail.js';
import { openPerson } from './person.js';
import { openStudio } from './studio.js';
import { openCollection2 } from './collection.js';
import { openSharedList } from './shared-list.js';
import { closeRating, isRatingOpen } from './ratings.js';
import { closeListPicker, isListPickerOpen } from './lists.js';
import { closeTrailer, isTrailerOpen, closeLightbox, isLightboxOpen } from './media.js';
import { closeAuth, isAuthOpen, closeDelete, isDeleteOpen } from './auth.js';
import { renderFriends } from './friends.js';
import { renderParty } from './party.js';
import { renderProfile } from './profile.js';
import { renderSettings } from './settings.js';

// Set when the watchlist/ratings change while we're NOT on home, so home can
// re-render its personal rows lazily on arrival instead of every list toggle
// re-running renderPersonalRows() (which re-blasts skeletons and refetches).
let personalDirty = false;

// Every route maps to one page-container element id and a render function.
// render() must be safe to call again with the same params.
const ROUTES = [
  { test: /^\/$/, page: 'homePage', render: () => { if (personalDirty) { personalDirty = false; renderPersonalRows(); } } },
  { test: /^\/movies\/?$/, page: 'moviesPage', render: () => loadMovies() },
  { test: /^\/tv\/?$/, page: 'tvPage', render: () => loadTV() },
  { test: /^\/discover\/?$/, page: 'discoverPage', render: () => initDiscover() },
  { test: /^\/watchlist\/?$/, page: 'wlPage', render: () => renderWL() },
  { test: /^\/watched\/?$/, page: 'watchedPage', render: () => renderWatched() },
  { test: /^\/stats\/?$/, page: 'statsPage', render: () => renderStats() },
  { test: /^\/search\/?$/, page: 'searchPage', render: (p, query) => openSearch(query.get('q') || '') },
  { test: /^\/friends\/?$/, page: 'friendsPage', render: () => renderFriends() },
  { test: /^\/party\/?$/, page: 'partyPage', render: () => renderParty() },
  { test: /^\/profile\/?$/, page: 'profilePage', render: () => renderProfile() },
  { test: /^\/settings\/?$/, page: 'settingsPage', render: () => renderSettings() },
  { test: /^\/movie\/(\d+)\/?$/, page: 'detailPage', render: (p) => openDetail(+p[0], 'movie') },
  { test: /^\/tv\/(\d+)\/?$/, page: 'detailPage', render: (p) => openDetail(+p[0], 'tv') },
  { test: /^\/person\/(\d+)\/?$/, page: 'personPage', render: (p) => openPerson(+p[0]) },
  { test: /^\/studio\/(\d+)\/?$/, page: 'studioPage', render: (p) => openStudio(+p[0], 'company') },
  { test: /^\/network\/(\d+)\/?$/, page: 'studioPage', render: (p) => openStudio(+p[0], 'network') },
  { test: /^\/shared-list\/([\w-]+)\/([\w-]+)\/?$/, page: 'sharedListPage', render: (p) => openSharedList(p[0], p[1]) },
  { test: /^\/collection\/(\d+)\/?$/, page: 'detailPage', render: (p) => openCollection(+p[0]) },
  // Curated home-row collection — a section id (letters, so it never collides with
  // the numeric TMDB-collection route above).
  { test: /^\/collection\/([\w-]+)\/?$/, page: 'collectionPage', render: (p) => openCollection2(p[0]) },
];

const TITLES = {
  homePage: 'CineVerse — Discover Movies & TV',
  moviesPage: 'Movies — CineVerse',
  tvPage: 'TV Shows — CineVerse',
  discoverPage: 'Discover — CineVerse',
  wlPage: 'My List — CineVerse',
  watchedPage: 'Watched — CineVerse',
  statsPage: 'My Stats — CineVerse',
  searchPage: 'Search — CineVerse',
  friendsPage: 'Friends — CineVerse',
  partyPage: 'Watch Party — CineVerse',
  profilePage: 'Profile — CineVerse',
  settingsPage: 'Settings — CineVerse',
  detailPage: 'CineVerse',
  personPage: 'CineVerse',
  studioPage: 'CineVerse',
  collectionPage: 'CineVerse',
  sharedListPage: 'Shared List — CineVerse',
};

const PAGE_TO_PATH = { home: '/', movies: '/movies', tv: '/tv', watchlist: '/watchlist', watched: '/watched', discover: '/discover', stats: '/stats', search: '/search', friends: '/friends', party: '/party', profile: '/profile', settings: '/settings' };

let currentPath = null;

function matchRoute(path) {
  for (const r of ROUTES) {
    const m = path.match(r.test);
    if (m) return { route: r, params: m.slice(1) };
  }
  return null;
}

// Close every modal that isn't part of the routed-page system. Called on
// every navigation — this is the structural fix for "close search first":
// navigating away from search is just navigating, there's nothing left to
// coordinate since search is a real page now, not an overlay.
function closeAllModals() {
  if (isTrailerOpen()) closeTrailer();
  if (isLightboxOpen()) closeLightbox();
  if (isRatingOpen()) closeRating();
  if (isListPickerOpen()) closeListPicker();
  if (isDeleteOpen()) closeDelete();
  if (isAuthOpen()) closeAuth();
  const dd = $('profileDD'); if (dd) dd.classList.remove('active');
  forceUnlockScroll();
}

function renderRoute(path, { isPopState = false, scroll = true } = {}) {
  const query = new URL(location.href).searchParams;
  const match = matchRoute(path) || matchRoute('/');
  const { route, params } = match;

  closeDetail(); // clears any running countdown intervals
  closeAllModals();

  currentPath = path;

  document.querySelectorAll('.page-container').forEach(el => { el.style.display = 'none'; });
  document.querySelectorAll('.nav-link,.mob-item[data-page]').forEach(l => {
    const p = l.dataset.page === 'home' ? '/' : PAGE_TO_PATH[l.dataset.page];
    l.classList.toggle('active', p === path);
  });

  const el = $(route.page);
  if (el) { el.style.display = 'block'; el.classList.remove('page-transition'); void el.offsetWidth; el.classList.add('page-transition'); }

  route.render(params, query);
  document.title = TITLES[route.page] || TITLES.homePage;

  if (scroll) window.scrollTo({ top: 0, behavior: isPopState ? 'auto' : 'smooth' });
}

// Progressive enhancement: on browsers with the View Transitions API, wrap the
// page swap so shared elements (a card poster tagged view-transition-name:cv-hero
// → the detail scaffold poster) morph with zero layout shift. Elsewhere it's a
// plain synchronous render (falls back to the CSS .page-transition fade).
function runRender(path, opts) {
  if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const t = document.startViewTransition(() => renderRoute(path, opts));
    // After the morph, drop any lingering shared name so the next transition is clean.
    t.finished.finally(() => { document.querySelectorAll('[style*="view-transition-name"]').forEach(el => { el.style.viewTransitionName = ''; }); }).catch(() => {});
  } else {
    renderRoute(path, opts);
  }
}

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({ path }, '', path);
  else history.pushState({ path }, '', path);
  runRender(path);
}

export function goHome() { navigate('/'); }

function pageToPath(page) { return page === 'home' ? '/' : (PAGE_TO_PATH[page] || '/'); }

function handleEscape() {
  // Innermost-first: the lightbox can be opened from the detail page, so it must
  // be dismissed before anything underneath it.
  if (isLightboxOpen()) return closeLightbox();
  if (isTrailerOpen()) return closeTrailer();
  if (isRatingOpen()) return closeRating();
  if (isListPickerOpen()) return closeListPicker();
  if (isDeleteOpen()) return closeDelete();
  if (isAuthOpen()) return closeAuth();
  const dd = $('profileDD'); if (dd && dd.classList.contains('active')) dd.classList.remove('active');
}

export function initRouter() {
  registerActions({
    'show-page': (el) => navigate(pageToPath(el.dataset.page)),
    'go-home': () => navigate('/'),
    'back-to-top': () => window.scrollTo({ top: 0, behavior: 'smooth' }),
    'back': () => { if (history.state && history.length > 1) history.back(); else navigate('/'); },
  });

  // Cards everywhere (buildCard/personCard) never changed their markup — they
  // still emit data-action="open-detail"/"open-person". Those two handlers
  // (in detail.js/person.js) dispatch this event instead of rendering
  // directly, avoiding a circular import between router.js and detail/person.
  document.addEventListener('cv:go', e => navigate(e.detail));

  // Re-render data-dependent pages when auth or lists change.
  const refresh = () => {
    if (currentPath === '/watchlist') renderWL();
    else if (currentPath === '/watched') renderWatched();
    else if (currentPath === '/stats') renderStats();
    else if (currentPath === '/friends') renderFriends();
    else if (currentPath === '/party') renderParty();
    else if (currentPath === '/profile') renderProfile();
    else if (currentPath === '/settings') renderSettings();
    // Only rebuild the home rows when they're actually on screen; otherwise flag
    // them so home's own render picks it up on arrival. Home's route render is a
    // no-op by design, which is why this can't simply be dropped.
    if (currentPath === '/') renderPersonalRows(); else personalDirty = true;
  };
  document.addEventListener('cv:auth', refresh);
  document.addEventListener('cv:wl-changed', refresh);
  // The meta backfill lands asynchronously and unlocks real hours/director data.
  document.addEventListener('cv:meta-backfilled', refresh);
  document.addEventListener('cv:navigate', e => navigate(pageToPath(e.detail)));

  window.addEventListener('popstate', () => {
    runRender(location.pathname, { isPopState: true });
  });

  // Nav scroll state + back-to-top visibility.
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    const nav = $('navbar'), btt = $('btt');
    if (nav) nav.classList.toggle('scrolled', y > 60);
    if (btt) btt.classList.toggle('show', y > 600);
  }, { passive: true });

  // Escape still dismisses the remaining true modals (auth / trailer / rating /
  // profile dropdown) — standard modal UX.
  document.addEventListener('keydown', e => { if (e.key === 'Escape') handleEscape(); });

  // Initial load — Vercel serves index.html for deep links (see vercel.json),
  // so location.pathname is already the real route.
  renderRoute(location.pathname, { scroll: false });
}
