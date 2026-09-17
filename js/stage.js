// ===== MOVING LIGHTS =====
// The background lights (the .aurora stage) drift slowly toward where you tap
// or click, and lean the way you scroll, then settle back. Settings → Moving
// lights turns it off; reduced motion keeps the lights still.
//
// The drift is two CSS variables on the stage (--drift-x, --drift-y, in px),
// eased toward a target every frame while it is moving and not at all when it
// is at rest. The stage's lights read them through `translate` (css/refinements
// .css), which composes with their own slow animation and stays on the
// compositor.
import { prefs } from './prefs.js';

const PULL = 0.34;          // how far toward a tap the lights travel (share of the distance)
const SCROLL_LEAN = 0.5;    // px of lean per px scrolled, before the cap
const RELAX_MS = 5200;      // a tap's pull fades over this long
const EASE_MS = 900;        // the lights' time constant chasing their target

/** Pure: the drift target for a tap at (x, y) in a w×h viewport, capped to `max` px. */
export function tapTarget(x, y, w, h, max) {
  const clamp = v => Math.max(-max, Math.min(max, v));
  return { x: clamp((x - w / 2) * PULL), y: clamp((y - h / 2) * PULL) };
}

/** Pure: one easing step toward `target` after `dt` ms (frame-rate independent). */
export function easeToward(current, target, dt, tau = EASE_MS) {
  const k = 1 - Math.exp(-Math.max(0, dt) / tau);
  return current + (target - current) * k;
}

function allowed() {
  const root = document.documentElement;
  if (!prefs.lightDrift || root.dataset.motion === 'reduced') return false;
  if (root.dataset.motion !== 'full' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  return true;
}

export function initStage() {
  const stage = document.querySelector('.aurora');
  if (!stage || typeof window === 'undefined') return;
  let tap = { x: 0, y: 0, at: 0 };
  let lean = 0;
  let current = { x: 0, y: 0 };
  let frame = 0, last = 0;
  let lastScroll = window.scrollY;

  const cap = () => Math.min(window.innerWidth, window.innerHeight) * 0.22;
  const target = now => {
    const fade = tap.at ? Math.max(0, 1 - (now - tap.at) / RELAX_MS) : 0;
    return { x: tap.x * fade, y: tap.y * fade + lean };
  };
  const step = now => {
    frame = 0;
    if (!allowed()) { rest(); return; }
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;
    // The scroll lean relaxes on its own.
    lean = easeToward(lean, 0, dt, 1400);
    const goal = target(now);
    current = { x: easeToward(current.x, goal.x, dt), y: easeToward(current.y, goal.y, dt) };
    stage.style.setProperty('--drift-x', `${current.x.toFixed(1)}px`);
    stage.style.setProperty('--drift-y', `${current.y.toFixed(1)}px`);
    const settled = Math.abs(current.x - goal.x) < 0.3 && Math.abs(current.y - goal.y) < 0.3 && Math.abs(lean) < 0.3 && (!tap.at || now - tap.at > RELAX_MS);
    if (!settled) frame = requestAnimationFrame(step); else last = 0;
  };
  const wake = () => { if (!frame) frame = requestAnimationFrame(step); };
  const rest = () => {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    last = 0;
    tap = { x: 0, y: 0, at: 0 }; lean = 0; current = { x: 0, y: 0 };
    stage.style.removeProperty('--drift-x'); stage.style.removeProperty('--drift-y');
  };

  window.addEventListener('pointerdown', event => {
    if (!allowed() || event.button > 0) return;
    const goal = tapTarget(event.clientX, event.clientY, window.innerWidth, window.innerHeight, cap());
    tap = { ...goal, at: performance.now() };
    wake();
  }, { passive: true, capture: true });

  window.addEventListener('scroll', () => {
    const y = window.scrollY, delta = y - lastScroll;
    lastScroll = y;
    if (!allowed() || !delta) return;
    const max = cap() * 0.7;
    lean = Math.max(-max, Math.min(max, lean + delta * SCROLL_LEAN));
    wake();
  }, { passive: true });

  document.addEventListener('cv:prefs', () => { if (!allowed()) rest(); });
}
