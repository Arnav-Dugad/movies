// ===== SEASON HEATMAP =====
// Every episode of a show as one grid: a row per season, a square per episode,
// coloured by TMDB's community rating, with a tick on the ones you have seen.
// It answers "where does this show peak?" and "how much of the good stuff have
// I seen?" at a glance, and a square opens that episode in the list below.
//
// Honest by construction:
//   - One hue, light to dark (dark to bright on the dark theme), in fixed rating
//     bands so a colour means the same score on every show. The legend names
//     the bands; colour is never the only signal (each square's label and
//     tooltip carry the number).
//   - Episodes without votes are hatched as "No rating", never coloured as low.
//   - Episodes that have not aired are outlined only.
//   - Specials (season 0) are left out; a row's average uses rated episodes.
// Fetched only when opened: one request per season, a few at a time.
import { tmdb } from './api.js';
import { esc } from './ui.js';
import { icon } from './icons.js';

export const RATING_BANDS = [
  { min: 0, label: 'Under 6' }, { min: 6, label: '6' }, { min: 7, label: '7' }, { min: 7.5, label: '7.5' },
  { min: 8, label: '8' }, { min: 8.5, label: '8.5' }, { min: 9, label: '9+' },
];

/** Pure: the band index for a rating, or -1 when there is no community rating. */
export function ratingBand(rating, votes) {
  if (!(+votes > 0) || !(+rating > 0)) return -1;
  let band = 0;
  RATING_BANDS.forEach((entry, index) => { if (+rating >= entry.min) band = index; });
  return band;
}

const today = now => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };
const airedBy = (episode, now) => {
  const at = Date.parse(`${episode.air_date || ''}T00:00:00`);
  return Number.isFinite(at) && at <= today(now);
};

/**
 * Pure: rows for the grid.
 * @param {object[]} seasons  TMDB season payloads ({ season_number, name, episodes })
 * @param {{ isWatched?: (season, episode) => boolean, now?: number }} options
 */
export function heatmapModel(seasons, { isWatched = () => false, now = Date.now() } = {}) {
  const rows = (seasons || [])
    .filter(season => season && +season.season_number > 0 && (season.episodes || []).length)
    .sort((a, b) => a.season_number - b.season_number)
    .map(season => {
      const cells = season.episodes.map(episode => {
        const number = +episode.episode_number;
        const rating = Math.round((+episode.vote_average || 0) * 10) / 10;
        const votes = +episode.vote_count || 0;
        return {
          season: +season.season_number, episode: number, name: episode.name || `Episode ${number}`,
          rating, votes, band: ratingBand(rating, votes), aired: airedBy(episode, now),
          watched: !!isWatched(+season.season_number, number),
        };
      });
      const rated = cells.filter(cell => cell.band >= 0);
      const mean = rated.length ? Math.round((rated.reduce((sum, cell) => sum + cell.rating, 0) / rated.length) * 10) / 10 : 0;
      return { season: +season.season_number, name: season.name || `Season ${season.season_number}`, mean, cells };
    });
  const all = rows.flatMap(row => row.cells);
  // "Best" needs a handful of votes, or one enthusiastic voter crowns an episode.
  const trusted = all.filter(cell => cell.band >= 0 && cell.votes >= 5);
  const pool = trusted.length ? trusted : all.filter(cell => cell.band >= 0);
  const best = pool.reduce((top, cell) => (!top || cell.rating > top.rating || (cell.rating === top.rating && cell.votes > top.votes) ? cell : top), null);
  const aired = all.filter(cell => cell.aired);
  return {
    rows, best,
    watched: all.filter(cell => cell.watched).length,
    aired: aired.length,
    total: all.length,
  };
}

const cellLabel = cell => `Season ${cell.season} episode ${cell.episode}, ${cell.name}, ${cell.band >= 0 ? `rated ${cell.rating.toFixed(1)} from ${cell.votes} vote${cell.votes === 1 ? '' : 's'}` : cell.aired ? 'no rating yet' : 'not aired yet'}${cell.watched ? ', watched' : ''}`;
const cellTip = cell => `S${cell.season} E${cell.episode} · ${cell.name} · ${cell.band >= 0 ? cell.rating.toFixed(1) : cell.aired ? 'No rating' : 'Not aired'}${cell.watched ? ' · Watched' : ''}`;

/** The grid, legend and note for a model. */
export function heatmapHTML(tid, model) {
  if (!model.rows.length) return '<p class="hm-empty">No episode ratings to show yet.</p>';
  const legend = `<div class="hm-legend" aria-hidden="true"><span class="hm-legend-scale">${RATING_BANDS.map((band, index) => `<i class="hm-swatch b${index}"></i>`).join('')}</span><span class="hm-legend-ends"><b>${RATING_BANDS[0].label}</b><b>${RATING_BANDS[RATING_BANDS.length - 1].label}</b></span><span class="hm-legend-key"><i class="hm-swatch none"></i>No rating</span><span class="hm-legend-key"><i class="hm-swatch unaired"></i>Not aired</span><span class="hm-legend-key"><i class="hm-swatch b4 watched"><i class="hm-tick"></i></i>Watched</span></div>`;
  const rows = model.rows.map(row => `<div class="hm-row" role="group" aria-label="${esc(row.name)}${row.mean ? `, average ${row.mean.toFixed(1)}` : ''}">
      <span class="hm-label" aria-hidden="true">S${row.season}</span>
      <div class="hm-cells">${row.cells.map((cell, index) => `<button type="button" class="hm-cell ${cell.band >= 0 ? `b${cell.band}` : cell.aired ? 'none' : 'unaired'}${cell.watched ? ' watched' : ''}${model.best && cell === model.best ? ' best' : ''}" style="--i:${index}" data-action="heatmap-episode" data-tid="${tid}" data-sn="${cell.season}" data-en="${cell.episode}" data-tip="${esc(cellTip(cell))}" aria-label="${esc(cellLabel(cell))}"><i class="hm-tick" aria-hidden="true"></i></button>`).join('')}</div>
      <span class="hm-mean" aria-hidden="true">${row.mean ? row.mean.toFixed(1) : '–'}</span>
    </div>`).join('');
  const best = model.best ? `<span>${icon('starSolid', { cls: 'cv-star' })}Best rated: <b>S${model.best.season} E${model.best.episode} · ${esc(model.best.name)}</b> ${model.best.rating.toFixed(1)}</span>` : '';
  return `${legend}<div class="hm-grid">${rows}</div><p class="hm-note">${best}<span>You've seen ${model.watched} of ${model.aired} aired episode${model.aired === 1 ? '' : 's'}</span><span class="hm-source">Ratings from TMDB; episodes with few votes can swing.</span></p>`;
}

/** The collapsible panel's shell (filled by mountHeatmap when opened). */
export function heatmapShell(tid, expanded) {
  const bodyId = `epHeatmapBody_${tid}`;
  return `<section class="ep-heatmap${expanded ? ' expanded' : ''}" data-dp="seasonHeatmap" id="epHeatmap_${tid}">
    <button type="button" class="ep-heatmap-toggle" data-action="heatmap-toggle" data-tid="${tid}" aria-expanded="${expanded}" aria-controls="${bodyId}">
      <span class="ep-heatmap-icon">${icon('grid')}</span>
      <span class="ep-heatmap-copy"><strong>Season heatmap</strong><small>Every episode by rating, with the ones you've seen ticked</small></span>
      <span class="ep-heatmap-chev">${icon('chevronDown')}</span>
    </button>
    <div class="ep-heatmap-body" id="${bodyId}"${expanded ? '' : ' hidden'}></div>
  </section>`;
}

/** Fetch every season (a few at a time) and draw the grid into the panel. */
export async function mountHeatmap(tid, seasonNumbers, { isWatched, isCurrent = () => true } = {}) {
  const body = document.getElementById(`epHeatmapBody_${tid}`);
  if (!body || body.dataset.state === 'loading' || body.dataset.state === 'ready') return;
  body.dataset.state = 'loading';
  const numbers = [...new Set(seasonNumbers.map(Number).filter(number => number > 0))].sort((a, b) => a - b);
  body.innerHTML = `<div class="hm-loading">${numbers.slice(0, 8).map(() => '<i class="skel"></i>').join('')}</div>`;
  const payloads = new Array(numbers.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < numbers.length) {
      const index = cursor++;
      payloads[index] = await tmdb(`/tv/${tid}/season/${numbers[index]}`).catch(() => null);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const live = document.getElementById(`epHeatmapBody_${tid}`);
  if (!live || !isCurrent()) return;
  live.innerHTML = heatmapHTML(tid, heatmapModel(payloads.filter(Boolean), { isWatched }));
  live.dataset.state = 'ready';
}

/** Repaint the ticks after tracking changes, without refetching. */
export function refreshHeatmapTicks(tid, isWatched) {
  document.querySelectorAll(`#epHeatmapBody_${tid} .hm-cell`).forEach(cell => {
    const on = !!isWatched(+cell.dataset.sn, +cell.dataset.en);
    if (cell.classList.contains('watched') === on) return;
    cell.classList.toggle('watched', on);
    const tip = cell.dataset.tip.replace(/ · Watched$/, '');
    cell.dataset.tip = on ? `${tip} · Watched` : tip;
    const label = cell.getAttribute('aria-label').replace(/, watched$/, '');
    cell.setAttribute('aria-label', on ? `${label}, watched` : label);
  });
  const note = document.querySelector(`#epHeatmapBody_${tid} .hm-note span:nth-last-child(2)`);
  if (note) {
    const cells = [...document.querySelectorAll(`#epHeatmapBody_${tid} .hm-cell`)];
    const aired = cells.filter(cell => !cell.classList.contains('unaired')).length;
    note.textContent = `You've seen ${cells.filter(cell => cell.classList.contains('watched')).length} of ${aired} aired episode${aired === 1 ? '' : 's'}`;
  }
}
