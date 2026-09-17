// ===== CONTINUE WATCHING LIFT =====
// With a mouse, a Continue Watching card lifts toward you in 3D: its artwork
// leans after the pointer, a soft light follows it across the image, and a
// show's card crossfades from the show's artwork to the still of the episode
// you are about to watch (js/home.js fetches it; css/feel.css shows it).
//
// Only the pointer's position is written here, as four custom properties on the
// card; the lean, the light and the crossfade are CSS. A reordering rail, the
// edit mode and reduced motion leave the card flat.
import { prefersReducedMotion } from './ui.js';

/** Pure: the lean and light position for a pointer at (px, py), each 0-1 across the art. */
export function liftFor(px, py, { tiltX = 9, tiltY = 11 } = {}) {
  const x = Math.max(0, Math.min(1, px)), y = Math.max(0, Math.min(1, py));
  const round = value => Math.round(value * 100) / 100;
  return { rx: round((.5 - y) * tiltX), ry: round((x - .5) * tiltY), gx: Math.round(x * 100), gy: Math.round(y * 100) };
}

const PROPS = ['--lift-rx', '--lift-ry', '--lift-gx', '--lift-gy'];

export function initContinueLift() {
  let active = null, frame = 0, last = null;

  const reset = card => { if (card) PROPS.forEach(prop => card.style.removeProperty(prop)); };
  const apply = () => {
    frame = 0;
    if (!active?.isConnected || !last) return;
    const art = active.querySelector('.continue-art');
    const box = art?.getBoundingClientRect();
    if (!box?.width) return;
    const lift = liftFor((last.clientX - box.left) / box.width, (last.clientY - box.top) / box.height);
    active.style.setProperty('--lift-rx', `${lift.rx}deg`);
    active.style.setProperty('--lift-ry', `${lift.ry}deg`);
    active.style.setProperty('--lift-gx', `${lift.gx}%`);
    active.style.setProperty('--lift-gy', `${lift.gy}%`);
  };

  document.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    const card = event.target.closest?.('.continue-card');
    if (card !== active) { reset(active); active = card; }
    if (!card || prefersReducedMotion() || card.closest('.editing, .continue-reordering')) return;
    last = event;
    if (!frame) frame = requestAnimationFrame(apply);
  }, { passive: true });

  document.addEventListener('pointerout', event => {
    if (!active || active.contains(event.relatedTarget)) return;
    reset(active);
    active = null;
  }, { passive: true });
}
