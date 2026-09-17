// ===== MOBILE HAPTIC LANGUAGE =====
// A small set of consistent tactile signatures. It runs only on touch-first
// devices, and only while Settings → Mobile haptics is on.
//
// Ticks and pins are OUTCOME haptics: the tracker and the rail fire them once
// the action has actually happened (a tick that was refused because you are
// signed out, or an episode that has not aired, gives no buzz). They are light
// on purpose — a tick is the most repeated gesture in the app.
//
// Every signature has a weight. Two buzzes closer than 45ms would blur into
// one, so the second is normally dropped — unless it matters more: the press of
// a button gives a light tap, and the "saved" that follows in the same instant
// replaces it rather than being swallowed by it.
//
// Scrolling has its own, much lighter vocabulary (js/scroll-feel.js): a detent
// as each poster passes in a row or each section heading passes on the page,
// and a firmer edge when a row or the page runs out.
//
// iPhone Safari has no Vibration API. Since iOS 18, toggling a native switch
// control produces the system's selection tap, so on iOS a hidden
// <input type="checkbox" switch> is toggled instead. It only works inside the
// user's gesture, which is where most of these calls happen; elsewhere (a toast
// arriving later, a scroll detent) it does nothing.
import { prefs } from './prefs.js';

export const PATTERNS = {
  detent: 4,
  land: 6,
  edge: 11,
  swipe: 8,
  tap: 7,
  untick: 5,
  tick: 9,
  select: [8, 18, 8],
  pin: [6, 34, 6],
  peek: [5, 30, 10],
  notify: [7, 70, 7],
  drop: [10, 26, 14],
  success: [10, 22, 15],
  warning: [18, 28, 20],
  celebrate: [12, 40, 12, 40, 26],
};
const WEIGHT = { detent: 0, land: 0, edge: 1, swipe: 1, tap: 1, untick: 1, tick: 2, select: 2, pin: 2, peek: 2, notify: 2, drop: 3, success: 3, warning: 3, celebrate: 4 };
// Too frequent, or too small, to be worth repainting the pressed-state glow for.
const QUIET = new Set(['detent', 'land', 'edge', 'swipe']);
// Actions whose haptic comes from their outcome, not from the press.
const OUTCOME_ACTIONS = /^(ep-toggle|ep-mark-upto|ep-season|continue-pin|continue-hide|toggle-watched)$/;

const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
const isIOS = () => /iP(hone|od|ad)/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let iosSwitch = null;
function iosTap() {
  if (!iosSwitch) {
    iosSwitch = document.createElement('label');
    iosSwitch.setAttribute('aria-hidden', 'true');
    iosSwitch.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    iosSwitch.appendChild(input);
    // Keep the synthetic click away from the page's own click listeners.
    iosSwitch.addEventListener('click', event => event.stopPropagation());
    document.body.appendChild(iosSwitch);
  }
  iosSwitch.click();
}
let lastAt = -Infinity, lastWeight = 0;

const touchFirst = () => (typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches) || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);

/**
 * Pure: may a buzz of `kind` play `sinceLast` ms after one of weight `lastWeight`?
 * `unlessRecent` skips it when anything played within that many ms.
 */
export function shouldPlay(kind, sinceLast, lastWeight, unlessRecent = 0) {
  if (unlessRecent && sinceLast < unlessRecent) return false;
  if (sinceLast >= 45) return true;
  return (WEIGHT[kind] ?? 1) > lastWeight;
}

export function haptic(kind = 'tap', { unlessRecent = 0 } = {}) {
  if (!prefs.haptics || !touchFirst()) return false;
  const now = performance.now();
  if (!shouldPlay(kind, now - lastAt, lastWeight, unlessRecent)) return false;
  lastAt = now;
  lastWeight = WEIGHT[kind] ?? 1;
  try {
    if (canVibrate()) navigator.vibrate(PATTERNS[kind] || PATTERNS.tap);
    else if (isIOS()) iosTap();
  } catch (_) {}
  if (QUIET.has(kind)) return true;
  document.documentElement.classList.remove('haptic-pulse');
  requestAnimationFrame(() => document.documentElement.classList.add('haptic-pulse'));
  setTimeout(() => document.documentElement.classList.remove('haptic-pulse'), 180);
  return true;
}

// Words are matched whole (between hyphens), so "preset" is not a reset and
// "watched-genre" is a filter, not a success.
const CLOSES = /^(close|cancel)-|-(cancel|close)$/;
const WARNS = /(^|-)(delete|remove|clear|reset|dismiss|drop|leave|sign-out)(-|$)/;
const CHOOSES = /-(pick|target|genre|decade|country|language|metadata|mine|plays|runtime|theme|when|actor|director|community|rating|added|status|era|dept|sort|type|mode|order|range|region|filter|filters|year|month|tab|jump|glass|toggle|preset|keyword|mood)$/;
const SUCCEEDS = /(^|-)(save|repair|import|restore|share|copy|download|export|accept)(-|$)|^(rate-submit|read-all-notifications|log-rewatch|clone-shared-list)$/;
const SELECTS = /toggle|filter|pref|pin|list|sort|choice|pick|region|show-page|theme/;

const CHOICE_CLASSES = ['filter-fold-toggle', 'chip', 'rate-star'];

/** Pure: the signature a press on a control deserves ('' when its outcome decides). */
export function signatureFor({ action = '', cls = '', checkbox = false } = {}) {
  if (OUTCOME_ACTIONS.test(action)) return '';
  if (!action) return checkbox || String(cls).split(/\s+/).some(name => CHOICE_CLASSES.includes(name)) ? 'select' : 'tap';
  if (CLOSES.test(action)) return 'tap';
  if (/^(open|choose)-/.test(action)) return 'tap';
  if (WARNS.test(action)) return 'warning';
  if (CHOOSES.test(action)) return 'select';
  if (SUCCEEDS.test(action)) return 'success';
  if (SELECTS.test(action)) return 'select';
  return 'tap';
}

function signature(target) {
  const action = target?.closest?.('[data-action]')?.dataset.action || '';
  const input = target.matches?.('label') ? target.querySelector('input') : null;
  return signatureFor({
    action,
    cls: typeof target.className === 'string' ? target.className : '',
    checkbox: !!input && (input.type === 'checkbox' || input.type === 'radio'),
  });
}

// Toasts are how most outcomes report back, so they carry their own feel: an
// error warns; a milestone or a finished series celebrates; a finished season
// confirms; any other success confirms unless the press that caused it has
// only just buzzed.
function watchToasts() {
  const zone = document.getElementById('toastZone');
  if (!zone) return;
  new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element) || !node.classList.contains('toast')) continue;
        if (node.classList.contains('cast-milestone') || node.classList.contains('finale-prompt')) haptic('celebrate');
        else if (node.classList.contains('recap-prompt')) haptic('success');
        else if (node.classList.contains('error')) haptic('warning');
        else if (node.classList.contains('success')) haptic('success', { unlessRecent: 600 });
      }
    }
  }).observe(zone, { childList: true });
}

export function initHaptics() {
  document.addEventListener('pointerup', event => {
    if (event.pointerType !== 'touch') return;
    const target = event.target.closest?.('button,a,[role="button"],[role="radio"],[role="tab"],label:has(input),select');
    if (!target || target.matches(':disabled,[aria-disabled="true"]')) return;
    const kind = signature(target);
    if (kind) haptic(kind);
  }, { passive: true, capture: true });
  document.addEventListener('cv:haptic', event => haptic(event.detail?.kind || 'success', event.detail || {}));
  watchToasts();
}
