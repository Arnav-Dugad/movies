// ===== RATINGS =====
import { auth, db, firebase } from './firebase.js';
import { state } from './state.js';
import { toast, $ } from './ui.js';
import { registerActions } from './events.js';
import { confettiBurst } from './effects.js';

let rateTarget = null;

export async function loadRatings() {
  if (!state.user) return;
  try {
    const s = await db.collection('users').doc(state.user.uid).collection('ratings').get();
    state.ratings = {};
    s.docs.forEach(d => state.ratings[d.id] = d.data().score);
  } catch (e) { console.error(e); }
}

export function openRating(id, type, title) {
  if (!state.user) return document.dispatchEvent(new Event('cv:open-auth'));
  rateTarget = { id, type, key: `${type}_${id}` };
  $('rateTitle').textContent = 'Rate this';
  $('rateSub').textContent = title;
  const stars = $('rateStars');
  const current = state.ratings[rateTarget.key] || 0;
  stars.innerHTML = '';
  for (let i = 1; i <= 10; i++) {
    const s = document.createElement('div');
    s.className = `rate-star ${i <= current ? 'active' : ''}`;
    s.setAttribute('role', 'button');
    s.setAttribute('aria-label', `${i} of 10`);
    s.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
    s.onmouseenter = () => stars.querySelectorAll('.rate-star').forEach((st, idx) => st.classList.toggle('active', idx < i));
    s.onclick = () => { rateTarget.score = i; stars.querySelectorAll('.rate-star').forEach((st, idx) => st.classList.toggle('active', idx < i)); };
    stars.appendChild(s);
  }
  stars.onmouseleave = () => { const sc = rateTarget.score || current; stars.querySelectorAll('.rate-star').forEach((st, idx) => st.classList.toggle('active', idx < sc)); };
  rateTarget.score = current;
  $('rateOv').classList.add('active');
}

export function closeRating() { $('rateOv').classList.remove('active'); rateTarget = null; }

export async function submitRating() {
  if (!rateTarget || !rateTarget.score) return;
  try {
    await db.collection('users').doc(state.user.uid).collection('ratings').doc(rateTarget.key)
      .set({ score: rateTarget.score, tmdbId: rateTarget.id, type: rateTarget.type, updated: firebase.firestore.FieldValue.serverTimestamp() });
    state.ratings[rateTarget.key] = rateTarget.score;
    toast(`Rated ${rateTarget.score}/10!`, 'success');
    confettiBurst();
    closeRating();
    document.dispatchEvent(new Event('cv:wl-changed'));
  } catch (e) { toast('Error saving rating', 'error'); }
}

export async function clearRating() {
  if (!rateTarget) return;
  try {
    await db.collection('users').doc(state.user.uid).collection('ratings').doc(rateTarget.key).delete();
    delete state.ratings[rateTarget.key];
    toast('Rating removed', 'info');
    closeRating();
    document.dispatchEvent(new Event('cv:wl-changed'));
  } catch (e) { toast('Error', 'error'); }
}

export function isRatingOpen() { return $('rateOv').classList.contains('active'); }

export function initRatings() {
  const ov = $('rateOv');
  ov.addEventListener('click', e => { if (e.target === ov) closeRating(); });
  registerActions({
    'open-rating': (el, e) => { e.stopPropagation(); openRating(+el.dataset.id, el.dataset.type, el.dataset.title || ''); },
    'rate-submit': () => submitRating(),
    'rate-clear': () => clearRating(),
    'close-rating': () => closeRating(),
  });
}
