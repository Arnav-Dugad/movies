// ===== WATCHED PAGE (/watched) =====
// Lists every title the user has marked as watched, with an All / Movies / TV
// toggle. Watched docs are enriched with poster/year on write (see
// watchlist.js); older docs fall back to the matching watchlist entry.
import { state } from './state.js';
import { IMG, PH } from './config.js';
import { esc, $ } from './ui.js';
import { registerActions } from './events.js';

// Normalize a watched doc into a renderable item, filling poster/year from the
// watchlist for entries saved before enrichment existed.
function toItem(key, d) {
  const wl = state.watchlist.find(w => w.id === key);
  return {
    id: d.tmdbId, type: d.type,
    title: d.title || wl?.title || '',
    poster: d.poster || wl?.poster || '',
    year: d.year || wl?.year || '',
    ts: d.watchedAt?.seconds || 0,
  };
}

function watchedItems() {
  const items = Object.entries(state.watched).map(([k, d]) => toItem(k, d));
  const filtered = state.watchedFilter === 'all' ? items : items.filter(i => i.type === state.watchedFilter);
  return filtered.sort((a, b) => b.ts - a.ts);
}

export function setWatchedFilter(f, el) {
  state.watchedFilter = f;
  el.parentElement.querySelectorAll('.wl-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderWatched();
}

export function renderWatched() {
  const ct = $('watchedContent'), cnt = $('watchedCount');
  if (!ct) return;

  if (!state.user) {
    ct.innerHTML = `<div class="wl-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 6L9 17l-5-5"/></svg><h3>Sign in to see what you've watched</h3><p>Mark titles as watched to build your history</p><br><button class="btn-primary" data-action="open-auth">Sign In</button></div>`;
    if (cnt) cnt.textContent = '';
    return;
  }

  const items = watchedItems();
  if (cnt) cnt.textContent = `${items.length} title${items.length !== 1 ? 's' : ''}`;

  if (!items.length) {
    const scope = state.watchedFilter === 'movie' ? 'movies' : state.watchedFilter === 'tv' ? 'TV shows' : 'titles';
    ct.innerHTML = `<div class="wl-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 6L9 17l-5-5"/></svg><h3>No watched ${scope} yet</h3><p>Open a title and tap the ✓ to mark it watched</p></div>`;
    return;
  }

  ct.innerHTML = `<div class="wl-grid">${items.map(w => {
    const poster = w.poster ? `${IMG}w342${w.poster}` : PH;
    return `<div class="card" role="button" tabindex="0" aria-label="${esc(w.title)}" data-action="open-detail" data-id="${w.id}" data-type="${w.type}"><div class="card-img"><img src="${poster}" alt="${esc(w.title)}" loading="lazy" data-ph="${PH}"><div class="watched-badge show"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></div></div><div class="card-info"><div class="card-title">${esc(w.title) || ''}</div><div class="card-sub"><span>${w.year || ''}</span><span class="dot"></span><span>${w.type === 'tv' ? 'TV' : 'Movie'}</span></div></div></div>`;
  }).join('')}</div>`;
}

export function initWatched() {
  registerActions({
    'watched-filter': (el) => setWatchedFilter(el.dataset.filter, el),
  });
}
