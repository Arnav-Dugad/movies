import { check, summary } from './harness.mjs';

// The bug this file exists for: the per-episode `log` is a list of
// [season, episode, stamp, bulk] tuples — an array of arrays. Firestore refuses
// to store that ("Nested arrays are not supported"), so every progress document
// carrying a non-empty log was rejected, retried, and rejected again: nothing a
// viewer ticked ever reached the cloud. The tuples are flattened to strings on
// the way out and parsed back on the way in.
const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const ep = await import(SRC + 'episodes.js');

state.user = { uid: 'u1' };
state.watched = {};
state.episodeProgress = {};

const META = { title: 'Log Show', structure: { '1': 4, '2': 4 }, aired: { season: 2, episode: 4 }, episodeRuntime: 30 };

ep.toggleEpisode(90, 1, 1, META);
ep.toggleEpisode(90, 1, 2, META);
const entry = ep.showEntry(90);

check('a tick writes a log row', Array.isArray(entry.log) && entry.log.length === 2, JSON.stringify(entry.log));
check('rows are tuples in memory', Array.isArray(entry.log[0]), JSON.stringify(entry.log[0]));

// ---- what actually goes to Firestore ----
const wire = ep.encodeLog(entry.log);
check('the wire form is a flat array of strings', wire.every(row => typeof row === 'string'), JSON.stringify(wire));
// This is the exact check the Firestore SDK performs before it throws.
check('the wire form contains no nested array', !wire.some(row => Array.isArray(row)));
check('a row keeps all four fields', wire[0].split('.').length === 4, wire[0]);

// ---- and back again ----
// sanitizeEntry is the read boundary: everything arriving from Firestore (or
// from the write transaction's own server read) goes through it, so that is
// where the wire form has to parse back.
const roundTripped = ep.sanitizeEntry({ ...entry, log: wire });
check('an encoded document parses back to tuples', Array.isArray(roundTripped.log[0]), JSON.stringify(roundTripped.log[0]));
check('the round trip is lossless',
  JSON.stringify(roundTripped.log) === JSON.stringify(entry.log),
  `${JSON.stringify(roundTripped.log)} vs ${JSON.stringify(entry.log)}`);

// Documents written by the older build still hold tuples; both shapes must read.
const legacy = ep.mergeEntries(ep.sanitizeEntry({ ...entry, log: [[2, 1, 111, 0]] }), ep.sanitizeEntry({ ...entry, log: wire }));
check('a legacy tuple document still merges', legacy.log.length === 3, JSON.stringify(legacy.log));
check('mixed shapes merge into tuples', legacy.log.every(row => Array.isArray(row) && row.length === 4));

// Junk on either side is dropped rather than thrown.
const junk = ep.sanitizeEntry({ ...entry, log: ['nonsense', '1.2', null, 7] });
check('unparseable rows are discarded, not crashed on', Array.isArray(junk.log) && junk.log.length === 0, JSON.stringify(junk.log));

summary();
