// ===== PULL DOWN TO REFRESH THE HOME PAGE =====
// At the very top of Home, drag down: a thin arc stretches as you pull, clicks
// when it is far enough (a light buzz), and on release spins while the picks are
// rebuilt — a fresh rotation of Top Picks and the rails around it.
//
// The pull only starts at scroll position zero, on a touch screen, on Home; any
// other drag scrolls the page as usual.
import { haptic } from './haptics.js';
import { refreshRecommendations } from './recommend.js';

const ARMED = 88, MAX = 150;

/** Pure: how far the indicator has been pulled, 0-1, with resistance. */
export function pullProgress(dy, { armed = ARMED, max = MAX } = {}) {
  if (!(dy > 0)) return 0;
  const eased = dy <= armed ? dy : armed + (dy - armed) * .38;
  return Math.max(0, Math.min(1, eased / max));
}

/** Pure: has the pull passed the point where releasing refreshes? */
export const pullArmed = (dy, armed = ARMED) => dy >= armed;

let node = null, busy = false;
function indicator() {
  if (node?.isConnected) return node;
  node = document.createElement('div');
  node.className = 'pull-refresh';
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = '<span class="pull-ring"><svg viewBox="0 0 36 36"><circle class="pull-track" cx="18" cy="18" r="15.5"/><circle class="pull-arc" cx="18" cy="18" r="15.5" pathLength="1"/></svg></span>';
  document.body.appendChild(node);
  return node;
}

// Home, at the top, with nothing else in front of it.
const onHomeTop = () => !busy
  && scrollY <= 0
  && !!document.getElementById('homePage')?.getClientRects().length
  && !document.querySelector('.modal.active, .overlay.active, .pick-sheet');

export function initPullRefresh() {
  let start = null, armed = false;

  document.addEventListener('touchstart', event => {
    if (event.touches.length !== 1 || !onHomeTop()) { start = null; return; }
    // A pull that starts inside a sideways rail is that rail's business.
    if (event.target.closest?.('.row, .hero, input, textarea')) { start = null; return; }
    start = event.touches[0].clientY;
    armed = false;
  }, { passive: true });

  document.addEventListener('touchmove', event => {
    if (start === null) return;
    const dy = event.touches[0].clientY - start;
    if (dy <= 0) { if (node) node.style.removeProperty('--pull'); return; }
    if (scrollY > 0) { start = null; return; }
    // Taking the gesture over: without this the browser's own overscroll fights it.
    if (event.cancelable) event.preventDefault();
    const box = indicator();
    box.classList.add('is-pulling');
    box.style.setProperty('--pull', String(pullProgress(dy)));
    const nowArmed = pullArmed(dy);
    if (nowArmed !== armed) { armed = nowArmed; box.classList.toggle('is-armed', armed); if (armed) haptic('select'); }
  }, { passive: false });

  const release = async () => {
    if (start === null) return;
    start = null;
    const box = node;
    if (!box) return;
    box.classList.remove('is-pulling');
    if (!armed) { box.style.removeProperty('--pull'); box.classList.remove('is-armed'); return; }
    armed = false;
    busy = true;
    haptic('success');
    box.classList.add('is-busy');
    try { await refreshRecommendations(); } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 500));
    box.classList.remove('is-busy', 'is-armed');
    box.style.removeProperty('--pull');
    busy = false;
  };
  document.addEventListener('touchend', release, { passive: true });
  document.addEventListener('touchcancel', release, { passive: true });
}
