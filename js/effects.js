// ===== PREMIUM ANIMATIONS & EFFECTS =====
import { prefersReducedMotion, isTouch } from './ui.js';

const motionOK = () => !prefersReducedMotion();
const pointerFine = () => !isTouch();

// ----- Scroll reveal -----
// Lazily constructed so observeReveals() can NEVER silently no-op: .reveal starts
// at opacity:0, so a call that arrives before initEffects() used to leave that
// content invisible forever with no error. Init order is now also correct
// (main.js), but this makes the ordering non-load-bearing.
let revealObs = null;
function ensureRevealObs() {
  if (revealObs) return revealObs;
  revealObs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); revealObs.unobserve(e.target); } });
  }, { threshold: .08, rootMargin: '0px 0px -50px 0px' });
  return revealObs;
}
export function initScrollReveal() { ensureRevealObs(); observeReveals(); }
export function observeReveals(root = document) {
  const obs = ensureRevealObs();
  root.querySelectorAll('.reveal:not(.visible)').forEach(el => obs.observe(el));
}

// ----- Count-up numbers -----
export function countUp(el, target, { dur = 900, decimals = 0, prefix = '', suffix = '' } = {}) {
  if (!motionOK()) { el.textContent = prefix + target.toFixed(decimals) + suffix; return; }
  const start = performance.now();
  const from = 0;
  function tick(now) {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = from + (target - from) * eased;
    el.textContent = prefix + val.toFixed(decimals) + suffix;
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
// Animate any [data-count] within root when it scrolls into view. Shares one
// IntersectionObserver across every call (same pattern as revealObs above) —
// this is invoked on every openDetail()/renderStats() render, and a fresh
// per-call observer would never disconnect() for elements that never scroll
// into view, leaking one observer (holding detached-DOM refs) per navigation.
let countObs = null;
function ensureCountObs() {
  if (countObs) return countObs;
  countObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target;
      const target = parseFloat(el.dataset.count) || 0;
      countUp(el, target, {
        decimals: parseInt(el.dataset.decimals || '0'),
        prefix: el.dataset.prefix || '', suffix: el.dataset.suffix || ''
      });
      countObs.unobserve(el);
    });
  }, { threshold: .4 });
  return countObs;
}
export function observeCountUps(root = document) {
  const els = root.querySelectorAll('[data-count]');
  if (!els.length) return;
  const obs = ensureCountObs();
  els.forEach(el => obs.observe(el));
}

// ----- Confetti -----
export function confettiBurst(count = 90) {
  if (!motionOK()) return;
  let zone = document.getElementById('confettiZone');
  if (!zone) { zone = document.createElement('div'); zone.id = 'confettiZone'; zone.className = 'confetti-zone'; document.body.appendChild(zone); }
  const colors = ['#e50914', '#fbbf24', '#06b6d4', '#10b981', '#8b5cf6', '#ec4899', '#ff2030'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--cx', (Math.random() * 60 - 30) + 'vw');
    p.style.animationDelay = (Math.random() * .25) + 's';
    p.style.animationDuration = (1.1 + Math.random() * .8) + 's';
    zone.appendChild(p);
    setTimeout(() => p.remove(), 2400);
  }
}

// ----- Scroll progress bar -----
export function initScrollProgress() {
  const bar = document.querySelector('.scroll-progress');
  if (!bar) return;
  let ticking = false;
  const update = () => {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    const p = h > 0 ? (window.scrollY / h) * 100 : 0;
    bar.style.width = p + '%';
    ticking = false;
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}

// ----- 3D tilt on cards (delegated, desktop only) -----
export function initTilt() {
  if (!pointerFine() || !motionOK()) return;
  let active = null, raf = null, lastE = null;
  document.addEventListener('pointermove', e => {
    const card = e.target.closest('.card');
    if (card !== active) { if (active) resetTilt(active); active = card; if (card) card.classList.add('tilt'); }
    if (!card) return;
    lastE = e;
    if (!raf) raf = requestAnimationFrame(() => { raf = null; applyTilt(active, lastE); });
  }, { passive: true });
  // pointerleave fires for EVERY element the pointer exits, including moving
  // between a card's own children — so only reset when the pointer has actually
  // left the tracked card, otherwise the transform snaps back mid-hover.
  document.addEventListener('pointerleave', e => {
    if (!active) return;
    if (e.target !== active && active.contains(e.relatedTarget)) return;
    resetTilt(active); active = null;
  }, true);
  function applyTilt(card, e) {
    if (!card) return;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - .5;
    const py = (e.clientY - r.top) / r.height - .5;
    card.style.transform = `perspective(700px) rotateY(${px * 8}deg) rotateX(${-py * 10}deg) translateY(-6px)`;
  }
  function resetTilt(card) {
    // A row can re-render (innerHTML =) while the pointer is over a card, leaving
    // `active` pointing at a node that's no longer in the document.
    if (!card.isConnected) { active = null; return; }
    card.style.transform = ''; card.classList.remove('tilt');
  }
}

// ----- Magnetic buttons -----
export function initMagnetic() {
  if (!pointerFine() || !motionOK()) return;
  document.addEventListener('pointermove', e => {
    const el = e.target.closest('.magnetic');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left - r.width / 2) * .3;
    const y = (e.clientY - r.top - r.height / 2) * .3;
    // `translate`, NOT `transform` — they're independent properties that compose.
    // Writing an inline transform here used to clobber the button's own :hover
    // lift and :active press, silently killing both on the only two .magnetic
    // buttons in the app.
    el.style.translate = `${x}px ${y}px`;
  }, { passive: true });
  document.addEventListener('pointerout', e => {
    const el = e.target.closest && e.target.closest('.magnetic');
    // pointerout also fires when moving onto the button's own child <svg>; only
    // release the magnet when the pointer has truly left the button.
    if (el && !el.contains(e.relatedTarget)) el.style.translate = '';
  }, true);
}

// ----- Hero parallax -----
export function initHeroParallax() {
  if (!motionOK()) return;
  let ticking = false;
  const run = () => {
    // Direct child only: the backdrop, not the nested .hero-logo.
    const img = document.querySelector('.hero-slide.active > img');
    if (img) {
      const y = window.scrollY;
      // Sets `translate`, leaving `transform` to the kenBurns animation. Writing
      // transform here did nothing at all: a CSS animation outranks inline styles,
      // and kenBurns' fill-mode:both keeps its final frame applied forever — so
      // this effect had never actually been visible.
      if (y < window.innerHeight) img.style.translate = `0 ${y * 0.25}px`;
    }
    ticking = false;
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(run); } }, { passive: true });
}

export function initEffects() {
  initScrollReveal();
  initScrollProgress();
  initTilt();
  initMagnetic();
  initHeroParallax();
}
