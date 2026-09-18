// ===== SHAKE TO RESHUFFLE =====
// On Discover, give the phone a shake and Surprise me spins again.
//
// Motion events need permission on iOS, and permission can only be asked for
// inside a gesture, so the ask happens the first time Surprise me is pressed on
// a touch device. Everywhere else the listener is simply attached; if the device
// has no accelerometer, nothing happens and nothing is broken.
import { haptic } from './haptics.js';

const SHAKE_FORCE = 26, SHAKES_NEEDED = 3, WINDOW_MS = 1200, COOLDOWN_MS = 2500;

/**
 * Pure: a shake detector. Feed it acceleration samples; it reports true on the
 * sample that completes a shake, then stays quiet for the cooldown.
 */
export function shakeDetector({ force = SHAKE_FORCE, needed = SHAKES_NEEDED, window = WINDOW_MS, cooldown = COOLDOWN_MS } = {}) {
  let hits = [], last = -Infinity;
  return ({ x = 0, y = 0, z = 0 }, at = Date.now()) => {
    if (at - last < cooldown) return false;
    const strength = Math.abs(x) + Math.abs(y) + Math.abs(z);
    if (strength < force) return false;
    hits = hits.filter(time => at - time < window);
    hits.push(at);
    if (hits.length < needed) return false;
    hits = [];
    last = at;
    return true;
  };
}

const onDiscover = () => !!document.getElementById('discoverPage')?.getClientRects().length;

/** The Surprise me button that is actually on screen, if any. */
function spinButton() {
  return [document.getElementById('spinBtn'), document.getElementById('spinBtnTV')]
    .find(button => button && !button.disabled && button.getClientRects().length) || null;
}

let listening = false;
function listen() {
  if (listening || typeof DeviceMotionEvent === 'undefined') return;
  listening = true;
  const detect = shakeDetector();
  addEventListener('devicemotion', event => {
    const a = event.accelerationIncludingGravity || event.acceleration;
    if (!a || !onDiscover() || document.hidden) return;
    if (!detect({ x: a.x || 0, y: a.y || 0, z: a.z || 0 })) return;
    const button = spinButton();
    if (!button) return;
    haptic('celebrate');
    button.classList.add('shaken');
    setTimeout(() => button.classList.remove('shaken'), 700);
    button.click();
  });
}

export function initShake() {
  const needsAsk = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
  if (!needsAsk) { listen(); return; }
  // iOS: ask inside the press on Surprise me, once.
  document.addEventListener('click', async event => {
    if (listening || !event.target.closest?.('#spinBtn, #spinBtnTV')) return;
    try { if (await DeviceMotionEvent.requestPermission() === 'granted') listen(); } catch (_) {}
  });
}
