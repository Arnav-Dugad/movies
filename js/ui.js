// ===== SHARED UI HELPERS =====
import { lastActionElement } from './events.js';

export function esc(s){const d=document.createElement('div');d.textContent=s==null?'':s;return d.innerHTML.replace(/'/g,'&#39;').replace(/"/g,'&quot;');}
export function fmt(n){if(n>=1e9)return(n/1e9).toFixed(1)+'B';if(n>=1e6)return(n/1e6).toFixed(0)+'M';if(n>=1e3)return(n/1e3).toFixed(0)+'K';return String(n);}
export function debounce(fn,ms){let t;return function(...a){clearTimeout(t);const ctx=this;t=setTimeout(()=>fn.apply(ctx,a),ms);};}
export const prefersReducedMotion=()=>document.documentElement.dataset.motion === 'reduced' || (document.documentElement.dataset.motion !== 'full' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
export const isTouch=()=>window.matchMedia('(hover: none)').matches;
export const $=(id)=>document.getElementById(id);

// ===== FOCUS TRAP =====
/**
 * Keep Tab inside `container` until the returned release function is called,
 * then hand focus back to whatever opened it.
 *
 * The listener is on the document, not on the container. It used to be on the
 * container, which meant the trap only worked once focus was already inside:
 * an overlay opened while focus sat on the trigger behind it never saw the
 * keydown at all, so Tab walked straight into the page underneath and a
 * keyboard user was left operating a screen they could not see. For the same
 * reason focus is moved into the container up front.
 */
export function trapFocus(container, restore = document.activeElement) {
  // A <div role="button"> is never focused by a click, so `document.activeElement`
  // at open time is often <body>. The element that actually fired the action is
  // the honest place to send focus back to.
  if (!restore || restore === document.body || restore === document.documentElement) {
    restore = lastActionElement() || restore;
  }
  const SEL = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const focusable = () => [...container.querySelectorAll(SEL)].filter(el => el.offsetParent !== null || el === document.activeElement);

  if (!container.contains(document.activeElement)) {
    const first = focusable()[0];
    if (first) first.focus();
    else {
      // Nothing to land on yet (a modal still painting its contents). The
      // container itself takes focus so the trap has something to hold.
      if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
      try { container.focus({ preventScroll: true }); } catch (_) {}
    }
  }

  const onKey = e => {
    if (e.key !== 'Tab') return;
    const f = focusable();
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!container.contains(document.activeElement)) {
      // Focus escaped (or never arrived). Pull it back to the right end.
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  return () => {
    document.removeEventListener('keydown', onKey, true);
    restoreFocusTo(restore);
  };
}

/**
 * Put focus back on the control a modal was opened from.
 *
 * Two things defeat a bare `.focus()` here. Many triggers are a <div> or <span>
 * carrying role="button", which cannot receive focus at all without a tabindex,
 * so the call silently did nothing and Escape dropped the user at the top of the
 * document. And a modal that writes to the library re-renders the page behind
 * it, leaving the original node detached — so its replacement is looked up by
 * the action and payload that identify it.
 */
function restoreFocusTo(el) {
  if (!el) return;
  if (!document.contains(el)) {
    const action = el.dataset?.action;
    if (!action) return;
    const id = el.dataset.id ? `[data-id="${CSS.escape(el.dataset.id)}"]` : '';
    el = document.querySelector(`[data-action="${CSS.escape(action)}"]${id}`);
    if (!el) return;
  }
  try {
    el.focus({ preventScroll: true });
    if (document.activeElement === el) return;
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  } catch (_) {}
}

// ===== SCROLL LOCK (reference-counted so overlays never strand the page) =====
let lockCount=0;
export function lockScroll(){lockCount++;document.body.style.overflow='hidden';}
export function unlockScroll(){lockCount=Math.max(0,lockCount-1);if(lockCount===0)document.body.style.overflow='';}
export function forceUnlockScroll(){lockCount=0;document.body.style.overflow='';}

// ===== TOAST =====
const ICONS={
  success:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>',
  error:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
  info:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'
};
export function toast(msg,type='info'){
  const z=$('toastZone');if(!z)return;
  const el=document.createElement('div');el.className=`toast ${type}`;
  el.innerHTML=`${ICONS[type]||ICONS.info}<span></span>`;
  el.querySelector('span').textContent=msg;
  z.appendChild(el);
  setTimeout(()=>{el.style.animation='toast-out .3s forwards';setTimeout(()=>el.remove(),300);},2800);
}
