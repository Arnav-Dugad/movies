// Cinema glass, the year-in-films card, shared year-card pieces, scroll hints,
// and removing people from Hours clubs.
import { check, summary } from './harness.mjs';

const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const glass = await import(SRC + 'glass.js');
const films = await import(SRC + 'films-year.js');
const card = await import(SRC + 'year-card.js');
const hints = await import(SRC + 'scroll-hints.js');
const cast = await import(SRC + 'cast-hours.js');
const prefs = await import(SRC + 'prefs.js');

state.user = { uid: 'u-glass' };

// ---------- glass: colours ----------
check('hex and rgb colours parse, with alpha', JSON.stringify(glass.parseColor('#14141f')) === '[20,20,31,1]' && JSON.stringify(glass.parseColor('rgba(20, 20, 31, .94)')) === '[20,20,31,0.94]' && JSON.stringify(glass.parseColor('rgb(20 20 31 / 50%)')) === '[20,20,31,0.5]');
check('junk is not a colour', glass.parseColor('var(--bg)') === null && glass.parseColor('#12') === null);
check('a near-opaque dark neutral is a surface', glass.isSurface([20, 20, 31, 0.94]) && glass.isSurface([11, 12, 18, 1]));
check('paper is a surface too', glass.isSurface([250, 248, 242, 1]));
check('accents, tints and mid greys are not surfaces', !glass.isSurface([229, 9, 20, 1]) && !glass.isSurface([20, 20, 31, 0.5]) && !glass.isSurface([120, 120, 120, 1]) && !glass.isSurface([251, 191, 36, 1]));
const value = 'radial-gradient(circle at 90% 0, rgba(139, 92, 246, 0.1), transparent 26%), linear-gradient(145deg, rgb(24, 24, 34), rgba(12, 12, 19, 0.96))';
const glassed = glass.glassValue(value, 0.5);
check('only surface colours turn translucent; accents are kept exactly', glassed === 'radial-gradient(circle at 90% 0, rgba(139, 92, 246, 0.1), transparent 26%), linear-gradient(145deg, rgba(24, 24, 34, 0.5), rgba(12, 12, 19, 0.5))', glassed);
check('a value with no surface needs no glass', glass.glassValue('rgba(255, 255, 255, 0.03)', 0.5) === null);
check('glass never makes a colour more opaque', glass.glassValue('rgba(20, 20, 31, 0.8)', 0.9) === 'rgba(20, 20, 31, 0.8)');

// ---------- glass: selectors ----------
check('selector lists split at top-level commas only', JSON.stringify(glass.selectorParts('.a, :is(.b, .c) .d,.e')) === '[".a",":is(.b, .c) .d",".e"]');
check('the subject is the last compound', glass.subjectOf('#statsContent .stats-panel.tv-tracker') === '.stats-panel.tv-tracker' && glass.subjectOf('.x > :is(.a .b)') === ':is(.a .b)');
check('a panel is glassed as the subject, not as an ancestor', glass.panelSelector('.stats-panel') === '.stats-panel' && glass.panelSelector('.stats-panel .stats-row') === '' && glass.panelSelector('.stats-panel-head') === '');
check('pseudo-elements of panels are left alone', glass.panelSelector('.profile-panel::before') === '');
check('mixed lists keep only their panel parts', glass.panelSelector('.card, .settings-panel, .row') === '.settings-panel');
check('a shorthand colour-only layer is written back as none', glass.writableValue('background-image', 'radial-gradient(red, blue), initial') === 'radial-gradient(red, blue), none' && glass.writableValue('background-color', 'initial') === 'initial');

// glassDeclarations against a CSSOM-shaped declaration reader
const reader = map => prop => ({ value: map[prop] || '', priority: map[`!${prop}`] ? 'important' : '' });
const panelWrites = glass.glassDeclarations(reader({ 'background-image': 'linear-gradient(145deg, rgb(20, 20, 31), rgb(12, 12, 20))', 'background-size': 'cover', 'box-shadow': '0 10px 30px rgba(0, 0, 0, 0.3)' }), 'panel', 0.4);
const byProp = writes => Object.fromEntries((writes || []).map(write => [write.prop, write.value]));
const panel = byProp(panelWrites);
check('a panel surface turns translucent under a sheen layer', panel['background-image'] === `${glass.SHEEN_LAYER}, linear-gradient(145deg, rgba(20, 20, 31, 0.4), rgba(12, 12, 20, 0.4))`, panel['background-image']);
check("the panel's own layer sizes keep lining up behind the sheen", panel['background-size'] === 'auto, cover');
check('a panel with a shadow gains the lit top edge', panel['box-shadow'] === `0 10px 30px rgba(0, 0, 0, 0.3), ${glass.EDGE}`);
const colourOnly = byProp(glass.glassDeclarations(reader({ 'background-color': 'rgb(14, 14, 20)' }), 'panel', 0.4));
check("a colour-only rule gets no sheen, so it never hides another rule's image", colourOnly['background-color'] === 'rgba(14, 14, 20, 0.4)' && !('background-image' in colourOnly) && !('box-shadow' in colourOnly));
check('a rule with no surface needs nothing', glass.glassDeclarations(reader({ 'background-color': 'rgba(229, 9, 20, 0.2)' }), 'panel', 0.4) === null && glass.glassDeclarations(reader({ color: 'red' }), 'panel', 0.4) === null);
const overlay = glass.glassDeclarations(reader({ 'background-color': 'var(--bg2)', '!background-color': true }), 'overlay', 0.74, { '--bg2': '#0c0c14' });
check('dialogs resolve theme tokens, keep !important and are frosted', overlay[0].value === 'rgba(12, 12, 20, 0.74)' && overlay[0].priority === 'important' && overlay.some(write => write.prop === 'backdrop-filter' && write.value.includes('blur')), JSON.stringify(overlay));
check('token chains resolve and unknown variables stay', glass.resolveTokens('var(--a) var(--zz)', { '--a': 'var(--b)', '--b': '#fff' }) === '#fff var(--zz)');
check('panels and dialogs are told apart by their subject', glass.glassKind('.profile-dd') === 'overlay' && glass.glassKind('#x .year-total') === 'panel' && glass.glassKind('.year-total .row') === '' && glass.glassKind('.year-side::after') === '');
check('the sheen travels as a panel scrolls up the screen, clamped at the edges', glass.sheenAt(1000, 800) < glass.sheenAt(400, 800) && glass.sheenAt(400, 800) < glass.sheenAt(0, 800) && glass.sheenAt(-9999, 800) === glass.sheenAt(-200, 800) && glass.sheenAt(9999, 800) === glass.sheenAt(1000, 800));

// ---------- year cards ----------
check('the busiest month glows, and ties all glow', JSON.stringify(card.busiestMonths([0, 2, 0, 5, 5, 1, 0, 0, 0, 0, 0, 0])) === '[3,4]');
check('an empty year has no busiest month', card.busiestMonths(Array(12).fill(0)).length === 0);
const plan = card.cardTimeline(20);
check('the wall never plans more than twelve posters', plan.months.start === plan.wall.start + 12 * plan.wall.step + 260);

const DAY = 86400000;
const at = (m, d) => new Date(2026, m, d, 21).getTime();
const watched = {
  movie_1: { title: 'Rewatched', poster: '/r.jpg', runtime: 120, genres: [18, 53], director: 'Ana', playDates: [new Date(2025, 5, 1).getTime(), at(1, 2), at(8, 3)] },
  movie_2: { title: 'Loved', poster: '/l.jpg', runtime: 90, genres: [18], director: 'Ana', watchedAt: { seconds: at(8, 10) / 1000 } },
  movie_3: { title: 'No Runtime', poster: '', genres: [35], watchedAt: at(8, 12) },
  movie_4: { title: 'Last Year', runtime: 100, genres: [18], watchedAt: { seconds: new Date(2025, 11, 30).getTime() / 1000 } },
  movie_5: { title: 'Adult', runtime: 80, genres: [18], watchedAt: at(3, 3) },
  tv_9: { title: 'A Show', runtime: 900, watchedAt: at(8, 1) },
};
const ratings = { movie_1: 8, movie_2: 10 };
const y = films.filmsYear(watched, 2026, { ratings, exclude: key => key === 'movie_5' });
check('a year holds the films viewed in it, films only, adult titles left out', y.films.map(film => film.id).join(',') === '1,2,3', y.films.map(film => film.id).join(','));
check('each viewing counts in its own year', y.films[0].plays === 2 && films.filmsYear(watched, 2025).films.map(film => film.id).sort().join(',') === '1,4');
check('hours are runtime times viewings, and missing runtimes are flagged', y.minutes === 120 * 2 + 90 && !y.allRuntimes);
check('viewings are counted by month', y.byMonth[1] === 1 && y.byMonth[8] === 3 && y.plays === 4);
check('top rated, rewatched, genre and director are found', y.topRated?.title === 'Loved' && y.rewatched?.title === 'Rewatched' && y.genre?.name === 'Drama' && y.genre.count === 2 && y.director?.name === 'Ana');
check('the wall puts your highest rated first', y.wall.map(film => film.id).join(',') === '2,1,3');
const tiles = films.filmTiles(y);
check('tiles say when hours come only from known runtimes', tiles[0][0] === 'Watch time' && tiles[0][2] === 'from known runtimes' && tiles.length === 4, JSON.stringify(tiles));
check('the film years are listed newest first', films.filmYears(watched).join(',') === '2026,2025');
check('an entry with no dates still counts on the day it was marked', films.viewingDates({ watchedAt: 1234 }).join() === '1234' && films.viewingDates({}).length === 0);

// ---------- scroll hints ----------
check('a row that fits has no fade', hints.fadeState(0, 400, 402) === '');
check('at the start the far edge fades', hints.fadeState(0, 400, 1200) === 'start');
check('in the middle both edges fade', hints.fadeState(300, 400, 1200) === 'middle');
check('at the end the near edge fades', hints.fadeState(799, 400, 1200) === 'end');
check('right-to-left positions count by distance', hints.fadeState(-799, 400, 1200) === 'end');

// ---------- removing people from Hours clubs ----------
const H = 60;
const people = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, name: `Person ${i + 1}`, minutes: (100 - i) * H }));
const shown = cast.clubBadges(people, 12);
const removed = cast.clubBadges(people, 12, { hidden: [1, 5] });
check('twelve badges show before anyone is removed', shown.length === 12 && shown.at(-1).id === 12);
check('a removed person leaves and the next people move up', removed.length === 12 && !removed.some(badge => [1, 5].includes(badge.id)) && removed.at(-1).id === 14, removed.map(badge => badge.id).join(','));
check('removing someone never reorders the rest', removed.map(badge => badge.id).join(',') === '2,3,4,6,7,8,9,10,11,12,13,14');
check('stored ids are cleaned: whole, positive, unique, capped', JSON.stringify(prefs.cleanPersonIds([3, '4', 3, -1, 2.5, 'x', 0, 7])) === '[3,4,7]' && prefs.cleanPersonIds('nope').length === 0 && prefs.cleanPersonIds(Array.from({ length: 400 }, (_, i) => i + 1)).length === 300);
check('the preference keeps removed people through a save', JSON.stringify(prefs.updatePref('hiddenClubs', [9, 9, 4]).hiddenClubs) === '[9,4]');
prefs.updatePref('hiddenClubs', []);

summary();
