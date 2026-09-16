// ===== CAST MILESTONES =====
// "You've now watched 30 hours of Adam Scott." Hours per person, counted from
// the episodes you have ticked and TMDB's episode credits:
//   - a season's billed cast (its regulars) count for every episode of that
//     season you watched;
//   - an episode's guest stars count for that episode only;
//   - minutes are each episode's own runtime, falling back to the show's usual
//     episode length. Episodes with neither add episodes but no time.
// TMDB does not record which regular appears in which episode, so a regular
// who sits out an episode is still counted for it; the panel says so.
//
// Season credits are fetched once and kept on the device (IndexedDB), so
// ticking an episode later costs nothing unless it opens a new season. A
// milestone is announced only when every season you have watched is known
// before and after the tick, so a half-loaded library can never "cross" a
// threshold that was already behind you.
import { tmdb } from './api.js';
import { IMG, PH } from './config.js';
import { state } from './state.js';
import { prefs } from './prefs.js';
import { esc } from './ui.js';
import { icon } from './icons.js';

export const MILESTONE_HOURS = [5, 10, 20, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000];
const DAY = 86400000;
const GUESTS_PER_EPISODE = 10;

// ---------- pure ----------
/** Pure: the compact record kept for one season payload (with credits appended). */
export function compactSeason(payload, now = Date.now()) {
  const people = {};
  const person = credit => {
    const id = +credit?.id;
    if (!id) return 0;
    if (!people[id]) people[id] = [String(credit.name || ''), String(credit.profile_path || '')];
    return id;
  };
  const regulars = [...new Set((payload?.credits?.cast || []).map(person).filter(Boolean))];
  const eps = {};
  let lastAir = 0;
  for (const episode of payload?.episodes || []) {
    const number = +episode.episode_number;
    if (!number) continue;
    const guests = [...(episode.guest_stars || [])]
      .sort((a, b) => (+a.order || 0) - (+b.order || 0))
      .slice(0, GUESTS_PER_EPISODE)
      .map(person).filter(id => id && !regulars.includes(id));
    eps[number] = [+episode.runtime || 0, [...new Set(guests)]];
    const air = Date.parse(`${episode.air_date || ''}T00:00:00`);
    if (Number.isFinite(air)) lastAir = Math.max(lastAir, air);
  }
  // A season whose every episode aired over a fortnight ago is settled.
  const settled = !!payload?.episodes?.length && payload.episodes.every(episode => episode.air_date) && now - lastAir > 14 * DAY;
  return { at: now, settled, people, regulars, eps };
}

/**
 * Pure: minutes and episodes per person.
 * @param {object[]} shows  [{ id, runtime, seasons: { [season]: number[] } }]
 * @param {(showId, season) => object|null} seasonOf  compact season lookup
 * @returns {{ people: object[], needed: number, known: number }}
 */
export function castHours(shows, seasonOf) {
  const totals = new Map();
  let needed = 0, known = 0;
  for (const show of shows) {
    for (const [seasonKey, list] of Object.entries(show.seasons || {})) {
      const watched = [...new Set((list || []).map(Number).filter(Boolean))];
      if (!watched.length) continue;
      needed++;
      const season = seasonOf(show.id, +seasonKey);
      if (!season) continue;
      known++;
      for (const number of watched) {
        const [runtime = 0, guests = []] = season.eps?.[number] || [];
        const minutes = runtime || +show.runtime || 0;
        for (const id of new Set([...(season.regulars || []), ...guests])) {
          const row = totals.get(id) || { id, name: '', profile: '', minutes: 0, episodes: 0, shows: new Set() };
          const [name, profile] = season.people?.[id] || [];
          if (!row.name && name) { row.name = name; row.profile = profile || ''; }
          row.minutes += minutes; row.episodes++; row.shows.add(+show.id);
          totals.set(id, row);
        }
      }
    }
  }
  const people = [...totals.values()]
    .map(row => ({ ...row, shows: [...row.shows] }))
    .sort((a, b) => b.minutes - a.minutes || b.episodes - a.episodes || a.name.localeCompare(b.name));
  return { people, needed, known };
}

/** Pure: the highest milestone (hours) passed between two minute totals, or 0. */
export function crossedMilestone(beforeMinutes, afterMinutes) {
  let crossed = 0;
  for (const hours of MILESTONE_HOURS) if (beforeMinutes < hours * 60 && afterMinutes >= hours * 60) crossed = hours;
  return crossed;
}

/** Pure: the last milestone reached and the next one, in hours. */
export function milestoneBand(minutes) {
  const hours = minutes / 60;
  const reached = [...MILESTONE_HOURS].reverse().find(value => hours >= value) || 0;
  const next = MILESTONE_HOURS.find(value => hours < value) || 0;
  return { reached, next, progress: next ? Math.min(1, (hours - reached) / (next - reached)) : 1 };
}

// ---------- hours clubs ----------
// Badges for the people you have spent real time with: 10, 25, 50, 100, 250,
// 500 and 1,000 hours. They are shown on your profile and, unless you turn it
// off, published for friends (js/social.js).
export const CLUBS = [10, 25, 50, 100, 250, 500, 1000];

/** Pure: the highest club (hours) these minutes have reached, or 0. */
export const clubFor = minutes => [...CLUBS].reverse().find(hours => minutes >= hours * 60) || 0;

/**
 * Pure: badge rows for everyone in at least the first club, most time first.
 * `progress` is the share of the way from this club to the next (1 at the top).
 */
export function clubBadges(people, limit = 12) {
  return (people || [])
    .filter(row => row && row.name && clubFor(row.minutes))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(row => {
      const club = clubFor(row.minutes);
      const next = CLUBS.find(hours => hours > club) || 0;
      const hours = row.minutes / 60;
      return { id: +row.id, name: row.name, profile: row.profile || '', club, next, hours: Math.floor(hours), progress: next ? Math.min(1, (hours - club) / (next - club)) : 1 };
    });
}

/**
 * The club badge: a ring that fills like a gauge, then the club's number pops
 * in. `delay` staggers a row of badges; `size` is the ring's CSS size.
 */
export function clubGaugeHTML({ club, profile = '', name = '' }, { delay = 0, cls = '', animate = true } = {}) {
  const face = profile ? `<img src="${IMG}w185${profile}" alt="" loading="lazy" data-ph="${PH}">` : `<i>${icon('person')}</i>`;
  const number = animate ? odometerHTML(club) : `${club}`;
  return `<span class="club-gauge club-${club}${animate ? ' club-arrive' : ' club-static'}${cls ? ` ${cls}` : ''}" style="--delay:${delay}ms" aria-hidden="true"><svg viewBox="0 0 64 64" focusable="false"><circle class="club-track" cx="32" cy="32" r="29"/><circle class="club-fill" cx="32" cy="32" r="29" pathLength="1"/></svg><span class="club-face">${face}</span><b class="club-num">${number}h</b></span>`;
}

/**
 * Digits that roll up like an odometer: each column spins through a full turn
 * of 0–9 and stops on its digit, the leftmost first. Pure markup; the motion is
 * CSS (.odo), after the gauge has filled.
 */
export function odometerHTML(value) {
  const digits = String(Math.max(0, Math.floor(+value || 0))).split('');
  const strip = Array.from({ length: 20 }, (_, index) => `<i>${index % 10}</i>`).join('');
  return `<span class="odo">${digits.map((digit, index) => `<span class="odo-col" style="--d:${10 + +digit};--k:${index}">${strip}</span>`).join('')}</span>`;
}

// Badges seen before on this device appear finished; a new one (a club you have
// just reached) fills and rolls up once.
const seenKey = () => `cv_clubs_seen_v1_${state.user?.uid || 'guest'}`;
export function takeNewBadges(badges) {
  let seen;
  try { seen = new Set(JSON.parse(localStorage.getItem(seenKey()) || '[]')); } catch (_) { seen = new Set(); }
  const fresh = new Set(badges.map(badge => `${badge.id}:${badge.club}`).filter(key => !seen.has(key)));
  if (fresh.size) {
    try { localStorage.setItem(seenKey(), JSON.stringify([...seen, ...fresh].slice(-400))); } catch (_) {}
  }
  return fresh;
}

/**
 * On a title page, marks each cast member you are in an hours club with, from
 * credits this device already holds (no requests).
 */
export async function markCastClubs(host) {
  if (!state.user || !host) return;
  const items = [...host.querySelectorAll('.cast-item[data-id]')];
  if (!items.length) return;
  const result = await computeCastHours({ fetch: false });
  const clubs = new Map(result.people.map(row => [+row.id, { club: clubFor(row.minutes), hours: Math.floor(row.minutes / 60) }]).filter(([, value]) => value.club));
  for (const item of items) {
    const found = clubs.get(+item.dataset.id);
    if (!found || !item.isConnected || item.querySelector('.cast-club')) continue;
    const pic = item.querySelector('.cast-pic');
    if (!pic) continue;
    // After the photo, not inside it: the photo is a clipped circle.
    pic.insertAdjacentHTML('afterend', `<span class="cast-club club-${found.club}" title="${found.club} hours club · ${found.hours}h watched">${found.club}h</span>`);
    item.setAttribute('aria-label', `${item.querySelector('.cast-name')?.textContent || ''}, ${found.club} hours club, ${found.hours} hours watched`);
  }
}

export const hoursLabel = minutes => {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60), m = total % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
};

// ---------- device cache ----------
const memory = new Map();
let dbPromise = null;
function database() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const request = indexedDB.open('cv-cast-hours', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('seasons');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch (_) { resolve(null); }
  });
  return dbPromise;
}
async function loadAllCached() {
  const db = await database();
  if (!db) return;
  await new Promise(resolve => {
    try {
      const request = db.transaction('seasons').objectStore('seasons').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        if (!memory.has(cursor.key)) memory.set(cursor.key, cursor.value);
        cursor.continue();
      };
      request.onerror = () => resolve();
    } catch (_) { resolve(); }
  });
}
async function store(key, value) {
  memory.set(key, value);
  const db = await database();
  if (!db) return;
  try { db.transaction('seasons', 'readwrite').objectStore('seasons').put(value, key); } catch (_) {}
}

const seasonKey = (showId, season) => `${+showId}_${+season}`;
const fresh = record => record && (record.settled ? Date.now() - record.at < 180 * DAY : Date.now() - record.at < 3 * DAY);

function trackedShows(keep = () => true) {
  return Object.values(state.episodeProgress || {})
    .filter(entry => entry && +entry.tmdbId && entry.seasons && Object.keys(entry.seasons).length && keep(+entry.tmdbId))
    .map(entry => ({ id: +entry.tmdbId, title: entry.title || '', runtime: +entry.episodeRuntime || 0, seasons: entry.seasons }));
}

let hydrated = null;
const hydrate = () => (hydrated ||= loadAllCached());

/** Fetch the credits for every watched season not already known (a few at a time). */
async function fillSeasons(shows, { onProgress } = {}) {
  await hydrate();
  const missing = [];
  for (const show of shows) {
    for (const [season, list] of Object.entries(show.seasons)) {
      if (!(list || []).length) continue;
      const key = seasonKey(show.id, season);
      if (!fresh(memory.get(key))) missing.push([show.id, +season, key]);
    }
  }
  let done = 0;
  const worker = async () => {
    while (missing.length) {
      const [showId, season, key] = missing.shift();
      try {
        const payload = await tmdb(`/tv/${showId}/season/${season}`, { append_to_response: 'credits' });
        await store(key, compactSeason(payload));
      } catch (error) {
        // A season TMDB does not have (a local specials numbering, say) is known
        // to be empty; any other failure leaves it unknown, and coverage says so.
        if (String(error?.message) === '404') await store(key, { at: Date.now(), settled: false, people: {}, regulars: [], eps: {} });
      }
      onProgress?.(++done);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

/** Totals from what this device knows, fetching unknown seasons first when `fetch`. */
export async function computeCastHours({ fetch = true, onProgress, keepShow } = {}) {
  const shows = trackedShows(keepShow);
  if (fetch) await fillSeasons(shows, { onProgress }); else await hydrate();
  const result = castHours(shows, (showId, season) => memory.get(seasonKey(showId, season)) || null);
  // New credits may have arrived: anything derived from them (the published
  // hours clubs) can refresh. Counting from the cache alone never announces.
  if (fetch) document.dispatchEvent(new CustomEvent('cv:cast-hours'));
  return result;
}

/** One person's totals from cached credits only (no network), or null. */
export async function personCastHours(personId) {
  if (!state.user) return null;
  const result = await computeCastHours({ fetch: false });
  return result.people.find(row => +row.id === +personId) || null;
}

// ---------- milestones ----------
const snapshotKey = () => `cv_cast_minutes_v1_${state.user?.uid || 'guest'}`;
const watchedEpisodeCount = () => trackedShows().reduce((sum, show) => sum + Object.values(show.seasons).reduce((n, list) => n + (list || []).length, 0), 0);
function readSnapshot() {
  try { const value = JSON.parse(localStorage.getItem(snapshotKey()) || 'null'); return value && typeof value.top === 'object' ? value : null; } catch (_) { return null; }
}
function writeSnapshot(result) {
  const top = {};
  for (const row of result.people.slice(0, 80)) top[row.id] = Math.round(row.minutes);
  try { localStorage.setItem(snapshotKey(), JSON.stringify({ at: Date.now(), complete: result.known === result.needed, episodes: watchedEpisodeCount(), top })); } catch (_) {}
}

function announce(row, hours) {
  const zone = document.getElementById('toastZone');
  if (!zone) return;
  zone.querySelector('.cast-milestone')?.remove();
  const card = document.createElement('div');
  card.className = 'toast success cast-milestone';
  card.setAttribute('role', 'status');
  card.innerHTML = `${clubGaugeHTML({ club: hours, profile: row.profile, name: row.name }, { delay: 160, cls: 'cast-milestone-photo' })}<span class="cast-milestone-copy"><small>Cast milestone</small><strong>${esc(`You've now watched ${hours} hours of ${row.name}`)}</strong></span><button type="button" data-action="open-person" data-id="${row.id}">View</button><button type="button" class="recap-prompt-close" aria-label="Dismiss">${icon('close')}</button>`;
  const dismiss = () => { card.style.animation = 'toast-out .3s forwards'; setTimeout(() => card.remove(), 300); };
  card.querySelector('.recap-prompt-close').addEventListener('click', () => card.remove());
  card.querySelector('[data-action="open-person"]').addEventListener('click', () => card.remove());
  zone.appendChild(card);
  setTimeout(() => { if (card.isConnected) dismiss(); }, 9000);
}

let running = null;
/** Recount, and announce the biggest milestone a tick just crossed. */
export async function checkCastMilestones() {
  if (!state.user) return;
  if (running) return running;
  running = (async () => {
    const before = readSnapshot();
    const result = await computeCastHours({ fetch: true });
    const complete = result.needed > 0 && result.known === result.needed;
    // Only more viewing earns a milestone: a refreshed runtime or an un-tick never does.
    if (complete && before?.complete && watchedEpisodeCount() > +(before.episodes || 0) && prefs.castMilestones !== false) {
      let best = null;
      for (const row of result.people.slice(0, 80)) {
        const previous = before.top[row.id];
        if (previous === undefined) continue;
        const hours = crossedMilestone(previous, row.minutes);
        if (hours && (!best || hours > best.hours || (hours === best.hours && row.minutes > best.row.minutes))) best = { row, hours };
      }
      if (best) announce(best.row, best.hours);
    }
    writeSnapshot(result);
    return result;
  })().finally(() => { running = null; });
  return running;
}

export function initCastMilestones() {
  let timer = 0;
  // A tick (not a sync from another device, not the backfill) is what earns a
  // milestone; the pause lets a run of ticks settle into one count.
  document.addEventListener('cv:episode-progress', event => {
    const detail = event.detail || {};
    if (!detail.key || detail.merged || detail.live || detail.backfill) return;
    clearTimeout(timer);
    timer = setTimeout(() => { checkCastMilestones().catch(() => {}); }, 2500);
  });
}
