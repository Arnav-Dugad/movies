// What counts as viewing, the forecast's reasons, the Diary's TV month, the
// mood of recent episodes, and Up Next countdowns.
import { check, summary } from './harness.mjs';

const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const ep = await import(SRC + 'episodes.js');
const diary = await import(SRC + 'diary.js');
const mood = await import(SRC + 'watching-mood.js');
const rec = await import(SRC + 'recommend.js');
const upNext = await import(SRC + 'up-next.js');

const DAY = 86400000, HOUR = 3600000;
const noon = offset => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime() - offset * DAY; };
const NOW = noon(0) + HOUR;
state.user = { uid: 'u1' };
state.watched = {};

// ---------- viewingLog ----------
const rows = (entry) => ep.viewingLog(entry).map(row => `${row.season}.${row.episode}:${row.viewing ? 'v' : 'b'}`).join(' ');
const batch = (episodes, at, season = 1) => episodes.map(e => [season, e, at, 1]);
check('single ticks are viewing', rows({ episodeRuntime: 50, log: [[1, 1, noon(3), 0], [1, 2, noon(2), 0]] }) === '1.1:v 1.2:v');
check('a first batch the size of an evening is viewing', rows({ episodeRuntime: 50, log: batch([1, 2], noon(9)) }) === '1.1:v 1.2:v');
check('a first batch bigger than an evening is the catch-up', rows({ episodeRuntime: 50, log: batch([1, 2, 3, 4], noon(9)) }) === '1.1:b 1.2:b 1.3:b 1.4:b');
check('without a runtime, three episodes is the most a first batch holds', rows({ log: batch([1, 2, 3], noon(9)) }) === '1.1:v 1.2:v 1.3:v' && rows({ log: batch([1, 2, 3, 4], noon(9)) }) === '1.1:b 1.2:b 1.3:b 1.4:b');
check('a show whose document lost its id still reaches the diary', (() => {
  const events = diary.diaryEvents({ watched: {}, episodeProgress: { tv_4242: { title: 'No id', episodeRuntime: 40, log: [[1, 1, noon(1), 0]] } } });
  return events.length === 1 && events[0].id === 4242;
})());
check('a later sitting-sized batch is viewing ("Up to here" after an evening)', rows({ episodeRuntime: 50, log: [...batch([1, 2], noon(9)), ...batch([3, 4, 5], noon(2))] }).endsWith('1.3:v 1.4:v 1.5:v'));
check('a later batch longer than six hours is bookkeeping', rows({ episodeRuntime: 50, log: [...batch([1], noon(9)), ...batch([2, 3, 4, 5, 6, 7, 8, 9], noon(2))] }).endsWith('1.9:b'));
check('without a runtime, six episodes is the most one sitting holds', rows({ log: [...batch([1], noon(9)), ...batch([2, 3, 4, 5, 6, 7], noon(2))] }).endsWith('1.7:v') && rows({ log: [...batch([1], noon(9)), ...batch([2, 3, 4, 5, 6, 7, 8], noon(2))] }).endsWith('1.8:b'));
check('an empty or malformed log is empty', ep.viewingLog({ log: [null, [1, 1, 'x', 0]] }).length === 0 && ep.viewingLog(null).length === 0);

// ---------- forecastStatus ----------
const show = (id, log, extra = {}) => {
  const seasons = {};
  log.forEach(([s, e]) => { (seasons[s] = seasons[s] || []).push(e); });
  const last = [...log].sort((a, b) => a[2] - b[2]).at(-1);
  return { tmdbId: id, title: `Show ${id}`, episodeRuntime: 45, structure: { 1: 10 }, aired: { season: 1, episode: 10 }, seasons, log, lastWatched: last ? { season: last[0], episode: last[1], at: last[2] } : null, ...extra };
};
// Tracked only with bulk presses: the case that used to get no forecast at all.
state.episodeProgress = { tv_1: show(1, [...batch([1, 2, 3, 4, 5], noon(14)), ...batch([6, 7], noon(6)), ...batch([8, 9], noon(2))]) };
let status = ep.forecastStatus(1, { now: NOW });
check('a show tracked with "Up to here" presses now gets a forecast', status?.kind === 'forecast', JSON.stringify(status));
check('its pace counts the sitting batches, not the catch-up', status?.kind === 'forecast' && Math.abs(status.forecast.pace - 4 / ((NOW - noon(6)) / DAY)) < 1e-9, JSON.stringify(status));
check('bingeForecast agrees with the status', JSON.stringify(ep.bingeForecast(1, { now: NOW })) === JSON.stringify(status.forecast));

state.episodeProgress = { tv_2: show(2, [[1, 1, noon(95), 0], [1, 2, noon(94), 0]]) };
status = ep.forecastStatus(2, { now: NOW });
check('a show untouched for two months is paused, with how long', status?.kind === 'paused' && status.days === 94, JSON.stringify(status));
check('the paused note says so in months', ep.forecastNote(status).startsWith('Paused for 3 months') && ep.forecastNote(status, { short: true }) === 'Paused 3 months', ep.forecastNote(status));

state.episodeProgress = { tv_3: show(3, [[1, 1, noon(1), 0]]) };
status = ep.forecastStatus(3, { now: NOW });
check('one episode is not a pace: learning', status?.kind === 'learning' && status.remaining === 9, JSON.stringify(status));
check('the learning note explains what produces a date', /finish date appears/.test(ep.forecastNote(status)));
check('a forecast status has no note', ep.forecastNote({ kind: 'forecast' }) === '' && ep.forecastNote(null) === '');

state.episodeProgress = { tv_3: show(3, [[1, 1, noon(1), 0]]), tv_4: show(4, [[1, 1, noon(9), 0], [1, 2, noon(6), 0], [1, 3, noon(3), 0]]) };
status = ep.forecastStatus(3, { now: NOW });
check('a new show borrows your usual pace from other shows', status?.kind === 'forecast' && status.forecast.basis === 'overall', JSON.stringify(status));
state.episodeProgress.tv_4.dropped = true;
check('a dropped show does not lend its pace', ep.forecastStatus(3, { now: NOW })?.kind === 'learning');

state.episodeProgress = { tv_5: show(5, Array.from({ length: 10 }, (_, i) => [1, i + 1, noon(10 - i), 0])) };
check('a caught-up show has nothing to forecast', ep.forecastStatus(5, { now: NOW }) === null);

check('fast pace reads per day', ep.paceLabel(2) === '2 episodes a day' && ep.paceLabel(1) === '1 episode a day' && ep.paceLabel(1.26) === '1.3 episodes a day');
check('moderate pace reads per week', ep.paceLabel(0.5) === '4 episodes a week' && ep.paceLabel(1 / 7) === '1 episode a week');
check('slow pace reads per month, never zero', ep.paceLabel(0.1) === '3 episodes a month' && ep.paceLabel(0.001) === '1 episode a month');

// ---------- the Diary's TV month ----------
const events = [
  { kind: 'episode', key: 'tv_10', id: 10, type: 'tv', title: 'Alpha', poster: '', season: 1, episode: 8, at: noon(2) + HOUR, bulk: false, minutes: 40 },
  { kind: 'episode', key: 'tv_10', id: 10, type: 'tv', title: 'Alpha', poster: '', season: 2, episode: 1, at: noon(2) + 2 * HOUR, bulk: false, minutes: 40 },
  { kind: 'episode', key: 'tv_10', id: 10, type: 'tv', title: 'Alpha', poster: '', season: 1, episode: 9, at: noon(2) + 3 * HOUR, bulk: false, minutes: 40 },
  { kind: 'episode', key: 'tv_11', id: 11, type: 'tv', title: 'Beta', poster: '', season: 3, episode: 2, at: noon(1), bulk: false, minutes: 0 },
  { kind: 'episode', key: 'tv_11', id: 11, type: 'tv', title: 'Beta', poster: '', season: 3, episode: 1, at: noon(1), bulk: true, minutes: 0 },
  { kind: 'movie', key: 'movie_1', id: 1, type: 'movie', title: 'Film', poster: '', at: noon(1) + HOUR, bulk: false, minutes: 120 },
];
const days = diary.diaryDays(events);
const month = diary.monthKey(noon(1));
const tv = diary.diaryMonthTV(days, month);
const sameMonth = diary.monthKey(noon(2)) === month;
if (sameMonth) {
  check('TV month counts only real viewing episodes', tv.episodes === 4 && tv.minutes === 120 && tv.marked === 1, JSON.stringify(tv));
  check('films never count as TV', tv.shows.every(show => show.key.startsWith('tv_')));
  check('three episodes in one day is a binge day', tv.bingeDays === 1 && tv.activeDays === 2);
  check('shows rank by episodes watched', tv.shows[0].title === 'Alpha' && tv.shows[0].episodes === 3 && tv.shows[0].days === 1);
  check('the span runs from the earliest to the latest episode, across seasons', tv.shows[0].span === 'S1 E8 – S2 E1', tv.shows[0].span);
}
check('an empty month has no TV', diary.diaryMonthTV(days, '1999-01').episodes === 0);
const dayTwo = days.get(diary.dayKey(noon(1)));
check('each day splits minutes into films and TV', dayTwo.filmMinutes === 120 && dayTwo.tvMinutes === 0 && days.get(diary.dayKey(noon(2))).tvMinutes === 120);
const months = diary.diaryMonths(days, { now: NOW });
check('each month splits minutes into films and TV', months.reduce((sum, m) => sum + m.tvMinutes, 0) === 120 && months.reduce((sum, m) => sum + m.filmMinutes, 0) === 120);
check('episode spans read naturally', diary.episodeSpan({ season: 2, episode: 5 }, { season: 2, episode: 5 }) === 'S2 E5' && diary.episodeSpan({ season: 2, episode: 1 }, { season: 2, episode: 5 }) === 'S2 E1–E5' && diary.episodeSpan(null, null) === '');

// Diary events read the same viewing rule as the forecast.
const fromLog = diary.diaryEvents({ episodeProgress: { tv_1: show(1, [...batch([1, 2, 3, 4, 5], noon(14)), ...batch([6, 7], noon(6))]) } });
check('Diary counts a sitting batch as viewing and a catch-up bigger than an evening as marked', fromLog.filter(e => !e.bulk).length === 2 && fromLog.filter(e => e.bulk).length === 5);

// ---------- mood of recent episodes ----------
const labels = moods => moods.map(m => m.label);
let moods = mood.detectMoods({ episodes: [{ overview: 'After surviving an assassination attempt, Blackthorne learns he was betrayed.', weight: 3 }] });
check('moods are read from what the episode is about', labels(moods).includes('assassination') && labels(moods).includes('betrayal'), JSON.stringify(moods));
check('episode titles are not read', mood.detectMoods({ episodes: [{ name: 'Kiss of Death', overview: 'The team regroups.', weight: 3 }] }).length === 0);
check('a season overview alone is not enough', mood.detectMoods({ episodes: [{ overview: 'They regroup.', weight: 3 }], seasonOverview: 'Their memories return.' }).length === 0);
check('the show being catalogued with a mood corroborates it', labels(mood.detectMoods({ episodes: [{ overview: 'They regroup.', weight: 3 }], seasonOverview: 'Their memories return.', showKeywords: [{ id: 10937, name: 'memory' }] })).includes('memory'));
check("a show keyword must match a whole word ('king' is not 'kingdom')", mood.detectMoods({ episodes: [{ overview: 'The kingdom falls.', weight: 3 }], showKeywords: [{ id: 999001, name: 'king' }] }).length === 0);
check('a show keyword named in the episode becomes a mood', labels(mood.detectMoods({ episodes: [{ overview: 'The old king dies.', weight: 3 }], showKeywords: [{ id: 999001, name: 'king' }] })).includes('king'));
check('genre-like keywords are never moods', mood.detectMoods({ episodes: [{ overview: 'A tense thriller night.', weight: 3 }], showKeywords: [{ id: 316362, name: 'thriller' }] }).length === 0);
moods = mood.detectMoods({ episodes: [{ overview: 'A murder, a heist, a prison break, a kidnapping and a wedding.', weight: 3 }] });
check('at most three moods', moods.length === 3, JSON.stringify(moods));
check('ambiguous words are not moods', mood.detectMoods({ episodes: [{ overview: 'Tensions emerge after the team suffers a loss.', weight: 3 }] }).length === 0);
check('every mood has a unique label and real keyword ids', new Set(mood.MOODS.map(([label]) => label)).size === mood.MOODS.length && mood.MOODS.every(([, pattern, ids]) => pattern instanceof RegExp && ids.length && ids.every(id => Number.isInteger(id) && id > 0)));

const recent = mood.recentEpisodes({ log: [[1, 1, 10, 0], [1, 3, 30, 1], [1, 2, 20, 0], [1, 4, 30, 1], [1, 5, 40, 0]] });
check('recent episodes are newest first, weighted 3-2-1', recent.map(e => `${e.episode}:${e.weight}`).join(' ') === '5:3 4:2 3:1', JSON.stringify(recent));
check('without a log the last watched episode is used', mood.recentEpisodes({ lastWatched: { season: 2, episode: 4, at: 5 } })[0]?.episode === 4);
check('the label spans the episodes read', mood.episodesLabel(recent) === 'S1 E3–E5' && mood.episodesLabel([]) === '');
check('show genres map to film genres', JSON.stringify(mood.movieGenresFor([10765, 18, 10764])) === JSON.stringify([878, 14, 18]));

const seedShow = { type: 'tv', id: 126308 };
const profile = { watchingGenres: { tv_126308: [18, 10768] } };
const cand = (genres, sources, extra = {}) => ({ genre_ids: genres, __sources: sources, __seedKeys: ['tv_126308'], ...extra });
check('mood mode accepts only mood-sourced titles', rec.isRelatedToWatching(cand([10752], ['watchingMood']), seedShow, profile, { mood: true }) && !rec.isRelatedToWatching(cand([18], ['watching']), seedShow, profile, { mood: true }));
check('a film in the mood qualifies through the mapped genre (War & Politics → War)', rec.isRelatedToWatching(cand([10752, 36], ['watchingMood']), seedShow, profile, { mood: true }));
check('the plain rail accepts both sources', rec.isRelatedToWatching(cand([18], ['watching']), seedShow, profile) && rec.isRelatedToWatching(cand([18], ['watchingMood']), seedShow, profile));
check('mood titles still may not switch to animation', !rec.isRelatedToWatching(cand([10752, 16], ['watchingMood']), seedShow, profile, { mood: true }));

// ---------- Up Next ----------
const ymd = at => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const tvShow = (days, extra = {}) => ({ id: 77, name: 'Next Show', poster_path: '/p.jpg', next_episode_to_air: { air_date: ymd(NOW + days * DAY), season_number: 2, episode_number: 5, name: 'Five', ...extra } });
let item = upNext.upNextItem(tvShow(1), { now: NOW });
check('an episode tomorrow makes a card', item && item.key === 'tv_77' && item.season === 2 && !item.exact, JSON.stringify(item));
check('a date-only card counts calendar days', upNext.countdownText(item, NOW).text === 'Tomorrow' && !upNext.countdownText(item, NOW).live);
check('today and further days read plainly', upNext.countdownText(upNext.upNextItem(tvShow(0), { now: NOW }), NOW).text === 'Today' && upNext.countdownText(upNext.upNextItem(tvShow(5), { now: NOW }), NOW).text === 'In 5 days');
check('more than 30 days out is no card', upNext.upNextItem(tvShow(31), { now: NOW }) === null);
check('two days after the date it still reads "Out now"', upNext.countdownText(upNext.upNextItem(tvShow(-2), { now: NOW }), NOW).out === true);
check('four days after, the card is gone', upNext.upNextItem(tvShow(-4), { now: NOW }) === null);
check('episode one is a season premiere', upNext.kindLabel(upNext.upNextItem(tvShow(3, { episode_number: 1 }), { now: NOW })) === 'Season 2 premiere');
check('a finale says so', upNext.kindLabel(upNext.upNextItem(tvShow(3, { episode_type: 'finale' }), { now: NOW })) === 'Season finale');
check('no next episode, no card', upNext.upNextItem({ id: 1, name: 'X' }, { now: NOW }) === null && upNext.upNextItem(null) === null);
const stamp = new Date(NOW + DAY + 2 * HOUR + 3 * 60000 + 4000).toISOString();
item = upNext.upNextItem(tvShow(1), { now: NOW, airstamp: stamp });
check('an exact airstamp gives a live countdown', item.exact && upNext.countdownText(item, NOW).text === '1d 02:03:04' && upNext.countdownText(item, NOW).live);
check('under a day there is no day count', upNext.countdownText(item, NOW + DAY).text === '02:03:04');
check('at the moment it airs, it is out', upNext.countdownText(item, NOW + 2 * DAY).text === 'Out now');

const returning = (id, log, extra = {}) => ({ ...show(id, log), status: 'Returning Series', ...extra });
const full = Array.from({ length: 10 }, (_, i) => [1, i + 1, noon(20 - i), 0]);
state.episodeProgress = {
  tv_20: returning(20, full),
  tv_21: returning(21, full, { status: 'Ended' }),
  tv_22: returning(22, full.slice(0, 5)),
  tv_23: returning(23, full, { dropped: true }),
};
check('Up Next considers only caught-up, returning, tracked shows', upNext.upNextCandidates().map(entry => entry.tmdbId).join(',') === '20');

summary();
