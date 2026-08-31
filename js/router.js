// ===== ROUTER (History API, clean URLs) =====
import { $, forceUnlockScroll } from './ui.js';
import { registerActions } from './events.js';
import { loadMovies, loadTV } from './browse.js';
import { renderWL } from './watchlist.js';
import { renderWatched } from './watched.js';
import { initDiscover } from './discover.js';
import { renderStats } from './stats.js';
import { renderPersonalRows } from './home.js';
import { renderFranchisePage } from './franchise-page.js';
import { renderBoxOfficePage } from './box-office-page.js';
import { openSearch } from './search.js';
import { stopVoiceSearch } from './voice.js';
import { openDetail, closeDetail, openCollection } from './detail.js';
import { openPerson } from './person.js';
import { openStudio } from './studio.js';
import { openCollection2 } from './collection.js';
import { SECTIONS } from './home.js';
import { openSharedList } from './shared-list.js';
import { openCollabPage, closeCollabPage } from './collab-page.js';
import { closeRating, isRatingOpen } from './ratings.js';
import { closeListPicker, isListPickerOpen } from './lists.js';
import { closePinModal, isPinModalOpen } from './list-lock.js';
import { closeImport, isImportOpen } from './import-csv.js';
import { closeTrailer, isTrailerOpen, closeLightbox, isLightboxOpen, closeSpoilerShare, isSpoilerShareOpen } from './media.js';
import { closeAuth, isAuthOpen, closeDelete, isDeleteOpen } from './auth.js';
import { renderFriends } from './friends.js';
import { renderParty } from './party.js';
import { renderProfile } from './profile.js';
import { renderSettings } from './settings.js';
import { renderReleaseReminders } from './release-reminders.js';
import { closeScanner, isScannerOpen } from './scan.js';
import { renderNotifications, closeNotificationDropdown, isNotificationDropdownOpen, stopNotificationCountdowns } from './notifications.js';

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
  { test: /^\/reminders\/?$/, page: 'remindersPage', render: () => renderReleaseReminders() },
  { test: /^\/franchises\/?$/, page: 'franchisesPage', render: () => renderFranchisePage() },
  { test: /^\/box-office\/?$/, page: 'boxOfficePage', render: () => renderBoxOfficePage() },
  { test: /^\/notifications\/?$/, page: 'notificationsPage', render: () => renderNotifications() },
  { test: /^\/watchlist\/?$/, page: 'wlPage', render: () => renderWL() },
  { test: /^\/watched\/?$/, page: 'watchedPage', render: () => renderWatched() },
  { test: /^\/stats\/?$/, page: 'statsPage', render: () => renderStats() },
  { test: /^\/search\/?$/, page: 'searchPage', render: (p, query) => openSearch(query.get('q') || '', { forceTag: query.get('tag') === '1' }) },
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
  { test: /^\/collab\/([\w-]+)\/?$/, page: 'collabPage', render: (p) => openCollabPage(p[0]) },
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
  remindersPage: 'Release Reminders — CineVerse',
  franchisesPage: 'Franchises — CineVerse',
  boxOfficePage: 'Highest Grossing Movies — CineVerse',
  notificationsPage: 'Notifications — CineVerse',
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
  collabPage: 'Shared List — CineVerse',
};

const PAGE_TO_PATH = { home: '/', movies: '/movies', tv: '/tv', watchlist: '/watchlist', watched: '/watched', discover: '/discover', reminders: '/reminders', franchises: '/franchises', 'box-office': '/box-office', notifications: '/notifications', stats: '/stats', search: '/search', friends: '/friends', party: '/party', profile: '/profile', settings: '/settings' };

let currentPath = null;

// ===== "WHERE AM I NOW?" =====
// A page swap here changes no document, so a screen reader is given no signal
// that activating a link did anything at all. One polite announcement per
// navigation says where the user landed.
//
// Detail-style pages fetch their title, so announcing straight away would call
// every film "Title details". Those wait briefly for a real heading and fall
// back to the generic name if none arrives — one announcement either way, never
// a wrong one followed by a correction.
const ROUTE_NAMES = {
  homePage: 'Home', moviesPage: 'Movies', tvPage: 'TV Shows', discoverPage: 'Discover',
  remindersPage: 'Release Reminders', franchisesPage: 'Franchises', boxOfficePage: 'Box Office',
  notificationsPage: 'Notifications', wlPage: 'My List', watchedPage: 'Watched',
  statsPage: 'My Stats', searchPage: 'Search', friendsPage: 'Friends', partyPage: 'Watch Party',
  profilePage: 'Profile', settingsPage: 'Settings', detailPage: 'Title details',
  personPage: 'Person', studioPage: 'Studio', collectionPage: 'Collection',
  sharedListPage: 'Shared list',
  collabPage: 'Shared list',
};
const TITLED_LATER = new Set(['detailPage', 'personPage', 'studioPage', 'collectionPage', 'sharedListPage', 'collabPage']);
let announceTimer = null, announceTries = 0, firstRenderDone = false;

function announceRoute(pageId) {
  const region = $('routeAnnouncer');
  if (!region) return;
  clearTimeout(announceTimer);
  announceTries = 0;
  const fallback = ROUTE_NAMES[pageId] || 'Page';
  const heading = () => {
    const page = $(pageId);
    const found = page && page.querySelector('h1, .detail-title, .person-name, .browse-top h1');
    if (!found) return '';
    // A title with official artwork renders the logo image instead of words, so
    // the heading has no text at all. Its alt IS the title — and is already the
    // accessible name a screen reader would read here.
    const text = (found.textContent.replace(/\s+/g, ' ').trim()
      || found.querySelector('img[alt]')?.alt.replace(/\s+/g, ' ').trim() || '');
    return text.length > 1 && text.length < 120 ? text : '';
  };
  const say = name => {
    // Re-announce an identical string by clearing first; a live region ignores
    // a write that does not change its text.
    region.textContent = '';
    region.textContent = `${name}, page loaded`;
  };
  if (!TITLED_LATER.has(pageId)) return say(fallback);
  const poll = () => {
    const name = heading();
    if (name) return say(name);
    if (++announceTries >= 8) return say(fallback);   // ~2s, then say something
    announceTimer = setTimeout(poll, 250);
  };
  announceTimer = setTimeout(poll, 250);
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
  if (isTrailerOpen()) closeTrailer();
  if (isLightboxOpen()) closeLightbox();
  if (isSpoilerShareOpen()) closeSpoilerShare();
  if (isRatingOpen()) closeRating();
  if (isListPickerOpen()) closeListPicker();
  if (isPinModalOpen()) closePinModal();
  if (isImportOpen()) closeImport();
  if (isScannerOpen()) closeScanner();
  if (isDeleteOpen()) closeDelete();
  if (isAuthOpen()) closeAuth();
  if (isNotificationDropdownOpen()) closeNotificationDropdown();
  const dd = $('profileDD'); if (dd) dd.classList.remove('active');
  forceUnlockScroll();
}

function renderRoute(path, { isPopState = false, scroll = true } = {}) {
  const query = new URL(location.href).searchParams;
  const matched = matchRoute(path);
  // An unmatched path used to render home while the address bar kept the broken
  // URL: no nav item highlighted, refresh reloaded the same dead link, and
  // sharing it passed the problem on. Home is the right destination, so the URL
  // is corrected to say so.
  if (!matched && path !== '/') history.replaceState({ path: '/' }, '', '/' + location.search);
  const { route, params } = matched || matchRoute('/');
  path = matched ? path : '/';

  closeDetail(); // clears any running countdown intervals
  closeCollabPage(); // drops the shared-list listener when leaving that page
  closeAllModals();
  // The voice console is global now, but a live microphone must never outlive the
  // page that opened it — a voice command tears itself down before navigating.
  stopVoiceSearch();
  if (!/^\/notifications\/?$/.test(path)) stopNotificationCountdowns();

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
  // Not on the very first render: the document load already announced itself,
  // and "Home, page loaded" on top of that is noise.
  if (firstRenderDone) announceRoute(route.page); else firstRenderDone = true;

  if (scroll) window.scrollTo({ top: 0, behavior: isPopState ? 'auto' : 'smooth' });
}

// Progressive enhancement: on browsers with the View Transitions API, wrap the
// page swap so shared elements (a card poster tagged view-transition-name:cv-hero
// → the detail scaffold poster) morph with zero layout shift. Elsewhere it's a
// plain synchronous render (falls back to the CSS .page-transition fade).
function runRender(path, opts) {
  if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const t = document.startViewTransition(() => renderRoute(path, opts));
    // A navigation that starts before the previous morph finishes skips it, and
    // the skip rejects `ready` and `updateCallbackDone` as well as `finished`.
    // Only `finished` was handled, so browsing quickly logged an uncaught
    // "AbortError: Transition was skipped" for every interrupted transition.
    // Being interrupted is normal here, so all three are acknowledged.
    t.ready?.catch(() => {});
    t.updateCallbackDone?.catch(() => {});
    // After the morph, drop any lingering shared name so the next transition is clean.
    t.finished.finally(() => { document.querySelectorAll('[style*="view-transition-name"]').forEach(el => { el.style.viewTransitionName = ''; }); }).catch(() => {});
  } else {
    renderRoute(path, opts);
  }
}

// `path` may carry a query string ("/search?q=dune"): the URL bar keeps it, but
// route matching and the history state use the pathname alone, since every route
// pattern is anchored (^…$) and would otherwise fall through to home.
export function navigate(path, { replace = false } = {}) {
  const url = new URL(path, location.origin);
  const href = url.pathname + url.search;
  if (replace) history.replaceState({ path: url.pathname }, '', href);
  else history.pushState({ path: url.pathname }, '', href);
  runRender(url.pathname);
}

export function goHome() { navigate('/'); }

function pageToPath(page) { return page === 'home' ? '/' : (PAGE_TO_PATH[page] || '/'); }

function handleEscape() {
  // Innermost-first: the lightbox can be opened from the detail page, so it must
  // be dismissed before anything underneath it.
  if (isLightboxOpen()) return closeLightbox();
  if (isSpoilerShareOpen()) return closeSpoilerShare();
  if (isScannerOpen()) return closeScanner();
  if (isTrailerOpen()) return closeTrailer();
  if (isRatingOpen()) return closeRating();
  if (isListPickerOpen()) return closeListPicker();
  if (isPinModalOpen()) return closePinModal();
  if (isImportOpen()) return closeImport();
  if (isDeleteOpen()) return closeDelete();
  if (isAuthOpen()) return closeAuth();
  if (isNotificationDropdownOpen()) return closeNotificationDropdown();
  const dd = $('profileDD'); if (dd && dd.classList.contains('active')) dd.classList.remove('active');
}

export function initRouter() {
  registerActions({
    'show-page': (el) => { $('profileDD')?.classList.remove('active'); navigate(pageToPath(el.dataset.page)); },
    'go-home': () => navigate('/'),
    'back-to-top': () => window.scrollTo({ top: 0, behavior: 'smooth' }),
    // Which element is "the content" depends on the route, so it is found now
    // rather than pointed at a fixed id that only exists on one page.
    'skip-to-content': () => {
      const page = [...document.querySelectorAll('.page-container')].find(el => el.style.display !== 'none');
      if (!page) return;
      if (!page.hasAttribute('tabindex')) page.setAttribute('tabindex', '-1');
      page.focus({ preventScroll: true });
      page.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
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
    else if (currentPath === '/notifications') renderNotifications(true);
    else if (currentPath === '/reminders') renderReleaseReminders();
    // A curated page opened straight from a URL renders before Firebase has
    // resolved the account, so its watched marks describe an empty library. The
    // Top 10 countdown draws its own rows rather than standard cards, so the
    // shared card-mark refresh cannot reach them — the page has to rebuild.
    // Every TMDB response behind it is cached, so this costs no network.
    else if (currentPath.startsWith('/collection/')) {
      const id = currentPath.split('/')[2] || '';
      if (SECTIONS.some(section => section.id === id)) openCollection2(id);
      else if (/^\d+$/.test(id)) openCollection(+id);
    }
    // Only rebuild the home rows when they're actually on screen; otherwise flag
    // them so home's own render picks it up on arrival. Home's route render is a
    // no-op by design, which is why this can't simply be dropped.
    if (currentPath === '/') renderPersonalRows(); else personalDirty = true;
  };
  document.addEventListener('cv:auth', refresh);
  document.addEventListener('cv:wl-changed', refresh);
  document.addEventListener('cv:library-sync', refresh);
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
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { handleEscape(); return; }
    const tag = e.target?.tagName, typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;
    const commandSearch = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
    const slashSearch = e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (commandSearch || slashSearch) { e.preventDefault(); navigate('/search'); }
  });

  // Initial load — the host serves index.html for every client route (Vercel: the
  // "rewrites" block in vercel.json; Cloudflare Workers: assets.not_found_handling
  // in wrangler.jsonc), so location.pathname is already the real route. Without
  // that, deep links, shared URLs, and "open in new tab" 404 on that host.
  renderRoute(location.pathname, { scroll: false });
}
