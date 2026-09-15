// Viewing patterns, season recaps, the "Returning this month" rail, exact
// episode times, and the season-complete signal.
import { check, summary } from './harness.mjs';

const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const ep = await import(SRC + 'episodes.js');
const pacing = await import(SRC + 'pacing.js');
const recap = await import(SRC + 'season-recap.js');
const returning = await import(SRC + 'returning.js');
const times = await import(SRC + 'episode-times.js');

const DAY = 86400000;
// A local moment on the most recent given weekday (0 = Sunday) `weeksAgo` weeks back, at `hour`.
const on = (weekday, hour, weeksAgo = 0, minute = 0) => {
  const d = new Date(); d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - weekday + 7) % 7) - weeksAgo * 7);
  return d.getTime();
};
state.user = { uid: 'u1' };
state.watched = {};

// ---------- viewing patterns ----------
const weeknights = [1, 2, 3, 4, 2, 3].map((day, i) => on(day, 21, i));
let profile = pacing.pacingProfile(weeknights);
check('weekday evenings read as weeknights', profile?.phrase === 'on weeknights', JSON.stringify(profile));
profile = pacing.pacingProfile([6, 0, 6, 0, 6].map((day, i) => on(day, 15, i)));
check('Saturday and Sunday afternoons read as weekend afternoons', profile?.phrase === 'on weekend afternoons', JSON.stringify(profile));
profile = pacing.pacingProfile([6, 0, 6, 0, 3].map((day, i) => on(day, [10, 14, 20, 23, 9][i], i)));
check('weekends at mixed hours read as weekends', profile?.phrase === 'on weekends', JSON.stringify(profile));
profile = pacing.pacingProfile([1, 2, 3, 4, 5].map((day, i) => on(day, 1, i)));
check('past midnight belongs to the night before (1 a.m. Saturday is Friday)', pacing.pacingProfile([6, 6, 6, 6, 6].map((day, i) => on(day, 1, i)))?.when === 'weekdays');
check('late weeknights say so', profile?.phrase === 'late on weeknights', JSON.stringify(profile));
check('no clear lean, no sentence', pacing.pacingProfile([1, 6, 3, 0, 5, 2].map((day, i) => on(day, [9, 14, 20, 23, 11, 16][i], i))) === null);
check('fewer than five sittings is too few to call', pacing.pacingProfile(weeknights.slice(0, 4)) === null);
check('five sittings on one or two days is too few days', pacing.pacingProfile([0, 1, 2, 3, 4].map(m => on(2, 21, 0, m))) === null);
check('the same stamp counts once (a batch is one sitting)', pacing.pacingProfile([...weeknights.slice(0, 4), weeknights[0], weeknights[0]]) === null);

const logFrom = (stamps, bulk = 0) => stamps.map((at, i) => [1, i + 1, at, bulk]);
const entry = (id, title, stamps, extra = {}) => ({ tmdbId: id, title, episodeRuntime: 50, structure: { 1: 10 }, aired: { season: 1, episode: 10 }, seasons: { 1: stamps.map((_, i) => i + 1) }, log: logFrom(stamps), ...extra });
const severance = entry(1, 'Severance', weeknights);
const bear = entry(2, 'The Bear', [6, 0, 6, 0, 6].map((day, i) => on(day, 15, i)));
check('a show pattern becomes a sentence', pacing.pacingSentence('Severance', pacing.showPacing(severance)) === 'You watch Severance on weeknights');
check('the insight contrasts shows', pacing.pacingInsight([severance, bear]) === 'You watch Severance on weeknights, The Bear on weekend afternoons', pacing.pacingInsight([severance, bear]));
check('two shows with the same pattern are not repeated', pacing.pacingInsight([severance, entry(3, 'Andor', weeknights.map(at => at + 60000))]).split(' on weeknights').length === 2);
check('dropped shows are left out', pacing.pacingInsight([{ ...severance, dropped: true }]) === '');
check('bookkeeping marks never make a pattern', pacing.showPacing({ ...severance, log: logFrom(weeknights, 1).map(row => [row[0], row[1], weeknights[0], 1]) }) === null);

// ---------- season recaps ----------
const start = on(1, 21, 2);
const seasonEntry = {
  tmdbId: 9, title: 'Recap Show', episodeRuntime: 45, structure: { 1: 6 }, aired: { season: 1, episode: 6 },
  seasons: { 1: [1, 2, 3, 4, 5, 6] },
  log: [[1, 1, start, 0], [1, 2, start + DAY, 0], [1, 3, start + 2 * DAY, 0], [1, 4, start + 2 * DAY + 3600000, 0], [1, 5, start + 2 * DAY + 7200000, 0], [1, 6, start + 4 * DAY, 0]],
};
const tmdbEpisodes = [
  { episode_number: 1, runtime: 50, vote_average: 7.9, vote_count: 40 },
  { episode_number: 2, runtime: 44, vote_average: 8.4, vote_count: 38, name: 'Two', still_path: '/two.jpg' },
  { episode_number: 3, runtime: 44, vote_average: 9.8, vote_count: 1, name: 'Hardly rated' },
  { episode_number: 4, runtime: 44, vote_average: 8.1, vote_count: 30 },
  { episode_number: 5, runtime: 0, vote_average: 0, vote_count: 0 },
  { episode_number: 6, runtime: 60, vote_average: 8.3, vote_count: 35 },
];
const r = recap.seasonRecap(seasonEntry, 1, { episodes: tmdbEpisodes });
check('a recap counts the season', r.episodes === 6 && r.viewingEpisodes === 6 && !r.marked);
check('days run from the first to the last evening, inclusive', r.spanDays === 5, String(r.spanDays));
check('pace is episodes over those days', Math.abs(r.pace - 6 / 5) < 1e-9);
check('three episodes in one day is a binge day, and the longest sitting', r.bingeDays === 1 && r.longestSitting === 3);
check('watch time sums TMDB runtimes, falling back to the show runtime', r.minutes === 50 + 44 + 44 + 44 + 45 + 60, String(r.minutes));
check('the top-rated episode ignores near-unrated ones', r.topEpisode?.number === 2 && r.topEpisode.rating === 8.4 && r.topEpisode.still === '/two.jpg', JSON.stringify(r.topEpisode));
check('figures are labelled and at most six', recap.recapFigures(r).length === 6 && recap.recapFigures(r)[0][0] === 'Episodes' && recap.recapFigures(r).some(([label, value]) => label === 'Pace' && value === '1.2 a day'), JSON.stringify(recap.recapFigures(r)));
check('dates span start to finish', /–/.test(recap.recapDates(r)));
const marked = recap.seasonRecap({ ...seasonEntry, log: seasonEntry.log.map(row => [row[0], row[1], start, 1]) }, 1, { episodes: tmdbEpisodes });
check('a season marked in one press has no pace and says so', marked.marked && marked.pace === 0 && !recap.recapFigures(marked).some(([label]) => ['Pace', 'Days', 'Binge days'].includes(label)));
check('a one-day finish shows one date', !/–/.test(recap.recapDates(recap.seasonRecap({ ...seasonEntry, log: seasonEntry.log.map((row, i) => [1, row[1], start + i * 60000, 0]) }, 1))));
check('durations read as hours and minutes', recap.formatDuration(287) === '4h 47m' && recap.formatDuration(60) === '1h' && recap.formatDuration(0) === '');

// ---------- the season-complete signal ----------
const events = [];
const dispatch = document.dispatchEvent;
document.dispatchEvent = event => { events.push(event); return true; };
state.episodeProgress = {};
const META = { title: 'Signal Show', structure: { 1: 3, 2: 3 }, aired: { season: 2, episode: 3 }, status: 'Ended', episodeRuntime: 40 };
ep.toggleEpisode(50, 1, 1, META);
ep.toggleEpisode(50, 1, 2, META);
check('no signal before the season is finished', !events.some(event => event.type === 'cv:season-complete'));
ep.toggleEpisode(50, 1, 3, META);
const signal = events.filter(event => event.type === 'cv:season-complete');
check('finishing a season signals once, with the season', signal.length === 1 && signal[0].detail.id === 50 && JSON.stringify(signal[0].detail.seasons) === '[1]', JSON.stringify(signal.map(event => event.detail)));
events.length = 0;
ep.toggleEpisode(50, 1, 3, META);
ep.toggleEpisode(50, 1, 3, META);
check('re-finishing after an un-tick signals again', events.filter(event => event.type === 'cv:season-complete').length === 1);
events.length = 0;
ep.setSeasonWatched(50, 2, true, META);
check('marking a whole season signals too (the prompt decides whether to show)', events.some(event => event.type === 'cv:season-complete' && event.detail.seasons.includes(2)));
document.dispatchEvent = dispatch;

// ---------- returning this month ----------
const now = Date.now();
const month = (() => { const d = new Date(now); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
const today = new Date(now).getDate();
const dayIn = n => `${month}-${String(n).padStart(2, '0')}`;
const show = (seasons, extra = {}) => ({ id: 7, name: 'Back Again', status: 'Returning Series', seasons, ...extra });
const later = Math.min(28, today + 1), earlier = Math.max(1, today - 1);
let found = returning.returningSeason(show([{ season_number: 1, air_date: '2020-01-01' }, { season_number: 2, air_date: dayIn(later), episode_count: 8 }]), { lastSeason: 1, now });
check('a new season premiering this month is returning', found?.season === 2 && found.episodes === 8, JSON.stringify(found));
check('a season you are caught up through is not returning', returning.returningSeason(show([{ season_number: 2, air_date: dayIn(later) }]), { lastSeason: 2, now }) === null);
check('without a known season, season one can never be a return', returning.returningSeason(show([{ season_number: 1, air_date: dayIn(later) }]), { now }) === null);
check('next month is not this month', returning.returningSeason(show([{ season_number: 3, air_date: '2999-01-01' }]), { lastSeason: 2, now }) === null);
check('ended shows never return', returning.returningSeason(show([{ season_number: 3, air_date: dayIn(later) }], { status: 'Ended' }), { lastSeason: 2, now }) === null);
check('a next episode that opens a season counts when seasons lack a date', returning.returningSeason(show([{ season_number: 3, air_date: null }], { next_episode_to_air: { season_number: 3, episode_number: 1, air_date: dayIn(later) } }), { lastSeason: 2, now })?.season === 3);
check('a mid-season next episode is not a return', returning.returningSeason(show([], { next_episode_to_air: { season_number: 3, episode_number: 4, air_date: dayIn(later) } }), { lastSeason: 2, now }) === null);
found = returning.returningSeason(show([{ season_number: 2, air_date: dayIn(earlier) }]), { lastSeason: 1, now });
check('a premiere earlier this month is out now', found?.out === (dayIn(earlier) <= dayIn(today)) && returning.returningBadge(found, now).startsWith('S2 · '));
check('an out-now badge says so', returning.returningBadge({ season: 4, out: true }) === 'S4 · Out now');

state.episodeProgress = {
  tv_1: { ...entry(1, 'Caught Up', Array.from({ length: 10 }, (_, i) => now - (10 - i) * DAY)), status: 'Returning Series' },
  tv_2: { ...entry(2, 'In Progress', [now - DAY, now]), status: 'Returning Series' },
  tv_3: { ...entry(3, 'Ended Show', Array.from({ length: 10 }, (_, i) => now - (10 - i) * DAY)), status: 'Ended' },
};
state.watched = { tv_4: { tmdbId: 4, type: 'tv', title: 'Marked Watched', watchedAt: { seconds: Math.floor(now / 1000) } }, tv_2: { tmdbId: 2, type: 'tv', title: 'In Progress' }, movie_5: { tmdbId: 5, type: 'movie' } };
const finished = returning.finishedShows();
check('finished shows are the caught-up and the marked-watched, not in-progress, ended or films', finished.map(item => item.title).sort().join(',') === 'Caught Up,Marked Watched', JSON.stringify(finished));
check('a caught-up show is finished through its aired season', finished.find(item => item.id === 1)?.lastSeason === 1);

// ---------- exact episode times ----------
check('a TVmaze stamp with an airtime is exact', times.exactStamp({ airstamp: '2026-09-17T06:00:00+00:00', airtime: '07:00' }) === '2026-09-17T06:00:00+00:00');
check("TVmaze's noon-UTC placeholder (no airtime) is not exact", times.exactStamp({ airstamp: '2026-09-16T12:00:00+00:00', airtime: '' }) === '' && times.exactStamp(null) === '');
const availability = times.episodeAvailability({ season_number: 1, episode_number: 1, air_date: '2026-09-16' }, { showId: 0, now: new Date('2026-09-16T01:00:00').getTime() });
check('without an exact stamp, availability falls back to the date', availability.precision === 'date' && availability.available === true);

summary();
