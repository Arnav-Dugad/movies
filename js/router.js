// ===== ROUTER (History API, clean URLs) =====
import { $, forceUnlockScroll } from './ui.js';
import { registerActions } from './events.js';
import { loadMovies, loadTV } from './browse.js';
import { renderWL } from './watchlist.js';
import { initDiscover } from './discover.js';
import { renderStats } from './stats.js';
import { renderPersonalRows } from './home.js';
import { openSearch } from './search.js';
import { openDetail, closeDetail, openCollection } from './detail.js';
import { openPerson } from './person.js';
import { openCompare } from './compare.js';
import { closeRating, isRatingOpen } from './ratings.js';
import { closeTrailer, isTrailerOpen } from './media.js';
import { closeCmdk, isCmdkOpen } from './cmdk.js';
import { closeAuth, isAuthOpen } from './auth.js';

// Every route maps to one page-container element id and a render function.
// render() must be safe to call again with the same params.
const ROUTES = [
  { test: /^\/$/, page: 'homePage', render: () => {} },
  { test: /^\/movies\/?$/, page: 'moviesPage', render: () => loadMovies() },
  { test: /^\/tv\/?$/, page: 'tvPage', render: () => loadTV() },
  { test: /^\/discover\/?$/, page: 'discoverPage', render: () => initDiscover() },
  { test: /^\/watchlist\/?$/, page: 'wlPage', render: () => renderWL() },
  { test: /^\/stats\/?$/, page: 'statsPage', render: () => renderStats() },
  { test: /^\/search\/?$/, page: 'searchPage', render: (p, query) => openSearch(query.get('q') || '') },
  { test: /^\/movie\/(\d+)\/?$/, page: 'detailPage', render: (p) => openDetail(+p[0], 'movie') },
  { test: /^\/tv\/(\d+)\/?$/, page: 'detailPage', render: (p) => openDetail(+p[0], 'tv') },
  { test: /^\/person\/(\d+)\/?$/, page: 'personPage', render: (p) => openPerson(+p[0]) },
  { test: /^\/collection\/(\d+)\/?$/, page: 'detailPage', render: (p) => openCollection(+p[0]) },
  { test: /^\/compare\/?$/, page: 'detailPage', render: () => openCompare() },
];

const TITLES = {
  homePage: 'CineVerse — Discover Movies & TV',
  moviesPage: 'Movies — CineVerse',
  tvPage: 'TV Shows — CineVerse',
  discoverPage: 'Discover — CineVerse',
  wlPage: 'My List — CineVerse',
  statsPage: 'My Stats — CineVerse',
  searchPage: 'Search — CineVerse',
  detailPage: 'CineVerse',
  personPage: 'CineVerse',
};

const PAGE_TO_PATH = { home: '/', movies: '/movies', tv: '/tv', watchlist: '/watchlist', discover: '/discover', stats: '/stats', search: '/search' };

let currentPath = null;

function getBase() {
  const baseEl = document.querySelector('base');
  return baseEl ? new URL(baseEl.href).pathname.replace(/\/$/, '') : '';
}
const BASE = getBase();

function fullPath(path) { return BASE + path; }
function stripBase(pathname) {
  if (BASE && pathname.startsWith(BASE)) return pathname.slice(BASE.length) || '/';
  return pathname;
}

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
  if (isCmdkOpen()) closeCmdk();
  if (isTrailerOpen()) closeTrailer();
  if (isRatingOpen()) closeRating();
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

export function navigate(path, { replace = false } = {}) {
  const full = fullPath(path);
  if (replace) history.replaceState({ path }, '', full);
  else history.pushState({ path }, '', full);
  renderRoute(path);
}

export function goHome() { navigate('/'); }

function pageToPath(page) { return page === 'home' ? '/' : (PAGE_TO_PATH[page] || '/'); }

function handleEscape() {
  if (isCmdkOpen()) return closeCmdk();
  if (isTrailerOpen()) return closeTrailer();
  if (isRatingOpen()) return closeRating();
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
    else if (currentPath === '/stats') renderStats();
    renderPersonalRows();
  };
  document.addEventListener('cv:auth', refresh);
  document.addEventListener('cv:wl-changed', refresh);
  document.addEventListener('cv:navigate', e => navigate(pageToPath(e.detail)));

  window.addEventListener('popstate', () => {
    renderRoute(stripBase(location.pathname), { isPopState: true });
  });

  // Nav scroll state + back-to-top visibility.
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    $('navbar').classList.toggle('scrolled', y > 60);
    $('btt').classList.toggle('show', y > 600);
  }, { passive: true });

  // Escape still dismisses the remaining true modals (auth/trailer/rating/
  // cmdk/profile dropdown) — standard modal UX, not a "shortcut" feature.
  document.addEventListener('keydown', e => { if (e.key === 'Escape') handleEscape(); });

  // Initial load — <head> restore script has already fixed location.pathname
  // (and appended <base>) before this module even started executing.
  renderRoute(stripBase(location.pathname), { scroll: false });
}
