// ===== ROUTER + GLOBAL SHORTCUTS =====
import { $, forceUnlockScroll } from './ui.js';
import { registerActions } from './events.js';
import { loadMovies, loadTV } from './browse.js';
import { renderWL } from './watchlist.js';
import { initDiscover, randomPick } from './discover.js';
import { renderStats } from './stats.js';
import { renderPersonalRows } from './home.js';
import { openSearch, closeSearch, isSearchOpen } from './search.js';
import { closeDetail, isDetailOpen } from './detail.js';
import { closePerson, isPersonOpen } from './person.js';
import { closeRating, isRatingOpen } from './ratings.js';
import { closeTrailer, isTrailerOpen } from './media.js';
import { openCmdk, closeCmdk, isCmdkOpen } from './cmdk.js';
import { closeAuth, isAuthOpen } from './auth.js';
import { toggleCinema } from './prefs.js';

const PAGES = ['homePage', 'moviesPage', 'tvPage', 'wlPage', 'discoverPage', 'statsPage'];
const PAGE_MAP = { home: 'homePage', movies: 'moviesPage', tv: 'tvPage', watchlist: 'wlPage', discover: 'discoverPage', stats: 'statsPage' };
let currentPage = 'home';

export function showPage(page) {
  currentPage = page;
  PAGES.forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
  document.querySelectorAll('.nav-link,.mob-item[data-page]').forEach(l => l.classList.toggle('active', l.dataset.page === page));
  const el = $(PAGE_MAP[page]);
  if (el) { el.style.display = 'block'; el.classList.remove('page-transition'); void el.offsetWidth; el.classList.add('page-transition'); }
  switch (page) {
    case 'movies': loadMovies(); break;
    case 'tv': loadTV(); break;
    case 'watchlist': renderWL(); break;
    case 'discover': initDiscover(); break;
    case 'stats': renderStats(); break;
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
export function goHome() { showPage('home'); }

function toggleKB() { $('kbOv').classList.toggle('active'); }

function handleEscape() {
  if (isCmdkOpen()) return closeCmdk();
  if ($('kbOv').classList.contains('active')) return toggleKB();
  if (isTrailerOpen()) return closeTrailer();
  if (isRatingOpen()) return closeRating();
  if (isPersonOpen()) return closePerson();
  if (isDetailOpen()) return closeDetail();
  if (isSearchOpen()) return closeSearch();
  if (isAuthOpen()) return closeAuth();
  const dd = $('profileDD'); if (dd && dd.classList.contains('active')) dd.classList.remove('active');
}

export function initRouter() {
  registerActions({
    'show-page': (el) => showPage(el.dataset.page),
    'go-home': () => goHome(),
    'toggle-kb': () => toggleKB(),
    'back-to-top': () => window.scrollTo({ top: 0, behavior: 'smooth' }),
  });

  // Re-render data-dependent pages when auth or lists change.
  const refresh = () => {
    if (currentPage === 'watchlist') renderWL();
    else if (currentPage === 'stats') renderStats();
    renderPersonalRows();
  };
  document.addEventListener('cv:auth', refresh);
  document.addEventListener('cv:wl-changed', refresh);
  document.addEventListener('cv:navigate', e => showPage(e.detail));

  // Close shortcuts modal on backdrop click.
  const kb = $('kbOv');
  kb.addEventListener('click', e => { if (e.target === kb) toggleKB(); });

  // Nav scroll state + back-to-top visibility.
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    $('navbar').classList.toggle('scrolled', y > 60);
    $('btt').classList.toggle('show', y > 600);
  }, { passive: true });

  // Global keyboard shortcuts.
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); isCmdkOpen() ? closeCmdk() : openCmdk(); return; }
    if (e.key === 'Escape') { handleEscape(); return; }
    if (e.target.closest('input,textarea,select')) return;
    if (e.key === '/') { e.preventDefault(); openSearch(); return; }
    if (e.key === '?' || (e.shiftKey && e.key === '/')) { toggleKB(); return; }
    const k = e.key.toLowerCase();
    if (k === 'h') showPage('home');
    else if (k === 'm') showPage('movies');
    else if (k === 't') showPage('tv');
    else if (k === 'w') showPage('watchlist');
    else if (k === 'd') showPage('discover');
    else if (k === 's') showPage('stats');
    else if (k === 'r') { showPage('discover'); setTimeout(() => randomPick('movie'), 300); }
    else if (k === 'c') toggleCinema();
  });

  // Swipe-to-close for detail & person overlays (mobile).
  attachSwipeClose('detailOv', closeDetail);
  attachSwipeClose('personOv', closePerson);
}

function attachSwipeClose(id, closeFn) {
  const ov = $(id); if (!ov) return;
  let startX = 0, startY = 0, tracking = false;
  ov.addEventListener('touchstart', e => {
    // Only start a close-swipe near the top of the overlay content.
    if (ov.scrollTop > 40) { tracking = false; return; }
    startX = e.touches[0].clientX; startY = e.touches[0].clientY; tracking = true;
  }, { passive: true });
  ov.addEventListener('touchend', e => {
    if (!tracking) return; tracking = false;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (dy > 90 && Math.abs(dx) < 80) closeFn();
  }, { passive: true });
}
