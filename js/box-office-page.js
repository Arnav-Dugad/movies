// ===== /box-office =====
import { $, esc, debounce } from './ui.js';
import { IMG, PH } from './config.js';
import { registerActions } from './events.js';
import { observeReveals } from './effects.js';
import { grossingMoviesPage, formatGross, financials, franchiseBoxOfficeLeague, directorBoxOfficeRanking } from './box-office.js';

let items = [], nextPage = 1, totalPages = 1, loading = false;
let chartRequested = 0, chartUpdatedAt = 0;
let query = '', sort = 'gross', decade = 'all', view = 'movies';
let franchiseRows = null, directorRows = null, rankRun = 0;
let chartDepthPromise = null;

export async function renderBoxOfficePage({ reset = false } = {}) {
  const host = $('boxOfficeContent'); if (!host) return;
  if (reset || !items.length) {
    items = []; nextPage = 1; totalPages = 1; chartRequested = 0; chartUpdatedAt = 0; franchiseRows = null; directorRows = null;
    host.innerHTML = shell('<div class="bo-page-loading"><i></i><i></i><i></i></div>');
    await loadNext(); return;
  }
  paint();
}

async function loadNext({ paintAfter = true } = {}) {
  if (loading || nextPage > totalPages) return false;
  loading = true;
  const button = document.querySelector('[data-action="box-office-more"]');
  if (button) { button.disabled = true; button.textContent = 'Loading…'; }
  try {
    const data = await grossingMoviesPage(nextPage);
    totalPages = data.totalPages;
    chartRequested += Math.max(0, +data.requested || data.rows.length);
    chartUpdatedAt = Math.max(chartUpdatedAt, +data.updatedAt || Date.now());
    const known = new Set(items.map(movie => movie.id));
    items.push(...data.rows.filter(movie => !known.has(movie.id)));
    items.sort((a, b) => b.revenue - a.revenue);
    nextPage++; franchiseRows = null; directorRows = null;
    if (paintAfter) paint();
    return true;
  } catch (error) {
    console.warn('box office page', error);
    if (!items.length) $('boxOfficeContent').innerHTML = shell('<div class="wl-empty"><h3>Box-office data is unavailable</h3><button class="btn-primary" data-action="box-office-retry">Try again</button></div>');
    return false;
  } finally { loading = false; }
}

async function loadCompleteChart() {
  if (!chartDepthPromise) chartDepthPromise = (async () => {
    while (nextPage <= totalPages) {
      const loaded = await loadNext({ paintAfter: false });
      if (!loaded) break;
    }
  })().finally(() => { chartDepthPromise = null; });
  return chartDepthPromise;
}

const tab = (id, label) => `<button class="bo-view-tab${view === id ? ' on' : ''}" data-action="box-office-view" data-view="${id}" aria-pressed="${view === id}">${label}</button>`;

function freshness(timestamp) {
  const age = Math.max(0, Date.now() - (+timestamp || 0));
  if (age < 3600000) return 'Fresh';
  if (age < 86400000) return `${Math.max(1, Math.floor(age / 3600000))}h old`;
  return `${Math.max(1, Math.floor(age / 86400000))}d old`;
}

const freshnessChip = timestamp => timestamp ? `<time class="bo-freshness" title="Updated ${esc(new Date(timestamp).toLocaleString())}">${esc(freshness(timestamp))}</time>` : '';

function shell(body) {
  return `<section class="bo-page-hero"><div><span>Worldwide revenue</span><h1>Box Office</h1></div><div class="bo-page-orbit" aria-hidden="true"><b>$</b><i></i></div></section>
    <nav class="bo-view-tabs" aria-label="Box-office rankings">${tab('movies', 'Movies')}${tab('franchises', 'Franchises')}${tab('directors', 'Directors')}</nav>${tools()}${body}`;
}

function tools() {
  const search = `<div class="watched-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><input id="boxOfficeSearch" value="${esc(query)}" placeholder="Search ${view}…" aria-label="Search ${view}"></div>`;
  if (view !== 'movies') return `<section class="bo-page-tools">${search}</section>`;
  return `<section class="bo-page-tools">${search}<select class="watched-select" data-action="box-office-decade" aria-label="Release decade"><option value="all">All decades</option>${[2020,2010,2000,1990,1980,1970].map(year => `<option value="${year}"${decade === String(year) ? ' selected' : ''}>${year}s</option>`).join('')}</select><select class="watched-select" data-action="box-office-sort" aria-label="Sort chart"><option value="gross"${sort === 'gross' ? ' selected' : ''}>Worldwide gross</option><option value="profit"${sort === 'profit' ? ' selected' : ''}>Reported profit</option><option value="roi"${sort === 'roi' ? ' selected' : ''}>Return on budget</option><option value="year"${sort === 'year' ? ' selected' : ''}>Newest release</option></select></section>`;
}

function bindSearch() {
  const search = $('boxOfficeSearch'); if (search) search.addEventListener('input', searchInput);
}

function paint() {
  if (view === 'franchises' || view === 'directors') { paintRanking(); return; }
  const host = $('boxOfficeContent'); if (!host) return;
  const q = query.trim().toLowerCase();
  let rows = items.map((movie, index) => ({ movie, rank: index + 1, money: financials(movie) }))
    .filter(row => (!q || row.movie.title.toLowerCase().includes(q)) && (decade === 'all' || Math.floor(+(row.movie.release_date || '').slice(0, 4) / 10) * 10 === +decade));
  if (sort === 'profit') rows.sort((a, b) => b.money.profit - a.money.profit || a.rank - b.rank);
  else if (sort === 'roi') rows.sort((a, b) => (b.money.roi ?? -Infinity) - (a.money.roi ?? -Infinity) || a.rank - b.rank);
  else if (sort === 'year') rows.sort((a, b) => (b.movie.release_date || '').localeCompare(a.movie.release_date || ''));
  else rows.sort((a, b) => a.rank - b.rank);
  const total = items.reduce((sum, movie) => sum + (+movie.revenue || 0), 0);
  const budgets = items.filter(movie => +movie.budget > 0).length;
  const coverage = chartRequested ? Math.round(items.length / chartRequested * 100) : 0;
  const body = `<div class="bo-page-summary"><span><b>${items.length}</b> films</span><span><b>${formatGross(total, { compact: true })}</b> combined</span><span><b>${coverage}%</b> revenue coverage</span><span><b>${items.length ? Math.round(budgets / items.length * 100) : 0}%</b> budget coverage</span>${freshnessChip(chartUpdatedAt)}</div>
    <div class="bo-chart">${rows.length ? rows.map(chartRow).join('') : '<div class="wl-empty"><h3>No films match</h3></div>'}</div>
    ${nextPage <= totalPages ? '<div class="load-more-wrap"><button class="load-more" data-action="box-office-more">Load 20 more</button></div>' : ''}`;
  host.innerHTML = shell(body); bindSearch(); observeReveals(host);
}

async function showRanking(nextView) {
  view = nextView; query = ''; const run = ++rankRun;
  const host = $('boxOfficeContent'); if (!host) return;
  host.innerHTML = shell('<div class="bo-page-loading"><i></i><i></i><i></i></div>');
  bindSearch();
  await loadCompleteChart();
  if (run !== rankRun || view !== nextView) return;
  try {
    if (nextView === 'franchises' && !franchiseRows) franchiseRows = await franchiseBoxOfficeLeague(items);
    if (nextView === 'directors' && !directorRows) directorRows = await directorBoxOfficeRanking(items);
  } catch (error) { console.warn('box office ranking', error); }
  if (run === rankRun && view === nextView) paintRanking();
}

function paintRanking() {
  const host = $('boxOfficeContent'); if (!host) return;
  const source = view === 'franchises' ? (franchiseRows || []) : (directorRows || []);
  const needle = query.trim().toLowerCase();
  const rows = source.filter(row => !needle || row.name.toLowerCase().includes(needle) || row.topFilm?.title?.toLowerCase().includes(needle));
  const latest = Math.max(chartUpdatedAt, ...source.map(row => +row.updatedAt || 0));
  const covered = view === 'franchises'
    ? Math.round(source.reduce((sum, row) => sum + row.reported, 0) / Math.max(1, source.reduce((sum, row) => sum + row.films, 0)) * 100)
    : Math.round(source.reduce((sum, row) => sum + row.knownBudgets, 0) / Math.max(1, source.reduce((sum, row) => sum + row.films, 0)) * 100);
  const body = `<div class="bo-page-summary"><span><b>${source.length}</b> ranked</span><span><b>${formatGross(source.reduce((sum, row) => sum + row.revenue, 0), { compact: true })}</b> reported</span><span><b>${covered}%</b> ${view === 'directors' ? 'hit-rate coverage' : 'revenue coverage'}</span>${freshnessChip(latest)}</div>
    <div class="bo-league">${rows.length ? rows.map((row, index) => view === 'franchises' ? franchiseRow(row, index) : directorRow(row, index)).join('') : '<div class="wl-empty"><h3>No results</h3></div>'}</div>`;
  host.innerHTML = shell(body); bindSearch(); observeReveals(host);
}

function chartRow({ movie, rank, money }) {
  const year = (movie.release_date || '').slice(0, 4) || '—';
  return `<article class="bo-chart-row reveal"><span class="bo-chart-rank">${String(rank).padStart(2, '0')}</span><a class="bo-chart-art" href="/movie/${movie.id}" data-action="open-detail" data-id="${movie.id}" data-type="movie"><img src="${movie.poster_path ? `${IMG}w185${movie.poster_path}` : PH}" alt="" loading="lazy"></a><div class="bo-chart-copy"><span>${year}${movie.runtime ? ` · ${movie.runtime} min` : ''}</span><a href="/movie/${movie.id}" data-action="open-detail" data-id="${movie.id}" data-type="movie">${esc(movie.title)}</a><div class="bo-chart-track"><i style="width:${Math.max(4, money.revenue / Math.max(1, items[0]?.revenue || money.revenue) * 100)}%"></i></div></div><div class="bo-chart-money"><small>Worldwide</small><strong>${formatGross(money.revenue)}</strong></div><div class="bo-chart-finance"><span><small>Budget</small><b>${formatGross(money.budget, { compact: true })}</b></span><span><small>Profit</small><b class="${money.profit < 0 ? 'loss' : ''}">${money.budget ? formatGross(money.profit, { compact: true }) : '—'}</b></span><span><small>ROI</small><b>${money.roi == null ? '—' : `${Math.round(money.roi).toLocaleString()}%`}</b></span></div></article>`;
}

function franchiseRow(row, index) {
  const max = Math.max(...(row.entries || []).map(entry => entry.revenue), 1);
  const timeline = (row.entries || []).map(entry => `<i style="--bo-film:${entry.revenue ? Math.max(5, Math.round(entry.revenue / max * 100)) : 2}%" title="${esc(entry.title)} — ${esc(formatGross(entry.revenue))}"></i>`).join('');
  return `<a class="bo-league-row reveal" href="/collection/${row.id}" data-action="go-collection" data-cid="${row.id}"><span class="bo-league-rank">${String(index + 1).padStart(2, '0')}</span><img src="${row.poster ? `${IMG}w185${row.poster}` : PH}" alt="" loading="lazy"><span class="bo-league-copy"><strong>${esc(row.name)}</strong><small>${row.reported}/${row.films} reported · ${row.coverage}% coverage${row.topFilm ? ` · ${esc(row.topFilm.title)}` : ''}</small><span class="bo-mini-timeline" aria-label="Film revenue timeline">${timeline}</span></span><span class="bo-league-total"><b>${formatGross(row.revenue)}</b>${freshnessChip(row.updatedAt)}</span></a>`;
}

function directorRow(row, index) {
  const eras = (row.eras || []).map(era => `<span><i>${esc(era.label)}</i><b>${formatGross(era.revenue, { compact: true })}</b><small>${esc(era.yearLabel)}</small></span>`).join('');
  const hit = row.hitRate == null ? 'Hit rate unavailable' : `${row.hitRate}% hit rate · ${row.hits}/${row.knownBudgets}`;
  return `<a class="bo-league-row director reveal" href="/person/${row.id}" data-action="open-person" data-id="${row.id}"><span class="bo-league-rank">${String(index + 1).padStart(2, '0')}</span><img src="${row.profile ? `${IMG}w185${row.profile}` : PH}" alt="" loading="lazy"><span class="bo-league-copy"><strong>${esc(row.name)}</strong><small>${row.films} film${row.films === 1 ? '' : 's'} · ${esc(hit)}${row.topFilm ? ` · ${esc(row.topFilm.title)}` : ''}</small><span class="bo-director-eras" aria-label="${esc(row.name)} career eras">${eras}</span></span><span class="bo-league-total"><b>${formatGross(row.revenue)}</b></span></a>`;
}

const searchInput = debounce(event => {
  query = event.target.value; paint();
  const input = $('boxOfficeSearch'); if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
}, 180);

export function initBoxOfficePage() {
  registerActions({
    'box-office-more': () => loadNext(),
    'box-office-retry': () => renderBoxOfficePage({ reset: true }),
    'box-office-sort': el => { sort = el.value; paint(); },
    'box-office-decade': el => { decade = el.value; paint(); },
    'box-office-view': el => { const next = el.dataset.view; if (next === view) return; next === 'movies' ? (view = next, rankRun++, query = '', paint()) : showRanking(next); },
  });
}
