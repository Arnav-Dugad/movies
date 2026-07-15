// ===== RATINGS =====
// 1-10 integer scores, one doc per title at users/{uid}/ratings/{type}_{id}.
import { db, firebase } from './firebase.js';
import { state } from './state.js';
import { toast, $, trapFocus, lockScroll, unlockScroll } from './ui.js';
import { registerActions } from './events.js';
import { confettiBurst } from './effects.js';
import { refreshRateBtns } from './cards.js';

let rateTarget = null;
let releaseFocus = null;

// Index = score - 1. Shown live under the stars so a number means something.
const LABELS = ['Unwatchable', 'Awful', 'Bad', 'Weak', 'Meh', 'Decent', 'Good', 'Great', 'Superb', 'Masterpiece'];

const STAR_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

export async function loadRatings() {
  if (!state.user) return;
  try {
    const s = await db.collection('users').doc(state.user.uid).collection('ratings').get();
    state.ratings = {};
    s.docs.forEach(d => state.ratings[d.id] = d.data().score);
  } catch (e) { console.error(e); }
}

// Paint stars + label for `score` without committing it (used for hover preview
// and for the committed value alike).
function paint(score) {
  const stars = $('rateStars');
  if (!stars) return;
  stars.querySelectorAll('.rate-star').forEach((st, idx) => {
    const on = idx < score;
    st.classList.toggle('active', on);
    st.setAttribute('aria-checked', String(idx + 1 === score));
    // Roving tabindex: only the selected star is tabbable, so Tab moves past the
    // whole group rather than through ten stops.
    st.tabIndex = (idx + 1 === (score || 1)) ? 0 : -1;
  });
  const lab = $('rateLabel');
  if (lab) lab.textContent = score ? `${score}/10 · ${LABELS[score - 1]}` : 'Pick a score';
}

function setScore(score) {
  if (!rateTarget) return;
  rateTarget.score = Math.max(1, Math.min(10, score));
  paint(rateTarget.score);
}

export function openRating(id, type, title) {
  if (!state.user) return document.dispatchEvent(new Event('cv:open-auth'));
  const trigger = document.activeElement;
  rateTarget = { id, type, key: `${type}_${id}` };
  $('rateTitle').textContent = 'Rate this';
  $('rateSub').textContent = title;

  const stars = $('rateStars');
  const current = state.ratings[rateTarget.key] || 0;
  stars.innerHTML = '';
  for (let i = 1; i <= 10; i++) {
    const s = document.createElement('div');
    s.className = 'rate-star';
    s.dataset.action = 'rate-pick';
    s.dataset.score = String(i);
    s.setAttribute('role', 'radio');
    s.setAttribute('aria-label', `${i} of 10 — ${LABELS[i - 1]}`);
    s.innerHTML = STAR_SVG;
    stars.appendChild(s);
  }
  rateTarget.score = current;
  paint(current);

  const ov = $('rateOv');
  ov.classList.add('active');
  lockScroll();
  releaseFocus = trapFocus(ov, trigger);
  const focusMe = stars.querySelector('.rate-star[tabindex="0"]') || stars.firstChild;
  if (focusMe && focusMe.focus) focusMe.focus();
}

export function closeRating() {
  const ov = $('rateOv');
  // Idempotent: closeAllModals() calls this unconditionally on every navigation,
  // and an unbalanced unlockScroll() would corrupt the lock's reference count.
  if (!ov || !ov.classList.contains('active')) return;
  ov.classList.remove('active');
  unlockScroll();
  if (releaseFocus) { releaseFocus(); releaseFocus = null; }
  rateTarget = null;
}

export async function submitRating() {
  if (!rateTarget || !rateTarget.score) return;
  const { key, score, id, type } = rateTarget;
  try {
    await db.collection('users').doc(state.user.uid).collection('ratings').doc(key)
      .set({ score, tmdbId: id, type, updated: firebase.firestore.FieldValue.serverTimestamp() });
    state.ratings[key] = score;
    toast(`Rated ${score}/10!`, 'success');
    confettiBurst();
    closeRating();
    refreshRateBtns();
    document.dispatchEvent(new Event('cv:wl-changed'));
  } catch (e) { console.error('submitRating failed:', e); toast('Error saving rating', 'error'); }
}

export async function clearRating() {
  if (!rateTarget) return;
  const { key } = rateTarget;
  try {
    await db.collection('users').doc(state.user.uid).collection('ratings').doc(key).delete();
    delete state.ratings[key];
    toast('Rating removed', 'info');
    closeRating();
    refreshRateBtns();
    document.dispatchEvent(new Event('cv:wl-changed'));
  } catch (e) { console.error('clearRating failed:', e); toast('Error', 'error'); }
}

export function isRatingOpen() { return $('rateOv').classList.contains('active'); }

export function initRatings() {
  const ov = $('rateOv');
  ov.addEventListener('click', e => { if (e.target === ov) closeRating(); });

  const stars = $('rateStars');

  // Hover preview. Bound ONCE on the container rather than per-star, and using
  // pointerleave (which does NOT bubble) instead of pointerout — pointerout fires
  // when moving onto a star's own child <svg>, which would snap the preview back
  // on every mouse move across the group.
  stars.addEventListener('pointerover', e => {
    const st = e.target.closest('.rate-star');
    if (st) paint(+st.dataset.score);
  });
  stars.addEventListener('pointerleave', () => { if (rateTarget) paint(rateTarget.score || 0); });

  // Keyboard. This listener sits on #rateStars while the action delegation lives
  // on document, so it runs FIRST (bubble order: inner -> outer). Enter therefore
  // submits here and stopPropagation() keeps it from also firing rate-pick.
  stars.addEventListener('keydown', e => {
    if (!rateTarget) return;
    const cur = rateTarget.score || 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setScore(cur + 1); focusCurrent(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setScore(Math.max(1, cur - 1)); focusCurrent(); }
    else if (e.key === 'Home') { e.preventDefault(); setScore(1); focusCurrent(); }
    else if (e.key === 'End') { e.preventDefault(); setScore(10); focusCurrent(); }
    else if (/^[0-9]$/.test(e.key)) { e.preventDefault(); setScore(e.key === '0' ? 10 : +e.key); focusCurrent(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submitRating(); }
  });

  function focusCurrent() {
    const st = stars.querySelector('.rate-star[tabindex="0"]');
    if (st) st.focus();
  }

  registerActions({
    'open-rating': (el, e) => { e.stopPropagation(); openRating(+el.dataset.id, el.dataset.type, el.dataset.title || ''); },
    'rate-pick': (el) => setScore(+el.dataset.score),
    'rate-submit': () => submitRating(),
    'rate-clear': () => clearRating(),
    'close-rating': () => closeRating(),
  });
}
