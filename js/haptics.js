// ===== MOBILE HAPTIC LANGUAGE =====
// A small set of consistent tactile signatures: tap, select, success and warning.
// It runs only on touch-first devices.
//
// Ticks and pins are OUTCOME haptics: the tracker and the rail fire them once
// the action has actually happened (a tick that was refused because you are
// signed out, or an episode that has not aired, gives no buzz). They are light
// on purpose — a tick is the most repeated gesture in the app.
//
// iPhone Safari has no Vibration API. Since iOS 18, toggling a native switch
// control produces the system's selection tap, so on iOS a hidden
// <input type="checkbox" switch> is toggled instead. It only works inside the
// user's gesture, which is where these calls happen; elsewhere it does nothing.
import { prefs } from './prefs.js';

const PATTERNS = {
  tap: 7,
  select: [8, 18, 8],
  success: [10, 22, 15],
  warning: [18, 28, 20],
  tick: 9,
  untick: 5,
  pin: [6, 34, 6],
};
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
let lastAt = 0;

const touchFirst = () => matchMedia?.('(pointer:coarse)')?.matches || navigator.maxTouchPoints > 0;

export function haptic(kind = 'tap') {
  if (!prefs.haptics || !touchFirst()) return false;
  const now = performance.now();
  if (now - lastAt < 45) return false;
  lastAt = now;
  try {
    if (canVibrate()) navigator.vibrate(PATTERNS[kind] || PATTERNS.tap);
    else if (isIOS()) iosTap();
  } catch (_) {}
  document.documentElement.classList.remove('haptic-pulse');
  requestAnimationFrame(() => document.documentElement.classList.add('haptic-pulse'));
  setTimeout(() => document.documentElement.classList.remove('haptic-pulse'), 180);
  return true;
}

function signature(target) {
  const action = target?.closest?.('[data-action]')?.dataset.action || '';
  if (OUTCOME_ACTIONS.test(action)) return '';
  if (/delete|remove|clear|reset|dismiss/.test(action)) return 'warning';
  if (/watched|ep-toggle|rate-submit|save|repair|import|restore/.test(action)) return 'success';
  if (/toggle|filter|pref|tab|pin|list|sort/.test(action)) return 'select';
  return 'tap';
}

export function initHaptics() {
  document.addEventListener('pointerup', event => {
    if (event.pointerType !== 'touch') return;
    const target = event.target.closest?.('button,a,[role="button"],label:has(input),select');
    if (!target || target.matches(':disabled,[aria-disabled="true"]')) return;
    const kind = signature(target);
    if (kind) haptic(kind);
  }, { passive: true, capture: true });
  document.addEventListener('cv:haptic', event => haptic(event.detail?.kind || 'success'));
}
