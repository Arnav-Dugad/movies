// ===== AMBIENT VIDEO BACKGROUNDS =====
// Fades a muted, controls-free, looping YouTube trailer in BEHIND the existing
// vignette/gradient of a hero or detail backdrop. The static image paints first
// (zero layout shift); the video is purely decorative (pointer-events:none) and
// only mounts on desktop with motion enabled — mobile/reduced-motion keep the image.
import { prefersReducedMotion } from './ui.js';

// Ambient trailers autoplay on mobile too — they're muted + playsinline, which
// satisfies mobile autoplay policies. Only reduced-motion opts out.
export function ambientOK() { return !prefersReducedMotion(); }

// Mounts an ambient video into `container` (which must be position:relative and
// already hold the backdrop image + a gradient overlay above it). Returns a
// teardown function. Safe to call when not ambientOK() (it just no-ops).
export function mountAmbientVideo(container, ytKey, { delay = 1400, overlaySelector = '.detail-back-grad, .hero-vignette' } = {}) {
  if (!container || !ytKey || !ambientOK()) return () => {};
  let el = null, timer = null, revealTimer = null, dead = false, onMsg = null;

  const reveal = () => { if (el && !dead) el.classList.add('show'); };

  timer = setTimeout(() => {
    if (dead || !container.isConnected) return;
    el = document.createElement('iframe');
    el.className = 'ambient-video';
    el.setAttribute('tabindex', '-1');
    el.setAttribute('aria-hidden', 'true');
    el.allow = 'autoplay; encrypted-media';
    // mute + playlist=key → programmatic autoplay + single-video loop.
    // enablejsapi lets us hold the fade-in until the trailer is actually PLAYING,
    // so YouTube's initial play/next/prev chrome + buffering never flash into view.
    el.src = `https://www.youtube.com/embed/${ytKey}?autoplay=1&mute=1&loop=1&playlist=${ytKey}&controls=0&playsinline=1&modestbranding=1&rel=0&disablekb=1&fs=0&iv_load_policy=3&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
    // Insert just BEFORE the gradient/vignette so paint order is: image → video → overlay.
    const overlay = container.querySelector(overlaySelector);
    if (overlay) container.insertBefore(el, overlay); else container.appendChild(el);

    // Ask the embed to stream player-state events, then reveal on PLAYING(=1).
    onMsg = (e) => {
      if (dead || !el || e.source !== el.contentWindow) return;
      let d = e.data;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { return; } }
      const st = d && (d.info?.playerState ?? d.info);
      if (d && (d.event === 'onStateChange' || d.event === 'infoDelivery') && st === 1) reveal();
    };
    window.addEventListener('message', onMsg);
    el.addEventListener('load', () => {
      try { el.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: ytKey, channel: 'widget' }), 'https://www.youtube.com'); } catch (_) {}
    });
    // Safety net: if no PLAYING event arrives (API blocked/slow), reveal anyway
    // so the feature never silently disappears — no worse than before.
    revealTimer = setTimeout(reveal, 4000);
  }, delay);

  return () => {
    dead = true;
    if (timer) clearTimeout(timer);
    if (revealTimer) clearTimeout(revealTimer);
    if (onMsg) { window.removeEventListener('message', onMsg); onMsg = null; }
    if (el) { el.src = 'about:blank'; el.remove(); el = null; }
  };
}
