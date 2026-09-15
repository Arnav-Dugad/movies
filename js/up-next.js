// ===== UP NEXT =====
// Shows you are caught up on, whose next episode has a date, lead Continue
// Watching with a countdown to it. Only what TMDB actually publishes is shown:
//
//   - The date is TMDB's `next_episode_to_air.air_date`.
//   - A live hours-minutes-seconds countdown needs an exact moment, which TMDB
//     does not have; it runs only when TVmaze publishes an airstamp for that
//     same episode WITH a published airtime (js/episode-times.js, cached);
//     a streaming drop with no time is stamped noon UTC by TVmaze, which is a
//     placeholder. Otherwise the card counts
//     calendar days — "Tomorrow", "In 4 days" — rather than inventing a time.
//
// A card appears up to 30 days ahead and stays as "Out now" for three days
// after, by which time TMDB has usually moved the show's aired marker and the
// show has returned to Continue Watching as a normal card.
import { tmdb, pool } from './api.js';
import { state } from './state.js';
import { showProgress, fetchShowMeta, syncShowStructure } from './episodes.js';
import { exactEpisodeTime } from './episode-times.js';

const DAY = 86400000;
export const UP_NEXT_DAYS = 30;
const OUT_NOW_DAYS = 3;
const LIMIT = 24;
const TTL = 30 * 60 * 1000;

/** Tracked shows that could have something coming: caught up, not dropped, not finished for good. */
export function upNextCandidates(progress = state.episodeProgress) {
  return Object.values(progress || {})
    .filter(entry => entry?.tmdbId && !entry.dropped)
    .filter(entry => {
      const status = String(entry.status || '').toLowerCase();
      if (['ended', 'canceled', 'cancelled'].includes(status)) return false;
      const progressNow = showProgress(entry.tmdbId);
      return progressNow.started && progressNow.caughtUp && !progressNow.seriesCompleted;
    })
    .sort((a, b) => (+b.lastWatched?.at || 0) - (+a.lastWatched?.at || 0))
    .slice(0, LIMIT);
}

// 'YYYY-MM-DD' as local midnight: the calendar day, not a moment in UTC.
const localDay = value => {
  const [y, m, d] = String(value || '').split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).getTime() : NaN;
};
const startOfToday = now => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** One card's model from a TMDB /tv payload, or null when nothing is due in the window. */
export function upNextItem(show, { now = Date.now(), airstamp = '' } = {}) {
  const episode = show?.next_episode_to_air;
  if (!show?.id || !episode?.air_date || !+episode.season_number || !+episode.episode_number) return null;
  const day = localDay(episode.air_date);
  if (!Number.isFinite(day)) return null;
  const exactAt = airstamp ? Date.parse(airstamp) : NaN;
  const exact = Number.isFinite(exactAt);
  const at = exact ? exactAt : day;
  const today = startOfToday(now);
  if (at - now > UP_NEXT_DAYS * DAY) return null;
  if ((exact ? now - at : today - day) > OUT_NOW_DAYS * DAY) return null;
  return {
    key: `tv_${show.id}`, id: +show.id, title: show.name || 'TV show',
    poster: show.poster_path || '', backdrop: show.backdrop_path || '', still: episode.still_path || '',
    season: +episode.season_number, episode: +episode.episode_number, name: episode.name || '',
    kind: +episode.episode_number === 1 ? 'premiere' : episode.episode_type === 'finale' ? 'finale' : 'episode',
    airDate: episode.air_date, airstamp: exact ? airstamp : '', exact, at,
  };
}

const two = n => String(n).padStart(2, '0');

/** What the countdown says right now. `live` means it changes every second. */
export function countdownText(item, now = Date.now()) {
  if (item.exact) {
    const ms = item.at - now;
    if (ms <= 0) return { text: 'Out now', out: true, live: false };
    const total = Math.floor(ms / 1000);
    const days = Math.floor(total / 86400), hours = Math.floor(total / 3600) % 24, minutes = Math.floor(total / 60) % 60, seconds = total % 60;
    return { text: `${days ? `${days}d ` : ''}${two(hours)}:${two(minutes)}:${two(seconds)}`, out: false, live: true };
  }
  const days = Math.round((localDay(item.airDate) - startOfToday(now)) / DAY);
  if (days < 0) return { text: 'Out now', out: true, live: false };
  if (days === 0) return { text: 'Today', out: false, live: false };
  if (days === 1) return { text: 'Tomorrow', out: false, live: false };
  return { text: `In ${days} days`, out: false, live: false };
}

export const kindLabel = item => (item.kind === 'premiere' ? `Season ${item.season} premiere` : item.kind === 'finale' ? 'Season finale' : 'New episode');

// ---------- loading ----------
let cache = { uid: '', signature: '', at: 0, items: [], promise: null };

export function upNextItems() {
  return state.user && cache.uid === state.user.uid ? cache.items : [];
}

/** Fetch (at most every 30 minutes, or when the candidate set changes). Fires cv:up-next when items change. */
export function refreshUpNext({ force = false } = {}) {
  if (!state.user) { cache = { uid: '', signature: '', at: 0, items: [], promise: null }; return Promise.resolve([]); }
  const uid = state.user.uid;
  const candidates = upNextCandidates();
  const signature = candidates.map(entry => entry.tmdbId).join(',');
  const fresh = cache.uid === uid && cache.signature === signature && Date.now() - cache.at < TTL;
  if (!force && (fresh || (cache.promise && cache.uid === uid && cache.signature === signature))) return cache.promise || Promise.resolve(cache.items);
  if (cache.uid !== uid) cache.items = [];
  cache.uid = uid; cache.signature = signature;
  const announce = () => document.dispatchEvent(new Event('cv:up-next'));
  const run = (async () => {
    const shows = [];
    await pool(candidates, async entry => {
      const show = await tmdb(`/tv/${entry.tmdbId}`).catch(() => null);
      const item = show && upNextItem(show);
      if (item) shows.push({ show, item });
    }, 3);
    if (state.user?.uid !== uid) return [];
    const byTime = list => list.sort((a, b) => a.at - b.at || a.title.localeCompare(b.title));
    cache.items = byTime(shows.map(entry => entry.item));
    cache.at = Date.now();
    announce();
    // Exact moments arrive afterwards (TVmaze is rate-limited); each one upgrades
    // its card from a day count to a live countdown.
    const exact = await Promise.all(shows.map(({ show, item }) => exactEpisodeTime(show)
      // exactEpisodeTime only returns stamps with a real airtime (never TVmaze's
      // noon-UTC placeholder), so any stamp here is a live countdown.
      .then(time => (time?.airstamp ? upNextItem(show, { airstamp: time.airstamp }) : item))
      .catch(() => item)));
    if (state.user?.uid !== uid) return [];
    const upgraded = byTime(exact.filter(Boolean));
    if (JSON.stringify(upgraded) !== JSON.stringify(cache.items)) { cache.items = upgraded; announce(); }
    return cache.items;
  })();
  cache.promise = run;
  run.finally(() => { if (cache.promise === run) cache.promise = null; });
  return run;
}

// When a countdown reaches zero, ask TMDB for the show again so the tracker
// learns the episode has aired; once it has, the show leaves "caught up" and
// comes back to Continue Watching as a normal card.
const arrived = new Set();
export function episodeArrived(item) {
  const key = `${item.key}_${item.season}_${item.episode}`;
  if (arrived.has(key)) return;
  arrived.add(key);
  fetchShowMeta(item.id, { force: true })
    .then(meta => { syncShowStructure(item.id, meta); return refreshUpNext({ force: true }); })
    .catch(() => {});
}
