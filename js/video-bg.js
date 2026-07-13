// ===== AMBIENT VIDEO BACKGROUNDS =====
// Fades a muted, controls-free, looping YouTube trailer in BEHIND the existing
// vignette/gradient of a hero or detail backdrop. The static image paints first
// (zero layout shift); the video is purely decorative (pointer-events:none) and
// only mounts on desktop with motion enabled — mobile/reduced-motion keep the image.
import { prefersReducedMotion, isTouch } from './ui.js';

export function ambientOK() { return !prefersReducedMotion() && !isTouch(); }

// Mounts an ambient video into `container` (which must be position:relative and
// already hold the backdrop image + a gradient overlay above it). Returns a
// teardown function. Safe to call when not ambientOK() (it just no-ops).
export function mountAmbientVideo(container, ytKey, { delay = 1400, overlaySelector = '.detail-back-grad, .hero-vignette' } = {}) {
  if (!container || !ytKey || !ambientOK()) return () => {};
  let el = null, timer = null, dead = false;
  timer = setTimeout(() => {
    if (dead || !container.isConnected) return;
    el = document.createElement('iframe');
    el.className = 'ambient-video';
    el.setAttribute('tabindex', '-1');
    el.setAttribute('aria-hidden', 'true');
    el.allow = 'autoplay; encrypted-media';
    // mute + playlist=key are required for programmatic autoplay + single-video loop.
    el.src = `https://www.youtube.com/embed/${ytKey}?autoplay=1&mute=1&loop=1&playlist=${ytKey}&controls=0&playsinline=1&modestbranding=1&rel=0&disablekb=1&fs=0&iv_load_policy=3`;
    // Insert just BEFORE the gradient/vignette so paint order is: image → video → overlay.
    const overlay = container.querySelector(overlaySelector);
    if (overlay) container.insertBefore(el, overlay); else container.appendChild(el);
    requestAnimationFrame(() => { if (el) el.classList.add('show'); });
  }, delay);

  return () => {
    dead = true;
    if (timer) clearTimeout(timer);
    if (el) { el.src = 'about:blank'; el.remove(); el = null; }
  };
}
