// Your Year page, the monthly recap notification, moving lights and the
// animated illustrations.
import { check, summary } from './harness.mjs';

const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const recap = await import(SRC + 'monthly-recap.js');
const year = await import(SRC + 'your-year.js');
const films = await import(SRC + 'films-year.js');
const series = await import(SRC + 'series-year.js');
const stage = await import(SRC + 'stage.js');
const art = await import(SRC + 'illustrations.js');
const notificationPrefs = await import(SRC + 'notification-prefs.js');

state.user = { uid: 'u-year' };

const at = (y, m, d, h = 21) => new Date(y, m, d, h).getTime();
const watched = {
  movie_1: { title: 'Twice in August', poster: '/a.jpg', runtime: 100, genres: [18], playDates: [at(2026, 6, 1), at(2026, 7, 3), at(2026, 7, 20)] },
  movie_2: { title: 'Loved', poster: '/b.jpg', runtime: 90, genres: [18], watchedAt: { seconds: at(2026, 7, 10) / 1000 } },
  movie_3: { title: 'September', poster: '/c.jpg', runtime: 95, genres: [35], watchedAt: at(2026, 8, 1) },
  movie_4: { title: 'Adult', runtime: 80, genres: [18], watchedAt: at(2026, 7, 4) },
  movie_5: { title: 'Last Year', runtime: 120, genres: [18], watchedAt: at(2025, 11, 30) },
  tv_7: { title: 'A Show', watchedAt: at(2026, 7, 5) },
};
const ratings = { movie_2: 9, movie_1: 7 };
const exclude = key => key === 'movie_4' || key === 'tv_66';
const entry = minutes => ({ seasons: { 1: [1, 2] }, runtime: minutes });
const finished = [
  { id: 11, title: 'Finished in August', poster: '/s.jpg', finishedAt: at(2026, 7, 15), entry: entry(40) },
  { id: 12, title: 'Finished in July', poster: '/t.jpg', finishedAt: at(2026, 6, 2), entry: entry(30) },
  { id: 66, title: 'Adult Series', poster: '/x.jpg', finishedAt: at(2026, 7, 16), entry: entry(30) },
];

// ---------- monthly recap ----------
const first = at(2026, 8, 1, 9);
check('a recap on the 1st is about the month before', JSON.stringify(recap.recapMonth(first)) === '{"year":2026,"month":7,"name":"August"}');
check('January\'s recap is about December of the year before', recap.recapMonth(at(2027, 0, 5)).year === 2026 && recap.recapMonth(at(2027, 0, 5)).month === 11);
const august = recap.monthRecap({ watched, ratings, finished, exclude, now: first });
check('the month holds the films viewed in it, adult and TV entries left out', august.films.map(film => film.id).join(',') === '2,1', august.films.map(film => film.id).join(','));
check('only that month\'s viewings count, and their minutes', august.films.find(film => film.id === 1).plays === 2 && august.films.find(film => film.id === 1).minutes === 200 && august.minutes === 290 && august.plays === 3);
check('series finished that month are listed, adult series left out', august.series.map(show => show.id).join(',') === '11');
const event = recap.recapEvent(august, first);
check('the recap notification links to that month of the year page', event.key === 'recap_2026_08' && event.path === '/year/2026?month=8' && event.category === 'recap');
check('the recap says what the month was made of', event.headline === '2 films and 1 finished series' && event.detail.includes('4h 50m of films') && event.detail.includes('Top rated: Loved (9/10)') && event.detail.includes('Finished Finished in August'), `${event.headline} | ${event.detail}`);
check('the recap arrives dated the 1st and may alert only on the 1st', event.date === '2026-09-01' && event.alertable === true && recap.recapEvent(august, at(2026, 8, 2)).alertable === false);
check('the poster fan uses up to four posters', event.posters.join(',') === '/b.jpg,/a.jpg,/s.jpg');
check('an empty month sends no recap', recap.recapEvent(recap.monthRecap({ watched: {}, finished: [], now: first }), first) === null);
check('one film reads in the singular', recap.recapEvent(recap.monthRecap({ watched: { movie_2: watched.movie_2 }, now: first }), first).headline === '1 film');

state.notificationPreferences = { ...state.notificationPreferences, recaps: false };
check('recaps can be switched off in notification preferences', notificationPrefs.notificationAllowed(event) === false);
state.notificationPreferences = { ...state.notificationPreferences, recaps: true };
check('recaps are on by default', notificationPrefs.notificationAllowed(event) === true && notificationPrefs.NOTIFICATION_CATEGORIES.includes('recaps'));

// ---------- your year ----------
const shareable = finished.filter(show => !exclude(`tv_${show.id}`));
check('the year choices merge film and series years, newest first', year.yearChoices(watched, shareable, { exclude }).join(',') === '2026,2025');
check('no year in the address picks this year when it has anything', year.pickYear(0, [2026, 2025], new Date(2026, 3, 1)) === 2026);
check('a quiet current year falls back to the latest year with something', year.pickYear(0, [2025, 2023], new Date(2026, 3, 1)) === 2025);
check('an empty library still shows this year, and an address year is kept', year.pickYear(0, [], new Date(2026, 3, 1)) === 2026 && year.pickYear(2019, [2026]) === 2019);
const filmSummary = films.filmsYear(watched, 2026, { ratings, exclude });
const seriesSummary = series.seriesYear(shareable, 2026);
const total = year.combineYear(filmSummary, seriesSummary);
check('the combined total adds films and finished series', total.titles === 5 && total.films === 3 && total.series === 2, JSON.stringify(total));
check('combined months stack both cards\' months', total.byMonth[6] === 2 && total.byMonth[7] === 4 && total.byMonth[8] === 1 && total.filmMonths[7] === 3 && total.seriesMonths[7] === 1);
check('the busiest month is found across both', total.busiest.join() === '7' && total.busiestCount === 4);
check('hours are film viewings plus the finished runs', total.minutes === filmSummary.minutes + seriesSummary.minutes && total.viewings === filmSummary.plays);
const items = year.monthItems(watched, filmSummary, seriesSummary, 7);
check('a month lists its films with that month\'s viewings, and its finished series', items.films.map(item => `${item.id}:${item.plays}`).sort().join(',') === '1:2,2:1' && items.series.map(item => item.id).join(',') === '11');
check('a month with nothing lists nothing', year.monthItems(watched, filmSummary, seriesSummary, 0).films.length === 0 && year.monthItems(watched, filmSummary, seriesSummary, 0).series.length === 0);

// ---------- moving lights ----------
const centre = stage.tapTarget(500, 400, 1000, 800, 100);
check('a tap in the centre pulls nowhere', centre.x === 0 && centre.y === 0);
const corner = stage.tapTarget(1000, 0, 1000, 800, 100);
check('a tap pulls toward itself, capped', corner.x === 100 && corner.y === -100 && stage.tapTarget(600, 450, 1000, 800, 100).x > 0);
check('easing with no time passed stays put', stage.easeToward(10, 50, 0) === 10);
check('easing approaches the target without overshooting', stage.easeToward(0, 50, 900) > 30 && stage.easeToward(0, 50, 900) < 50 && stage.easeToward(0, 50, 1e6) > 49.99);
const twoSteps = stage.easeToward(stage.easeToward(0, 50, 8), 50, 8);
check('easing is frame-rate independent', Math.abs(twoSteps - stage.easeToward(0, 50, 16)) < 1e-9);

// ---------- illustrations ----------
const scenes = art.ILLUSTRATIONS.map(name => art.illustration(name));
check('every scene is an svg with its own class', art.ILLUSTRATIONS.length >= 6 && scenes.every((svg, i) => svg.startsWith('<svg class="cv-art cv-art-' + art.ILLUSTRATIONS[i]) && svg.endsWith('</svg>')));
const ids = scenes.join('').match(/ id="([^"]+)"/g) || [];
check('gradient ids never repeat, even for two copies of a scene', new Set(ids).size === ids.length && art.illustration('tv') !== art.illustration('tv'));
check('every url() points at an id in the same scene', scenes.every(svg => (svg.match(/url\(#([^)]+)\)/g) || []).every(ref => svg.includes(` id="${ref.slice(5, -1)}"`))));
check('scenes are decorative unless labelled, and labels are escaped', scenes.every(svg => svg.includes('aria-hidden="true"')) && art.illustration('year', { label: 'A "year" <b>' }).includes('role="img" aria-label="A &quot;year&quot; &lt;b&gt;"'));
check('an unknown scene falls back to the projector', art.illustration('nope').includes('cv-art-projector'));
check('the second set of scenes is there', ['ticket', 'search', 'friends', 'party', 'stats', 'bell', 'trophy', 'compass', 'unplugged'].every(name => art.ILLUSTRATIONS.includes(name)));
check('every scene keeps its drawing inside the 240×180 frame it declares', scenes.every(svg => svg.includes('viewBox="0 0 240 180"')));

// ---------- your year: comparisons, moments, genres ----------
const lastYear = { year: 2025, titles: 4, films: 2, series: 2, minutes: 600 };
const delta = year.yearDelta({ films: 5, series: 2, minutes: 480 }, lastYear);
check('each figure says how it compares with the year before', delta.films.label === '+3 vs 2025' && delta.films.dir === 'up' && delta.series.label === 'same as 2025' && delta.series.dir === 'same' && delta.minutes.label === '−2h vs 2025' && delta.minutes.dir === 'down', JSON.stringify(delta));
check('no comparison when the year before is empty', year.yearDelta({ films: 1, series: 0, minutes: 90 }, { year: 2025, titles: 0 }) === null && year.yearDelta({ films: 1 }, null) === null);
const moments = year.yearHighlights(watched, filmSummary, seriesSummary);
const byLabel = Object.fromEntries(moments.map(moment => [moment.label, moment]));
check('the first and latest watch of the year are found across films and series', byLabel['First of the year']?.title === 'Twice in August' && byLabel['Most recent']?.title === 'September', moments.map(m => `${m.label}:${m.title}`).join(' | '));
check('top rated and biggest run are moments too, linking to their titles', byLabel['Top rated']?.id === 2 && byLabel['Top rated'].kind === 'movie' && byLabel['Biggest run']?.kind === 'tv' && byLabel['Most rewatched']?.title === 'Twice in August');
check('an empty year has no moments', year.yearHighlights({}, films.filmsYear({}, 2019), series.seriesYear([], 2019)).length === 0);
const genres = year.topGenres(filmSummary);
check('genres are counted once per film, most first, with a share of the leader', genres[0].name === 'Drama' && genres[0].count === 2 && genres[0].share === 1 && genres[1].name === 'Comedy' && genres[1].share === 0.5, JSON.stringify(genres));

// ---------- watch diary: streaks, weekdays, month totals ----------
const diary = await import(SRC + 'diary.js');
const day = (m, d) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const diaryDays = new Map([
  [day(8, 30), { key: day(8, 30), items: 1, minutes: 50 }],
  [day(8, 31), { key: day(8, 31), items: 2, minutes: 100, tvMinutes: 100 }],
  [day(9, 1), { key: day(9, 1), items: 1, minutes: 120, filmMinutes: 120 }],
  [day(9, 3), { key: day(9, 3), items: 0, minutes: 0, marked: 5 }],
  [day(9, 4), { key: day(9, 4), items: 1, minutes: 40, tvMinutes: 40 }],
  [day(9, 5), { key: day(9, 5), items: 3, minutes: 150, tvMinutes: 150 }],
]);
check('the longest run crosses month ends', diary.longestRun([day(8, 30), day(8, 31), day(9, 1), day(9, 4)]) === 3 && diary.longestRun([]) === 0);
const streaks = diary.diaryStreaks(diaryDays, new Date(2026, 8, 6, 9).getTime(), '2026-09');
check('a streak still counts on a day with nothing yet, bulk marks never count', streaks.current === 2 && streaks.longest === 3 && streaks.month === 2, JSON.stringify(streaks));
check('a streak ends after a missed day', diary.diaryStreaks(diaryDays, new Date(2026, 8, 7, 9).getTime()).current === 0);
const week = diary.diaryWeekdays(diaryDays, '2026-09');
check('minutes fall on their weekday, Monday first', week[1].minutes === 120 && week[4].minutes === 40 && week[5].minutes === 150 && week[3].minutes === 0 && week.length === 7, JSON.stringify(week.map(slot => slot.minutes)));
const totals = diary.monthTotals(diaryDays, '2026-09');
check('a month totals its viewing and finds its biggest day', totals.minutes === 310 && totals.items === 5 && totals.active === 3 && totals.film === 120 && totals.tv === 190 && totals.busiest.key === day(9, 5));

summary();
