// ===== WATCHLIST + WATCHED =====
import { auth, db, firebase } from './firebase.js';
import { state } from './state.js';
import { IMG, PH } from './config.js';
import { esc, toast, $ } from './ui.js';
import { refreshWLBtns } from './cards.js';
import { registerActions, readItem } from './events.js';

const requireAuth = () => document.dispatchEvent(new Event('cv:open-auth'));

export async function loadWatchlist() {
  if (!state.user) return;
  try {
    const s = await db.collection('users').doc(state.user.uid).collection('watchlist').orderBy('added', 'desc').get();
    state.watchlist = s.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.error(e); }
}

export async function toggleWL(item, type) {
  if (!state.user) return requireAuth();
  const id = `${type}_${item.id}`, exists = state.watchlist.find(w => w.id === id);
  try {
    const ref = db.collection('users').doc(state.user.uid).collection('watchlist').doc(id);
    if (exists) {
      await ref.delete();
      state.watchlist = state.watchlist.filter(w => w.id !== id);
      toast('Removed from list', 'info');
    } else {
      const d = {
        tmdbId: item.id, type,
        title: item.title || item.name || '',
        poster: item.poster || item.poster_path || '',
        rating: item.rating || item.vote_average || 0,
        year: item.year || (item.release_date || item.first_air_date || '').slice(0, 4),
        added: firebase.firestore.FieldValue.serverTimestamp(),
        genres: item.genres || item.genre_ids || []
      };
      await ref.set(d);
      state.watchlist.unshift({ id, ...d });
      toast('Added to list!', 'success');
    }
    refreshWLBtns();
    document.dispatchEvent(new Event('cv:wl-changed'));
  } catch (e) { console.error('toggleWL failed:', e); toast('Error updating list', 'error'); }
}

export async function loadWatched() {
  if (!state.user) return;
  try {
    const s = await db.collection('users').doc(state.user.uid).collection('watched').get();
    state.watched = {};
    s.docs.forEach(d => state.watched[d.id] = d.data());
  } catch (e) { console.error('loadWatched failed:', e); }
}

export async function toggleWatched(id, type, title) {
  if (!state.user) return requireAuth();
  const key = `${type}_${id}`;
  try {
    const ref = db.collection('users').doc(state.user.uid).collection('watched').doc(key);
    if (state.watched[key]) {
      await ref.delete(); delete state.watched[key]; toast('Unmarked as watched', 'info');
    } else {
      const d = { tmdbId: id, type, title, watchedAt: firebase.firestore.FieldValue.serverTimestamp() };
      await ref.set(d); state.watched[key] = d; toast('Marked as watched!', 'success');
    }
    document.dispatchEvent(new Event('cv:wl-changed'));
  } catch (e) { console.error('toggleWatched failed:', e); toast('Error', 'error'); }
}

// ===== WATCHLIST PAGE =====
export function setWLFilter(f, el) {
  state.wlFilter = f;
  el.parentElement.querySelectorAll('.wl-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderWL();
}

export function renderWL() {
  const ct = $('wlContent'), cnt = $('wlCount');
  if (!ct) return;
  let items;
  if (state.wlFilter === 'watched') items = state.watchlist.filter(w => state.watched[w.id]);
  else items = state.wlFilter === 'all' ? state.watchlist : state.watchlist.filter(w => w.type === state.wlFilter);
  cnt.textContent = `${items.length} title${items.length !== 1 ? 's' : ''}`;

  if (!state.user) {
    ct.innerHTML = `<div class="wl-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg><h3>Sign in to see your list</h3><p>Create an account to save movies and shows</p><br><button class="btn-primary" data-action="open-auth">Sign In</button></div>`;
    return;
  }
  if (!items.length) {
    ct.innerHTML = `<div class="wl-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg><h3>Your list is empty</h3><p>Start adding movies and shows you want to watch</p></div>`;
    return;
  }
  ct.innerHTML = `<div class="wl-grid">${items.map(w => {
    const poster = w.poster ? `${IMG}w342${w.poster}` : PH;
    const wd = state.watched[w.id];
    return `<div class="card" role="button" tabindex="0" aria-label="${esc(w.title)}" data-action="open-detail" data-id="${w.tmdbId}" data-type="${w.type}"><div class="card-img"><img src="${poster}" alt="${esc(w.title)}" loading="lazy" data-ph="${PH}">${wd ? '<div class="watched-badge show"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></div>' : ''}</div><div class="card-info"><div class="card-title">${esc(w.title) || ''}</div><div class="card-sub"><span>${w.year || ''}</span><span class="dot"></span><span>${w.type === 'tv' ? 'TV' : 'Movie'}</span></div></div></div>`;
  }).join('')}</div>`;
}

export function initWatchlist() {
  registerActions({
    'toggle-wl': (el, e) => { e.stopPropagation(); toggleWL(readItem(el), readItem(el).type); },
    'toggle-watched': (el, e) => {
      e.stopPropagation();
      toggleWatched(+el.dataset.id, el.dataset.type, el.dataset.title || '');
      el.classList.toggle('active');
    },
    'wl-filter': (el) => setWLFilter(el.dataset.filter, el),
  });
}
