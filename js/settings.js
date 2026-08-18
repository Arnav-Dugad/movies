// ===== SETTINGS PAGE (/settings) =====
import { state } from './state.js';
import { $, toast, esc } from './ui.js';
import { registerActions } from './events.js';
import { REGIONS } from './config.js';
import { prefs, updatePref, resetPrefs, preferencePayload } from './prefs.js';
import { db } from './firebase.js';

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
  const regionOpts = REGIONS.map(([code, label]) => `<option value="${code}" ${code === state.region ? 'selected' : ''}>${esc(label)}</option>`).join('');
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
        <section class="settings-panel"><div class="settings-panel-head">${ICONS.shield}<div><span>Region</span><h2>Streaming home</h2></div></div><label class="settings-select-row stacked"><span><strong>Where to Watch region</strong><small>Controls provider availability on details pages.</small></span><select id="settingsRegion" class="watched-select" data-action="settings-region">${regionOpts}</select></label></section>
        <section class="settings-panel settings-vault"><div class="settings-panel-head">${ICONS.data}<div><span>Collection vault</span><h2>Backup & restore</h2></div></div><p>Download lists, memberships, watched history, ratings and profile showcase data in one readable JSON file.</p><div class="settings-vault-actions"><button class="btn-primary" data-action="download-backup">Download backup</button><button class="btn-glass" data-action="choose-backup">Restore backup</button></div><div class="settings-vault-actions"><button class="btn-glass" data-action="download-watched">Export watched only</button><button class="btn-glass" data-action="choose-watched-import">Import watched only</button></div><small>Every restore safely merges data and never deletes newer cloud records.</small></section>
        <section class="settings-panel settings-maintenance"><div class="settings-panel-head">${ICONS.data}<div><span>Device data</span><h2>Maintenance</h2></div></div><button data-action="clear-search-history"><span>Clear search history</span><b>Clear</b></button><button data-action="clear-recent-history"><span>Clear recently viewed</span><b>Clear</b></button><button data-action="reset-experience"><span>Reset experience settings</span><b>Reset</b></button><button data-action="sign-out"><span>Sign out on this device</span><b>Sign out</b></button></section>
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
  });
  document.addEventListener('cv:prefs', event => { if (!event.detail?.cloud) queueCloudSettings(); });
}
