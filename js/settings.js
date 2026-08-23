// ===== SETTINGS PAGE (/settings) =====
import { state } from './state.js';
import { $, toast, esc } from './ui.js';
import { registerActions } from './events.js';
import { REGIONS, regionLabel } from './config.js';
import { prefs, updatePref, resetPrefs, preferencePayload } from './prefs.js';
import { db } from './firebase.js';
import { clearLibraryCache, flushLibraryVersion, libraryCacheDisabled } from './library-cache.js';
import { loadWatchlist, loadWatched } from './watchlist.js';
import { loadRatings } from './ratings.js';
import { loadLists } from './lists.js';
import { loadEpisodeProgress, repairEpisodeProgress } from './episodes.js';
import { loadMovieProgress } from './movie-progress.js';

let cloudSyncTimer = null;

function queueCloudSettings() {
  if (!state.user) return;
  const uid = state.user.uid;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(async () => {
    if (!state.user || state.user.uid !== uid) return;
    try {
      await db.collection('users').doc(uid).set({ experiencePrefs: preferencePayload({ region: state.region }) }, { merge: true });
    } catch (error) { console.warn('settings sync', error); }
  }, 1200);
}

const ICONS = {
  palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h4a5 5 0 0 0 0-10h-4Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="10" cy="6.5" r="1"/><circle cx="15" cy="7" r="1"/></svg>',
  motion: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 3 14 9-14 9V3Z"/><path d="M9 8v8"/></svg>',
  discover: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/></svg>',
  data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 20 7v5c0 5-3 8-8 10-5-2-8-5-8-10V7l8-4Z"/><path d="m9 12 2 2 4-4"/></svg>',
};

const toggle = (key, title, sub, checked) => `<label class="settings-switch-row"><span><strong>${title}</strong><small>${sub}</small></span><input type="checkbox" data-action="settings-toggle" data-pref="${key}" ${checked ? 'checked' : ''}><i></i></label>`;
const select = (key, title, sub, options, value) => `<label class="settings-select-row"><span><strong>${title}</strong><small>${sub}</small></span><select class="watched-select" data-action="settings-pref" data-pref="${key}">${options.map(([v, label]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;

export function renderSettings() {
  const ct = $('settingsContent'); if (!ct) return;
  if (!state.user) {
    ct.innerHTML = `<div class="wl-empty" style="padding:40px 20px"><h3>Sign in to change settings</h3><p>Your experience controls and collection vault live here.</p><br><button class="btn-primary" data-action="open-auth">Sign In</button></div>`;
    return;
  }
  const regionOpts = [...REGIONS].sort((a, b) => a[1].localeCompare(b[1]))
    .map(([code]) => `<option value="${code}" ${code === state.region ? 'selected' : ''}>${esc(regionLabel(code))}</option>`).join('');
  ct.innerHTML = `<div class="settings-shell">
    <section class="settings-premium-hero"><div><span>Experience control</span><h2>Make the universe yours.</h2><p>Fine-tune the look, motion, discovery signals and privacy of CineVerse. Changes apply instantly and sync efficiently to your account.</p></div><b>${ICONS.palette}</b></section>
    <div class="settings-layout">
      <main>
        <section class="settings-panel"><div class="settings-panel-head">${ICONS.palette}<div><span>Appearance</span><h2>Cinematic interface</h2></div></div>
          ${select('density', 'Content density', 'Choose roomy cards or fit more on screen.', [['comfortable', 'Comfortable'], ['compact', 'Compact']], prefs.density)}
          ${select('textSize', 'Text size', 'Increase interface text without zooming the page.', [['standard', 'Standard'], ['large', 'Large']], prefs.textSize)}
          ${select('glass', 'Glass effects', 'Control glow and translucent surface intensity.', [['rich', 'Rich cinema glass'], ['quiet', 'Quiet and focused']], prefs.glass)}
          ${toggle('highContrast', 'High-contrast type', 'Brighten supporting text and borders for easier reading.', prefs.highContrast)}
          ${toggle('compactNav', 'Compact navigation', 'Use a tighter desktop navigation bar with more breathing room below.', prefs.compactNav)}
        </section>
        <section class="settings-panel poster-controls"><div class="settings-panel-head">${ICONS.palette}<div><span>Home posters</span><h2>Poster controls</h2></div></div>
          ${toggle('cleanHomePosters', 'Clean posters', 'Hide every badge and action from homepage artwork.', prefs.cleanHomePosters)}
          ${toggle('posterCommunityRating', 'Community rating', 'Show the TMDB score on homepage posters.', prefs.posterCommunityRating)}
          ${toggle('posterPersonalRating', 'Your rating', 'Show your own score on homepage posters.', prefs.posterPersonalRating)}
          ${toggle('posterWatchedMark', 'Watched mark', 'Show the watched check on homepage posters.', prefs.posterWatchedMark)}
          ${toggle('posterListButton', 'Add to list', 'Show the list button when a homepage poster is hovered.', prefs.posterListButton)}
          ${toggle('posterRateButton', 'Quick rating', 'Show the quick-rate button for watched titles.', prefs.posterRateButton)}
          ${toggle('posterMatchBadge', 'Match badge', 'Show personalized match percentages.', prefs.posterMatchBadge)}
          ${toggle('posterProviderLogo', 'Streaming logo', 'Show subscription provider logos.', prefs.posterProviderLogo)}
          ${toggle('posterDismissButton', 'Not interested', 'Show the recommendation dismissal button.', prefs.posterDismissButton)}
          ${toggle('posterPreview', 'Hover previews', 'Expand homepage posters into muted landscape trailers on desktop.', prefs.posterPreview)}
        </section>
        <section class="settings-panel"><div class="settings-panel-head">${ICONS.motion}<div><span>Motion & playback</span><h2>Atmosphere</h2></div></div>
          ${select('motion', 'Interface motion', 'Respect your system, force full motion, or reduce it.', [['system', 'Use system setting'], ['full', 'Full cinematic motion'], ['reduced', 'Reduced motion']], prefs.motion)}
          ${toggle('autoplay', 'Ambient hero previews', 'Play muted trailer backgrounds where available.', prefs.autoplay)}
          ${toggle('backdropArt', 'Decorative backdrop art', 'Show cinematic artwork behind heroes and profile identity.', prefs.backdropArt)}
          ${toggle('posterTilt', 'Poster depth effect', 'Let posters respond with a subtle premium hover tilt.', prefs.posterTilt)}
        </section>
        <section class="settings-panel"><div class="settings-panel-head">${ICONS.discover}<div><span>Discovery</span><h2>Signals and spoilers</h2></div></div>
          ${toggle('showRatings', 'Community ratings', 'Show TMDB scores on posters and hero slides.', prefs.showRatings)}
          ${toggle('showWatched', 'Watched artwork marks', 'Show the green watched treatment on posters.', prefs.showWatched)}
          ${toggle('spoilerShield', 'Spoiler shield', 'Blur long summaries until you hover or focus them.', prefs.spoilerShield)}
        </section>
        <section class="settings-panel settings-mature"><div class="settings-panel-head">${ICONS.shield}<div><span>Content</span><h2>Maturity</h2></div></div>
          <details class="settings-mature-disclosure"${prefs.mature ? ' open' : ''}>
            <summary>Mature content${prefs.mature ? ' <b>On</b>' : ''}</summary>
            <div class="settings-mature-body">
              <p>Off by default. While it is off, adult titles are excluded from every search and Discover request and nothing about this appears anywhere in the app.</p>
              ${toggle('mature', 'Show mature content', 'Adds an After Dark section to Discover with erotic, softcore, and sensual collections, and includes adult results in search.', prefs.mature)}
              ${prefs.mature ? toggle('matureBlur', 'Blur mature artwork', 'Posters in the After Dark section stay blurred until you hover or focus them.', prefs.matureBlur) : ''}
              <small>Collections are built from TMDB keywords, not a genre — TMDB has no erotic genre. Titles you save can be kept in a PIN-locked list from the + button on any poster.</small>
            </div>
          </details>
        </section>
        <section class="settings-panel"><div class="settings-panel-head">${ICONS.data}<div><span>Detail pages</span><h2>Section defaults</h2></div></div>
          ${toggle('detailBoxOfficeExpanded', 'Open Box Office', 'Show the financial intelligence panel expanded by default.', prefs.detailBoxOfficeExpanded)}
          ${toggle('detailGalleryExpanded', 'Open Gallery', 'Show backdrop and poster artwork expanded by default.', prefs.detailGalleryExpanded)}
          ${toggle('detailReviewsExpanded', 'Open Reviews', 'Show community reviews expanded by default.', prefs.detailReviewsExpanded)}
        </section>
        <section class="settings-panel settings-privacy"><div class="settings-panel-head">${ICONS.shield}<div><span>Privacy</span><h2>Your visibility, your choice</h2></div></div>
          ${toggle('rememberSearch', 'Remember searches', 'Keep recent searches only on this device.', prefs.rememberSearch)}
          ${toggle('rememberViewed', 'Remember recently viewed', 'Save recently opened titles only on this device.', prefs.rememberViewed)}
          ${toggle('discoverable', 'Find me by name', 'Allow signed-in people to find your public profile by name.', prefs.discoverable)}
          ${toggle('shareTaste', 'Friend taste matching', 'Let friends compare a derived taste summary, never raw history.', prefs.shareTaste)}
          <div class="settings-privacy-note">Raw ratings, watched history and private lists are never published to friends.</div>
        </section>
      </main>
      <aside>
        <section class="settings-panel"><div class="settings-panel-head">${ICONS.shield}<div><span>Region</span><h2>Streaming home</h2></div></div><label class="settings-select-row stacked"><span><strong>Where to Watch region</strong><small>Controls provider availability across details, notifications, and provider intelligence. ${REGIONS.length} countries, from JustWatch via TMDB.</small></span><select id="settingsRegion" class="watched-select" data-action="settings-region">${regionOpts}</select></label></section>
        <section class="settings-panel settings-vault"><div class="settings-panel-head">${ICONS.data}<div><span>Collection vault</span><h2>Backup & restore</h2></div></div><p>Download lists, memberships, watched history, ratings and profile showcase data in one readable JSON file.</p><div class="settings-vault-actions"><button class="btn-primary" data-action="download-backup">Download backup</button><button class="btn-glass" data-action="choose-backup">Restore backup</button></div><div class="settings-vault-actions"><button class="btn-glass" data-action="download-watched">Export watched only</button><button class="btn-glass" data-action="choose-watched-import">Import watched only</button></div><div class="settings-vault-actions"><button class="btn-glass" data-action="open-import">Import from Letterboxd, Trakt or IMDb</button></div><small>Every restore safely merges data and never deletes newer cloud records.</small></section>
        <section class="settings-panel settings-maintenance"><div class="settings-panel-head">${ICONS.data}<div><span>Device data</span><h2>Maintenance</h2></div></div><button class="episode-repair-action" data-action="repair-episode-progress"><span><strong>Episode Progress Repair</strong><small data-repair-status>Rebuild old history and refresh tracked shows.</small></span><b>Repair</b></button><button data-action="clear-search-history"><span>Clear search history</span><b>Clear</b></button><button data-action="clear-recent-history"><span>Clear recently viewed</span><b>Clear</b></button><button data-action="refresh-library"><span>Refresh library from cloud</span><b>Refresh</b></button><button data-action="reset-experience"><span>Reset experience settings</span><b>Reset</b></button><button data-action="sign-out"><span>Sign out on this device</span><b>Sign out</b></button></section>
        <section class="settings-panel settings-danger"><span>Danger zone</span><h2>Delete account</h2><p>Permanently remove the account and its private collection.</p><button class="del-confirm" data-action="open-delete">Delete account</button></section>
      </aside>
    </div>
  </div>`;
}

function clearSearchHistory() {
  state.searchHistory = [];
  if (state.user) { try { localStorage.removeItem('cv_history_' + state.user.uid); } catch (_) {} }
}

export function initSettings() {
  registerActions({
    'settings-region': el => { state.region = el.value; try { localStorage.setItem('cv_region', state.region); } catch (_) {} queueCloudSettings(); document.dispatchEvent(new Event('cv:region')); toast('Streaming region updated', 'success'); },
    'settings-toggle': el => {
      const key = el.dataset.pref;
      updatePref(key, !!el.checked);
      if (key === 'rememberSearch' && !el.checked) clearSearchHistory();
      // The panel itself changes shape (the blur option only exists while mature
      // is on), and Discover has a whole section to add or remove.
      if (key === 'mature' || key === 'matureBlur') {
        document.dispatchEvent(new Event('cv:mature'));
        if (key === 'mature') { renderSettings(); toast(el.checked ? 'Mature content is on' : 'Mature content is hidden', el.checked ? 'success' : 'info'); }
        return;
      }
      if (key === 'rememberViewed' && !el.checked) {
        state.recentlyViewed = [];
        try { localStorage.removeItem(`cv_recent_${state.user?.uid || 'guest'}`); } catch (_) {}
      }
      if (key === 'discoverable' || key === 'shareTaste') document.dispatchEvent(new Event('cv:privacy'));
      toast('Preference saved', 'success');
    },
    'settings-pref': el => { updatePref(el.dataset.pref, el.value); toast('Preference saved', 'success'); },
    'clear-search-history': () => { clearSearchHistory(); toast('Search history cleared', 'info'); },
    'clear-recent-history': () => { state.recentlyViewed = []; try { localStorage.removeItem(`cv_recent_${state.user?.uid || 'guest'}`); } catch (_) {} toast('Recently viewed cleared', 'info'); },
    'reset-experience': () => { resetPrefs(); document.dispatchEvent(new Event('cv:privacy')); renderSettings(); toast('Experience settings reset', 'success'); },
    'repair-episode-progress': async el => {
      if (!state.user || el.disabled) return;
      const label = el.querySelector('b'), status = el.querySelector('[data-repair-status]');
      el.disabled = true;
      if (label) label.textContent = 'Working…';
      try {
        const result = await repairEpisodeProgress({ onProgress: progress => {
          if (!status || !el.isConnected) return;
          status.textContent = progress.phase === 'refresh'
            ? `Refreshing shows ${progress.completed}/${progress.total}`
            : `Rebuilding history ${progress.completed}/${progress.total}`;
        } });
        if (status) status.textContent = `${result.repaired} histories rebuilt · ${result.refreshed} shows refreshed`;
        document.dispatchEvent(new Event('cv:wl-changed'));
        toast(result.failed ? `Repair finished with ${result.failed} item${result.failed === 1 ? '' : 's'} to retry` : 'Episode progress repaired', result.failed ? 'info' : 'success');
      } catch (error) {
        console.error('episode progress repair', error);
        if (status) status.textContent = 'Could not finish. Your existing progress is safe.';
        toast('Episode repair could not finish — try again', 'error');
      } finally {
        el.disabled = false;
        if (label) label.textContent = 'Repair';
      }
    },
    // The escape hatch for the sign-in cache (js/library-cache.js). Signing in
    // normally skips the collection reads when the version says nothing changed;
    // this drops that snapshot so the next load reads everything again. Kept for
    // the one case a version counter cannot cover — a doubt about it.
    'refresh-library': async (el) => {
      if (!state.user) return;
      const label = el.querySelector('b');
      const before = label ? label.textContent : '';
      if (label) label.textContent = 'Refreshing…';
      el.disabled = true;
      flushLibraryVersion();
      clearLibraryCache(state.user.uid);
      try {
        await Promise.all([loadWatchlist(), loadRatings(), loadWatched(), loadLists(), loadEpisodeProgress(), loadMovieProgress()]);
        document.dispatchEvent(new Event('cv:wl-changed'));
        toast(libraryCacheDisabled() ? 'Library reloaded' : 'Library reloaded from the cloud', 'success');
      } catch (error) {
        console.error('refresh-library', error);
        toast('Could not reach the cloud — try again', 'error');
      } finally {
        el.disabled = false;
        if (label) label.textContent = before;
      }
    },
  });
  document.addEventListener('cv:prefs', event => { if (!event.detail?.cloud) queueCloudSettings(); });
}
