// ===== TWO DEVICES, ONE ACCOUNT =====
// Runs against the Firestore emulator, so it exercises the real rules, the real
// transactions and the real merge functions — not a model of them.
//
// The reported symptom was a phone and a laptop showing different Continue
// Watching rails for the same account: a different number of titles, and a
// different number starred. Every claim below is one of the ways that can
// happen, written as something that has to converge.
//
// Each test gets its own account rather than sharing one and clearing between
// them. Node runs top-level suites concurrently, so a shared account plus a
// clearFirestore() in beforeEach lets one suite wipe another's data mid-test —
// exactly the kind of phantom failure this file exists to rule out.
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs, runTransaction } from 'firebase/firestore';

let env, uidCounter = 0;

before(async () => {
  env = await initializeTestEnvironment({
    // Its own project id. rules.test.mjs runs concurrently in the same emulator
    // and calls clearFirestore() between its tests, which would wipe this file's
    // data mid-write if both shared a project.
    projectId: 'cineverse-sync-test',
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});
after(async () => { await env?.cleanup(); });

/**
 * One account, two clients — as close to a phone and a laptop as a single
 * process gets. Each is its own Firestore app, so neither sees the other's
 * writes except through the server.
 */
function account() {
  const uid = `sync-user-${++uidCounter}`;
  return {
    uid,
    phone: env.authenticatedContext(uid, { device: 'phone' }).firestore(),
    laptop: env.authenticatedContext(uid, { device: 'laptop' }).firestore(),
    progressRef: (db, key) => doc(db, `users/${uid}/progress/${key}`),
    profileRef: db => doc(db, `users/${uid}`),
    docIn: (db, name, id) => doc(db, `users/${uid}/${name}/${id}`),
    readAll: async (db, name) => {
      const snapshot = await getDocs(collection(db, `users/${uid}/${name}`));
      return Object.fromEntries(snapshot.docs.map(entry => [entry.id, entry.data()]));
    },
  };
}

describe('every collection Continue Watching depends on is writable', () => {
  // A subcollection missing from the PUBLISHED rules fails with
  // permission-denied and the feature silently stops syncing, which is how two
  // devices end up holding different numbers of titles. `movieProgress` is the
  // newest one, and it stays broken in production until the rules are
  // republished in the Firebase console — this proves the rules file is right,
  // not that the deployment is.
  for (const name of ['progress', 'movieProgress', 'watched', 'watchlist', 'ratings', 'lists']) {
    it(`${name} accepts a write and reads back on the other device`, async () => {
      const acc = account();
      await setDoc(acc.docIn(acc.phone, name, 'probe'), { value: 1 });
      const back = await getDoc(acc.docIn(acc.laptop, name, 'probe'));
      assert.equal(back.exists(), true, `${name} must be readable by the same account`);
      assert.equal(back.data().value, 1);
    });
  }

  it('the layout lives on the profile document both devices already read', async () => {
    const acc = account();
    await setDoc(acc.profileRef(acc.phone), { continueWatching: { pinned: ['tv_1399'], hidden: [], clientUpdatedAt: 5 } }, { merge: true });
    const back = await getDoc(acc.profileRef(acc.laptop));
    assert.deepEqual(back.data().continueWatching.pinned, ['tv_1399']);
  });
});

describe('episode progress converges', () => {
  // Imported from the module so the test cannot drift into describing a
  // different algorithm than the one that actually runs.
  let mergeEntries;
  before(async () => {
    await import('./logic/harness.mjs');
    ({ mergeEntries } = await import(new URL('../js/episodes.js', import.meta.url).href));
  });

  const base = (seasons, updatedAt, extra = {}) => ({
    tmdbId: 1399, title: 'Show', structure: { 1: 10, 2: 10 }, aired: { season: 2, episode: 10 },
    seasons, removed: {}, seasonPlays: {}, log: [], updatedAt, ...extra,
  });
  const wholeSeason = Array.from({ length: 10 }, (_, index) => index + 1);

  // The write path both devices use: read, merge, write, inside a transaction.
  const writer = acc => async (db, key, entry) => {
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(acc.progressRef(db, key));
      transaction.set(acc.progressRef(db, key), snapshot.exists() ? mergeEntries(snapshot.data(), entry) : entry);
    });
  };

  it('ticks made on two devices are both kept', async () => {
    const acc = account(), write = writer(acc);
    await write(acc.phone, 'tv_1399', base({ 1: [1, 2] }, 1000));
    await write(acc.laptop, 'tv_1399', base({ 1: [3, 4] }, 2000));
    const stored = (await getDoc(acc.progressRef(acc.phone, 'tv_1399'))).data();
    assert.deepEqual(stored.seasons['1'], [1, 2, 3, 4]);
  });

  it('an un-tick is not resurrected by a stale device', async () => {
    const acc = account(), write = writer(acc);
    await write(acc.phone, 'tv_1399', base({ 1: [1, 2, 3] }, 1000));
    // The laptop removes episode 2 and records why.
    await write(acc.laptop, 'tv_1399', base({ 1: [1, 3] }, 2000, { removed: { 1: [2] } }));
    // The phone, still holding its older copy, writes again.
    await write(acc.phone, 'tv_1399', base({ 1: [1, 2, 3] }, 1000));
    const stored = (await getDoc(acc.progressRef(acc.laptop, 'tv_1399'))).data();
    assert.deepEqual(stored.seasons['1'], [1, 3], 'the removal must survive a stale write');
    assert.deepEqual(stored.removed['1'], [2]);
  });

  it('the aired marker only ever moves forward', async () => {
    const acc = account(), write = writer(acc);
    // A device whose TMDB copy is a week old must not un-air an episode.
    await write(acc.phone, 'tv_1399', { ...base({ 1: [1] }, 2000), aired: { season: 3, episode: 4 }, structure: { 1: 10, 2: 10, 3: 8 } });
    await write(acc.laptop, 'tv_1399', { ...base({ 1: [1] }, 3000), aired: { season: 2, episode: 10 }, structure: { 1: 10, 2: 10 } });
    const stored = (await getDoc(acc.progressRef(acc.phone, 'tv_1399'))).data();
    assert.equal(stored.aired.season, 3, 'an episode that has aired cannot un-air');
    assert.equal(stored.structure['3'], 8, 'a season the show gained is not dropped by a stale device');
  });

  it('a season that grew keeps its larger episode count', async () => {
    const acc = account(), write = writer(acc);
    await write(acc.phone, 'tv_1399', { ...base({ 1: wholeSeason }, 1000), structure: { 1: 10, 2: 10 } });
    await write(acc.laptop, 'tv_1399', { ...base({ 1: wholeSeason }, 2000), structure: { 1: 10, 2: 13 } });
    const stored = (await getDoc(acc.progressRef(acc.phone, 'tv_1399'))).data();
    assert.equal(stored.structure['2'], 13);
    assert.equal(stored.structure['1'], 10);
  });

  it('a season rewatch count takes the higher number', async () => {
    const acc = account(), write = writer(acc);
    await write(acc.phone, 'tv_1399', base({ 1: wholeSeason }, 1000, { seasonPlays: { 1: 3 } }));
    await write(acc.laptop, 'tv_1399', base({ 1: wholeSeason }, 2000, { seasonPlays: { 1: 2 } }));
    const stored = (await getDoc(acc.progressRef(acc.phone, 'tv_1399'))).data();
    assert.equal(stored.seasonPlays['1'], 3);
  });

  it('two shows edited at the same moment do not overwrite each other', async () => {
    const acc = account(), write = writer(acc);
    await Promise.all([
      write(acc.phone, 'tv_1399', base({ 1: [1] }, 1000)),
      write(acc.laptop, 'tv_1396', base({ 1: [5] }, 1000)),
    ]);
    const all = await acc.readAll(acc.phone, 'progress');
    assert.deepEqual(Object.keys(all).sort(), ['tv_1396', 'tv_1399']);
  });

  it('the same show ticked on both devices at once keeps both ticks', async () => {
    const acc = account(), write = writer(acc);
    await write(acc.phone, 'tv_1399', base({ 1: [1] }, 1000));
    // A transaction retries on contention, so both edits must survive the race.
    await Promise.all([
      write(acc.phone, 'tv_1399', base({ 1: [1, 2] }, 2000)),
      write(acc.laptop, 'tv_1399', base({ 1: [1, 5] }, 2100)),
    ]);
    const stored = (await getDoc(acc.progressRef(acc.phone, 'tv_1399'))).data();
    assert.deepEqual(stored.seasons['1'], [1, 2, 5]);
  });
});

describe('the Continue Watching layout converges', () => {
  let mergeContinuePrefs;
  before(async () => {
    await import('./logic/harness.mjs');
    ({ mergeContinuePrefs } = await import(new URL('../js/continue-prefs.js', import.meta.url).href));
  });

  // The real save path: replay this device's intents onto whatever the server
  // holds, inside a transaction, so two devices never overwrite one another.
  const applier = acc => async (db, operations) =>
    runTransaction(db, async transaction => {
      const snapshot = await transaction.get(acc.profileRef(db));
      const value = mergeContinuePrefs(snapshot.exists() ? snapshot.data().continueWatching : null, operations);
      transaction.set(acc.profileRef(db), { continueWatching: value }, { merge: true });
      return value;
    });
  const op = (type, key, value, at) => ({ type, key, value, at, id: `${type}_${key}_${at}` });
  const layout = async acc => (await getDoc(acc.profileRef(acc.phone))).data().continueWatching;

  it('a star made on one device is visible on the other', async () => {
    const acc = account(), apply = applier(acc);
    await apply(acc.phone, [op('pin', 'tv_1399', true, 1000)]);
    assert.deepEqual((await getDoc(acc.profileRef(acc.laptop))).data().continueWatching.pinned, ['tv_1399']);
  });

  it('stars from two devices are both kept — neither replaces the other', async () => {
    const acc = account(), apply = applier(acc);
    await apply(acc.phone, [op('pin', 'tv_1399', true, 1000)]);
    await apply(acc.laptop, [op('pin', 'tv_1396', true, 2000)]);
    assert.deepEqual((await layout(acc)).pinned.slice().sort(), ['tv_1396', 'tv_1399'],
      'this is the two-starred-here, one-starred-there symptom');
  });

  it('hiding on one device hides on the other, and unhiding brings it back', async () => {
    const acc = account(), apply = applier(acc);
    await apply(acc.phone, [op('hide', 'tv_66732', true, 1000)]);
    assert.deepEqual((await getDoc(acc.profileRef(acc.laptop))).data().continueWatching.hidden, ['tv_66732']);
    await apply(acc.laptop, [op('hide', 'tv_66732', false, 2000)]);
    assert.deepEqual((await layout(acc)).hidden, [], 'an unhide must reach the other device too');
  });

  it('a hide made while the other device was starring keeps both intents', async () => {
    const acc = account(), apply = applier(acc);
    await apply(acc.phone, [op('pin', 'tv_1399', true, 1000)]);
    await apply(acc.laptop, [op('hide', 'tv_1396', true, 1100)]);
    const seen = await layout(acc);
    assert.deepEqual(seen.pinned, ['tv_1399']);
    assert.deepEqual(seen.hidden, ['tv_1396']);
  });

  it('hiding a starred title removes the star', async () => {
    const acc = account(), apply = applier(acc);
    await apply(acc.phone, [op('pin', 'tv_1399', true, 1000)]);
    await apply(acc.laptop, [op('hide', 'tv_1399', true, 2000)]);
    const seen = await layout(acc);
    assert.deepEqual(seen.pinned, []);
    assert.deepEqual(seen.hidden, ['tv_1399']);
  });

  it('an order set by dragging survives the other device starring something else', async () => {
    const acc = account(), apply = applier(acc);
    await apply(acc.phone, [op('order', '', ['tv_1', 'tv_2', 'tv_3'], 1000)]);
    await apply(acc.laptop, [op('pin', 'tv_9', true, 2000)]);
    const seen = await layout(acc);
    assert.equal(seen.pinned[0], 'tv_9', 'a newly starred title leads');
    assert.deepEqual(seen.pinned.slice(1), ['tv_1', 'tv_2', 'tv_3'], 'and the dragged order is intact behind it');
  });

  it('a reset clears both lists for both devices', async () => {
    const acc = account(), apply = applier(acc);
    await apply(acc.phone, [op('pin', 'tv_1399', true, 1000), op('hide', 'tv_1396', true, 1100)]);
    await apply(acc.laptop, [op('reset', '', null, 2000)]);
    const seen = await layout(acc);
    assert.deepEqual(seen.pinned, []);
    assert.deepEqual(seen.hidden, []);
  });

  it('an offline device replays its queued intents on top of what changed meanwhile', async () => {
    const acc = account(), apply = applier(acc);
    await apply(acc.laptop, [op('pin', 'tv_1396', true, 2000)]);
    // The phone was offline while that happened and now flushes its own queue.
    await apply(acc.phone, [op('pin', 'tv_1399', true, 1000), op('hide', 'tv_66732', true, 1200)]);
    const seen = await layout(acc);
    assert.deepEqual(seen.pinned.slice().sort(), ['tv_1396', 'tv_1399']);
    assert.deepEqual(seen.hidden, ['tv_66732']);
  });

  it('both devices starring at the same moment keep both stars', async () => {
    const acc = account(), apply = applier(acc);
    await Promise.all([
      apply(acc.phone, [op('pin', 'tv_1399', true, 1000)]),
      apply(acc.laptop, [op('pin', 'tv_1396', true, 1001)]),
    ]);
    assert.deepEqual((await layout(acc)).pinned.slice().sort(), ['tv_1396', 'tv_1399']);
  });
});

describe('movie progress converges', () => {
  it('a position saved on one device is readable on the other', async () => {
    const acc = account();
    await setDoc(acc.docIn(acc.phone, 'movieProgress', 'movie_299534'), { tmdbId: 299534, position: 4200, runtime: 10860, updatedAt: 1000 });
    assert.equal((await getDoc(acc.docIn(acc.laptop, 'movieProgress', 'movie_299534'))).data().position, 4200);
  });

  it('two films in progress are both listed', async () => {
    const acc = account();
    await setDoc(acc.docIn(acc.phone, 'movieProgress', 'movie_1'), { tmdbId: 1, position: 100, updatedAt: 1 });
    await setDoc(acc.docIn(acc.laptop, 'movieProgress', 'movie_2'), { tmdbId: 2, position: 200, updatedAt: 2 });
    assert.deepEqual(Object.keys(await acc.readAll(acc.phone, 'movieProgress')).sort(), ['movie_1', 'movie_2']);
  });
});
