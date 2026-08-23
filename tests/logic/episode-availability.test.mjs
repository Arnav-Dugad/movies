import { check, summary } from './harness.mjs';

const SRC = new URL('../../js/', import.meta.url).href;
const { episodeAvailability, isEpisodeAvailable } = await import(SRC + 'episode-times.js');

const episode = { season_number: 2, episode_number: 4, air_date: '2030-01-02' };
const beforeDate = new Date('2030-01-01T23:59:59').getTime();
const startOfDate = new Date('2030-01-02T00:00:00').getTime();

check('date fallback is locked before the local release date', !isEpisodeAvailable(episode, { now: beforeDate }));
check('date fallback unlocks at local midnight', isEpisodeAvailable(episode, { now: startOfDate }));
check('date fallback reports its precision', episodeAvailability(episode, { now: startOfDate }).precision === 'date');

const exact = '2030-01-02T20:30:00+05:30';
check('an exact timestamp overrides the earlier date fallback', !isEpisodeAvailable(episode, { airstamp: exact, now: new Date('2030-01-02T10:00:00+05:30').getTime() }));
check('an exact timestamp unlocks at the confirmed instant', isEpisodeAvailable(episode, { airstamp: exact, now: new Date(exact).getTime() }));
check('exact availability reports its precision', episodeAvailability(episode, { airstamp: exact, now: new Date(exact).getTime() }).precision === 'exact');

check('an episode with no date remains unavailable', !isEpisodeAvailable({ season_number: 1, episode_number: 1 }, { now: Date.now() }));

summary();
