// ===== SEASON HEATMAP =====
// Every episode of a show as one grid: a row per season, a square per episode,
// with a tick on the ones you have seen. It answers "where does this show
// peak?" and "how much of the good stuff have I seen?" at a glance.
//
// Two ways to colour it:
//   - Rating: TMDB's community rating in fixed bands (under 6, 6, 7, 7.5, 8,
//     8.5, 9+), red through yellow to green and a step lighter each band, so a
//     colour means the same score on every show.
//   - Standouts: each episode against its own season's average, red below and
//     green above with grey for "about average", so a strong episode in a weak
//     season is as visible as one in a great season.
//
// Around the grid: a sparkline and average for each season (the strongest
// season marked), a readout for the episode under the pointer or focus (still,
// air date, runtime, rating and votes, how it compares with its season, and
// when you watched it), and three insights — the peak episode, how many of the
// show's best episodes you have seen, and the best-rated aired episodes you
// have not.
//
// The first time you open a show's heatmap its squares light up in the order
// you watched them, each tick drawing itself as its square arrives.
//
// Honest by construction: unrated episodes are hatched ("No rating"), never
// coloured as low; unaired ones are outlined; specials (season 0) are left out;
// averages, "best" and "standouts" use only episodes with votes, and "best"
// needs at least five votes. Every square carries its numbers in its label, so
// colour is never the only signal.
//
// Keyboard: the grid is one tab stop; arrow keys move, Home and End jump along a
// season, Enter opens the episode. With a pointer, hovering shows the readout
// and a click opens; on touch the first tap shows the readout, a second opens.
import { tmdb } from './api.js';
import { IMG } from './config.js';
import { esc } from './ui.js';
import { icon } from './icons.js';

export const RATING_BANDS = [
  { min: 0, label: 'Under 6' }, { min: 6, label: '6' }, { min: 7, label: '7' }, { min: 7.5, label: '7.5' },
  { min: 8, label: '8' }, { min: 8.5, label: '8.5' }, { min: 9, label: '9+' },
];
// Difference from the season average, in rating points: seven bands, grey middle,
// the same distances either side (0.2, 0.5 and 1 point).
export const DELTA_STEPS = [0.2, 0.5, 1];
export const DELTA_BANDS = [0, 1, 2, 3, 4, 5, 6];
const TRUSTED_VOTES = 5;
const MODE_KEY = 'cv_heatmap_mode';
const NUMBERS_KEY = 'cv_heatmap_numbers';
// Two colourings: by rating, or by how an episode compares with its own season.
export const MODES = [['rating', 'Rating'], ['standouts', 'Standouts']];
export const MODE_NAMES = MODES.map(([value]) => value);
/**
 * Pure: a stored mode cleaned to one this build draws.
 * "numbers" used to be a third mode of its own, which meant choosing between
 * seeing the ratings and seeing the colours. It is a switch over either
 * colouring now, so a grid stored in the old mode comes back as Rating — with
 * the numbers on, which is what that mode was for.
 */
export const modeName = value => (MODE_NAMES.includes(String(value)) ? String(value) : 'rating');
/** Pure: is the "show every rating" switch on? */
export const numbersOn = value => value === true || value === 'true' || value === '1' || value === 'numbers';
const LIT_KEY = 'cv_heatmap_lit_v1';

/** Pure: the band index for a rating, or -1 when there is no community rating. */
export function ratingBand(rating, votes) {
  if (!(+votes > 0) || !(+rating > 0)) return -1;
  let band = 0;
  RATING_BANDS.forEach((entry, index) => { if (+rating >= entry.min) band = index; });
  return band;
}

/** Pure: the standout band (0–6, 3 is "about average") for a difference from the season average. */
export function deltaBand(delta) {
  if (typeof delta !== 'number' || !Number.isFinite(delta)) return -1;
  // A hair's tolerance, so a difference that is exactly a step (8.5 − 8.0) is
  // never pushed below it by floating point.
  const size = Math.abs(delta) + 1e-9;
  const level = DELTA_STEPS.filter(step => size >= step).length;
  return 3 + Math.sign(delta) * level;
}

const today = now => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };
const airedBy = (episode, now) => {
  const at = Date.parse(`${episode.air_date || ''}T00:00:00`);
  return Number.isFinite(at) && at <= today(now);
};
const round1 = value => Math.round(value * 10) / 10;

/**
 * Pure: rows, insights and the watch order for the grid.
 * @param {object[]} seasons  TMDB season payloads ({ season_number, name, episodes })
 * @param {{ isWatched?: Function, watchedAt?: Function, now?: number }} options
 *   watchedAt(season, episode) → the moment it was marked, or 0
 */
export function heatmapModel(seasons, { isWatched = () => false, watchedAt = () => 0, now = Date.now() } = {}) {
  const rows = (seasons || [])
    .filter(season => season && +season.season_number > 0 && (season.episodes || []).length)
    .sort((a, b) => a.season_number - b.season_number)
    .map(season => {
      const cells = season.episodes.map(episode => {
        const number = +episode.episode_number;
        const rating = round1(+episode.vote_average || 0);
        const votes = +episode.vote_count || 0;
        const watched = !!isWatched(+season.season_number, number);
        return {
          season: +season.season_number, episode: number, name: episode.name || `Episode ${number}`,
          rating, votes, band: ratingBand(rating, votes), aired: airedBy(episode, now), watched,
          watchedAt: watched ? +watchedAt(+season.season_number, number) || 0 : 0,
          still: episode.still_path || '', airDate: episode.air_date || '', runtime: +episode.runtime || 0,
          delta: null, deltaBand: -1, order: -1,
        };
      });
      const rated = cells.filter(cell => cell.band >= 0);
      const mean = rated.length ? round1(rated.reduce((sum, cell) => sum + cell.rating, 0) / rated.length) : 0;
      // The comparison uses the unrounded average, so rounding never flips a band.
      const exactMean = rated.length ? rated.reduce((sum, cell) => sum + cell.rating, 0) / rated.length : 0;
      if (rated.length >= 2) for (const cell of rated) { cell.delta = round1(cell.rating - exactMean); cell.deltaBand = deltaBand(cell.rating - exactMean); }
      return { season: +season.season_number, name: season.name || `Season ${season.season_number}`, mean, rated: rated.length, cells };
    });

  const all = rows.flatMap(row => row.cells);
  const ratedAll = all.filter(cell => cell.band >= 0);
  const trusted = ratedAll.filter(cell => cell.votes >= TRUSTED_VOTES);
  const pool = trusted.length ? trusted : ratedAll;
  const byRating = (a, b) => b.rating - a.rating || b.votes - a.votes || a.season - b.season || a.episode - b.episode;
  const best = [...pool].sort(byRating)[0] || null;
  const strongest = rows.filter(row => row.rated >= 3).sort((a, b) => b.mean - a.mean || a.season - b.season)[0] || null;
  const showMean = pool.length ? pool.reduce((sum, cell) => sum + cell.rating, 0) / pool.length : 0;
  // The show's best episodes: its top tenth by rating (at least three, at most ten).
  const topCount = Math.min(10, Math.max(3, Math.round(pool.length / 10)));
  const top = [...pool].sort(byRating).slice(0, Math.min(topCount, pool.length));
  const gems = pool.filter(cell => cell.aired && !cell.watched && cell.rating >= showMean).sort(byRating).slice(0, 3);
  // Watch order: marked episodes by when they were marked, ties in episode order.
  // An episode with no stamp predates the log (it was marked before tracking kept
  // one, or fell off its oldest end), so it comes first.
  all.filter(cell => cell.watched)
    .sort((a, b) => (a.watchedAt || 0) - (b.watchedAt || 0) || a.season - b.season || a.episode - b.episode)
    .forEach((cell, index) => { cell.order = index; });
  const scores = ratedAll.map(cell => cell.rating);
  return {
    rows, best, strongest, gems,
    top: { count: top.length, seen: top.filter(cell => cell.watched).length },
    watched: all.filter(cell => cell.watched).length,
    aired: all.filter(cell => cell.aired).length,
    total: all.length,
    range: scores.length ? [Math.min(...scores), Math.max(...scores)] : [0, 0],
    maxEpisodes: Math.max(0, ...rows.map(row => row.cells.length)),
  };
}

// ---------- markup ----------
const TICK = '<svg class="hm-tick" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path pathLength="1" d="M5.5 12.5l4 4 9-9"/></svg>';
const dateLabel = (value, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => {
  const at = typeof value === 'number' ? value : Date.parse(`${value}T00:00:00`);
  return Number.isFinite(at) && at > 0 ? new Date(at).toLocaleDateString(undefined, opts) : '';
};
const signed = value => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toFixed(1)}`;

export function cellLabel(cell) {
  const score = cell.band >= 0 ? `rated ${cell.rating.toFixed(1)} from ${cell.votes} vote${cell.votes === 1 ? '' : 's'}` : cell.aired ? 'no rating yet' : 'not aired yet';
  const versus = cell.delta === null ? '' : cell.deltaBand === 3 ? ', about the season average' : `, ${Math.abs(cell.delta).toFixed(1)} ${cell.delta > 0 ? 'above' : 'below'} the season average`;
  return `Season ${cell.season} episode ${cell.episode}, ${cell.name}, ${score}${versus}${cell.watched ? ', watched' : ''}`;
}

function sparkline(row, range) {
  const points = row.cells.map((cell, index) => ({ index, cell })).filter(point => point.cell.band >= 0);
  if (points.length < 2) return '<svg class="hm-spark" viewBox="0 0 60 18" aria-hidden="true"></svg>';
  const [low, high] = range;
  const span = Math.max(0.5, high - low);
  const x = index => (row.cells.length > 1 ? (index / (row.cells.length - 1)) * 56 + 2 : 30);
  const y = rating => 16 - ((rating - low) / span) * 14;
  const line = points.map(point => `${x(point.index).toFixed(1)},${y(point.cell.rating).toFixed(1)}`).join(' ');
  const peak = points.reduce((top, point) => (point.cell.rating > top.cell.rating ? point : top), points[0]);
  return `<svg class="hm-spark" viewBox="0 0 60 18" aria-hidden="true" focusable="false"><polyline points="${line}"/><circle cx="${x(peak.index).toFixed(1)}" cy="${y(peak.cell.rating).toFixed(1)}" r="2"/></svg>`;
}

function legendHTML() {
  const rating = `<div class="hm-legend-set rating"><span class="hm-legend-bar">${RATING_BANDS.map((band, index) => `<i data-b="${index}"></i>`).join('')}</span><span class="hm-legend-ends"><b>${RATING_BANDS[0].label}</b><b>${RATING_BANDS[RATING_BANDS.length - 1].label}</b></span></div>`;
  const standouts = `<div class="hm-legend-set standouts"><span class="hm-legend-bar">${DELTA_BANDS.map((_, index) => `<i data-d="${index}"></i>`).join('')}</span><span class="hm-legend-ends"><b>Below its season</b><b>Above</b></span></div>`;
  return `<div class="hm-legend" aria-hidden="true">${rating}${standouts}<span class="hm-legend-key"><i class="hm-swatch none"></i>No rating</span><span class="hm-legend-key"><i class="hm-swatch unaired"></i>Not aired</span><span class="hm-legend-key"><i class="hm-swatch seen" data-b="4" data-d="5">${TICK}</i>Watched</span></div>`;
}

function readoutHTML(tid, cell, model) {
  if (!cell) {
    return `<div class="hm-readout-idle">${icon('grid')}<span>Point at a square to see its episode${model.best ? `, or open the peak: <button type="button" class="hm-link" data-action="heatmap-episode" data-tid="${tid}" data-sn="${model.best.season}" data-en="${model.best.episode}">S${model.best.season} E${model.best.episode} · ${esc(model.best.name)}</button>` : ''}</span></div>`;
  }
  const still = cell.still ? `<img src="${IMG}w300${cell.still}" alt="" loading="lazy">` : `<i class="hm-readout-blank">${icon('tv')}</i>`;
  const facts = [dateLabel(cell.airDate), cell.runtime ? `${cell.runtime}m` : ''].filter(Boolean).join(' · ');
  const score = cell.band >= 0
    ? `<b class="hm-readout-score">${icon('starSolid', { cls: 'cv-star' })}${cell.rating.toFixed(1)}</b><small>${cell.votes.toLocaleString()} vote${cell.votes === 1 ? '' : 's'}</small>`
    : `<small>${cell.aired ? 'No rating yet' : 'Not aired yet'}</small>`;
  const versus = cell.delta === null ? '' : `<span class="hm-versus ${cell.deltaBand === 3 ? 'even' : cell.delta > 0 ? 'up' : 'down'}">${cell.deltaBand === 3 ? 'About its season average' : `${signed(cell.delta)} vs its season`}</span>`;
  const seen = cell.watched
    ? `<span class="hm-seen on">${TICK}${cell.watchedAt ? `Watched ${esc(dateLabel(cell.watchedAt))}` : 'Watched'}</span>`
    : `<span class="hm-seen">${cell.aired ? 'Not seen yet' : 'Coming up'}</span>`;
  return `<div class="hm-readout-card">
    <span class="hm-readout-still">${still}<em>S${cell.season} · E${cell.episode}</em></span>
    <span class="hm-readout-copy"><strong>${esc(cell.name)}</strong><small>${esc(facts)}</small><span class="hm-readout-line">${score}${versus}</span>${seen}</span>
    <button type="button" class="hm-open" data-action="heatmap-episode" data-tid="${tid}" data-sn="${cell.season}" data-en="${cell.episode}">Open${icon('arrowRight', { cls: 'cv-arrow' })}</button>
  </div>`;
}

function insightsHTML(tid, model) {
  const chip = cell => `<button type="button" class="hm-gem" data-action="heatmap-episode" data-tid="${tid}" data-sn="${cell.season}" data-en="${cell.episode}"><b>S${cell.season} E${cell.episode}</b><span>${esc(cell.name)}</span><i>${icon('starSolid', { cls: 'cv-star' })}${cell.rating.toFixed(1)}</i></button>`;
  const cards = [];
  if (model.best) cards.push(`<article><small>Peak episode</small><strong>S${model.best.season} E${model.best.episode} · ${esc(model.best.name)}</strong><span>${model.best.rating.toFixed(1)} from ${model.best.votes.toLocaleString()} votes</span></article>`);
  if (model.top.count) cards.push(`<article><small>The best of it</small><strong>${model.top.seen} of the top ${model.top.count}</strong><span>You've seen ${model.watched} of ${model.aired} aired episode${model.aired === 1 ? '' : 's'}</span></article>`);
  if (model.strongest && model.rows.length > 1) cards.push(`<article><small>Strongest season</small><strong>${esc(model.strongest.name)}</strong><span>${model.strongest.mean.toFixed(1)} average</span></article>`);
  const gems = model.gems.length ? `<div class="hm-gems"><small>Best you haven't seen</small><div>${model.gems.map(chip).join('')}</div></div>` : '';
  return `<div class="hm-insights">${cards.join('')}</div>${gems}`;
}

/** The whole panel body for a model. */
export function heatmapHTML(tid, model, { mode = 'rating', numbers = false, light = false } = {}) {
  if (!model.rows.length) return '<p class="hm-empty">No episode ratings to show yet.</p>';
  const watchedCount = Math.max(1, model.watched);
  const step = Math.max(14, Math.min(90, Math.round(2000 / watchedCount)));
  const unwatchedDelay = Math.min(2400, model.watched * step) + 120;
  const rows = model.rows.map((row, rowIndex) => `<div class="hm-row${model.strongest && row === model.strongest && model.rows.length > 1 ? ' strongest' : ''}" role="row" aria-label="${esc(row.name)}${row.mean ? `, average ${row.mean.toFixed(1)}` : ''}">
      <span class="hm-label" aria-hidden="true">S${row.season}</span>
      <div class="hm-cells" role="presentation">${row.cells.map((cell, index) => {
        const kind = cell.band >= 0 ? '' : cell.aired ? ' none' : ' unaired';
        const lit = cell.order >= 0 ? cell.order * step : unwatchedDelay;
        return `<button type="button" role="gridcell" class="hm-cell${kind}${cell.watched ? ' watched' : ''}${model.best === cell ? ' best' : ''}" tabindex="${rowIndex === 0 && index === 0 ? 0 : -1}" data-b="${cell.band}" data-d="${cell.deltaBand}" data-sn="${cell.season}" data-en="${cell.episode}" data-r="${rowIndex}" data-c="${index}" style="--i:${index};--lit:${lit}ms" data-n="${cell.rating ? cell.rating.toFixed(1) : ''}" aria-label="${esc(cellLabel(cell))}">${TICK}</button>`;
      }).join('')}</div>
      <span class="hm-trend" aria-hidden="true">${sparkline(row, model.range)}<b>${row.mean ? row.mean.toFixed(1) : '–'}</b>${model.strongest === row && model.rows.length > 1 ? icon('trophy', { cls: 'hm-crown' }) : ''}</span>
    </div>`).join('');
  const modes = MODES.map(([value, label]) => `<button type="button" class="${mode === value ? 'active' : ''}" data-hm-mode="${value}" aria-pressed="${mode === value}">${label}</button>`).join('');
  // The numbers are a switch over whichever colouring is showing, not a third
  // view: the squares grow and every rating fades up in place, so the colours
  // you were reading never go away underneath them.
  const numbersSwitch = `<button type="button" class="hm-numbers${numbers ? ' active' : ''}" data-hm-numbers aria-pressed="${numbers}" title="Print every episode's rating in its square"><i aria-hidden="true">8.4</i><span>Numbers</span></button>`;
  return `<div class="hm-toolbar"><div class="hm-controls"><div class="hm-modes" role="group" aria-label="Colour episodes by">${modes}</div>${numbersSwitch}</div>${legendHTML()}</div>
    <div class="hm-grid hm-mode-${mode}${numbers ? ' hm-showing-numbers' : ''}${model.maxEpisodes > 26 ? ' dense' : model.maxEpisodes <= 13 ? ' roomy' : ''}${light ? ' hm-lighting' : ' hm-enter'}" role="grid" aria-label="Episodes by season. Arrow keys move between episodes; Enter opens one.">${rows}</div>
    <div class="hm-readout" aria-live="polite">${readoutHTML(tid, null, model)}</div>
    ${insightsHTML(tid, model)}
    <p class="hm-source">Ratings from TMDB; episodes with few votes can swing. Standouts compare each episode with its own season's average, and Numbers prints every rating in its square, beside the season averages at the end of each row.</p>`;
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

// ---------- behaviour ----------
const readMode = () => { try { return modeName(localStorage.getItem(MODE_KEY)); } catch (_) { return 'rating'; } };
// A grid left in the old "numbers" mode comes back with the switch on.
const readNumbers = () => {
  try { return numbersOn(localStorage.getItem(NUMBERS_KEY)) || numbersOn(localStorage.getItem(MODE_KEY)); } catch (_) { return false; }
};
function firstLight(tid) {
  try {
    const seen = JSON.parse(localStorage.getItem(LIT_KEY) || '[]');
    if (Array.isArray(seen) && seen.includes(+tid)) return false;
    localStorage.setItem(LIT_KEY, JSON.stringify([...(Array.isArray(seen) ? seen : []), +tid].slice(-300)));
    return true;
  } catch (_) { return false; }
}
const reducedMotion = () => document.documentElement.dataset.motion === 'reduced'
  || (document.documentElement.dataset.motion !== 'full' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const hoverDevice = () => !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

function cellFor(body, season, episode) {
  const model = body._hm?.model;
  return model?.rows.find(row => row.season === season)?.cells.find(cell => cell.episode === episode) || null;
}

function select(body, button, { focus = false } = {}) {
  const state = body._hm; if (!state) return;
  const cell = button ? cellFor(body, +button.dataset.sn, +button.dataset.en) : null;
  body.querySelectorAll('.hm-cell.selected').forEach(other => other !== button && other.classList.remove('selected'));
  body.querySelectorAll('.hm-cell.col-hot').forEach(other => other.classList.remove('col-hot'));
  if (button) {
    button.classList.add('selected');
    body.querySelectorAll(`.hm-cell[data-en="${button.dataset.en}"]`).forEach(other => { if (other !== button) other.classList.add('col-hot'); });
    body.querySelectorAll('.hm-cell[tabindex="0"]').forEach(other => other.setAttribute('tabindex', '-1'));
    button.setAttribute('tabindex', '0');
    if (focus) button.focus({ preventScroll: false });
  }
  const key = cell ? `${cell.season}-${cell.episode}` : '';
  if (state.selected === key) return;
  state.selected = key;
  const readout = body.querySelector('.hm-readout');
  if (readout) readout.innerHTML = readoutHTML(state.tid, cell, state.model);
}

function move(body, button, key) {
  const rows = [...body.querySelectorAll('.hm-row')].map(row => [...row.querySelectorAll('.hm-cell')]);
  const r = +button.dataset.r, c = +button.dataset.c;
  let target = null;
  if (key === 'ArrowRight') target = rows[r][c + 1] || rows[r + 1]?.[0];
  else if (key === 'ArrowLeft') target = rows[r][c - 1] || rows[r - 1]?.at(-1);
  else if (key === 'ArrowDown') target = rows[r + 1] ? rows[r + 1][Math.min(c, rows[r + 1].length - 1)] : null;
  else if (key === 'ArrowUp') target = rows[r - 1] ? rows[r - 1][Math.min(c, rows[r - 1].length - 1)] : null;
  else if (key === 'Home') target = rows[r][0];
  else if (key === 'End') target = rows[r].at(-1);
  return target;
}

function wire(body, onOpen) {
  if (body._hmWired) return;
  body._hmWired = true;
  body.addEventListener('pointerover', event => {
    const button = event.target.closest?.('.hm-cell');
    if (button && hoverDevice()) select(body, button);
  });
  body.addEventListener('focusin', event => {
    const button = event.target.closest?.('.hm-cell');
    if (button) select(body, button);
  });
  body.addEventListener('click', event => {
    const modeButton = event.target.closest?.('[data-hm-mode]');
    if (modeButton) { setMode(body, modeButton.dataset.hmMode); return; }
    const numbersButton = event.target.closest?.('[data-hm-numbers]');
    if (numbersButton) { setNumbers(body, numbersButton.getAttribute('aria-pressed') !== 'true'); return; }
    const button = event.target.closest?.('.hm-cell');
    if (!button) return;
    const key = `${button.dataset.sn}-${button.dataset.en}`;
    // Touch: the first tap shows the readout, the second opens the episode.
    if (!hoverDevice() && body._hm?.selected !== key) { select(body, button); return; }
    onOpen?.(+button.dataset.sn, +button.dataset.en);
  });
  body.addEventListener('keydown', event => {
    const button = event.target.closest?.('.hm-cell');
    if (!button) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen?.(+button.dataset.sn, +button.dataset.en); return; }
    const target = move(body, button, event.key);
    if (!target && !/^(Arrow|Home|End)/.test(event.key)) return;
    event.preventDefault();
    if (target) select(body, target, { focus: true });
  });
}

function setMode(body, mode) {
  const value = modeName(mode);
  try { localStorage.setItem(MODE_KEY, value); } catch (_) {}
  const grid = body.querySelector('.hm-grid');
  if (!grid) return;
  grid.classList.remove('hm-mode-rating', 'hm-mode-standouts', 'hm-lighting', 'hm-enter');
  grid.classList.add(`hm-mode-${value}`);
  fitCells(body);
  body.querySelector('.hm-toolbar')?.setAttribute('data-mode', value);
  body.querySelectorAll('[data-hm-mode]').forEach(button => {
    const on = button.dataset.hmMode === value;
    button.classList.toggle('active', on); button.setAttribute('aria-pressed', String(on));
  });
}

/**
 * Turn every episode's rating on or off over whatever colouring is showing.
 * The squares grow and the numbers fade up (css/scores.css owns the easing), so
 * the grid you were reading is the grid you keep.
 */
function setNumbers(body, on) {
  try { localStorage.setItem(NUMBERS_KEY, on ? '1' : '0'); } catch (_) {}
  const grid = body.querySelector('.hm-grid');
  if (!grid) return;
  grid.classList.remove('hm-lighting', 'hm-enter');
  grid.classList.toggle('hm-showing-numbers', on);
  // Numbers need room, so the shrink-to-fit that squeezes a long season onto one
  // line on a phone steps aside while they are on.
  fitCells(body);
  const button = body.querySelector('[data-hm-numbers]');
  if (button) { button.classList.toggle('active', on); button.setAttribute('aria-pressed', String(on)); }
}

// Squares shrink to fit a season on one line when the panel is narrow (a phone),
// down to 13px; longer seasons than that simply wrap. Wider screens keep the
// size the stylesheet chose.
function fitCells(body) {
  const grid = body.querySelector('.hm-grid');
  const cells = grid?.querySelector('.hm-cells');
  const count = body._hm?.model.maxEpisodes || 0;
  if (!grid || !cells || !count) return;
  // With the numbers on, the squares are sized around the text instead.
  if (grid.classList.contains('hm-showing-numbers')) { grid.style.removeProperty('--hm-fit'); return; }
  grid.style.removeProperty('--hm-fit');
  const natural = parseFloat(getComputedStyle(grid).getPropertyValue('--hm-size')) || 22;
  const gap = parseFloat(getComputedStyle(cells).columnGap) || 3;
  const fits = Math.floor((cells.clientWidth - (count - 1) * gap) / count);
  if (fits < natural) grid.style.setProperty('--hm-fit', `${Math.max(13, fits)}px`);
}
let fitListener = false;
function watchFit() {
  if (fitListener) return;
  fitListener = true;
  let timer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => document.querySelectorAll('.ep-heatmap-body').forEach(body => { if (body._hm) fitCells(body); }), 120);
  }, { passive: true });
}

/**
 * Fetch every season (a few at a time) and draw the panel.
 * @param {{ isWatched, watchedAt, onOpen, isCurrent }} options
 */
export async function mountHeatmap(tid, seasonNumbers, { isWatched, watchedAt, onOpen, isCurrent = () => true } = {}) {
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
  if (!live || !isCurrent()) { if (live) delete live.dataset.state; return; }
  const model = heatmapModel(payloads.filter(Boolean), { isWatched, watchedAt });
  const light = model.watched > 0 && !reducedMotion() && firstLight(tid);
  const mode = readMode();
  const showNumbers = readNumbers();
  live._hm = { tid, model, selected: '', isWatched, watchedAt };
  live.innerHTML = heatmapHTML(tid, model, { mode, numbers: showNumbers, light });
  live.querySelector('.hm-toolbar')?.setAttribute('data-mode', mode);
  live.dataset.state = 'ready';
  wire(live, onOpen);
  fitCells(live);
  watchFit();
  // The entrance ends at its last frame, which is the resting state, so taking
  // the class off afterwards changes nothing on screen and keeps later mode
  // switches from replaying it.
  const total = light ? Math.min(2400, model.watched * Math.max(14, Math.min(90, Math.round(2000 / Math.max(1, model.watched))))) + 1000 : 900;
  setTimeout(() => live.querySelector('.hm-grid')?.classList.remove('hm-lighting', 'hm-enter'), total);
}

/** Repaint the ticks after tracking changes, without refetching. */
export function refreshHeatmapTicks(tid, isWatched, watchedAt = () => 0) {
  const body = document.getElementById(`epHeatmapBody_${tid}`);
  const state = body?._hm;
  if (!state) return;
  let changed = false;
  body.querySelectorAll('.hm-cell').forEach(button => {
    const cell = cellFor(body, +button.dataset.sn, +button.dataset.en);
    if (!cell) return;
    const on = !!isWatched(cell.season, cell.episode);
    if (cell.watched === on) return;
    changed = true;
    cell.watched = on;
    cell.watchedAt = on ? +watchedAt(cell.season, cell.episode) || Date.now() : 0;
    button.classList.toggle('watched', on);
    button.classList.toggle('tick-draw', on);
    button.setAttribute('aria-label', cellLabel(cell));
  });
  if (!changed) return;
  const all = state.model.rows.flatMap(row => row.cells);
  state.model.watched = all.filter(cell => cell.watched).length;
  const pool = all.filter(cell => cell.band >= 0 && cell.votes >= TRUSTED_VOTES).length ? all.filter(cell => cell.band >= 0 && cell.votes >= TRUSTED_VOTES) : all.filter(cell => cell.band >= 0);
  const showMean = pool.length ? pool.reduce((sum, cell) => sum + cell.rating, 0) / pool.length : 0;
  const byRating = (a, b) => b.rating - a.rating || b.votes - a.votes || a.season - b.season || a.episode - b.episode;
  state.model.gems = pool.filter(cell => cell.aired && !cell.watched && cell.rating >= showMean).sort(byRating).slice(0, 3);
  const top = [...pool].sort(byRating).slice(0, state.model.top.count);
  state.model.top.seen = top.filter(cell => cell.watched).length;
  const insights = body.querySelector('.hm-insights');
  if (insights) {
    const wrap = document.createElement('div');
    wrap.innerHTML = insightsHTML(tid, state.model);
    body.querySelector('.hm-gems')?.remove();
    insights.replaceWith(...wrap.childNodes);
  }
  if (state.selected) {
    const [season, episode] = state.selected.split('-').map(Number);
    const readout = body.querySelector('.hm-readout');
    if (readout) readout.innerHTML = readoutHTML(tid, cellFor(body, season, episode), state.model);
  }
}
