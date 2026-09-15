// ===== RETURNING THIS MONTH =====
// A Home rail of shows you have finished — caught up in the tracker, or marked
// watched — whose next season premieres this calendar month. The premiere date
// is TMDB's: a season's `air_date` is its first episode, and a show's next
// episode being episode 1 of a later season covers seasons TMDB lists without
// a date yet. Ended and cancelled shows never return; a show you dropped is
// left out.
import { tmdb, pool } from './api.js';
import { state } from './state.js';
import { $, esc, debounce } from './ui.js';
import { buildCard } from './cards.js';
import { observeReveals } from './effects.js';
import { showProgress } from './episodes.js';

const LIMIT = 40;
const pad = n => String(n).padStart(2, '0');
const monthOf = at => { const d = new Date(at); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const todayOf = at => { const d = new Date(at); return `${monthOf(at)}-${pad(d.getDate())}`; };
const ended = status => ['ended', 'canceled', 'cancelled'].includes(String(status || '').toLowerCase());

/** Shows you have finished, newest activity first: { id, title, lastSeason }. */
export function finishedShows({ progress = state.episodeProgress, watched = state.watched } = {}) {
  const out = new Map();
  for (const entry of Object.values(progress || {})) {
    const id = +entry?.tmdbId;
    if (!id || entry.dropped || ended(entry.status)) continue;
    const current = showProgress(id);
    if (!current.started || !current.caughtUp) continue;
    // The last season that has aired is the one you are caught up through. Not
    // the structure's highest season: TMDB lists an announced season there too,
    // and that is exactly the one returning.
    out.set(id, { id, title: entry.title || '', lastSeason: +entry.aired?.season || 0, at: +entry.lastWatched?.at || 0 });
  }
  for (const [key, doc] of Object.entries(watched || {})) {
    const [type, rawId] = [key.slice(0, key.lastIndexOf('_')), key.slice(key.lastIndexOf('_') + 1)];
    const id = +(doc?.tmdbId || rawId);
    if ((doc?.type || type) !== 'tv' || !id || out.has(id)) continue;
    // A show being tracked but not caught up is still in progress, not finished.
    const tracked = progress?.[`tv_${id}`];
    if (tracked && (tracked.dropped || !showProgress(id).caughtUp)) continue;
    const seconds = +doc?.watchedAt?.seconds || 0;
    out.set(id, { id, title: doc.title || '', lastSeason: 0, at: seconds * 1000 });
  }
  return [...out.values()].sort((a, b) => b.at - a.at).slice(0, LIMIT);
}

/**
 * Pure: the season of `show` (a TMDB /tv payload) that premieres in the month
 * of `now`, newer than `lastSeason`, or null.
 */
export function returningSeason(show, { lastSeason = 0, now = Date.now() } = {}) {
  if (!show?.id || ended(show.status)) return null;
  const month = monthOf(now);
  // Without a tracked season count, a first season cannot be a return.
  const floor = Math.max(+lastSeason || 0, 1);
  const candidates = (show.seasons || [])
    .filter(season => +season.season_number > floor && String(season.air_date || '').startsWith(month))
    .map(season => ({ season: +season.season_number, airDate: season.air_date, episodes: +season.episode_count || 0, poster: season.poster_path || '' }));
  const next = show.next_episode_to_air;
  if (next && +next.episode_number === 1 && +next.season_number > floor && String(next.air_date || '').startsWith(month)
    && !candidates.some(entry => entry.season === +next.season_number)) {
    candidates.push({ season: +next.season_number, airDate: next.air_date, episodes: 0, poster: '' });
  }
  if (!candidates.length) return null;
  const first = candidates.sort((a, b) => a.season - b.season)[0];
  return { ...first, out: first.airDate <= todayOf(now) };
}

/** The badge on a returning card: "S3 · Sep 20", or "S3 · Out now". */
export function returningBadge(item, now = Date.now()) {
  if (item.out) return `S${item.season} · Out now`;
  const [y, m, d] = item.airDate.split('-').map(Number);
  const when = new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `S${item.season} · ${todayOf(now + 86400000) === item.airDate ? 'Tomorrow' : when}`;
}

// Its own badge, not the match badge: the premiere date must not disappear when
// Settings hides match badges, and it sits bottom-left, clear of the watched mark.
const returningCard = item => buildCard(item.show, 'tv').replace('<div class="card-img">', `<div class="card-img"><div class="returning-badge${item.out ? ' out' : ''}">${esc(returningBadge(item))}</div>`);

let signature = '';
let run = 0;

export async function renderReturningRail() {
  const host = $('returningRow');
  if (!host || !state.authReady) return;
  if (!state.user) { host.innerHTML = ''; signature = ''; return; }
  const mine = ++run;
  const shows = finishedShows();
  const found = [];
  await pool(shows, async item => {
    const show = await tmdb(`/tv/${item.id}`).catch(() => null);
    const season = show && returningSeason(show, { lastSeason: item.lastSeason });
    if (season) found.push({ show, ...season });
  }, 4);
  if (mine !== run || !$('returningRow')) return;
  found.sort((a, b) => a.airDate.localeCompare(b.airDate) || a.show.name.localeCompare(b.show.name));
  const next = JSON.stringify({ uid: state.user.uid, month: monthOf(Date.now()), items: found.map(item => [item.show.id, item.season, item.airDate, item.out]) });
  if (next === signature && host.firstElementChild) return;
  signature = next;
  if (!found.length) { host.innerHTML = ''; return; }
  host.innerHTML = `<div class="section reveal rec-section returning-section"><div class="section-head rec-head">
      <span class="rail-glyph" aria-hidden="true">↻</span>
      <div class="rec-head-copy"><h2 class="section-title">Returning this month</h2></div>
    </div><div class="row" id="rowReturning">${found.map(returningCard).join('')}</div></div>`;
  observeReveals(host);
}

export function initReturningRail() {
  const refresh = debounce(renderReturningRail, 1200);
  document.addEventListener('cv:auth', renderReturningRail);
  document.addEventListener('cv:library-sync', refresh);
  document.addEventListener('cv:episode-progress', refresh);
  document.addEventListener('cv:wl-changed', refresh);
  document.addEventListener('cv:auth-loading', () => { run++; signature = ''; const host = $('returningRow'); if (host) host.innerHTML = ''; });
}
