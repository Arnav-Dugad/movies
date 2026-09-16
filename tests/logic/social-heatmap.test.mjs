// Hours clubs, person-to-person links, the season heatmap's standouts, insights
// and watch order, the finale card's build-up timeline, and the Completed series
// shelf.
import { check, summary } from './harness.mjs';

const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const cast = await import(SRC + 'cast-hours.js');
const links = await import(SRC + 'collaborations.js');
const heatmap = await import(SRC + 'season-heatmap.js');
const finale = await import(SRC + 'series-finale.js');
const profile = await import(SRC + 'profile.js');

state.user = { uid: 'u1' };
state.watched = {};
const H = 60;

// ---------- hours clubs ----------
check('below ten hours there is no club', cast.clubFor(9 * H + 59) === 0);
check('clubs are reached at their exact hour', cast.clubFor(10 * H) === 10 && cast.clubFor(100 * H) === 100 && cast.clubFor(249 * H) === 100);
check('the top club holds', cast.clubFor(5000 * H) === 1000);
const badges = cast.clubBadges([
  { id: 1, name: 'Adam Scott', profile: '/a.jpg', minutes: 130 * H },
  { id: 2, name: 'Britt Lower', minutes: 9 * H },
  { id: 3, name: 'Zach Cherry', minutes: 30 * H },
  { id: 4, name: '', minutes: 400 * H },
  { id: 5, name: 'John Turturro', minutes: 1200 * H },
]);
check('only named people in a club get a badge, most time first', badges.map(badge => badge.id).join(',') === '5,1,3', badges.map(badge => badge.id).join(','));
check('a badge knows its club, the next one and how far along it is', badges[1].club === 100 && badges[1].next === 250 && Math.abs(badges[1].progress - 0.2) < 1e-9 && badges[1].hours === 130, JSON.stringify(badges[1]));
check('the top club has nowhere further to go', badges[0].club === 1000 && badges[0].next === 0 && badges[0].progress === 1);
check('the limit caps the badges', cast.clubBadges(badges.map((badge, i) => ({ ...badge, minutes: (20 + i) * H })), 2).length === 2);
const gauge = cast.clubGaugeHTML({ club: 100, profile: '/a.jpg' }, { delay: 240 });
check('the gauge carries its club colour, delay, ring and number', /club-gauge club-100/.test(gauge) && /--delay:240ms/.test(gauge) && /pathLength="1"/.test(gauge) && />100h</.test(gauge));

// ---------- person-to-person links ----------
const nolan = { id: 525, name: 'Christopher Nolan' }, murphy = { id: 2037, name: 'Cillian Murphy' }, caine = { id: 3895, name: 'Michael Caine' }, hardy = { id: 2524, name: 'Tom Hardy' };
const film = (id, year, directors, cast, extra = {}) => ({ id, title: `Film ${id}`, poster: `/p${id}.jpg`, year, directors, cast, ...extra });
const films = [
  film(1, 2005, [nolan], [{ ...murphy, order: 3 }, { ...caine, order: 2 }]),
  film(2, 2010, [nolan], [{ ...murphy, order: 4 }, { ...hardy, order: 5 }, { ...caine, order: 6 }]),
  film(3, 2017, [nolan], [{ ...murphy, order: 6 }, { ...hardy, order: 1 }]),
  film(4, 2023, [nolan], [{ ...murphy, order: 0 }]),
  film(5, 2014, [{ id: 9, name: 'Someone Else' }], [{ ...murphy, order: 20 }, { ...hardy, order: 1 }]),
];
const murphyLinks = links.collaborationLinks(murphy.id, films);
check("an actor's director leads, with every film they share", murphyLinks[0].relation === 'directed-them' && murphyLinks[0].other.id === 525 && murphyLinks[0].count === 4, JSON.stringify(murphyLinks[0]));
check('the sentence reads naturally', links.linkSentence(murphyLinks[0], 'Cillian Murphy') === "You've seen 4 films where Christopher Nolan directed Cillian Murphy", links.linkSentence(murphyLinks[0], 'Cillian Murphy'));
check('films are newest first', murphyLinks[0].films.map(item => item.id).join(',') === '4,3,2,1');
const hardyLink = murphyLinks.find(link => link.other.id === hardy.id);
check('co-stars count only films where both are top-billed', hardyLink?.relation === 'co-star' && hardyLink.count === 2, JSON.stringify(hardyLink));
check('a co-star sentence names both', links.linkSentence(hardyLink, 'Cillian Murphy') === "You've seen 2 films with Cillian Murphy and Tom Hardy together");
check('a single shared film is not a link', !murphyLinks.some(link => link.other.id === 9));
const nolanLinks = links.collaborationLinks(nolan.id, films);
check("a director's actors are counted from films they directed", nolanLinks[0].relation === 'they-directed' && nolanLinks[0].other.id === murphy.id && nolanLinks[0].count === 4, JSON.stringify(nolanLinks.map(link => [link.other.name, link.count])));
check('the director sentence puts the director first', links.linkSentence(nolanLinks[0], 'Christopher Nolan') === "You've seen 4 films where Christopher Nolan directed Cillian Murphy");
check('names can be wrapped for emphasis', links.linkSentence(nolanLinks[0], 'Christopher Nolan', name => `<b>${name}</b>`) === "You've seen 4 films where <b>Christopher Nolan</b> directed <b>Cillian Murphy</b>");
const both = links.collaborationLinks(1, [
  film(10, 2000, [{ id: 7, name: 'Actor Director' }], [{ id: 1, name: 'Star', order: 0 }, { id: 7, name: 'Actor Director', order: 1 }]),
  film(11, 2001, [{ id: 7, name: 'Actor Director' }], [{ id: 1, name: 'Star', order: 0 }, { id: 7, name: 'Actor Director', order: 1 }]),
]);
check('someone who directed and co-starred appears once, as director', both.length === 1 && both[0].relation === 'directed-them', JSON.stringify(both.map(link => link.relation)));
check('the limit caps the links', links.collaborationLinks(murphy.id, films, { limit: 1 }).length === 1);

// ---------- heatmap: standouts, insights, watch order ----------
check('about average is the grey middle band', heatmap.deltaBand(0) === 3 && heatmap.deltaBand(0.19) === 3 && heatmap.deltaBand(-0.19) === 3);
check('standout bands step out in both directions', heatmap.deltaBand(0.2) === 4 && heatmap.deltaBand(0.6) === 5 && heatmap.deltaBand(1.4) === 6 && heatmap.deltaBand(-0.3) === 2 && heatmap.deltaBand(-0.7) === 1 && heatmap.deltaBand(-2) === 0);
check('the bands are symmetric at every step', [0.2, 0.5, 1].every(step => heatmap.deltaBand(step) - 3 === 3 - heatmap.deltaBand(-step)));
check('a difference of exactly a step is not lost to floating point', heatmap.deltaBand(8.5 - 8.0) === 5 && heatmap.deltaBand(7.3 - 7.1) === 4);
check('no difference, no standout band', heatmap.deltaBand(NaN) === -1 && heatmap.deltaBand(null) === -1);
const ep = (n, rating, votes, extra = {}) => ({ episode_number: n, vote_average: rating, vote_count: votes, air_date: '2024-01-01', name: `E${n}`, ...extra });
const seasons = [
  { season_number: 1, name: 'Season 1', episodes: [ep(1, 7.0, 40), ep(2, 8.0, 40), ep(3, 9.0, 40), ep(4, 8.0, 40)] },
  { season_number: 2, name: 'Season 2', episodes: [ep(1, 8.8, 40), ep(2, 9.4, 3), ep(3, 8.6, 40), ep(4, 0, 0, { air_date: '2099-01-01' })] },
];
const marked = { '1-1': 300, '1-2': 100, '2-1': 200, '1-3': 0 };
const model = heatmap.heatmapModel(seasons, {
  isWatched: (s, e) => `${s}-${e}` in marked,
  watchedAt: (s, e) => marked[`${s}-${e}`] || 0,
  now: new Date('2026-09-16').getTime(),
});
const cell = (s, e) => model.rows.find(row => row.season === s).cells.find(item => item.episode === e);
check("each rated episode is compared with its own season's average", cell(1, 3).delta === 1 && cell(1, 3).deltaBand === 6 && cell(1, 1).delta === -1 && cell(1, 1).deltaBand === 0, JSON.stringify([cell(1, 3).delta, cell(1, 1).delta]));
check('an unrated episode has no standout', cell(2, 4).delta === null && cell(2, 4).deltaBand === -1);
check('watch order follows when episodes were marked, unstamped ones first', [cell(1, 3), cell(1, 2), cell(2, 1), cell(1, 1)].map(item => item.order).join(',') === '0,1,2,3', [cell(1, 3), cell(1, 2), cell(2, 1), cell(1, 1)].map(item => item.order).join(','));
check('unwatched episodes have no place in the order', cell(1, 4).order === -1);
check('the peak ignores thinly voted episodes', model.best === cell(1, 3), JSON.stringify(model.best));
check('the strongest season has the highest average of three or more rated episodes', model.strongest?.season === 2 && model.strongest.mean === 8.9, JSON.stringify(model.strongest && [model.strongest.season, model.strongest.mean]));
check('a season with fewer than three rated episodes cannot be strongest', heatmap.heatmapModel([{ season_number: 1, episodes: [ep(1, 7, 40), ep(2, 7, 40), ep(3, 7, 40)] }, { season_number: 2, episodes: [ep(1, 9.9, 40), ep(2, 9.9, 40)] }]).strongest?.season === 1);
check('unseen gems are aired, trusted and at least the show average', model.gems.map(item => `${item.season}.${item.episode}`).join(',') === '2.3', model.gems.map(item => `${item.season}.${item.episode}`).join(','));
check('the best-of count says how many of the top episodes you have seen', model.top.count === 3 && model.top.seen === 2, JSON.stringify(model.top));
const html = heatmap.heatmapHTML(9, model, { mode: 'standouts', light: true });
check('the grid carries the mode, the light-up and both band attributes', /hm-grid hm-mode-standouts/.test(html) && /hm-lighting/.test(html) && /data-b="6" data-d="6"/.test(html));
check('watched squares light up in order', /data-sn="1" data-en="3"[^>]*--lit:0ms/.test(html) && /data-sn="1" data-en="2"[^>]*--lit:\d+ms/.test(html));
check('the grid is one tab stop', (html.match(/tabindex="0"/g) || []).length === 1);
check('the insights name the peak and the gems', html.includes('Peak episode') && html.includes('Best you haven') && html.includes('2 of the top 3'));
check('without the light-up the grid simply settles in', /hm-enter/.test(heatmap.heatmapHTML(9, model)) && !/hm-lighting/.test(heatmap.heatmapHTML(9, model)));
check('labels carry the standout in words', heatmap.cellLabel(cell(1, 3)).includes('1.0 above the season average') && heatmap.cellLabel(cell(1, 2)).includes('about the season average'));

// ---------- finale build-up ----------
const DAY = 86400000, t0 = new Date('2026-06-01T20:00:00').getTime();
const show = {
  tmdbId: 5, title: 'Show', episodeRuntime: 50, structure: { 1: 2, 2: 2, 3: 2 }, aired: { season: 3, episode: 2 },
  seasons: { 1: [1, 2], 2: [1, 2], 3: [1, 2] },
  log: [[1, 1, t0, 0], [1, 2, t0 + DAY, 0], [2, 1, t0 + 3 * DAY, 0], [2, 2, t0 + 3 * DAY + 3e6, 0], [3, 1, t0 + 6 * DAY, 0], [3, 2, t0 + 9 * DAY, 0]],
};
const recap = finale.seriesRecap(show, {});
const plan = finale.finaleTimeline(recap);
const tiles = finale.finaleFigures(recap).length;
check('the poster and title arrive first', plan.poster[0] < plan.tiles.start && plan.title[0] < plan.tiles.start);
check('the last tile lands before the strip arrives', plan.tiles.start + (tiles - 1) * plan.tiles.step < plan.strip[0]);
check('bars rise one season after another, after the strip', plan.bars.start > plan.strip[0] && plan.bars.step > 0);
check('the best episode comes after the last bar starts rising', plan.top[0] > plan.bars.start + (recap.seasons.length - 1) * plan.bars.step);
check('the build-up ends when the last part lands', plan.end === plan.top[0] + plan.top[1] && plan.end < 5000, String(plan.end));

// ---------- completed series shelf ----------
const progress = {
  tv_1: { tmdbId: 1, title: 'Older', poster: '/o.jpg', completedAt: 1000, seasons: { 1: [1, 2], 2: [1] } },
  tv_2: { tmdbId: 2, title: 'Newer', poster: '/n.jpg', completedAt: 5000, seasons: { 0: [1], 1: [1, 2, 3] } },
  tv_3: { tmdbId: 3, title: 'Unfinished', completedAt: 0, seasons: { 1: [1] } },
  tv_4: { tmdbId: 4, title: 'Dropped', completedAt: 9000, dropped: true, seasons: { 1: [1] } },
};
const shelf = profile.completedSeries(progress, id => [1, 2, 4].includes(id));
check('the shelf holds finished, undropped series, newest finish first', shelf.map(item => item.id).join(',') === '2,1', shelf.map(item => item.id).join(','));
check('shelf cards count seasons and episodes without specials', shelf[0].seasons === 1 && shelf[0].episodes === 3 && shelf[1].seasons === 2 && shelf[1].episodes === 3, JSON.stringify(shelf));

summary();
