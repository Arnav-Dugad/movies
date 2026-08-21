// ===== STUDIO / NETWORK PAGE =====
// Opened from a production-company logo or a network chip on the detail page.
// The old page showed one popularity-sorted page of movies and one of shows.
// This one exposes the whole catalogue: sortable, filterable by decade and
// rating, with real counts and a decade profile so a studio's era is visible at
// a glance.
import { tmdb } from './api.js';
import { IMG, regionName } from './config.js';
import { esc, $ } from './ui.js';
import { buildCard, skelCards } from './cards.js';
import { registerActions } from './events.js';
import { observeReveals } from './effects.js';

let reqGen = 0;
let company = null, kind = 'company', companyId = null;
let view = { type: 'movie', sort: 'popularity.desc', decade: '', rating: 0 };
let pages = { movie: 0, tv: 0 }, maxPages = { movie: 1, tv: 1 }, totals = { movie: 0, tv: 0 };
let loaded = { movie: [], tv: [] };   // everything fetched so far, for the decade profile

const SORTS = [
  ['popularity.desc', 'Most popular'],
  ['vote_average.desc', 'Highest rated'],
  ['vote_count.desc', 'Most discussed'],
  ['date.desc', 'Newest first'],
  ['date.asc', 'Oldest first'],
  ['revenue.desc', 'Highest grossing'],
];
const DECADES = [['', 'Any era'], ['2020', '2020s'], ['2010', '2010s'], ['2000', '2000s'], ['1990', '1990s'], ['1980', '1980s'], ['1970', '1970s'], ['older', 'Before 1970']];

const isNetwork = () => kind === 'network';
const dateField = type => (type === 'tv' ? 'first_air_date' : 'primary_release_date');

// A network only has shows; a company has both. `with_networks` and
// `with_companies` are different discover parameters, so the filter is chosen by
// what we are actually looking at rather than by the tab.
function discoverParams(type, page) {
  const date = dateField(type);
  const params = {
    page,
    sort_by: view.sort === 'date.desc' ? `${date}.desc` : view.sort === 'date.asc' ? `${date}.asc` : view.sort,
    include_adult: false,
  };
  if (isNetwork() && type === 'tv') params.with_networks = companyId;
  else params.with_companies = companyId;
  if (view.decade === 'older') params[`${date}.lte`] = '1969-12-31';
  else if (view.decade) { params[`${date}.gte`] = `${view.decade}-01-01`; params[`${date}.lte`] = `${+view.decade + 9}-12-31`; }
  if (view.rating) { params['vote_average.gte'] = view.rating; params['vote_count.gte'] = 50; }
  else if (view.sort === 'vote_average.desc') params['vote_count.gte'] = 100;
  if (view.sort === 'revenue.desc' && type === 'tv') params.sort_by = 'popularity.desc';   // revenue is movie-only
  return params;
}

const fetchPage = (type, page) => tmdb(`/discover/${type}`, discoverParams(type, page));

// ---------- decade profile ----------
// A single series (titles per decade) rendered as a plain bar row: one hue, the
// busiest decade emphasised, every bar directly labelled because there are only
// a handful of them.
function decadeProfile(rows) {
  const decades = new Map();
  rows.forEach(item => {
    const year = +String(item.release_date || item.first_air_date || '').slice(0, 4);
    if (!year) return;
    const decade = Math.floor(year / 10) * 10;
    decades.set(decade, (decades.get(decade) || 0) + 1);
  });
  if (decades.size < 2) return '';
  const ordered = [...decades.entries()].sort((a, b) => a[0] - b[0]);
  const max = Math.max(...ordered.map(entry => entry[1]));
  return `<div class="studio-decades">
    <span class="studio-decade-label">${rows.length} loaded title${rows.length === 1 ? '' : 's'} by decade</span>
    <div class="studio-decade-row">${ordered.map(([decade, count]) => `<div class="studio-decade${count === max ? ' peak' : ''}"><i style="--decade-h:${Math.max(10, Math.round(count / max * 100))}%"></i><b>${count}</b><span>${decade}s</span></div>`).join('')}</div>
  </div>`;
}

function toolbar() {
  const option = (value, label, current) => `<option value="${value}"${String(value) === String(current) ? ' selected' : ''}>${esc(label)}</option>`;
  const tabs = isNetwork() ? [['tv', 'TV Shows']] : [['movie', 'Movies'], ['tv', 'TV Shows']];
  return `<div class="studio-toolbar">
    <div class="studio-tabs" role="tablist">${tabs.map(([value, label]) => `<button class="${view.type === value ? 'active' : ''}" role="tab" aria-selected="${view.type === value}" data-action="studio-type" data-type="${value}">${label}${totals[value] ? `<b>${totals[value].toLocaleString()}</b>` : ''}</button>`).join('')}</div>
    <div class="studio-filters">
      <label><span>Sort</span><select data-action="studio-sort">${SORTS.filter(([value]) => !(value === 'revenue.desc' && view.type === 'tv')).map(([value, label]) => option(value, label, view.sort)).join('')}</select></label>
      <label><span>Era</span><select data-action="studio-decade">${DECADES.map(([value, label]) => option(value, label, view.decade)).join('')}</select></label>
      <label><span>Rating</span><select data-action="studio-rating">${[[0, 'Any rating'], [6, '6+'], [7, '7+'], [8, '8+']].map(([value, label]) => option(value, label, view.rating)).join('')}</select></label>
    </div>
  </div>`;
}

function resultsHTML(rows, type) {
  if (!rows.length) return `<p class="studio-empty">Nothing matches these filters. Try a wider era or a lower rating.</p>`;
  return `${decadeProfile(rows)}<div class="browse-grid" id="studioGrid">${rows.map(item => buildCard(item, type)).join('')}</div>
    ${pages[type] < maxPages[type] ? `<div class="studio-more"><button class="btn-glass" data-action="studio-more">Load more ${type === 'tv' ? 'shows' : 'movies'}</button></div>` : ''}`;
}

// `reset` rebuilds from page 1; otherwise the NEXT page is appended. The page
// counter advances here rather than in the click handler so a failed request
// leaves it untouched and the retry asks for the same page instead of skipping
// one — and the button is always restored, which is what previously made
// "Load more" work exactly once and then sit disabled forever.
async function renderResults({ reset = true } = {}) {
  const host = $('studioResults'); if (!host) return;
  const gen = reqGen;
  const type = view.type;
  const button = reset ? null : document.querySelector('.studio-more button');
  const wanted = reset ? 1 : pages[type] + 1;
  if (reset) host.innerHTML = `<div class="browse-grid">${skelCards(12)}</div>`;
  else if (button) { button.disabled = true; button.textContent = 'Loading…'; }
  try {
    const data = await fetchPage(type, wanted);
    if (gen !== reqGen) return;
    pages[type] = wanted;
    maxPages[type] = Math.min(data.total_pages || 1, 500);   // TMDB refuses page > 500
    totals[type] = data.total_results || 0;
    const rows = data.results || [];
    if (reset) {
      loaded[type] = rows;
      host.innerHTML = resultsHTML(rows, type);
    } else {
      loaded[type] = [...(loaded[type] || []), ...rows];
      const grid = $('studioGrid');
      if (grid) grid.insertAdjacentHTML('beforeend', rows.map(item => buildCard(item, type)).join(''));
      // The decade profile describes everything loaded so far, so it grows too —
      // and it may not exist yet, because one page can span a single decade.
      const decades = host.querySelector('.studio-decades');
      const markup = decadeProfile(loaded[type]);
      if (decades) decades.outerHTML = markup;
      else if (markup && grid) grid.insertAdjacentHTML('beforebegin', markup);
      if (pages[type] >= maxPages[type] || !rows.length) document.querySelector('.studio-more')?.remove();
      else if (button) { button.disabled = false; button.textContent = `Load more ${type === 'tv' ? 'shows' : 'movies'}`; }
    }
    const bar = $('studioToolbar'); if (bar) bar.innerHTML = toolbar();
    requestAnimationFrame(() => host.querySelectorAll('.studio-decade i').forEach(node => { node.style.height = node.style.getPropertyValue('--decade-h'); }));
    observeReveals(host);
  } catch (error) {
    if (gen !== reqGen) return;
    console.error('studio results', error);
    if (reset) host.innerHTML = `<p class="studio-empty">Could not load titles. <button class="link-btn" data-action="studio-retry">Try again</button></p>`;
    else if (button) { button.disabled = false; button.textContent = 'Retry loading more'; }
  }
}

export async function openStudio(id, mode = 'company') {
  const gen = ++reqGen;
  companyId = id; kind = mode;
  view = { type: mode === 'network' ? 'tv' : 'movie', sort: 'popularity.desc', decade: '', rating: 0 };
  pages = { movie: 0, tv: 0 }; maxPages = { movie: 1, tv: 1 }; totals = { movie: 0, tv: 0 }; loaded = { movie: [], tv: [] };
  const ct = $('studioContent');
  if (!ct) return;
  ct.innerHTML = '<div style="text-align:center;padding:100px"><div class="loader-text">Loading...</div></div>';
  document.title = 'Loading… — CineVerse';
  try {
    const [info, movieCount, tvCount] = await Promise.all([
      tmdb(`/${mode === 'network' ? 'network' : 'company'}/${id}`),
      mode === 'network' ? Promise.resolve({ total_results: 0 }) : tmdb('/discover/movie', { with_companies: id, page: 1 }).catch(() => ({ total_results: 0 })),
      tmdb('/discover/tv', mode === 'network' ? { with_networks: id, page: 1 } : { with_companies: id, page: 1 }).catch(() => ({ total_results: 0 })),
    ]);
    if (gen !== reqGen) return;
    company = info;
    totals.movie = movieCount.total_results || 0;
    totals.tv = tvCount.total_results || 0;
    document.title = `${info.name} — CineVerse`;

    const logo = info.logo_path ? `${IMG}w300${info.logo_path}` : '';
    const facts = [
      totals.movie ? ['Movies', totals.movie.toLocaleString()] : null,
      totals.tv ? [mode === 'network' ? 'Shows' : 'TV shows', totals.tv.toLocaleString()] : null,
      info.origin_country ? ['Country', regionName(info.origin_country)] : null,
      info.headquarters ? ['Headquarters', info.headquarters] : null,
      info.parent_company?.name ? ['Parent', info.parent_company.name] : null,
    ].filter(Boolean);

    ct.innerHTML = `
      <div class="studio-top">
        <div class="studio-logo-lg">${logo ? `<img src="${logo}" alt="${esc(info.name)}">` : `<span class="studio-mono">${esc((info.name || '?')[0])}</span>`}</div>
        <div class="studio-head">
          <h1 class="studio-name">${esc(info.name)}</h1>
          <div class="studio-meta">${mode === 'network' ? 'Television network' : 'Production company'}</div>
          ${info.description ? `<p class="person-bio">${esc(info.description)}</p>` : ''}
          ${info.homepage ? `<div class="person-links"><a href="${esc(info.homepage)}" target="_blank" rel="noopener">Official site<i>↗</i></a></div>` : ''}
        </div>
      </div>
      ${facts.length ? `<div class="studio-facts">${facts.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(String(value))}</strong></div>`).join('')}</div>` : ''}
      <div id="studioToolbar">${toolbar()}</div>
      <div id="studioResults"></div>`;
    observeReveals(ct);
    renderResults();
  } catch (error) {
    console.error('openStudio', error);
    if (gen !== reqGen) return;
    ct.innerHTML = '<div style="text-align:center;padding:100px 20px"><p style="color:var(--text3)">Failed to load</p><br><button class="btn-primary" data-action="back">Back</button></div>';
  }
}

export function initStudio() {
  registerActions({
    'open-studio': (el, e) => { if (e) e.stopPropagation(); document.dispatchEvent(new CustomEvent('cv:go', { detail: `/studio/${+el.dataset.id}` })); },
    'open-network': (el, e) => { if (e) e.stopPropagation(); document.dispatchEvent(new CustomEvent('cv:go', { detail: `/network/${+el.dataset.id}` })); },
    'studio-type': el => { view.type = el.dataset.type; renderResults(); },
    'studio-sort': el => { view.sort = el.value; renderResults(); },
    'studio-decade': el => { view.decade = el.value; renderResults(); },
    'studio-rating': el => { view.rating = +el.value || 0; renderResults(); },
    'studio-more': () => renderResults({ reset: false }),
    'studio-retry': () => renderResults(),
  });
}
