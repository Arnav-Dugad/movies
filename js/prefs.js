// ===== LOCAL EXPERIENCE PREFERENCES =====
// Personal UI choices apply device-local first for instant paint, then Settings
// mirrors one compact snapshot to the user's existing Firestore profile document.
import { state } from './state.js';
import { REGIONS } from './config.js';
import { cleanDetailHidden, detailHiddenCSS, cleanDetailOrder, isDefaultOrder } from './detail-parts.js';

const KEY = 'cv_experience_v2';
export const DEFAULT_PREFS = Object.freeze({
  // 'dark' (the cinema default), 'light', or 'system' to follow the device.
  theme: 'dark',
  density: 'comfortable', motion: 'system', autoplay: true,
  showRatings: true, showWatched: true, spoilerShield: false,
  rememberSearch: true, rememberViewed: true, discoverable: true, shareTaste: true,
  glass: 'rich', textSize: 'standard',
  // The moving light behind the site (js/backdrops.js).
  backdrop: 'aurora',
  // An optional free OMDb key: fills the Tomatometer and Metascore in where the
  // keyless sources have nothing, television especially (js/scores.js).
  omdbKey: '',
  backdropArt: true, posterTilt: true, highContrast: false, compactNav: false,
  haptics: true,
  cleanHomePosters: false, posterCommunityRating: true, posterPersonalRating: true,
  posterWatchedMark: true, posterListButton: true, posterRateButton: true,
  posterMatchBadge: true, posterProviderLogo: true, posterDismissButton: true, posterPreview: true,
  // Off by default: titles, years and types stay under posters until switched off.
  hidePosterCaptions: false,
  // On by default: title pages take their glow, buttons and progress colour from
  // the poster (js/ambient.js).
  ambientColour: true,
  // A toast when an episode tick crosses an hours milestone with an actor.
  castMilestones: true,
  // A toast when your streak of days with viewing reaches 7, 30 or 100 (js/streak-milestones.js).
  streakMilestones: true,
  // Hours-club badges readable by friends (users/{uid}/shared/milestones).
  shareMilestones: true,
  detailBoxOfficeExpanded: false, detailGalleryExpanded: false, detailReviewsExpanded: false, detailHeatmapExpanded: false,
  directorExcludeShorts: true, directorExcludeDocumentaries: true, directorExcludeUnreleased: true,
  // Mature content is OFF by default and leaves no trace in the UI until it is
  // turned on: no section, no chips, no badge, and include_adult stays false.
  mature: false, matureBlur: true,
  // Even with mature content on, adult titles never shape recommendations until
  // this is switched on too (js/recommend.js). Friends never see them either way.
  matureInRecs: false,
  // Detail-page parts the viewer switched off (js/detail-parts.js). Empty = all shown.
  detailHidden: [],
  // The order of a title page's blocks (js/detail-parts.js). Empty = as shipped.
  detailOrder: [],
  // People removed from Hours clubs (TMDB person ids). The next person with the
  // most time takes their place; restoring brings them back.
  hiddenClubs: [],
  // The background lights drift toward where you tap and the way you scroll
  // (js/stage.js). Reduced motion keeps them still regardless.
  lightDrift: true,
});

export let prefs = { ...DEFAULT_PREFS };

// Every user-facing search and discover call passes this rather than a literal,
// so adult results can never leak in while the toggle is off — and turning it on
// does not require touching a dozen call sites.
export const adultFlag = () => !!prefs.mature;
let updatedAt = 0;

const allowed = {
  theme: new Set(['dark', 'light', 'system']),
  density: new Set(['comfortable', 'compact']),
  motion: new Set(['system', 'full', 'reduced']),
  glass: new Set(['rich', 'quiet']),
  textSize: new Set(['standard', 'large']),
  backdrop: new Set(['aurora', 'silk', 'mesh', 'nebula', 'beams', 'still']),
};

/** Pure: unique positive whole person ids, at most 300, in the order given. */
export function cleanPersonIds(value) {
  const ids = (Array.isArray(value) ? value : []).map(Number).filter(id => Number.isInteger(id) && id > 0);
  return [...new Set(ids)].slice(-300);
}

function sanitize(raw = {}) {
  const next = { ...DEFAULT_PREFS };
  Object.keys(allowed).forEach(key => { if (allowed[key].has(raw[key])) next[key] = raw[key]; });
  ['autoplay', 'showRatings', 'showWatched', 'spoilerShield', 'rememberSearch', 'rememberViewed', 'discoverable', 'shareTaste', 'backdropArt', 'posterTilt', 'highContrast', 'compactNav', 'haptics', 'cleanHomePosters', 'posterCommunityRating', 'posterPersonalRating', 'posterWatchedMark', 'posterListButton', 'posterRateButton', 'posterMatchBadge', 'posterProviderLogo', 'posterDismissButton', 'posterPreview', 'hidePosterCaptions', 'ambientColour', 'castMilestones', 'streakMilestones', 'shareMilestones', 'lightDrift', 'detailBoxOfficeExpanded', 'detailGalleryExpanded', 'detailReviewsExpanded', 'detailHeatmapExpanded', 'directorExcludeShorts', 'directorExcludeDocumentaries', 'directorExcludeUnreleased', 'mature', 'matureBlur', 'matureInRecs'].forEach(key => {
    if (typeof raw[key] === 'boolean') next[key] = raw[key];
  });
  next.omdbKey = typeof raw.omdbKey === 'string' ? raw.omdbKey.trim().slice(0, 32) : '';
  next.detailHidden = cleanDetailHidden(raw.detailHidden);
  // Stored as it was chosen, but an order that matches the shipped one is kept
  // empty, so "nothing changed here" stays readable in Settings and in backups.
  const order = Array.isArray(raw.detailOrder) && raw.detailOrder.length ? cleanDetailOrder(raw.detailOrder) : [];
  next.detailOrder = isDefaultOrder(order) ? [] : order;
  next.hiddenClubs = cleanPersonIds(raw.hiddenClubs);
  return next;
}

export function applyPrefs() {
  const root = document.documentElement;
  delete root.dataset.accent;
  // js/theme.js (a classic script in <head>) owns the palette swap; it already
  // applied the stored theme before first paint, so this only acts on a change.
  if (typeof window !== 'undefined' && window.CVTheme) window.CVTheme.apply(prefs.theme);
  root.dataset.density = prefs.density;
  root.dataset.motion = prefs.motion;
  root.dataset.autoplay = prefs.autoplay ? 'on' : 'off';
  root.dataset.ratings = prefs.showRatings ? 'show' : 'hide';
  root.dataset.watchedMarks = prefs.showWatched ? 'show' : 'hide';
  root.dataset.spoilers = prefs.spoilerShield ? 'shield' : 'show';
  root.dataset.glass = prefs.glass;
  root.dataset.textSize = prefs.textSize;
  root.dataset.backdrop = prefs.backdrop;
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
  root.dataset.posterCaptions = prefs.hidePosterCaptions ? 'hide' : 'show';
  root.dataset.contrast = prefs.highContrast ? 'high' : 'standard';
  root.dataset.mature = prefs.mature ? 'on' : 'off';
  root.dataset.matureBlur = prefs.mature && prefs.matureBlur ? 'on' : 'off';
  root.dataset.compactNav = prefs.compactNav ? 'on' : 'off';
  root.dataset.haptics = prefs.haptics ? 'on' : 'off';
  root.dataset.rememberViewed = prefs.rememberViewed ? 'on' : 'off';
  // Hidden detail-page parts become one generated rule, so an open title page
  // changes the instant a switch is flipped.
  if (document.head && typeof document.createElement === 'function') {
    const css = detailHiddenCSS(prefs.detailHidden);
    let style = document.getElementById('detailVisibility');
    if (!style && css) {
      style = document.createElement('style');
      style.id = 'detailVisibility';
      document.head.appendChild(style);
    }
    if (style) style.textContent = css;
  }
}

// Every surface that shows or hides mature content listens for `cv:mature`, so
// it is announced from the one place the value actually changes. It used to be
// dispatched by the Settings toggle alone: a reset, or the preference arriving
// from another device, left the After Dark section and every adult filter
// describing a setting that no longer applied.
const matureSignature = value => `${!!value.mature}|${!!value.matureBlur}`;
function announceMature(before) {
  if (before !== matureSignature(prefs)) document.dispatchEvent(new Event('cv:mature'));
}

export function updatePref(key, value) {
  const before = matureSignature(prefs);
  prefs = sanitize({ ...prefs, [key]: value });
  updatedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify({ ...prefs, _updatedAt: updatedAt })); } catch (_) {}
  applyPrefs();
  document.dispatchEvent(new CustomEvent('cv:prefs', { detail: { ...prefs } }));
  announceMature(before);
  return prefs;
}

export function resetPrefs() {
  const before = matureSignature(prefs);
  prefs = { ...DEFAULT_PREFS };
  updatedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify({ ...prefs, _updatedAt: updatedAt })); } catch (_) {}
  applyPrefs();
  document.dispatchEvent(new CustomEvent('cv:prefs', { detail: { ...prefs } }));
  announceMature(before);
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
  const before = matureSignature(prefs);
  prefs = sanitize(raw); updatedAt = incomingAt;
  try { localStorage.setItem(KEY, JSON.stringify({ ...prefs, _updatedAt: updatedAt })); } catch (_) {}
  applyPrefs();
  document.dispatchEvent(new CustomEvent('cv:prefs', { detail: { ...prefs, cloud: true } }));
  announceMature(before);
  return true;
}

export function preferencePayload(extra = {}) {
  updatedAt = Date.now();
  const value = { ...prefs, ...extra, _updatedAt: updatedAt };
  try { localStorage.setItem(KEY, JSON.stringify({ ...prefs, _updatedAt: updatedAt })); } catch (_) {}
  return value;
}
