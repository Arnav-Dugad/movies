// The year-in-series card, the Completed series shelf's flip figures, odometer
// club numbers and first-sight badges.
import { check, summary } from './harness.mjs';

const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const year = await import(SRC + 'series-year.js');
const cast = await import(SRC + 'cast-hours.js');
const profile = await import(SRC + 'profile.js');

state.user = { uid: 'u-year' };
state.watched = {};
const DAY = 86400000;
const at = (y, m, d) => new Date(y, m, d, 21).getTime();
const run = (start, days, episodes, { bulk = false, runtime = 50 } = {}) => ({
  tmdbId: 1, title: 'x', episodeRuntime: runtime, structure: { 1: episodes }, aired: { season: 1, episode: episodes },
  seasons: { 1: Array.from({ length: episodes }, (_, i) => i + 1) },
  log: Array.from({ length: episodes }, (_, i) => [1, i + 1, bulk ? start : start + Math.round((i / Math.max(1, episodes - 1)) * (days - 1)) * DAY, bulk ? 1 : 0]),
});
const rows = [
  { id: 1, title: 'Quick One', poster: '/q.jpg', finishedAt: at(2026, 2, 10), entry: run(at(2026, 2, 8), 3, 6) },
  { id: 2, title: 'Long Haul', poster: '/l.jpg', finishedAt: at(2026, 6, 20), entry: run(at(2026, 0, 1), 200, 60, { runtime: 45 }) },
  { id: 3, title: 'Marked', poster: '', finishedAt: at(2026, 6, 2), entry: run(at(2026, 6, 2), 1, 10, { bulk: true }) },
  { id: 4, title: 'Last Year', poster: '/y.jpg', finishedAt: at(2025, 11, 30), entry: run(at(2025, 11, 20), 10, 8) },
];

// ---------- year summary ----------
const y26 = year.seriesYear(rows, 2026);
check('a year holds the series finished in it, in finishing order', y26.shows.map(show => show.id).join(',') === '1,3,2', y26.shows.map(show => show.id).join(','));
check('episodes and time add up across those runs', y26.episodes === 76 && y26.minutes === 6 * 50 + 60 * 45 + 10 * 50, `${y26.episodes} ${y26.minutes}`);
check('the fastest finish is the shortest watched run', y26.fastest?.id === 1 && y26.fastest.spanDays === 3, JSON.stringify(y26.fastest));
check('a run marked in one press can never be the fastest', !y26.shows.find(show => show.id === 3).paced);
check('the biggest run has the most episodes', y26.biggest?.id === 2);
check('finishes are counted by month', y26.byMonth[2] === 1 && y26.byMonth[6] === 2 && y26.byMonth.reduce((a, b) => a + b, 0) === 3);
check('another year is its own', year.seriesYear(rows, 2025).count === 1 && year.seriesYear(rows, 2024).count === 0);
check('the years with finishes are listed newest first', year.finishYears(rows).join(',') === '2026,2025');
const plan = year.yearTimeline(y26);
check('the headline comes first, then tiles, posters and months in order', plan.headline[0] < plan.tiles.start && plan.tiles.start + 3 * plan.tiles.step < plan.wall.start && plan.wall.start + (y26.count - 1) * plan.wall.step < plan.months.start);
check('the build-up ends when the last month lands, in under five seconds', plan.end === plan.months.start + 11 * plan.months.step + plan.months.dur && plan.end < 5000, String(plan.end));

// ---------- shelf flip figures ----------
const figures = profile.shelfFigures(rows[0].entry);
check('a shelf card shows seasons, episodes, days and watch time', figures[0].join('=') === 'Seasons=1' && figures[1].join('=') === 'Episodes=6' && figures.some(([label, value]) => label === 'Days' && value === '3') && figures.some(([label, value]) => label === 'Watch time' && value === '5h'), JSON.stringify(figures));
check('a marked run shows no days', !profile.shelfFigures(rows[2].entry).some(([label]) => label === 'Days'));
check('at most five figures', profile.shelfFigures(run(at(2026, 0, 1), 20, 30)).length <= 5);

// ---------- odometer and first sight ----------
const odo = cast.odometerHTML(250);
check('each digit is its own rolling column', (odo.match(/class="odo-col"/g) || []).length === 3);
check('each column stops on its digit in the second turn', /--d:12;--k:0/.test(odo) && /--d:15;--k:1/.test(odo) && /--d:10;--k:2/.test(odo));
check('a column holds two full turns of digits', (odo.match(/<i>/g) || []).length === 60);
const arriving = cast.clubGaugeHTML({ club: 100 }, { delay: 90 });
const resting = cast.clubGaugeHTML({ club: 100 }, { animate: false });
check('a new badge fills and rolls; a known one rests', /club-arrive/.test(arriving) && /class="odo"/.test(arriving) && /club-static/.test(resting) && !/odo/.test(resting) && />100h</.test(resting));
const badges = [{ id: 1, club: 10 }, { id: 2, club: 25 }];
check('badges are new the first time', cast.takeNewBadges(badges).size === 2);
check('and known after that', cast.takeNewBadges(badges).size === 0);
check('reaching a higher club makes that badge new again', [...cast.takeNewBadges([{ id: 1, club: 25 }, { id: 2, club: 25 }])].join(',') === '1:25');

summary();
