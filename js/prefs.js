// ===== LOCAL EXPERIENCE PREFERENCES =====
// Personal UI choices apply device-local first for instant paint, then Settings
// mirrors one compact snapshot to the user's existing Firestore profile document.
import { state } from './state.js';
import { REGIONS } from './config.js';

const KEY = 'cv_experience_v2';
export const DEFAULT_PREFS = Object.freeze({
  density: 'comfortable', motion: 'system', autoplay: true,
  showRatings: true, showWatched: true, spoilerShield: false,
  rememberSearch: true, rememberViewed: true, discoverable: true, shareTaste: true,
  glass: 'rich', textSize: 'standard',
  backdropArt: true, posterTilt: true, highContrast: false, compactNav: false,
  cleanHomePosters: false, posterCommunityRating: true, posterPersonalRating: true,
  posterWatchedMark: true, posterListButton: true, posterRateButton: true,
  posterMatchBadge: true, posterProviderLogo: true, posterDismissButton: true, posterPreview: true,
  detailBoxOfficeExpanded: false, detailGalleryExpanded: false, detailReviewsExpanded: false,
  directorExcludeShorts: true, directorExcludeDocumentaries: true, directorExcludeUnreleased: true,
  // Mature content is OFF by default and leaves no trace in the UI until it is
  // turned on: no section, no chips, no badge, and include_adult stays false.
  mature: false, matureBlur: true,
});

export let prefs = { ...DEFAULT_PREFS };

// Every user-facing search and discover call passes this rather than a literal,
// so adult results can never leak in while the toggle is off — and turning it on
// does not require touching a dozen call sites.
export const adultFlag = () => !!prefs.mature;
let updatedAt = 0;

const allowed = {
  density: new Set(['comfortable', 'compact']),
  motion: new Set(['system', 'full', 'reduced']),
  glass: new Set(['rich', 'quiet']),
  textSize: new Set(['standard', 'large']),
};

function sanitize(raw = {}) {
  const next = { ...DEFAULT_PREFS };
  Object.keys(allowed).forEach(key => { if (allowed[key].has(raw[key])) next[key] = raw[key]; });
  ['autoplay', 'showRatings', 'showWatched', 'spoilerShield', 'rememberSearch', 'rememberViewed', 'discoverable', 'shareTaste', 'backdropArt', 'posterTilt', 'highContrast', 'compactNav', 'cleanHomePosters', 'posterCommunityRating', 'posterPersonalRating', 'posterWatchedMark', 'posterListButton', 'posterRateButton', 'posterMatchBadge', 'posterProviderLogo', 'posterDismissButton', 'posterPreview', 'detailBoxOfficeExpanded', 'detailGalleryExpanded', 'detailReviewsExpanded', 'directorExcludeShorts', 'directorExcludeDocumentaries', 'directorExcludeUnreleased', 'mature', 'matureBlur'].forEach(key => {
    if (typeof raw[key] === 'boolean') next[key] = raw[key];
  });
  return next;
}

export function applyPrefs() {
  const root = document.documentElement;
  delete root.dataset.accent;
  root.dataset.density = prefs.density;
  root.dataset.motion = prefs.motion;
  root.dataset.autoplay = prefs.autoplay ? 'on' : 'off';
  root.dataset.ratings = prefs.showRatings ? 'show' : 'hide';
  root.dataset.watchedMarks = prefs.showWatched ? 'show' : 'hide';
  root.dataset.spoilers = prefs.spoilerShield ? 'shield' : 'show';
  root.dataset.glass = prefs.glass;
  root.dataset.textSize = prefs.textSize;
  root.dataset.backdropArt = prefs.backdropArt ? 'show' : 'hide';
  root.dataset.posterTilt = prefs.posterTilt ? 'on' : 'off';
  root.dataset.cleanHomePosters = prefs.cleanHomePosters ? 'on' : 'off';
  root.dataset.posterCommunityRating = prefs.posterCommunityRating ? 'show' : 'hide';
  root.dataset.posterPersonalRating = prefs.posterPersonalRating ? 'show' : 'hide';
  root.dataset.posterWatchedMark = prefs.posterWatchedMark ? 'show' : 'hide';
  root.dataset.posterListButton = prefs.posterListButton ? 'show' : 'hide';
  root.dataset.posterRateButton = prefs.posterRateButton ? 'show' : 'hide';
  root.dataset.posterMatchBadge = prefs.posterMatchBadge ? 'show' : 'hide';
  root.dataset.posterProviderLogo = prefs.posterProviderLogo ? 'show' : 'hide';
  root.dataset.posterDismissButton = prefs.posterDismissButton ? 'show' : 'hide';
  root.dataset.posterPreview = prefs.posterPreview ? 'show' : 'hide';
  root.dataset.contrast = prefs.highContrast ? 'high' : 'standard';
  root.dataset.mature = prefs.mature ? 'on' : 'off';
  root.dataset.matureBlur = prefs.mature && prefs.matureBlur ? 'on' : 'off';
  root.dataset.compactNav = prefs.compactNav ? 'on' : 'off';
  root.dataset.rememberViewed = prefs.rememberViewed ? 'on' : 'off';
}

export function updatePref(key, value) {
  prefs = sanitize({ ...prefs, [key]: value });
  updatedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify({ ...prefs, _updatedAt: updatedAt })); } catch (_) {}
  applyPrefs();
  document.dispatchEvent(new CustomEvent('cv:prefs', { detail: { ...prefs } }));
  return prefs;
}

export function resetPrefs() {
  prefs = { ...DEFAULT_PREFS };
  updatedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify({ ...prefs, _updatedAt: updatedAt })); } catch (_) {}
  applyPrefs();
  document.dispatchEvent(new CustomEvent('cv:prefs', { detail: { ...prefs } }));
}

export function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    prefs = sanitize(raw);
    updatedAt = Math.max(0, +raw._updatedAt || 0);
    const region = localStorage.getItem('cv_region');
    if (region && REGIONS.some(([code]) => code === region)) state.region = region;
    localStorage.removeItem('cv_theme');
    localStorage.removeItem('cv_cinema');
  } catch (_) { prefs = { ...DEFAULT_PREFS }; }
  applyPrefs();
}

export function hydratePrefs(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const incomingAt = Math.max(0, +raw._updatedAt || 0);
  if (!incomingAt || incomingAt <= updatedAt) return false;
  prefs = sanitize(raw); updatedAt = incomingAt;
  try { localStorage.setItem(KEY, JSON.stringify({ ...prefs, _updatedAt: updatedAt })); } catch (_) {}
  applyPrefs();
  document.dispatchEvent(new CustomEvent('cv:prefs', { detail: { ...prefs, cloud: true } }));
  return true;
}

export function preferencePayload(extra = {}) {
  updatedAt = Date.now();
  const value = { ...prefs, ...extra, _updatedAt: updatedAt };
  try { localStorage.setItem(KEY, JSON.stringify({ ...prefs, _updatedAt: updatedAt })); } catch (_) {}
  return value;
}
