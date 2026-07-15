// ===== SHARED UI HELPERS =====

export function esc(s){const d=document.createElement('div');d.textContent=s==null?'':s;return d.innerHTML.replace(/'/g,'&#39;').replace(/"/g,'&quot;');}
export function fmt(n){if(n>=1e9)return(n/1e9).toFixed(1)+'B';if(n>=1e6)return(n/1e6).toFixed(0)+'M';if(n>=1e3)return(n/1e3).toFixed(0)+'K';return String(n);}
export function debounce(fn,ms){let t;return function(...a){clearTimeout(t);const ctx=this;t=setTimeout(()=>fn.apply(ctx,a),ms);};}
export const prefersReducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isTouch=()=>window.matchMedia('(hover: none)').matches;
export const $=(id)=>document.getElementById(id);

// ===== FOCUS TRAP =====
// Keeps Tab inside an open modal and restores focus to whatever opened it.
// Returns a teardown — call it from the modal's close path. Queried lazily on
// each Tab so modals that rebuild their contents (e.g. the rating stars) work.
export function trapFocus(container, restore = document.activeElement) {
  const SEL = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';
  const onKey = e => {
    if (e.key !== 'Tab') return;
    const f = [...container.querySelectorAll(SEL)].filter(el => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  container.addEventListener('keydown', onKey);
  return () => {
    container.removeEventListener('keydown', onKey);
    try { restore && restore.focus(); } catch (_) {}
  };
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
