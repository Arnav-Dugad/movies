// ===== /box-office =====
import { $, esc, debounce } from './ui.js';
import { IMG, PH } from './config.js';
import { registerActions } from './events.js';
import { observeReveals } from './effects.js';
import { grossingMoviesPage, formatGross, financials } from './box-office.js';

let items = [], nextPage = 1, totalPages = 1, loading = false;
let query = '', sort = 'gross', decade = 'all';

export async function renderBoxOfficePage({ reset = false } = {}) {
  const host = $('boxOfficeContent'); if (!host) return;
  if (reset || !items.length) {
    items = []; nextPage = 1; totalPages = 1;
    host.innerHTML = shell('<div class="bo-page-loading"><i></i><i></i><i></i></div>');
    await loadNext();
    return;
  }
  paint();
}

async function loadNext() {
  if (loading || nextPage > totalPages) return;
  loading = true;
  const button = document.querySelector('[data-action="box-office-more"]');
  if (button) { button.disabled = true; button.textContent = 'Loading…'; }
  try {
    const data = await grossingMoviesPage(nextPage);
    totalPages = data.totalPages;
    const known = new Set(items.map(movie => movie.id));
    items.push(...data.rows.filter(movie => !known.has(movie.id)));
    items.sort((a, b) => b.revenue - a.revenue);
    nextPage++;
    paint();
  } catch (error) {
    console.warn('box office page', error);
    if (!items.length) $('boxOfficeContent').innerHTML = shell('<div class="wl-empty"><h3>Box-office data is unavailable</h3><p>TMDB did not answer. Try again in a moment.</p><br><button class="btn-primary" data-action="box-office-retry">Try again</button></div>');
  } finally { loading = false; }
}

function shell(body) {
  return `<section class="bo-page-hero"><div><span>Worldwide theatrical revenue</span><h1>Highest Grossing Movies</h1><p>A living all-time chart using reported worldwide gross in US dollars. Open any film for its complete financial breakdown.</p></div><div class="bo-page-orbit" aria-hidden="true"><b>$</b><i></i></div></section>
    <section class="bo-page-tools"><div class="watched-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><input id="boxOfficeSearch" value="${esc(query)}" placeholder="Search this chart…" aria-label="Search highest grossing movies"></div><select class="watched-select" data-action="box-office-decade" aria-label="Release decade"><option value="all">All decades</option>${[2020,2010,2000,1990,1980,1970].map(year => `<option value="${year}"${decade === String(year) ? ' selected' : ''}>${year}s</option>`).join('')}</select><select class="watched-select" data-action="box-office-sort" aria-label="Sort chart"><option value="gross"${sort === 'gross' ? ' selected' : ''}>Worldwide gross</option><option value="profit"${sort === 'profit' ? ' selected' : ''}>Reported profit</option><option value="roi"${sort === 'roi' ? ' selected' : ''}>Return on budget</option><option value="year"${sort === 'year' ? ' selected' : ''}>Newest release</option></select></section>${body}`;
}

function paint() {
  const host = $('boxOfficeContent'); if (!host) return;
  const q = query.trim().toLowerCase();
  let rows = items.map((movie, index) => ({ movie, rank: index + 1, money: financials(movie) }))
    .filter(row => (!q || row.movie.title.toLowerCase().includes(q)) && (decade === 'all' || Math.floor(+(row.movie.release_date || '').slice(0, 4) / 10) * 10 === +decade));
  if (sort === 'profit') rows.sort((a, b) => b.money.profit - a.money.profit || a.rank - b.rank);
  else if (sort === 'roi') rows.sort((a, b) => (b.money.roi ?? -Infinity) - (a.money.roi ?? -Infinity) || a.rank - b.rank);
  else if (sort === 'year') rows.sort((a, b) => (b.movie.release_date || '').localeCompare(a.movie.release_date || ''));
  else rows.sort((a, b) => a.rank - b.rank);
  const total = items.reduce((sum, movie) => sum + (+movie.revenue || 0), 0);
  const body = `<div class="bo-page-summary"><span><b>${items.length}</b> films loaded</span><span><b>${formatGross(total, { compact: true })}</b> combined gross</span><span><b>USD</b> nominal values</span></div>
    <div class="bo-chart">${rows.length ? rows.map(chartRow).join('') : '<div class="wl-empty"><h3>No films match</h3><p>Try a different title or decade.</p></div>'}</div>
    ${nextPage <= totalPages ? '<div class="load-more-wrap"><button class="load-more" data-action="box-office-more">Load 20 more</button></div>' : '<p class="bo-source-note">Showing the available all-time chart. Revenue is reported metadata and may be revised.</p>'}`;
  host.innerHTML = shell(body);
  const search = $('boxOfficeSearch'); if (search) search.addEventListener('input', searchInput);
  observeReveals(host);
}

function chartRow({ movie, rank, money }) {
  const year = (movie.release_date || '').slice(0, 4) || '—';
  return `<article class="bo-chart-row reveal">
    <span class="bo-chart-rank">${String(rank).padStart(2, '0')}</span>
    <a class="bo-chart-art" href="/movie/${movie.id}" data-action="open-detail" data-id="${movie.id}" data-type="movie"><img src="${movie.poster_path ? `${IMG}w185${movie.poster_path}` : PH}" alt="" loading="lazy"></a>
    <div class="bo-chart-copy"><span>${year}${movie.runtime ? ` · ${movie.runtime} min` : ''}</span><a href="/movie/${movie.id}" data-action="open-detail" data-id="${movie.id}" data-type="movie">${esc(movie.title)}</a><div class="bo-chart-track"><i style="width:${Math.max(4, money.revenue / Math.max(1, items[0]?.revenue || money.revenue) * 100)}%"></i></div></div>
    <div class="bo-chart-money"><small>Worldwide gross</small><strong>${formatGross(money.revenue)}</strong></div>
    <div class="bo-chart-finance"><span><small>Budget</small><b>${formatGross(money.budget, { compact: true })}</b></span><span><small>Profit</small><b class="${money.profit < 0 ? 'loss' : ''}">${money.budget ? formatGross(money.profit, { compact: true }) : '—'}</b></span><span><small>ROI</small><b>${money.roi == null ? '—' : `${Math.round(money.roi).toLocaleString()}%`}</b></span></div>
  </article>`;
}

const searchInput = debounce(event => { query = event.target.value; paint(); $('boxOfficeSearch')?.focus(); }, 180);

export function initBoxOfficePage() {
  registerActions({
    'box-office-more': () => loadNext(),
    'box-office-retry': () => renderBoxOfficePage({ reset: true }),
    'box-office-sort': el => { sort = el.value; paint(); },
    'box-office-decade': el => { decade = el.value; paint(); },
  });
}
