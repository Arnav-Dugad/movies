// ===== COMPARE MODE =====
import { tmdb } from './api.js';
import { IMG, PH, genreMap } from './config.js';
import { state } from './state.js';
import { esc, toast, $, lockScroll } from './ui.js';
import { fmt } from './ui.js';
import { registerActions } from './events.js';

export function isCompareMode() { return state.compareMode; }

export function toggleCompareMode() {
  state.compareMode = !state.compareMode;
  const bar = $('compareBar');
  if (state.compareMode) {
    toast('Compare mode: pick two titles', 'info');
    bar.classList.add('show');
  } else {
    clearCompare();
    bar.classList.remove('show');
  }
}

function clearCompare() {
  state.compareItems = [];
  document.querySelectorAll('.card.compare-sel').forEach(c => c.classList.remove('compare-sel'));
  updateBar();
}

export function toggleCompareSelect(id, type, el) {
  const idx = state.compareItems.findIndex(c => c.id === id && c.type === type);
  if (idx >= 0) { state.compareItems.splice(idx, 1); el.classList.remove('compare-sel'); }
  else {
    if (state.compareItems.length >= 2) { toast('Two titles max — compare or clear first', 'info'); return; }
    state.compareItems.push({ id, type }); el.classList.add('compare-sel');
  }
  updateBar();
}

function updateBar() {
  const bar = $('compareBar'); if (!bar) return;
  bar.querySelector('.cmp-count').textContent = `${state.compareItems.length}/2 selected`;
  bar.querySelector('.cmp-go').disabled = state.compareItems.length !== 2;
}

async function openCompare() {
  if (state.compareItems.length !== 2) return;
  const ov = $('detailOv'), ct = $('detailContent');
  ov.classList.add('active'); lockScroll();
  ct.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh"><div class="loader-text">Loading comparison…</div></div>';
  try {
    const [a, b] = await Promise.all(state.compareItems.map(c => tmdb(`/${c.type}/${c.id}`)));
    ct.innerHTML = renderCompare(a, state.compareItems[0].type, b, state.compareItems[1].type);
  } catch (e) { ct.innerHTML = '<div style="text-align:center;padding:120px 20px"><p style="font-weight:600">Failed to load comparison</p><button class="btn-primary" data-action="close-detail">Close</button></div>'; }
}

function row(label, a, b) { return `<tr><th>${label}</th><td>${a}</td><td>${b}</td></tr>`; }
function money(v) { return v ? '$' + fmt(v) : '—'; }

function renderCompare(a, ta, b, tb) {
  const info = (d, t) => ({
    title: d.title || d.name || '',
    poster: d.poster_path ? `${IMG}w342${d.poster_path}` : PH,
    year: (d.release_date || d.first_air_date || '').slice(0, 4) || '—',
    rating: d.vote_average ? d.vote_average.toFixed(1) : '—',
    votes: d.vote_count ? d.vote_count.toLocaleString() : '—',
    runtime: d.runtime ? `${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m` : (d.episode_run_time?.length ? `${d.episode_run_time[0]}m/ep` : '—'),
    genres: (d.genres || []).map(g => g.name).join(', ') || '—',
    lang: (d.original_language || '—').toUpperCase(),
    budget: money(d.budget), revenue: money(d.revenue),
    status: d.status || '—',
    kind: t === 'tv' ? 'TV Series' : 'Movie',
    seasons: t === 'tv' ? (d.number_of_seasons || '—') : '—',
  });
  const A = info(a, ta), B = info(b, tb);
  return `<div style="padding:calc(var(--nav-h) + 20px) clamp(16px,4vw,40px) 100px;max-width:1000px;margin:0 auto">
    <h1 style="font-family:var(--font-display);font-size:1.8rem;margin-bottom:20px">Head to Head</h1>
    <div class="compare-poster">
      <div><img src="${A.poster}" alt="${esc(A.title)}" data-ph="${PH}"><h3>${esc(A.title)}</h3></div>
      <div><img src="${B.poster}" alt="${esc(B.title)}" data-ph="${PH}"><h3>${esc(B.title)}</h3></div>
    </div>
    <table class="compare-table" style="margin-top:20px">
      ${row('Type', A.kind, B.kind)}
      ${row('Year', A.year, B.year)}
      ${row('Rating', '⭐ ' + A.rating, '⭐ ' + B.rating)}
      ${row('Votes', A.votes, B.votes)}
      ${row('Runtime', A.runtime, B.runtime)}
      ${row('Genres', esc(A.genres), esc(B.genres))}
      ${row('Language', A.lang, B.lang)}
      ${row('Budget', A.budget, B.budget)}
      ${row('Revenue', A.revenue, B.revenue)}
      ${row('Status', esc(A.status), esc(B.status))}
    </table>
  </div>`;
}

export function initCompare() {
  registerActions({
    'toggle-compare': () => toggleCompareMode(),
    'compare-go': () => openCompare(),
    'compare-clear': () => clearCompare(),
  });
}
