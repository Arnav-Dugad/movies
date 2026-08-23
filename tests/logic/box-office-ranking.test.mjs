import { check, summary } from './harness.mjs';

const SRC = new URL('../../js/', import.meta.url).href;
const { aggregateDirectorRanking } = await import(SRC + 'box-office.js');
const { collectionOf } = await import(SRC + 'watched-meta.js');

const films = [
  { id: 1, title: 'Alpha', revenue: 800 },
  { id: 2, title: 'Beta', revenue: 500 },
  { id: 3, title: 'Gamma', revenue: 200 },
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
check('non-director crew are excluded', !ranking.some(row => row.id === 30));

const member = collectionOf({ belongs_to_collection: { id: 99, name: 'Series', poster_path: '/p.jpg' } });
check('watched metadata stores collection identity', member.collectionId === 99 && member.collectionName === 'Series' && member.collectionChecked === true, JSON.stringify(member));
const none = collectionOf({}, { collectionId: 99, collectionName: 'Stale' });
check('a confirmed non-member clears stale collection data', none.collectionId === 0 && none.collectionName === '' && none.collectionChecked === true, JSON.stringify(none));

summary();
