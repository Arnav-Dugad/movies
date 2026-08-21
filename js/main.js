// ===== APP BOOTSTRAP =====
import { $ } from './ui.js';
import { initDelegation } from './events.js';
import { initImageFallback, initCardSync } from './cards.js';
import { loadPrefs } from './prefs.js';
import { initAuth } from './auth.js';
import { initWatchlist, toggleWatched } from './watchlist.js';
import { onShowComplete } from './episodes.js';
import { initLists } from './lists.js';
import { initListLock } from './list-lock.js';
import { initWatched } from './watched.js';
import { initRatings } from './ratings.js';
import { initMedia } from './media.js';
import { initPerson } from './person.js';
import { initStudio } from './studio.js';
import { initCollection } from './collection.js';
import { initSharedList } from './shared-list.js';
import { initDetail } from './detail.js';
import { initBrowse, initFilters } from './browse.js';
import { initDiscoverActions } from './discover.js';
import { initHome, initHomeActions } from './home.js';
import { initHero, initHeroInteractions } from './hero.js';
import { initSearch } from './search.js';
import { initVoice } from './voice.js';
import { initStats } from './stats.js';
import { initSocial } from './social.js';
import { initFriends } from './friends.js';
import { initParty } from './party.js';
import { initProfile } from './profile.js';
import { initSettings } from './settings.js';
import { initReleaseReminders } from './release-reminders.js';
import { initRouter } from './router.js';
import { initEffects } from './effects.js';
import { initHScroll } from './hscroll.js';
import { initBadges } from './badges.js';
import { initWatchedMeta } from './watched-meta.js';
import { cleanupServiceWorker } from './pwa.js';
import { initRecommendations } from './recommend.js';
import { initBackups } from './backup.js';
import { initImportCSV } from './import-csv.js';
import { initAwards } from './awards.js';
import { initProviderBadges } from './provider-badges.js';
import { initNotifications } from './notifications.js';

function hideLoader() { window.__cvBooted = true; const l = $('loader'); if (l) l.classList.add('hidden'); }

async function init() {
  loadPrefs();

  // Wire delegation + all action handlers before any content renders.
  initDelegation();
  initImageFallback();
  initCardSync();
  initProviderBadges();
  initNotifications();
  initAuth();
  initWatchlist();
  // Ticking the final aired episode finishes the show, so the watched list,
  // stats, and badges agree with what the user just did instead of leaving a
  // 100%-complete show marked unwatched.
  onShowComplete((id, meta, progress) => {
    toggleWatched(id, 'tv', meta.title || 'TV show', {
      poster: meta.poster || '', episodeCount: progress.aired,
      runtime: (meta.episodeRuntime || 0) * progress.aired,
      episodeRuntime: meta.episodeRuntime || 0,
    });
  });
  initLists();
  initListLock();
  initWatched();
  initRatings();
  initMedia();
  initPerson();
  initStudio();
  initCollection();
  initSharedList();
  initDetail();
  initBrowse();
  initDiscoverActions();
  initHomeActions();
  initRecommendations();
  initHeroInteractions();
  initSearch();
  initVoice();
  initStats();
  initSocial();
  initFriends();
  initParty();
  initProfile();
  initSettings();
  initBackups();
  initImportCSV();
  initAwards();
  initReleaseReminders();
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
