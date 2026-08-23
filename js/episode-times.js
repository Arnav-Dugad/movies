// Exact episode timestamps from TVmaze's free public API. TMDB provides the
// episode date; TVmaze's airstamp adds the original timezone offset so Intl can
// convert it accurately to the viewer's local timezone.
const CACHE_KEY = 'cv_episode_times_v1';
const POSITIVE_TTL = 7 * 86400000;
const EMPTY_TTL = 86400000;
let cache = {};
let mazeBudget = 16;
let mazeWindowStarted = Date.now();
let mazeTimer = null;
const mazeQueue = [];
const inflight = new Map();

try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (_) { cache = {}; }

const cleanTitle = value => String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
const episodeKey = (showId, season, episode) => `${+showId || 0}:${+season || 0}:${+episode || 0}`;

/**
 * The single availability rule used by detail pages, tracker writes and tests.
 * A confirmed broadcaster timestamp wins. TMDB only supplies a calendar date,
 * so its safe fallback becomes available at the start of that date in the
 * viewer's timezone. A missing date is unknown, never silently "already aired".
 */
export function episodeAvailability(episode, { showId = 0, airstamp = '', now = Date.now() } = {}) {
  const exact = airstamp || cache[episodeKey(showId, episode?.season_number, episode?.episode_number)]?.airstamp || '';
  if (exact) {
    const at = new Date(exact).getTime();
    if (Number.isFinite(at)) return { available: now >= at, at, precision: 'exact' };
  }
  const airDate = String(episode?.air_date || '');
  const at = airDate ? new Date(`${airDate}T00:00:00`).getTime() : NaN;
  return Number.isFinite(at)
    ? { available: now >= at, at, precision: 'date' }
    : { available: false, at: 0, precision: 'unknown' };
}

export function isEpisodeAvailable(episode, options) {
  return episodeAvailability(episode, options).available;
}

function persist() {
  try {
    cache = Object.fromEntries(Object.entries(cache).sort((a, b) => (b[1]?.checkedAt || 0) - (a[1]?.checkedAt || 0)).slice(0, 260));
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (_) {}
}

function pumpMazeQueue() {
  const elapsed = Date.now() - mazeWindowStarted;
  if (elapsed >= 10000) { mazeBudget = 16; mazeWindowStarted = Date.now(); }
  while (mazeBudget > 0 && mazeQueue.length) {
    mazeBudget--;
    const job = mazeQueue.shift();
    fetchJSON(job.url).then(job.resolve);
  }
  if (mazeQueue.length && !mazeTimer) {
    mazeTimer = setTimeout(() => { mazeTimer = null; pumpMazeQueue(); }, Math.max(50, 10025 - (Date.now() - mazeWindowStarted)));
  }
}

function scheduledJSON(url) {
  return new Promise(resolve => { mazeQueue.push({ url, resolve }); pumpMazeQueue(); });
}

async function fetchJSON(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return response.status === 404 ? null : { __cvFailed: true };
    return await response.json();
  } catch (_) { return { __cvFailed: true }; }
  finally { clearTimeout(timeout); }
}

export async function exactEpisodeTime(show) {
  const episode = show?.next_episode_to_air;
  if (!show?.id || !episode?.air_date) return null;
  const key = episodeKey(show.id, episode.season_number, episode.episode_number);
  const saved = cache[key], ttl = saved?.airstamp ? POSITIVE_TTL : EMPTY_TTL;
  if (saved && Date.now() - saved.checkedAt < ttl) return saved.airstamp ? saved : null;
  if (inflight.has(key)) return inflight.get(key);

  const request = (async () => {
    const title = show.name || show.original_name || '';
    const data = await scheduledJSON(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(title)}&embed=nextepisode`);
    // Network errors and rate-limit responses are intentionally not cached as
    // "no exact time" so a later refresh can recover without waiting a day.
    if (data?.__cvFailed) return null;
    const mazeEpisode = data?._embedded?.nextepisode;
    const tmdbYear = +(show.first_air_date || '').slice(0, 4), mazeYear = +(data?.premiered || '').slice(0, 4);
    const titleMatches = cleanTitle(data?.name) === cleanTitle(title) || cleanTitle(data?.name) === cleanTitle(show.original_name);
    const yearMatches = !tmdbYear || !mazeYear || Math.abs(tmdbYear - mazeYear) <= 1;
    const episodeMatches = +mazeEpisode?.season === +episode.season_number && +mazeEpisode?.number === +episode.episode_number;
    const result = titleMatches && yearMatches && episodeMatches && mazeEpisode?.airstamp
      ? { airstamp: mazeEpisode.airstamp, airtime: mazeEpisode.airtime || '', source: 'TVmaze', checkedAt: Date.now() }
      : { airstamp: '', checkedAt: Date.now() };
    cache[key] = result; persist();
    return result.airstamp ? result : null;
  })();
  inflight.set(key, request);
  try { return await request; }
  finally { inflight.delete(key); }
}

export function localEpisodeTime(airstamp, options = {}) {
  const date = new Date(airstamp);
  if (!airstamp || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    weekday: options.short ? undefined : 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

export function localTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time'; }
  catch (_) { return 'Local time'; }
}
