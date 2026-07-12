// ===== SEARCH OVERLAY =====
import { tmdb } from './api.js';
import { IMG, PH } from './config.js';
import { state } from './state.js';
import { esc, debounce, $ } from './ui.js';
import { buildCard, personCard } from './cards.js';
import { registerActions } from './events.js';

export function openSearch() {
  $('searchOv').classList.add('active');
  setTimeout(() => $('searchIn').focus(), 150);
  loadTrending();
  renderSearchHistory();
  renderRecentStrip();
}
export function closeSearch() {
  $('searchOv').classList.remove('active');
  $('searchIn').value = '';
  $('searchDefault').style.display = 'block';
  $('searchResultsWrap').style.display = 'none';
}
export function isSearchOpen() { return $('searchOv').classList.contains('active'); }

function setFilter(f, el) {
  state.searchFilt = f;
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.f === f));
  const q = $('searchIn').value.trim();
  if (q.length >= 2) doSearch(q);
}

export async function doSearch(q) {
  $('searchDefault').style.display = 'none';
  $('searchResultsWrap').style.display = 'block';
  try {
    const d = await tmdb(`/search/${state.searchFilt}`, { query: q });
    const g = $('searchGrid'); const empty = $('searchEmpty');
    if (!d.results.length) { g.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    g.innerHTML = d.results.slice(0, 24).map(r => {
      const t = state.searchFilt === 'multi' ? (r.media_type || 'movie') : state.searchFilt;
      return t === 'person' ? personCard(r) : buildCard(r, t);
    }).join('');
  } catch (e) { console.error(e); }
}

async function loadTrending() {
  try { const d = await tmdb('/trending/all/day'); $('trendGrid').innerHTML = d.results.slice(0, 12).map(r => buildCard(r, r.media_type)).join(''); } catch (e) {}
}

function addToHistory(q) {
  if (!state.user) return;
  state.searchHistory = state.searchHistory.filter(h => h !== q);
  state.searchHistory.unshift(q);
  state.searchHistory = state.searchHistory.slice(0, 8);
  try { localStorage.setItem('cv_history_' + state.user.uid, JSON.stringify(state.searchHistory)); } catch (e) {}
  renderSearchHistory();
}

function renderSearchHistory() {
  const w = $('searchHistoryWrap');
  if (!state.searchHistory.length) { w.innerHTML = ''; return; }
  w.innerHTML = `<div class="search-section-title">Recent Searches</div><div class="search-history">${state.searchHistory.map((h, i) => `<div class="search-history-item" role="button" tabindex="0" data-action="history-search" data-q="${esc(h)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span></span><span class="remove" data-action="history-remove" data-i="${i}">✕</span></div>`).join('')}</div>`;
  // Fill text via textContent so quotes/entities can never break markup.
  w.querySelectorAll('.search-history-item').forEach((el, i) => { el.querySelector('span:not(.remove)').textContent = state.searchHistory[i]; });
}

function renderRecentStrip() {
  const wrap = $('recentStrip'); if (!wrap) return;
  const items = state.recentlyViewed.slice(0, 12);
  if (!items.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<div class="search-section-title">Recently Viewed</div><div class="search-grid">${items.map(r => buildCard({ id: r.id, title: r.title, name: r.title, poster_path: r.poster, media_type: r.type, genre_ids: r.genres || [] }, r.type)).join('')}</div>`;
}

function removeHistory(i) {
  state.searchHistory.splice(i, 1);
  if (state.user) { try { localStorage.setItem('cv_history_' + state.user.uid, JSON.stringify(state.searchHistory)); } catch (e) {} }
  renderSearchHistory();
}

export function initSearch() {
  const input = $('searchIn');
  input.addEventListener('input', debounce(function () {
    const q = this.value.trim();
    if (q.length < 2) { $('searchDefault').style.display = 'block'; $('searchResultsWrap').style.display = 'none'; return; }
    doSearch(q);
  }, 300));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { const q = e.target.value.trim(); if (q.length >= 2) { addToHistory(q); doSearch(q); } } });

  registerActions({
    'open-search': () => openSearch(),
    'close-search': () => closeSearch(),
    'set-filter': (el) => setFilter(el.dataset.f, el),
    'history-search': (el) => { const q = el.dataset.q ? decodeEntities(el.dataset.q) : (el.querySelector('span')?.textContent || ''); $('searchIn').value = q; doSearch(q); addToHistory(q); },
    'history-remove': (el, e) => { e.stopPropagation(); removeHistory(+el.dataset.i); },
  });
}

function decodeEntities(s) { const d = document.createElement('textarea'); d.innerHTML = s; return d.value; }
