// ===== WATCHED PAGE (/watched) =====
// Lists every title the user has marked as watched, with type tabs (All/Movies/TV)
// plus a search box, sort, and genre filter. Watched docs are enriched with
// poster/year/genres on write (see watchlist.js); older docs are backfilled from
// TMDB on first view so their artwork and genres show up.
import { tmdb } from './api.js';
import { db } from './firebase.js';
import { state } from './state.js';
import { IMG, PH, genreMap } from './config.js';
import { esc, debounce, $ } from './ui.js';
import { registerActions } from './events.js';

let watchedSort = 'recent';   // recent | title | year_desc | year_asc
let watchedGenre = 'all';     // 'all' | genre id (string)
let watchedQuery = '';
let backfilled = false;

// Normalize a watched doc into a renderable item, filling poster/year from the
// watchlist for entries saved before enrichment existed.
function toItem(key, d) {
  const wl = state.watchlist.find(w => w.id === key);
  return {
    id: d.tmdbId, type: d.type,
    title: d.title || wl?.title || '',
    poster: d.poster || wl?.poster || '',
    year: d.year || wl?.year || '',
    genres: (d.genres && d.genres.length ? d.genres : wl?.genres) || [],
    ts: d.watchedAt?.seconds || 0,
  };
}

function allItems() {
  return Object.entries(state.watched).map(([k, d]) => toItem(k, d));
}

function watchedItems() {
  let items = allItems();
  if (state.watchedFilter !== 'all') items = items.filter(i => i.type === state.watchedFilter);
  if (watchedGenre !== 'all') items = items.filter(i => (i.genres || []).map(String).includes(watchedGenre));
  if (watchedQuery) { const q = watchedQuery.toLowerCase(); items = items.filter(i => i.title.toLowerCase().includes(q)); }
  const sorters = {
    recent: (a, b) => b.ts - a.ts,
    title: (a, b) => a.title.localeCompare(b.title),
    year_desc: (a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0),
    year_asc: (a, b) => (parseInt(a.year) || 0) - (parseInt(b.year) || 0),
  };
  return items.sort(sorters[watchedSort] || sorters.recent);
}

// Options for the genre <select>, built from the genres present in watched items.
function genreOptions() {
  const ids = new Set();
  allItems().forEach(i => (i.genres || []).forEach(g => { if (genreMap[g]) ids.add(g); }));
  const opts = [...ids].map(id => [String(id), genreMap[id]]).sort((a, b) => a[1].localeCompare(b[1]));
  return `<option value="all">All genres</option>` + opts.map(([v, name]) => `<option value="${v}">${esc(name)}</option>`).join('');
}

// Backfill poster/year/genres for old watched docs missing them, once per session.
async function backfillWatched() {
  if (backfilled || !state.user) return;
  backfilled = true;
  const missing = Object.entries(state.watched).filter(([, d]) => !d.poster || !(d.genres && d.genres.length));
  if (!missing.length) return;
  await Promise.allSettled(missing.map(async ([key, d]) => {
    try {
      const det = await tmdb(`/${d.type}/${d.tmdbId}`);
      const patch = {
        poster: det.poster_path || d.poster || '',
        year: d.year || (det.release_date || det.first_air_date || '').slice(0, 4),
        genres: (det.genres || []).map(g => g.id),
      };
      state.watched[key] = { ...d, ...patch };
      await db.collection('users').doc(state.user.uid).collection('watched').doc(key).set(patch, { merge: true });
    } catch (e) { /* leave placeholder; don't block the rest */ }
  }));
  renderWatched();
}

export function setWatchedFilter(f, el) {
  state.watchedFilter = f;
  el.parentElement.querySelectorAll('.wl-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderGrid();
}

function renderGrid() {
  const ct = $('watchedContent'), cnt = $('watchedCount');
  if (!ct) return;
  const items = watchedItems();
  if (cnt) cnt.textContent = `${items.length} title${items.length !== 1 ? 's' : ''}`;

  if (!items.length) {
    const anyWatched = Object.keys(state.watched).length > 0;
    const scope = state.watchedFilter === 'movie' ? 'movies' : state.watchedFilter === 'tv' ? 'TV shows' : 'titles';
    ct.innerHTML = anyWatched
      ? `<div class="wl-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><h3>No matches</h3><p>Try a different search, genre, or filter</p></div>`
      : `<div class="wl-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 6L9 17l-5-5"/></svg><h3>No watched ${scope} yet</h3><p>Open a title and tap the ✓ to mark it watched</p></div>`;
    return;
  }

  ct.innerHTML = `<div class="wl-grid">${items.map(w => {
    const poster = w.poster ? `${IMG}w342${w.poster}` : PH;
    return `<div class="card" role="button" tabindex="0" aria-label="${esc(w.title)}" data-action="open-detail" data-id="${w.id}" data-type="${w.type}"><div class="card-img"><img src="${poster}" alt="${esc(w.title)}" loading="lazy" data-ph="${PH}"><div class="watched-badge show"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></div></div><div class="card-info"><div class="card-title">${esc(w.title) || ''}</div><div class="card-sub"><span>${w.year || ''}</span><span class="dot"></span><span>${w.type === 'tv' ? 'TV' : 'Movie'}</span></div></div></div>`;
  }).join('')}</div>`;
}

export function renderWatched() {
  const ct = $('watchedContent'), cnt = $('watchedCount'), controls = $('watchedControls');
  if (!ct) return;

  if (!state.user) {
    if (controls) controls.style.display = 'none';
    if (cnt) cnt.textContent = '';
    ct.innerHTML = `<div class="wl-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 6L9 17l-5-5"/></svg><h3>Sign in to see what you've watched</h3><p>Mark titles as watched to build your history</p><br><button class="btn-primary" data-action="open-auth">Sign In</button></div>`;
    return;
  }

  // Show controls only when there's something to control.
  const hasAny = Object.keys(state.watched).length > 0;
  if (controls) {
    controls.style.display = hasAny ? '' : 'none';
    const gsel = $('watchedGenre');
    if (gsel) { gsel.innerHTML = genreOptions(); gsel.value = watchedGenre; if (gsel.value !== watchedGenre) { watchedGenre = 'all'; gsel.value = 'all'; } }
    const ssel = $('watchedSort'); if (ssel) ssel.value = watchedSort;
    const sinp = $('watchedSearch'); if (sinp && sinp.value !== watchedQuery) sinp.value = watchedQuery;
  }

  renderGrid();
  backfillWatched();
}

export function initWatched() {
  registerActions({
    'watched-filter': (el) => setWatchedFilter(el.dataset.filter, el),
    'watched-sort': (el) => { watchedSort = el.value; renderGrid(); },
    'watched-genre': (el) => { watchedGenre = el.value; renderGrid(); },
  });
  const inp = $('watchedSearch');
  if (inp) inp.addEventListener('input', debounce(function () { watchedQuery = this.value.trim(); renderGrid(); }, 200));
}
