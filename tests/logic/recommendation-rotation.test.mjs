import { check, summary } from './harness.mjs';

const SRC = new URL('../../js/', import.meta.url).href;
const { rotateRecommendationSignals } = await import(SRC + 'recommend.js');

const profile = {
  seedIds: ['movie_1', 'movie_2', 'movie_3'],
  topDirectors: [{ id: 1 }, { id: 2 }, { id: 3 }],
  topActors: [{ id: 4 }, { id: 5 }, { id: 6 }],
  topKeywords: [{ id: 7 }, { id: 8 }, { id: 9 }],
  topGenres: [{ id: 10 }, { id: 11 }, { id: 12 }],
};

const today = rotateRecommendationSignals(profile, 4, 100);
const tomorrow = rotateRecommendationSignals(profile, 4, 101);
check('named recommendation signals rotate to a new seed each day', today.seedIds[0] !== tomorrow.seedIds[0], JSON.stringify({ today: today.seedIds, tomorrow: tomorrow.seedIds }));
check('director and tag rails rotate as well as Because-you-liked', today.topDirectors[0].id !== tomorrow.topDirectors[0].id && today.topKeywords[0].id !== tomorrow.topKeywords[0].id);
check('rotation never mutates the taste-ranked source profile', profile.seedIds.join(',') === 'movie_1,movie_2,movie_3' && profile.topDirectors[0].id === 1);

summary();
