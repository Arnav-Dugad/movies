// ===== EPISODE RATINGS GRID =====
// The whole series at once: seasons across the top, episode numbers down the
// side, every cell an episode's rating in its band's colour, with each season's
// average along the bottom. It is the view that makes a show's shape obvious —
// which season sagged, which finale landed.
//
// The ratings are TMDB's, the same ones the season heatmap and every episode
// card already show, so the grid never disagrees with the page behind it. (The
// free IMDb catalogue CineVerse uses for a title's own score does not publish
// trustworthy per-episode ratings — it returns a show's episodes unrated, or
// rated on another scale entirely — so it is not used here.)
//
// Episodes you have watched are ringed, the best episode is marked, and picking
// a cell opens that episode in the list behind.
import { tmdb } from './api.js';
import { esc } from './ui.js';
import { showEntry } from './episodes.js';

export const BANDS = [
  ['great', '9.0+'],
  ['good', '8.0–8.9'],
  ['fair', '7.0–7.9'],
  ['weak', '6.0–6.9'],
  ['poor', 'Below 6'],
  ['none', 'Not rated'],
];

/** Pure: a 0-10 rating's band, for colour. */
export function bandFor(rating) {
  const value = +rating;
  if (!Number.isFinite(value) || value <= 0) return 'none';
  if (value >= 9) return 'great';
  if (value >= 8) return 'good';
  if (value >= 7) return 'fair';
  if (value >= 6) return 'weak';
  return 'poor';
}

/**
 * Pure: the grid to draw, from TMDB season payloads.
 * @returns {{ seasons: number[], rows: number, cells: object, averages: object, best: string, rated: number }}
 */
export function gridModel(payloads = []) {
  const cells = {};
  const seasons = [];
  let rows = 0;
  for (const payload of payloads) {
    const season = +payload?.season_number;
    if (!(season > 0)) continue;
    let any = false;
    for (const episode of payload.episodes || []) {
      const number = +episode?.episode_number;
      const rating = Math.round((+episode?.vote_average || 0) * 10) / 10;
      if (!(number > 0) || !(rating > 0)) continue;
      cells[`${season}-${number}`] = rating;
      rows = Math.max(rows, number);
      any = true;
    }
    if (any) seasons.push(season);
  }
  seasons.sort((a, b) => a - b);
  const averages = {};
  for (const season of seasons) {
    const values = Object.entries(cells).filter(([key]) => +key.split('-')[0] === season).map(([, value]) => value);
    averages[season] = values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : 0;
  }
  const entries = Object.entries(cells);
  const best = entries.length ? entries.reduce((top, row) => (row[1] > top[1] ? row : top))[0] : '';
  return { seasons, rows, cells, averages, best, rated: entries.length };
}

/** Pure: a short sentence about the shape of the show. */
export function gridHeadline(model) {
  if (!model.rated || !model.seasons.length) return '';
  const best = model.best ? `S${model.best.split('-')[0]} E${model.best.split('-')[1]} (${model.cells[model.best].toFixed(1)})` : '';
  if (model.seasons.length === 1) return `${model.rated} episodes rated · best ${best}`;
  const ranked = [...model.seasons].sort((a, b) => model.averages[b] - model.averages[a]);
  const top = ranked[0], bottom = ranked[ranked.length - 1];
  return `Season ${top} rates highest (${model.averages[top].toFixed(1)}), season ${bottom} lowest (${model.averages[bottom].toFixed(1)}) · best ${best}`;
}

const cellClass = rating => `eg-cell band-${bandFor(rating)}`;

function gridHTML(title, model, watched) {
  const head = model.seasons.map(season => `<th scope="col">S${season}</th>`).join('');
  const body = Array.from({ length: model.rows }, (_, index) => {
    const episode = index + 1;
    const cells = model.seasons.map(season => {
      const key = `${season}-${episode}`;
      const rating = model.cells[key];
      if (!rating) return '<td class="eg-empty-cell" aria-hidden="true"></td>';
      const seen = watched(season, episode);
      const marks = `${model.best === key ? ' is-best' : ''}${seen ? ' seen' : ''}`;
      return `<td><button type="button" class="${cellClass(rating)}${marks}" data-action="episode-grid-open" data-sn="${season}" data-en="${episode}"
        aria-label="Season ${season}, episode ${episode}: ${rating.toFixed(1)} out of 10${seen ? ', watched' : ''}">${rating.toFixed(1)}</button></td>`;
    }).join('');
    return `<tr><th scope="row">E${episode}</th>${cells}</tr>`;
  }).join('');
  const averages = model.seasons.map(season => {
    const value = model.averages[season];
    return `<td>${value ? `<span class="${cellClass(value)} is-avg">${value.toFixed(1)}</span>` : ''}</td>`;
  }).join('');
  return `<div class="eg-head">
      <div><h2>Episode Ratings</h2><p>${esc(title)}</p></div>
      <button type="button" class="eg-close" data-action="episode-grid-close" aria-label="Close">&times;</button>
    </div>
    <div class="eg-legend">${BANDS.map(([band, label]) => `<span><i class="band-${band}"></i>${label}</span>`).join('')}</div>
    <div class="eg-scroll"><table class="eg-table"><thead><tr><td></td>${head}</tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><th scope="row">AVG</th>${averages}</tr></tfoot></table></div>
    <p class="eg-note">${esc(gridHeadline(model))}</p>
    <p class="eg-source">TMDB episode ratings, the same ones on every episode card. A ring marks what you have watched; the white outline is the highest-rated episode.</p>`;
}

let sheet = null, run = 0;
export function closeGrid() {
  if (!sheet) return;
  run++;
  const node = sheet;
  sheet = null;
  node.classList.remove('is-open');
  setTimeout(() => node.remove(), 240);
}

/** Every season of a series, a few requests at a time. */
async function loadSeasons(tid, numbers) {
  const wanted = [...new Set(numbers.map(Number).filter(number => number > 0))].sort((a, b) => a - b);
  const payloads = new Array(wanted.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < wanted.length) {
      const index = cursor++;
      payloads[index] = await tmdb(`/tv/${tid}/season/${wanted[index]}`).catch(() => null);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return payloads.filter(Boolean);
}

/** Open the grid for one series. */
export async function openEpisodeGrid(tid, seasonNumbers = [], title = '') {
  closeGrid();
  const mine = ++run;
  sheet = document.createElement('div');
  sheet.className = 'eg-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Episode ratings');
  sheet.innerHTML = `<div class="eg-card"><div class="eg-head"><div><h2>Episode Ratings</h2><p>${esc(title)}</p></div>
    <button type="button" class="eg-close" data-action="episode-grid-close" aria-label="Close">&times;</button></div>
    <div class="eg-loading">Reading every season…</div></div>`;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet?.classList.add('is-open'));
  sheet.addEventListener('click', event => {
    if (event.target === sheet || event.target.closest('.eg-close')) closeGrid();
  });

  const payloads = await loadSeasons(tid, seasonNumbers);
  if (mine !== run || !sheet?.isConnected) return;
  const model = gridModel(payloads);
  const entry = showEntry(+tid);
  const seen = (season, episode) => (entry?.seasons?.[String(season)] || []).includes(episode);
  const card = sheet.querySelector('.eg-card');
  if (!model.rated) {
    card.querySelector('.eg-loading').textContent = 'No episode ratings are published for this series yet.';
    card.querySelector('.eg-loading').className = 'eg-empty';
    return;
  }
  card.innerHTML = gridHTML(title, model, seen);
}
