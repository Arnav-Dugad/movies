// ===== MOBILE HAPTIC LANGUAGE =====
// A small set of consistent tactile signatures: tap, select, success and warning.
// It runs only on touch-first devices and gracefully becomes visual-only where
// the browser does not expose vibration (notably some iOS versions).
import { prefs } from './prefs.js';

const PATTERNS = {
  tap: 7,
  select: [8, 18, 8],
  success: [10, 22, 15],
  warning: [18, 28, 20],
};
let lastAt = 0;

const touchFirst = () => matchMedia?.('(pointer:coarse)')?.matches || navigator.maxTouchPoints > 0;

export function haptic(kind = 'tap') {
  if (!prefs.haptics || !touchFirst()) return false;
  const now = performance.now();
  if (now - lastAt < 45) return false;
  lastAt = now;
  try { navigator.vibrate?.(PATTERNS[kind] || PATTERNS.tap); } catch (_) {}
  document.documentElement.classList.remove('haptic-pulse');
  requestAnimationFrame(() => document.documentElement.classList.add('haptic-pulse'));
  setTimeout(() => document.documentElement.classList.remove('haptic-pulse'), 180);
  return true;
}

function signature(target) {
  const action = target?.closest?.('[data-action]')?.dataset.action || '';
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
    haptic(signature(target));
  }, { passive: true, capture: true });
  document.addEventListener('cv:haptic', event => haptic(event.detail?.kind || 'success'));
}
