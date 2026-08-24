import { check, summary } from './harness.mjs';

const SRC = new URL('../../js/', import.meta.url).href;
const { aggregateDirectorRanking, applyDirectorCareerRevenue, directorEraBreakdown, directorConsistency, boxOfficeAssumptions, isIndianProduction, formatIndianGross } = await import(SRC + 'box-office.js');
const { collectionOf } = await import(SRC + 'watched-meta.js');

const films = [
  { id: 1, title: 'Alpha', revenue: 800, budget: 200, release_date: '2001-01-01' },
  { id: 2, title: 'Beta', revenue: 500, budget: 300, release_date: '2011-01-01' },
  { id: 3, title: 'Gamma', revenue: 200, budget: 0, release_date: '2021-01-01' },
];
const credits = new Map([
  [1, [{ id: 10, name: 'Director A', job: 'Director', profile_path: '/a.jpg' }]],
  [2, [{ id: 10, name: 'Director A', job: 'Director' }, { id: 20, name: 'Director B', job: 'Director' }]],
  [3, [{ id: 20, name: 'Director B', job: 'Director' }, { id: 30, name: 'Writer', job: 'Writer' }]],
]);
const ranking = aggregateDirectorRanking(films, credits);
check('directors are ranked by combined worldwide revenue', ranking.map(row => row.id).join(',') === '10,20', ranking.map(row => row.id).join(','));
check('a director receives every directed film exactly once', ranking[0].revenue === 1300 && ranking[0].films === 2, JSON.stringify(ranking[0]));
check('the top film is retained for context', ranking[0].topFilm.id === 1, JSON.stringify(ranking[0].topFilm));
const careerRanking = applyDirectorCareerRevenue(ranking, new Map([[20, { gross: 5000, films: 12 }]]));
check('reported career revenue can promote a director hidden by a chart-only subtotal', careerRanking[0].id === 20 && careerRanking[0].revenue === 5000 && careerRanking[0].chartRevenue === 700 && careerRanking[0].revenueSource === 'career', JSON.stringify(careerRanking));
check('non-director crew are excluded', !ranking.some(row => row.id === 30));
check('director hit rate excludes films with unknown budgets', ranking[0].knownBudgets === 2 && ranking[0].hits === 1 && ranking[0].hitRate === 50, JSON.stringify(ranking[0]));
check('director eras retain early and recent revenue', ranking[0].eras.map(era => era.label).join(',') === 'Early,Recent', JSON.stringify(ranking[0].eras));
check('three-film careers split into early, middle, and recent eras', directorEraBreakdown(films).map(era => era.label).join(',') === 'Early,Middle,Recent');
const reliable = directorConsistency([
  { budget: 100, revenue: 400 }, { budget: 100, revenue: 350 }, { budget: 100, revenue: 300 },
]);
const uneven = directorConsistency([
  { budget: 100, revenue: 1000 }, { budget: 100, revenue: 80 }, { budget: 100, revenue: 110 },
]);
check('director consistency rewards repeat success without overstating three films', reliable.score > uneven.score && reliable.label === 'Steady', JSON.stringify({ reliable, uneven }));
check('director consistency exposes its measured sample', reliable.sample === 3 && reliable.medianMultiple === 3.5, JSON.stringify(reliable));
const limited = directorConsistency([{ budget: 100, revenue: 400 }]);
check('director consistency does not overstate a one-film sample', limited.score === null && limited.label === 'Not enough comparable films' && limited.sample === 1, JSON.stringify(limited));
const indianProfile = boxOfficeAssumptions({ production_countries: [{ iso_3166_1: 'IN' }], original_language: 'hi' });
check('Indian productions use their own theatrical model', isIndianProduction({ production_countries: [{ iso_3166_1: 'IN' }] }) && indianProfile.id === 'india' && indianProfile.hitThreshold === 2.5, JSON.stringify(indianProfile));
check('country data takes priority over a language-only fallback', !isIndianProduction({ production_countries: [{ iso_3166_1: 'US' }], original_language: 'hi' }));
check('Indian box office is converted from USD into clearly approximate crores', formatIndianGross(1000000, { rate: 80 }) === '≈ ₹8 crore', formatIndianGross(1000000, { rate: 80 }));

const member = collectionOf({ belongs_to_collection: { id: 99, name: 'Series', poster_path: '/p.jpg' } });
check('watched metadata stores collection identity', member.collectionId === 99 && member.collectionName === 'Series' && member.collectionChecked === true, JSON.stringify(member));
const none = collectionOf({}, { collectionId: 99, collectionName: 'Stale' });
check('a confirmed non-member clears stale collection data', none.collectionId === 0 && none.collectionName === '' && none.collectionChecked === true, JSON.stringify(none));

summary();
