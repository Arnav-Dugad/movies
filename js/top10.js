// ===== TOP 10 THIS WEEK =====
// The countdown was a grid with a number bolted onto each tile, which is a list
// pretending to be a chart. A countdown has a shape: one title at the top that
// earns the space, and nine beneath it in descending order, read like a chart
// rather than scanned like a shelf.
//
// Movement is the other half of a chart, and it is the half nobody can fake. No
// free API publishes last week's ranking, so CineVerse keeps its own: the ids and
// the week they were seen, on the device. Movement appears only once there is a
// snapshot from a genuinely earlier week to compare against — never on a first
// visit, and never invented.
import { tmdb } from './api.js';
import { IMG, PH, genreMap } from './config.js';
import { esc, $ } from './ui.js';
import { state } from './state.js';
import { observeReveals } from './effects.js';
import { rateBtnHTML, myRatingHTML, WATCHED_BADGE_HTML } from './cards.js';

const SNAP_PREFIX = 'cv_top10_history_v1_';
const snapKey = chart => SNAP_PREFIX + String(chart || 'movie');

/** ISO-ish week key, so "a different week" is a fact rather than a guess. */
export function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));      // nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function readSnapshot(chart) {
  try {
    const raw = JSON.parse(localStorage.getItem(snapKey(chart)) || 'null');
    return raw && Array.isArray(raw.ids) && typeof raw.week === 'string' ? raw : null;
  } catch (_) { return null; }
}

/**
 * Compare this week's order against the last one we stored, then record the
 * current one. Returns a map of id -> movement, empty when there is nothing
 * honest to say.
 */
// Recording this week's chart is a one-way door: the moment it is written, last
// week's ranking is gone. So the answer is computed once per chart per page load
// and reused. Without this, anything that re-renders the page — the account
// arriving, a filter, a re-navigation — would compare the chart against the copy
// it had just written and report no movement at all, silently erasing the chips
// on exactly the visit they were meant for.
const decided = new Map();

/** Test seam: forget what this page load already decided. */
export function resetMovementMemo() { decided.clear(); }

export function movementFor(ids, chart) {
  const week = weekKey();
  const signature = `${chart}|${week}|${ids.join(',')}`;
  if (decided.has(signature)) return decided.get(signature);

  const previous = readSnapshot(chart);
  const moves = new Map();
  // Only a snapshot from a DIFFERENT week is a comparison. Re-opening the page
  // an hour later must not report movement against itself.
  if (previous && previous.week !== week) {
    previous.ids.forEach((id, index) => moves.set(+id, index));
  }
  try { localStorage.setItem(snapKey(chart), JSON.stringify({ week, ids, at: Date.now() })); } catch (_) {}

  const out = new Map();
  decided.set(signature, out);
  if (!moves.size) return out;
  ids.forEach((id, index) => {
    const before = moves.get(+id);
    if (before === undefined) { out.set(+id, { kind: 'new' }); return; }
    const delta = before - index;                 // positive means it climbed
    out.set(+id, delta === 0 ? { kind: 'hold' } : { kind: delta > 0 ? 'up' : 'down', by: Math.abs(delta) });
  });
  return out;
}

// Direction is carried by an arrow and a number as well as colour, so the chart
// still reads correctly without colour vision.
function movementChip(move) {
  if (!move) return '';
  if (move.kind === 'new') return '<span class="t10-move new">NEW</span>';
  if (move.kind === 'hold') return '<span class="t10-move hold" title="No change since last week">&#8212;</span>';
  const up = move.kind === 'up';
  return `<span class="t10-move ${up ? 'up' : 'down'}" title="${up ? 'Up' : 'Down'} ${move.by} since last week">${up ? '&#9650;' : '&#9660;'}${move.by}</span>`;
}

const yearOf = item => (item.release_date || item.first_air_date || '').slice(0, 4);
const titleOf = item => item.title || item.name || '';
const genresOf = item => (item.genre_ids || []).map(id => genreMap[id]).filter(Boolean).slice(0, 3);

export function top10HTML(items, type = 'movie', chart = type) {
  if (!items.length) return '<p style="color:var(--text3);padding:20px 0">Nothing charting right now.</p>';
  const moves = movementFor(items.map(item => item.id), chart);
  const [lead, ...rest] = items;
  return `<div class="t10-wrap">
    ${heroHTML(lead, type, moves.get(lead.id))}
    <ol class="t10-list">${rest.map((item, index) => rowHTML(item, index + 2, type, moves.get(item.id))).join('')}</ol>
  </div>`;
}

function heroHTML(item, type, move) {
  const kind = item.media_type || type;
  const title = titleOf(item);
  const backdrop = item.backdrop_path ? `${IMG}w1280${item.backdrop_path}` : '';
  const poster = item.poster_path ? `${IMG}w342${item.poster_path}` : PH;
  const watched = !!state.watched[`${kind}_${item.id}`];
  return `<section class="t10-hero reveal">
    <div class="t10-hero-art" aria-hidden="true">${backdrop ? `<img src="${backdrop}" alt="" fetchpriority="high">` : ''}<span class="t10-hero-fade"></span></div>
    <div class="t10-hero-inner">
      <a class="t10-hero-poster" href="/${kind}/${item.id}" data-action="open-detail" data-id="${item.id}" data-type="${kind}" aria-label="Open ${esc(title)}">
        <img src="${poster}" alt="" loading="eager" data-ph="${PH}">
        ${watched ? WATCHED_BADGE_HTML : ''}
      </a>
      <div class="t10-hero-copy">
        <div class="t10-hero-rank"><span aria-hidden="true">1</span><b>Number one this week</b>${movementChip(move)}</div>
        <h2>${esc(title)}</h2>
        <div class="t10-hero-meta">
          ${item.vote_average ? `<span class="t10-score"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>${item.vote_average.toFixed(1)}</span>` : ''}
          ${yearOf(item) ? `<span>${yearOf(item)}</span>` : ''}
          ${genresOf(item).map(g => `<span>${esc(g)}</span>`).join('')}
          ${item.vote_count ? `<span>${(+item.vote_count).toLocaleString()} votes</span>` : ''}
        </div>
        ${item.overview ? `<p class="t10-hero-overview">${esc(item.overview)}</p>` : ''}
        <div class="t10-hero-actions">
          <button class="btn-primary" data-action="open-detail" data-id="${item.id}" data-type="${kind}">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>Open</button>
          <span class="t10-hero-tools" id="t10HeroTools">${rateBtnHTML(item.id, kind, title)}${myRatingHTML(item.id, kind)}</span>
        </div>
      </div>
    </div>
  </section>`;
}

function rowHTML(item, rank, type, move) {
  const kind = item.media_type || type;
  const title = titleOf(item);
  const poster = item.poster_path ? `${IMG}w185${item.poster_path}` : PH;
  const watched = !!state.watched[`${kind}_${item.id}`];
  return `<li class="t10-row reveal">
    <a class="t10-row-link" href="/${kind}/${item.id}" data-action="open-detail" data-id="${item.id}" data-type="${kind}" aria-label="Number ${rank}, ${esc(title)}">
      <span class="t10-rank" aria-hidden="true">${rank}</span>
      <span class="t10-poster">
        <img src="${poster}" alt="" loading="lazy" data-ph="${PH}">
        ${watched ? WATCHED_BADGE_HTML : ''}
      </span>
      <span class="t10-row-copy">
        <b>${esc(title)}</b>
        <span class="t10-row-meta">
          ${item.vote_average ? `<i class="t10-score-sm">&#9733; ${item.vote_average.toFixed(1)}</i>` : ''}
          ${yearOf(item) ? `<i>${yearOf(item)}</i>` : ''}
          ${genresOf(item).slice(0, 2).map(g => `<i>${esc(g)}</i>`).join('')}
        </span>
        ${item.overview ? `<span class="t10-row-blurb">${esc(item.overview)}</span>` : ''}
      </span>
      <span class="t10-row-side">${movementChip(move)}</span>
    </a>
  </li>`;
}

/**
 * One request, for the leader only, to turn its Open button into a trailer.
 * Runs after paint and fails silently — the countdown is complete without it.
 */
export async function hydrateTop10Trailer(item, type = 'movie') {
  const kind = item?.media_type || type;
  if (!item?.id) return;
  try {
    const data = await tmdb(`/${kind}/${item.id}/videos`);
    const video = (data.results || []).find(v => v.site === 'YouTube' && v.type === 'Trailer')
      || (data.results || []).find(v => v.site === 'YouTube');
    const host = $('t10HeroTools');
    if (!video || !host) return;
    host.insertAdjacentHTML('afterbegin',
      `<button class="btn-glass t10-trailer" data-action="play-trailer" data-key="${esc(video.key)}">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>Trailer</button>`);
  } catch (_) { /* the countdown stands on its own */ }
}

export function paintTop10Reveals(host) { observeReveals(host); }
