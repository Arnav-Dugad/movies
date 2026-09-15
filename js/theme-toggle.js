// ===== THEME TOGGLE =====
// The switch in the profile menu (and the Theme choice in Settings) and the
// motion that carries the change. The colours themselves come from js/theme.js,
// which has already applied the stored theme before first paint.
//
// The motion: going light, the new paper page opens as a circle from the
// switch, with a warm bloom that lingers a moment after; going dark, the paper
// page closes back into the switch like a sun setting. Both ride the View
// Transitions API, so the page is swapped once, underneath a snapshot, rather
// than every element transitioning its colours. Browsers without it get a
// circular wipe; reduced motion switches instantly.
import { prefs, updatePref } from './prefs.js';
import { registerActions } from './events.js';
import { $ } from './ui.js';
import { initLogoTone, tagAllLogos } from './logo-tone.js';

const DURATION = { light: 860, dark: 760 };
const EASE = 'cubic-bezier(.65,0,.2,1)';

const effective = () => (window.CVTheme ? window.CVTheme.resolve(prefs.theme) : 'dark');

const reducedMotion = () => {
  const setting = document.documentElement.dataset.motion;
  if (setting === 'reduced') return true;
  if (setting === 'full') return false;
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
};

function originOf(el, event) {
  if (event && Number.isFinite(event.clientX) && (event.clientX || event.clientY)) return { x: event.clientX, y: event.clientY };
  const icon = el?.querySelector?.('.theme-orb') || el;
  const box = icon?.getBoundingClientRect?.();
  return box && box.width ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: innerWidth - 40, y: 30 };
}

/** Reflect the current theme on every switch on the page. */
export function syncThemeControls() {
  const light = effective() === 'light';
  document.querySelectorAll('[data-theme-switch]').forEach(node => {
    node.setAttribute('aria-checked', String(light));
    const label = node.querySelector('.theme-switch-label');
    if (label) label.textContent = light ? 'Light theme' : 'Dark theme';
  });
}

/**
 * Switch to `choice` ('dark' | 'light' | 'system'), animating from `origin`.
 * Resolves once the page shows the new theme.
 */
export function setTheme(choice, origin) {
  const html = document.documentElement;
  const from = effective();
  const to = window.CVTheme ? window.CVTheme.resolve(choice) : choice;
  const commit = () => { updatePref('theme', choice); syncThemeControls(); };
  if (from === to || reducedMotion() || !origin) { commit(); return Promise.resolve(); }

  const { x, y } = origin;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  html.style.setProperty('--theme-x', `${x}px`);
  html.style.setProperty('--theme-y', `${y}px`);

  if (typeof document.startViewTransition !== 'function') return wipe(to, commit, { x, y, radius });

  html.classList.add('theme-vt', `to-${to}`);
  const transition = document.startViewTransition(async () => {
    commit();
    if (to !== 'light') return;
    html.classList.add('theme-bloom');
    // Let white title logos turn to ink before the new page is captured, but
    // never hold the switch for more than a moment.
    await Promise.race([tagAllLogos(), new Promise(resolve => setTimeout(resolve, 280))]);
  });
  transition.ready.then(() => {
    const open = [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`];
    html.animate(
      { clipPath: to === 'light' ? open : [...open].reverse() },
      { duration: DURATION[to], easing: EASE, fill: 'both', pseudoElement: to === 'light' ? '::view-transition-new(root)' : '::view-transition-old(root)' },
    );
  }).catch(() => {});
  return transition.finished.catch(() => {}).finally(() => {
    html.classList.remove('theme-vt', 'to-light', 'to-dark');
    // The bloom was painted into the new snapshot; it now fades out on the live page.
    requestAnimationFrame(() => html.classList.remove('theme-bloom'));
  });
}

// Fallback: a disc of the destination paper grows from the switch, the theme
// swaps underneath it, and the disc dissolves.
function wipe(to, commit, { x, y, radius }) {
  const disc = document.createElement('div');
  disc.className = 'theme-wipe';
  disc.style.background = window.CVTheme?.META?.[to] || (to === 'light' ? '#e6e2da' : '#06060b');
  document.body.appendChild(disc);
  const grow = disc.animate(
    { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
    { duration: DURATION[to] * 0.75, easing: EASE, fill: 'forwards' },
  );
  return grow.finished.then(() => {
    commit();
    return disc.animate({ opacity: [1, 0] }, { duration: 380, easing: 'ease-out', fill: 'forwards' }).finished;
  }).catch(() => commit()).finally(() => disc.remove());
}

export function initThemeToggle() {
  initLogoTone();
  syncThemeControls();
  registerActions({
    'toggle-theme': (el, event) => setTheme(effective() === 'light' ? 'dark' : 'light', originOf(el, event)),
    'settings-theme': el => setTheme(el.value, originOf(el)),
  });
  // A theme arriving from another device, a reset, or the OS flipping while on
  // "Match device" updates the switches without motion.
  document.addEventListener('cv:prefs', () => { syncThemeControls(); tagAllLogos(); });
  try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', syncThemeControls); } catch (_) {}
  const item = $('ddTheme');
  if (item) item.hidden = false;
}
