// ===== AMBIENT VIDEO BACKGROUNDS =====
// Fades a muted, controls-free, looping YouTube trailer in BEHIND the existing
// vignette/gradient of a hero or detail backdrop. The static image paints first
// (zero layout shift) and the video is purely decorative (pointer-events:none).
import { prefersReducedMotion } from './ui.js';

// Mobile included. The video only ever becomes visible on a confirmed PLAYING
// state (see below) — so if muted autoplay is blocked/paused on a device, the
// iframe stays hidden (opacity 0) behind the static backdrop instead of showing
// YouTube's paused chrome. Only reduced-motion opts out entirely.
export function ambientOK() { return !prefersReducedMotion(); }

// Mounts an ambient video into `container` (which must be position:relative and
// already hold the backdrop image + a gradient overlay above it). Returns a
// teardown function. Safe to call when not ambientOK() (it just no-ops).
export function mountAmbientVideo(container, ytKey, { delay = 1400, overlaySelector = '.detail-back-grad, .hero-vignette' } = {}) {
  if (!container || !ytKey || !ambientOK()) return () => {};
  let el = null, timer = null, dead = false, onMsg = null;

  const reveal = () => { if (el && !dead) el.classList.add('show'); };

  timer = setTimeout(() => {
    if (dead || !container.isConnected) return;
    el = document.createElement('iframe');
    el.className = 'ambient-video';
    el.setAttribute('tabindex', '-1');
    el.setAttribute('aria-hidden', 'true');
    el.allow = 'autoplay; encrypted-media';
    // controls=0 + NO playlist param: the `playlist=key` loop trick is what makes
    // YouTube render prev/next buttons, so we loop via the JS API instead (seek to
    // 0 on END below) for a clean, chrome-free video. enablejsapi also lets us hold
    // the fade-in until the trailer is actually PLAYING so nothing flashes in.
    const post = (func, args = []) => { try { el.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube.com'); } catch (_) {} };
    el.src = `https://www.youtube.com/embed/${ytKey}?autoplay=1&mute=1&controls=0&playsinline=1&modestbranding=1&rel=0&disablekb=1&fs=0&iv_load_policy=3&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
    // Insert just BEFORE the gradient/vignette so paint order is: image → video → overlay.
    const overlay = container.querySelector(overlaySelector);
    if (overlay) container.insertBefore(el, overlay); else container.appendChild(el);

    // Stream player-state events: reveal on PLAYING(=1); loop on ENDED(=0) by
    // seeking back to the start and replaying (no playlist → no next/prev chrome).
    onMsg = (e) => {
      if (dead || !el || e.source !== el.contentWindow) return;
      let d = e.data;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { return; } }
      if (!d || (d.event !== 'onStateChange' && d.event !== 'infoDelivery')) return;
      const st = d.info?.playerState ?? d.info;
      if (st === 1) reveal();
      else if (st === 0) { post('seekTo', [0, true]); post('playVideo'); }
    };
    window.addEventListener('message', onMsg);
    el.addEventListener('load', () => {
      try { el.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: ytKey, channel: 'widget' }), 'https://www.youtube.com'); } catch (_) {}
    });
    // NO fallback reveal: we only ever show the iframe on a confirmed PLAYING
    // state. If autoplay is blocked/paused (common on mobile), it stays hidden
    // behind the static backdrop rather than exposing YouTube's paused chrome.
  }, delay);

  return () => {
    dead = true;
    if (timer) clearTimeout(timer);
    if (onMsg) { window.removeEventListener('message', onMsg); onMsg = null; }
    if (el) { el.src = 'about:blank'; el.remove(); el = null; }
  };
}
