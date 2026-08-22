// ===== /franchises =====
// Franchise completion was spread across four surfaces — a meter on the detail
// banner, a standing block on a collection page, a Home rail, a Stats block —
// and none of them answered the question somebody actually opens a tracker for:
// what have I got left, and how long would it take?
//
// This is that page. Every series in one place, each one expandable to its whole
// running order with what you have seen marked, what a finish would cost in
// hours, and which entries you skipped rather than simply not reached yet.
import { state } from './state.js';
import { $, esc, toast, debounce } from './ui.js';
import { registerActions } from './events.js';
import { IMG, PH } from './config.js';
import { observeReveals } from './effects.js';
import {
  franchiseSummary, tvFamilySummary,
  isFranchiseDismissed, toggleFranchiseDismissed, restoreAllFranchises,
} from './franchise.js';

let filter = 'progress';            // progress | complete | skipped | all | tv
const expanded = new Set();
let cached = null;                  // last resolved summary, so filtering is instant
let loading = false;
let generation = 0;

const hours = minutes => {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
};

export async function renderFranchisePage() {
  const host = $('franchisesContent');
  if (!host) return;
  if (!state.user) {
    host.innerHTML = `<div class="wl-empty"><h3>Sign in to track franchises</h3><p>Completion is worked out from the films you have marked watched.</p><br><button class="btn-primary" data-action="open-auth">Sign In</button></div>`;
    return;
  }
  const run = ++generation;
  if (!cached) {
    if (loading) return;
    loading = true;
    host.innerHTML = skeleton();
    try {
      const [films, tv] = await Promise.all([franchiseSummary({ limit: 24 }), tvFamilySummary({ limit: 12 })]);
      if (run !== generation) return;
      cached = { films, tv };
    } catch (error) {
      console.warn('franchise page', error);
      host.innerHTML = `<div class="wl-empty"><h3>Could not reach TMDB</h3><p>Collection data is fetched from TMDB and cached for a month. Try again shortly.</p></div>`;
      return;
    } finally { loading = false; }
  }
  if (run !== generation) return;
  paint(host);
}

/** Drop the resolved data so the next visit recomputes. */
export const invalidateFranchisePage = () => { cached = null; };

function skeleton() {
  return `<div class="fp-skeleton">${Array.from({ length: 5 }, () => '<div class="fp-skel-row"></div>').join('')}</div>`;
}

// ---------- totals ----------
// Runtime is not on a TMDB collection payload, so a finish time can only be
// estimated — from the average length of the entries in that series the viewer
// HAS seen, which is the most relevant sample available. Never shown without
// saying it is approximate, and never shown at all with nothing to average.
function estimateRemaining(row) {
  const seenRuntimes = [...(row.seenIds || [])]
    .map(id => +(state.watched[`movie_${id}`]?.runtime || 0))
    .filter(value => value > 0 && value < 400);
  if (!seenRuntimes.length || !row.unseen.length) return 0;
  const average = seenRuntimes.reduce((sum, value) => sum + value, 0) / seenRuntimes.length;
  return Math.round(average * row.unseen.length);
}

/**
 * Entries left unseen that sit BEFORE something already watched — films skipped
 * rather than simply not reached yet. Worth separating: "you have three left" and
 * "you skipped the third one" are different problems.
 */
function gapsIn(row, ordered) {
  const lastSeen = ordered.reduce((last, part, index) => (row.seenIds?.has(part.id) ? index : last), -1);
  if (lastSeen < 0) return [];
  return ordered.slice(0, lastSeen).filter(part => !row.seenIds?.has(part.id));
}

function paint(host) {
  const { films, tv } = cached;
  const dismissedRows = films.rows.filter(row => isFranchiseDismissed(row.id));
  const skipped = films.rows.filter(row => !row.complete && row.parts && gapsIn(row, row.parts).length);

  const counts = {
    progress: films.inProgress.length,
    complete: films.complete.length,
    skipped: skipped.length,
    tv: tv.rows.length,
    all: films.rows.length,
  };

  let rows;
  if (filter === 'complete') rows = films.complete;
  else if (filter === 'skipped') rows = skipped;
  else if (filter === 'all') rows = films.rows;
  else if (filter === 'tv') rows = [];
  else rows = films.inProgress;

  const totalLeft = films.inProgress.reduce((sum, row) => sum + estimateRemaining(row), 0);

  host.innerHTML = `
    <div class="fp-hero">
      <div>
        <span class="fp-eyebrow">Collection completion</span>
        <h1>Franchises</h1>
        <p>Every film series in your watch history, measured against entries that have actually been released. An announced sequel never counts against you.</p>
      </div>
      <div class="fp-hero-stats">
        ${stat(films.rows.length, films.rows.length === 1 ? 'series' : 'series')}
        ${stat(`${films.seenParts}/${films.trackedParts}`, 'entries seen')}
        ${stat(films.complete.length, 'completed')}
        ${totalLeft ? stat(`~${hours(totalLeft)}`, 'left to finish') : ''}
      </div>
    </div>

    <div class="fp-tabs" role="tablist">
      ${tab('progress', 'In progress', counts.progress)}
      ${tab('skipped', 'With gaps', counts.skipped)}
      ${tab('complete', 'Complete', counts.complete)}
      ${tab('tv', 'Television', counts.tv)}
      ${tab('all', 'Everything', counts.all)}
    </div>

    ${filter === 'tv' ? tvSection(tv) : filmSection(rows)}

    ${dismissedRows.length ? `<div class="fp-dismissed">
      <p><b>${dismissedRows.length} series set aside.</b> They are hidden from the Home rail but still counted here.</p>
      <button class="btn-glass" data-action="franchise-restore-all">Bring them all back</button>
    </div>` : ''}`;
  observeReveals(host);
}

const stat = (value, label) => `<div><strong>${esc(String(value))}</strong><span>${esc(label)}</span></div>`;
const tab = (id, label, count) => `<button class="fp-tab${filter === id ? ' on' : ''}" role="tab" aria-selected="${filter === id}" data-action="fp-filter" data-filter="${id}">${esc(label)}<b>${count}</b></button>`;

function filmSection(rows) {
  if (!rows.length) {
    const message = filter === 'complete' ? 'No series finished yet — the first one is usually closer than it looks.'
      : filter === 'skipped' ? 'No gaps. Everything you have started, you have watched in order.'
      : 'No film series in your history yet. Watch two entries from the same TMDB collection and they appear here.';
    return `<div class="wl-empty"><h3>Nothing to show</h3><p>${esc(message)}</p></div>`;
  }
  return `<div class="fp-list">${rows.map(filmRow).join('')}</div>`;
}

function filmRow(row) {
  const open = expanded.has(row.id);
  const ordered = row.parts || [];
  const gaps = gapsIn(row, ordered);
  const left = estimateRemaining(row);
  const percent = Math.round(row.percent);

  return `<article class="fp-row${row.complete ? ' done' : ''}${isFranchiseDismissed(row.id) ? ' aside' : ''} reveal" id="fp_${row.id}">
    <button class="fp-row-head" data-action="fp-toggle" data-cid="${row.id}" aria-expanded="${open}" aria-controls="fpBody_${row.id}">
      <img class="fp-poster" src="${row.poster ? `${IMG}w154${row.poster}` : PH}" alt="" loading="lazy">
      <span class="fp-row-body">
        <span class="fp-row-title">${esc(row.name)}</span>
        <span class="fp-bar"><i style="width:${percent}%"></i></span>
        <span class="fp-row-meta">
          <b>${row.seen} of ${row.released} seen</b>
          ${row.upcoming ? `<span>${row.upcoming} still to come</span>` : ''}
          ${gaps.length ? `<span class="fp-gap">${gaps.length} skipped</span>` : ''}
          ${left ? `<span>about ${hours(left)} left</span>` : ''}
        </span>
      </span>
      <span class="fp-row-pct">${percent}%</span>
      <span class="fp-chev" aria-hidden="true">${open ? '&#9662;' : '&#9656;'}</span>
    </button>
    <div class="fp-row-detail" id="fpBody_${row.id}"${open ? '' : ' hidden'}>
      ${open ? partsHTML(row, ordered, gaps) : ''}
    </div>
  </article>`;
}

function partsHTML(row, ordered, gaps) {
  const gapIds = new Set(gaps.map(part => part.id));
  const items = ordered.map((part, index) => {
    const seen = row.seenIds?.has(part.id);
    const year = (part.release_date || '').slice(0, 4);
    const future = !!part.release_date && Date.parse(`${part.release_date}T00:00:00`) > Date.now();
    const label = future ? 'Not out yet' : seen ? 'Watched' : gapIds.has(part.id) ? 'Skipped' : 'Not seen';
    return `<a class="fp-part${seen ? ' seen' : ''}${future ? ' future' : ''}${gapIds.has(part.id) ? ' gap' : ''}" href="/movie/${part.id}" data-action="open-detail" data-id="${part.id}" data-type="movie">
      <span class="fp-part-no">${index + 1}</span>
      <img src="${part.poster ? `${IMG}w92${part.poster}` : PH}" alt="" loading="lazy">
      <span class="fp-part-body">
        <b>${esc(part.title)}</b>
        <small>${year || 'Undated'} &middot; ${label}</small>
      </span>
      <span class="fp-part-mark" aria-hidden="true">${seen ? '&#10003;' : future ? '&#8987;' : ''}</span>
    </a>`;
  }).join('');

  return `<div class="fp-parts">${items}</div>
    <div class="fp-row-actions">
      ${row.nextUp ? `<button class="btn-primary" data-action="open-detail" data-id="${row.nextUp.id}" data-type="movie">Carry on with ${esc(row.nextUp.title)}</button>` : ''}
      <button class="btn-glass" data-action="go-collection" data-cid="${row.id}">Open the collection</button>
      <button class="btn-glass" data-action="fp-dismiss" data-cid="${row.id}">${isFranchiseDismissed(row.id) ? 'Show on Home again' : 'Not interested'}</button>
    </div>`;
}

function tvSection(tv) {
  if (!tv.rows.length) {
    return `<div class="wl-empty"><h3>No television families</h3><p>TMDB publishes collections for film only, so these are grouped by name — a show that declares its franchise before a colon or a dash, like <i>Star Trek: Discovery</i>.</p></div>`;
  }
  return `<p class="fp-note">TMDB has no collections for television, so these are grouped by name. The total is what a TMDB search returned for that name — read it as <b>found</b>, not as everything that exists.</p>
    <div class="fp-list">${tv.rows.map(row => `<article class="fp-row${row.complete ? ' done' : ''} reveal">
      <div class="fp-row-head static">
        <img class="fp-poster" src="${row.poster ? `${IMG}w154${row.poster}` : PH}" alt="" loading="lazy">
        <span class="fp-row-body">
          <span class="fp-row-title">${esc(row.name)}</span>
          <span class="fp-bar"><i style="width:${Math.round(row.percent)}%"></i></span>
          <span class="fp-row-meta"><b>${row.seen} of ${row.found} found</b>${row.nextUp ? `<span>next: ${esc(row.nextUp.title)}</span>` : ''}</span>
        </span>
        <span class="fp-row-pct">${Math.round(row.percent)}%</span>
      </div>
      ${row.nextUp ? `<div class="fp-row-actions"><button class="btn-glass" data-action="open-detail" data-id="${row.nextUp.id}" data-type="tv">Open ${esc(row.nextUp.title)}</button></div>` : ''}
    </article>`).join('')}</div>`;
}

export function initFranchisePage() {
  registerActions({
    'fp-filter': (el) => { filter = el.dataset.filter; paint($('franchisesContent')); },
    'fp-toggle': (el) => {
      const id = +el.dataset.cid;
      expanded.has(id) ? expanded.delete(id) : expanded.add(id);
      paint($('franchisesContent'));
      // Re-focus the row that was just toggled: repainting the list would
      // otherwise drop focus to the top of the page mid-keyboard-navigation.
      $(`fp_${id}`)?.querySelector('.fp-row-head')?.focus();
    },
    'fp-dismiss': (el) => {
      const id = +el.dataset.cid;
      const aside = toggleFranchiseDismissed(id);
      paint($('franchisesContent'));
      toast(aside ? 'Hidden from the Home rail' : 'Back on the Home rail', 'info');
    },
  });
  // The library changing can finish a series or open a gap, so the resolved
  // summary is dropped and rebuilt rather than left to go stale.
  const refresh = debounce(() => { invalidateFranchisePage(); if (location.pathname === '/franchises') renderFranchisePage(); }, 700);
  document.addEventListener('cv:wl-changed', refresh);
  document.addEventListener('cv:auth', () => { invalidateFranchisePage(); expanded.clear(); });
  document.addEventListener('cv:meta-backfilled', refresh);
}
