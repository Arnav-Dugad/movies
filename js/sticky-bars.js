// ===== STICKY BARS =====
// Stats' section index, the Settings toolbar, Discover's jump bar, the
// notification toolbar, Box Office's search and the Franchises toolbar stick a
// few pixels below the navigation bar. Those few pixels showed the page
// scrolling past between the two bars. While a bar is stuck it gets a shelf
// (css/feel.css) that closes the gap; unstuck, it is an ordinary block again.
export const STICKY_BARS = '.stats-index, .settings-toolbar, .discover-jumpbar, .notification-toolbar, .bo-page-tools, .fp-toolbar';

/** Pure: is a sticky bar resting at its sticky offset (within half a pixel)? */
export const isStuck = (top, stickyTop) => Number.isFinite(stickyTop) && Math.abs(top - stickyTop) < .5;

function update() {
  const nav = document.querySelector('.navbar');
  const navBottom = nav ? nav.getBoundingClientRect().bottom : 0;
  document.querySelectorAll(STICKY_BARS).forEach(bar => {
    // A bar on a page that is not showing is never stuck.
    if (!bar.getClientRects().length) { bar.classList.remove('is-stuck'); return; }
    const style = getComputedStyle(bar);
    const box = bar.getBoundingClientRect();
    const stuck = style.position === 'sticky' && scrollY > 0 && isStuck(box.top, parseFloat(style.top));
    bar.classList.toggle('is-stuck', stuck);
    if (stuck) bar.style.setProperty('--shelf-h', `${Math.max(0, Math.ceil(box.top - navBottom) + 1)}px`);
  });
}

export function initStickyBars() {
  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; update(); });
  };
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue, { passive: true });
}
