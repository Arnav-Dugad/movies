// ===== APP BOOTSTRAP =====
import { $ } from './ui.js';
import { initDelegation } from './events.js';
import { initImageFallback } from './cards.js';
import { loadPrefs } from './prefs.js';
import { initAuth } from './auth.js';
import { initWatchlist } from './watchlist.js';
import { initWatched } from './watched.js';
import { initRatings } from './ratings.js';
import { initMedia } from './media.js';
import { initPerson } from './person.js';
import { initDetail } from './detail.js';
import { initBrowse, initFilters } from './browse.js';
import { initDiscoverActions } from './discover.js';
import { initHome, initHomeActions } from './home.js';
import { initHero, initHeroInteractions } from './hero.js';
import { initSearch } from './search.js';
import { initStats } from './stats.js';
import { initSocial } from './social.js';
import { initFriends } from './friends.js';
import { initParty } from './party.js';
import { initProfile } from './profile.js';
import { initSettings } from './settings.js';
import { initRouter } from './router.js';
import { initEffects } from './effects.js';
import { initHScroll } from './hscroll.js';
import { initBadges } from './badges.js';
import { initWatchedMeta } from './watched-meta.js';
import { cleanupServiceWorker } from './pwa.js';

function hideLoader() { const l = $('loader'); if (l) l.classList.add('hidden'); }

async function init() {
  loadPrefs();

  // Wire delegation + all action handlers before any content renders.
  initDelegation();
  initImageFallback();
  initAuth();
  initWatchlist();
  initWatched();
  initRatings();
  initMedia();
  initPerson();
  initDetail();
  initBrowse();
  initDiscoverActions();
  initHomeActions();
  initHeroInteractions();
  initSearch();
  initStats();
  initSocial();
  initFriends();
  initParty();
  initProfile();
  initSettings();
  initWatchedMeta();
  // initEffects BEFORE initRouter: initRouter ends with a synchronous renderRoute(),
  // and observeReveals() silently no-ops while its IntersectionObserver is null —
  // any .reveal rendered on that first synchronous pass would stay at opacity:0
  // forever. Nothing in initEffects depends on the router.
  initEffects();
  initHScroll();
  // initBadges BEFORE initRouter too: both listen on `document` for cv:wl-changed,
  // and same-target listeners fire in registration order. Badges must sync (ledger +
  // recentUnlocks) before the router's refresh renders stats, so a freshly-unlocked
  // badge paints with its pulse on the same tick.
  initBadges();
  initRouter();
  cleanupServiceWorker();

  // Load initial content; hide loader once hero + home settle (max 4s fallback).
  const ready = Promise.allSettled([initHero(), initHome()]);
  initFilters();
  const timeout = new Promise(r => setTimeout(r, 4000));
  await Promise.race([ready, timeout]);
  hideLoader();
}

init();
