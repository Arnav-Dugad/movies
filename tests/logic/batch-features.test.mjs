// Binge forecast, the Watch Diary, detail-page parts, the new preferences, the
// "because you're watching" rail and title-logo tone.
import { check, summary } from './harness.mjs';

const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const ep = await import(SRC + 'episodes.js');
const diary = await import(SRC + 'diary.js');
const parts = await import(SRC + 'detail-parts.js');
const prefsModule = await import(SRC + 'prefs.js');
const rec = await import(SRC + 'recommend.js');
const tone = await import(SRC + 'logo-tone.js');

const DAY = 86400000;
const noon = offset => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime() - offset * DAY; };
const NOW = noon(0) + 3600000;

// ---------- binge forecast ----------
// A 10-episode season, 4 watched one by one over the last 8 days.
const show = (log, extra = {}) => ({
  tmdbId: 7, title: 'Pace Show', episodeRuntime: 40, structure: { '1': 10 }, aired: { season: 1, episode: 10 },
  seasons: { '1': log.map(row => row[1]) }, log, lastWatched: { season: 1, episode: log.at(-1)?.[1] || 0, at: log.at(-1)?.[2] || 0 },
  ...extra,
});
state.user = { uid: 'u1' };
state.watched = {};
state.episodeProgress = { tv_7: show([[1, 1, noon(8), 0], [1, 2, noon(6), 0], [1, 3, noon(3), 0], [1, 4, noon(1), 0]]) };
const forecast = ep.bingeForecast(7, { now: NOW });
check('a steady viewer gets a forecast', !!forecast, JSON.stringify(forecast));
check('the forecast counts what is left', forecast?.remaining === 6);
check('pace is episodes per day over the span watched', forecast && Math.abs(forecast.pace - 0.5) < 0.06, String(forecast?.pace));
check('days to finish follow from the pace', forecast?.days === Math.ceil(6 / (4 / ((NOW - noon(8)) / DAY))), String(forecast?.days));
check('the finish date is that many days out', forecast && forecast.finishAt === NOW + forecast.days * DAY);
check('the sentence names pace, remainder and a date', /pace of 3 episodes a week, you'll finish the 6 left in \d+ days — around /.test(ep.forecastSentence(forecast)), ep.forecastSentence(forecast));
check('the short form reads as a date', /^Done ~/.test(ep.forecastSentence(forecast, { short: true })));

state.episodeProgress = { tv_7: show([[1, 1, noon(3), 1], [1, 2, noon(3), 1], [1, 3, noon(3), 1], [1, 4, noon(3), 1], [1, 5, noon(3), 1]]) };
check('a lone catch-up batch gives no pace, so no forecast', ep.bingeForecast(7, { now: NOW }) === null);
state.episodeProgress = { tv_7: show([[1, 1, noon(90), 0], [1, 2, noon(80), 0]]) };
check('a show untouched for two months gets no forecast', ep.bingeForecast(7, { now: NOW }) === null);
state.episodeProgress = { tv_7: show([[1, 1, noon(4), 0], [1, 2, noon(2), 0]], { dropped: true }) };
check('a dropped show gets no forecast', ep.bingeForecast(7, { now: NOW }) === null);
state.episodeProgress = { tv_7: show(Array.from({ length: 10 }, (_, i) => [1, i + 1, noon(10 - i), 0])) };
check('a caught-up show gets no forecast', ep.bingeForecast(7, { now: NOW }) === null);
check('no forecast, no sentence', ep.forecastSentence(null) === '');

// ---------- watch diary ----------
const events = diary.diaryEvents({
  watched: {
    movie_1: { tmdbId: 1, type: 'movie', title: 'Film', runtime: 120, playDates: [noon(2), noon(1)] },
    movie_2: { tmdbId: 2, type: 'movie', title: 'Old', runtime: 90, watchedAt: { seconds: Math.floor(noon(1) / 1000) } },
    tv_9: { tmdbId: 9, type: 'tv', title: 'Marked series', watchedAt: { seconds: Math.floor(noon(1) / 1000) } },
    tv_7: { tmdbId: 7, type: 'tv', title: 'Logged series', watchedAt: { seconds: Math.floor(noon(1) / 1000) } },
  },
  // Yesterday: a catch-up of five swept in at once, plus one episode ticked on its own.
  episodeProgress: { tv_7: show([[1, 1, noon(1), 1], [1, 2, noon(1), 1], [1, 3, noon(1), 1], [1, 4, noon(1), 1], [1, 5, noon(1), 1], [1, 6, noon(1), 0]]) },
});
check('every play of a film is its own event', events.filter(e => e.key === 'movie_1').length === 2);
check('a second play is flagged as a rewatch', events.filter(e => e.key === 'movie_1')[1].rewatch === true);
check('legacy watchedAt timestamps are read', events.some(e => e.key === 'movie_2'));
check('a series marked watched without a log is a bulk mark', events.find(e => e.key === 'tv_9')?.bulk === true);
check('a series with an episode log is not double counted', !events.some(e => e.kind === 'series' && e.key === 'tv_7'));
check('bulk episode rows carry no minutes', events.find(e => e.kind === 'episode' && e.bulk)?.minutes === 0);
check('events are sorted oldest first', events.every((e, i) => !i || e.at >= events[i - 1].at));

const days = diary.diaryDays(events);
const yesterday = days.get(diary.dayKey(noon(1)));
check('a day totals only real viewing minutes', yesterday.minutes === 120 + 90 + 40, String(yesterday.minutes));
check('a day counts films and episodes apart', yesterday.films === 2 && yesterday.episodes === 1);
check('bulk marks are counted separately', yesterday.marked === 6 && yesterday.items === 3, `marked=${yesterday.marked} items=${yesterday.items}`);
const months = diary.diaryMonths(days, { months: 12, now: NOW });
check('the year strip has twelve gapless months ending now', months.length === 12 && months.at(-1).key === diary.monthKey(NOW));
check('month totals add up the days', months.reduce((sum, m) => sum + m.minutes, 0) === [...days.values()].reduce((sum, d) => sum + d.minutes, 0));
check('shade steps run 0 to 4', diary.shadeStep(0, 100) === 0 && diary.shadeStep(10, 100) === 1 && diary.shadeStep(60, 100) === 3 && diary.shadeStep(100, 100) === 4);
check('minutes format as hours and minutes', diary.formatMinutes(321) === '5h 21m' && diary.formatMinutes(60) === '1h' && diary.formatMinutes(0) === '0m');

// ---------- detail parts ----------
check('every part key is unique', parts.DETAIL_PART_KEYS.size === parts.DETAIL_PART_GROUPS.flatMap(g => g.parts).length);
check('stored choices are cleaned to known keys, once, in order', JSON.stringify(parts.cleanDetailHidden(['votes', 'nope', 'cast', 'votes'])) === JSON.stringify(['votes', 'cast'].sort((a, b) => [...parts.DETAIL_PART_KEYS].indexOf(a) - [...parts.DETAIL_PART_KEYS].indexOf(b))));
check('garbage is an empty list', parts.cleanDetailHidden('cast').length === 0 && parts.cleanDetailHidden(null).length === 0);
check('nothing hidden, no stylesheet', parts.detailHiddenCSS([]) === '');
check('hidden parts become one scoped rule', parts.detailHiddenCSS(['cast']) === '#detailContent [data-dp="cast"] { display: none !important; }');

// ---------- the order of a title page ----------
check('every block is named once', parts.DETAIL_BLOCK_KEYS.length === new Set(parts.DETAIL_BLOCK_KEYS).size
  && parts.DETAIL_BLOCKS.every(([key, label]) => key && label));
check('no stored order is the shipped one', parts.isDefaultOrder([]) && parts.isDefaultOrder(null)
  && JSON.stringify(parts.cleanDetailOrder([])) === JSON.stringify(parts.DETAIL_BLOCK_KEYS));
check('a stored order keeps what it names and appends the rest', (() => {
  const order = parts.cleanDetailOrder(['cast', 'nonsense', 'cast', 'overview']);
  return order[0] === 'cast' && order[1] === 'overview'
    && order.length === parts.DETAIL_BLOCK_KEYS.length
    && new Set(order).size === order.length;
})());
check('a block a stored order never heard of still appears', parts.cleanDetailOrder(['cast']).includes('reviews'));
check('moving a block down swaps it with the one below', (() => {
  const moved = parts.moveDetailBlock([], 'overview', 1);
  const shipped = parts.DETAIL_BLOCK_KEYS;
  return moved[0] === shipped[0] && moved[1] === shipped[2] && moved[2] === 'overview';
})());
check('a move off either end is no move', (() => {
  const first = parts.DETAIL_BLOCK_KEYS[0], last = parts.DETAIL_BLOCK_KEYS.at(-1);
  return parts.moveDetailBlock([], first, -1).join() === parts.DETAIL_BLOCK_KEYS.join()
    && parts.moveDetailBlock([], last, 1).join() === parts.DETAIL_BLOCK_KEYS.join()
    && parts.moveDetailBlock([], 'cast', 0).join() === parts.DETAIL_BLOCK_KEYS.join();
})());
check('a block dropped on another takes its place', (() => {
  const dropped = parts.dropDetailBlock([], 'moreLikeThis', 'overview');
  return dropped.indexOf('moreLikeThis') === dropped.indexOf('overview') - 1 && dropped.length === parts.DETAIL_BLOCK_KEYS.length;
})());
check('a block dropped on nothing goes last', parts.dropDetailBlock([], 'overview', null).at(-1) === 'overview');
check('every block is a real part of the page', parts.DETAIL_BLOCK_KEYS.every(key => key === 'facts' || parts.DETAIL_PART_KEYS.has(key)));
check('every block has a name for a settings row', parts.DETAIL_BLOCK_KEYS.every(key => parts.blockLabel(key).length > 3));

// ---------- preferences ----------
check('defaults: dark theme, captions shown, nothing hidden', prefsModule.DEFAULT_PREFS.theme === 'dark' && prefsModule.DEFAULT_PREFS.hidePosterCaptions === false && prefsModule.DEFAULT_PREFS.detailHidden.length === 0);
localStorage.setItem('cv_experience_v2', JSON.stringify({ theme: 'light', hidePosterCaptions: true, detailHidden: ['cast', 'bogus'], _updatedAt: 5 }));
prefsModule.loadPrefs();
check('a stored light theme loads', prefsModule.prefs.theme === 'light');
check('caption hiding loads and reaches the root', prefsModule.prefs.hidePosterCaptions === true && document.documentElement.dataset.posterCaptions === 'hide');
check('stored detail parts are cleaned on load', JSON.stringify(prefsModule.prefs.detailHidden) === '["cast"]');
check('a page order is a stored preference, empty until it is changed', prefsModule.DEFAULT_PREFS.detailOrder.length === 0);
check('an order that matches the shipped one is stored as no order at all', (() => {
  localStorage.setItem('cv_experience_v2', JSON.stringify({ detailOrder: parts.DETAIL_BLOCK_KEYS, _updatedAt: 6 }));
  prefsModule.loadPrefs();
  const shippedIsNone = prefsModule.prefs.detailOrder.length === 0;
  localStorage.setItem('cv_experience_v2', JSON.stringify({ detailOrder: ['cast', 'bogus'], _updatedAt: 7 }));
  prefsModule.loadPrefs();
  const kept = prefsModule.prefs.detailOrder[0] === 'cast' && !prefsModule.prefs.detailOrder.includes('bogus');
  // Leave the store as the checks above it found it.
  localStorage.setItem('cv_experience_v2', JSON.stringify({ theme: 'light', hidePosterCaptions: true, detailHidden: ['cast', 'bogus'], _updatedAt: 8 }));
  prefsModule.loadPrefs();
  return shippedIsNone && kept;
})());
localStorage.setItem('cv_experience_v2', JSON.stringify({ theme: 'neon', hidePosterCaptions: 'yes', _updatedAt: 6 }));
prefsModule.loadPrefs();
check('an unknown theme falls back to dark', prefsModule.prefs.theme === 'dark');
check('a non-boolean caption flag is ignored', prefsModule.prefs.hidePosterCaptions === false);
check('system is an accepted theme', (localStorage.setItem('cv_experience_v2', JSON.stringify({ theme: 'system' })), prefsModule.loadPrefs(), prefsModule.prefs.theme === 'system'));

// ---------- because you're watching ----------
const seed = { type: 'tv', id: 95396 };
const profile = { watchingGenres: { tv_95396: [18, 9648, 10765] } };
const candidate = (genres, extra = {}) => ({ genre_ids: genres, __sources: ['watching'], __seedKeys: ['tv_95396'], ...extra });
check('a same-genre title from the show seed is related', rec.isRelatedToWatching(candidate([18, 9648]), seed, profile));
check('a title from another seed is not', !rec.isRelatedToWatching(candidate([18], { __seedKeys: ['tv_1'] }), seed, profile));
check('a title not sourced from what you watch is not', !rec.isRelatedToWatching(candidate([18], { __sources: ['rec'] }), seed, profile));
check('a sudden switch to animation is not related', !rec.isRelatedToWatching(candidate([18, 16]), seed, profile));
check('no genre overlap is not related', !rec.isRelatedToWatching(candidate([35]), seed, profile));
check('with unknown seed genres the seed link alone is enough', rec.isRelatedToWatching(candidate([35]), seed, {}));

// ---------- title-logo tone ----------
const pixels = (rgba, count = 100) => Uint8ClampedArray.from({ length: count * 4 }, (_, i) => rgba[i % 4]);
const mix = (...parts) => { const out = []; parts.forEach(([rgba, n]) => { for (let i = 0; i < n; i++) out.push(...rgba); }); return Uint8ClampedArray.from(out); };
check('white lettering reads as light', tone.toneOfPixels(pixels([250, 250, 250, 255])) === 'light');
check('black lettering reads as dark', tone.toneOfPixels(pixels([10, 10, 12, 255])) === 'dark');
check('a saturated logo reads as colour', tone.toneOfPixels(pixels([220, 30, 40, 255])) === 'color');
check('white type beside a colourful mark reads as mixed', tone.toneOfPixels(mix([[255, 255, 255, 255], 20], [[60, 150, 230, 255], 80])) === 'mixed');
check('transparent pixels are ignored', tone.toneOfPixels(mix([[0, 0, 0, 0], 500], [[250, 250, 250, 255], 40])) === 'light');
check('too few opaque pixels gives no verdict', tone.toneOfPixels(pixels([255, 255, 255, 255], 5)) === '');

summary();
