// ===== FIRESTORE SECURITY RULE TESTS =====
// Run against the Firestore emulator:
//
//   cd tests && npm install && npm test
//
// Requires a JDK on PATH (the emulator is a Java process). The rules file is
// loaded and handed to the emulator by initializeTestEnvironment, so these tests
// always exercise the exact firestore.rules that ships.
//
// The property under test is the one that matters: raw collection data is
// owner-only, and the ONLY cross-user readable documents are the derived
// snapshots the owner deliberately publishes under users/{uid}/shared/.
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';

const OWNER = 'user-owner';
const OTHER = 'user-other';
const THIRD = 'user-third';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'cineverse-rules-test',
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const asOwner = () => env.authenticatedContext(OWNER).firestore();
const asOther = () => env.authenticatedContext(OTHER).firestore();
const asGuest = () => env.unauthenticatedContext().firestore();

// Seed through the admin context so a fixture is never itself a rules test.
const seed = fn => env.withSecurityRulesDisabled(async context => fn(context.firestore()));

describe('users/{uid} profile document', () => {
  it('the owner can read and write their own profile', async () => {
    await assertSucceeds(setDoc(doc(asOwner(), `users/${OWNER}`), { headline: 'hi' }));
    await assertSucceeds(getDoc(doc(asOwner(), `users/${OWNER}`)));
  });

  // The sign-in cache (js/library-cache.js) decides whether to skip five
  // collection reads by comparing a counter on this document. Someone able to
  // write it could pin another account's cache — freezing it on stale data by
  // holding the number still, or forcing a full read every load by inflating it.
  // Owner-only is what makes that optimisation safe to rely on.
  it('nobody else can write the libraryVersion the sign-in cache trusts', async () => {
    await seed(db => setDoc(doc(db, `users/${OWNER}`), { libraryVersion: 12 }));
    await assertFails(setDoc(doc(asOther(), `users/${OWNER}`), { libraryVersion: 999 }, { merge: true }));
    await assertFails(setDoc(doc(asGuest(), `users/${OWNER}`), { libraryVersion: 0 }, { merge: true }));
    await assertFails(getDoc(doc(asOther(), `users/${OWNER}`)));
    await assertSucceeds(setDoc(doc(asOwner(), `users/${OWNER}`), { libraryVersion: 13 }, { merge: true }));
  });

  // Declared at sign-up and folded into the taste profile. Writable by a stranger,
  // it becomes a way to steer somebody else's recommendations.
  it('nobody else can write the onboarding seed', async () => {
    await seed(db => setDoc(doc(db, `users/${OWNER}`), { onboarded: true, seedGenres: [18, 27] }));
    await assertFails(setDoc(doc(asOther(), `users/${OWNER}`), { seedGenres: [10749] }, { merge: true }));
    await assertFails(setDoc(doc(asOther(), `users/${OWNER}`), { onboarded: false }, { merge: true }));
    await assertSucceeds(setDoc(doc(asOwner(), `users/${OWNER}`), { seedGenres: [878] }, { merge: true }));
  });

  it('another signed-in user cannot read or write it', async () => {
    await seed(db => setDoc(doc(db, `users/${OWNER}`), { headline: 'private' }));
    await assertFails(getDoc(doc(asOther(), `users/${OWNER}`)));
    await assertFails(setDoc(doc(asOther(), `users/${OWNER}`), { headline: 'hacked' }));
  });

  it('a signed-out visitor cannot read it', async () => {
    await seed(db => setDoc(doc(db, `users/${OWNER}`), { headline: 'private' }));
    await assertFails(getDoc(doc(asGuest(), `users/${OWNER}`)));
  });
});

// Every private subcollection behaves identically, so they are asserted as a set:
// a new one added to the rules without a test here is caught by the coverage
// check in tests/coverage.mjs.
describe('private subcollections', () => {
  const PRIVATE = ['watchlist', 'watched', 'ratings', 'lists', 'progress'];

  for (const name of PRIVATE) {
    it(`${name} is readable and writable only by its owner`, async () => {
      await seed(db => setDoc(doc(db, `users/${OWNER}/${name}/item1`), { value: 1 }));

      await assertSucceeds(getDoc(doc(asOwner(), `users/${OWNER}/${name}/item1`)));
      await assertSucceeds(setDoc(doc(asOwner(), `users/${OWNER}/${name}/item2`), { value: 2 }));
      await assertSucceeds(getDocs(collection(asOwner(), `users/${OWNER}/${name}`)));
      await assertSucceeds(deleteDoc(doc(asOwner(), `users/${OWNER}/${name}/item1`)));

      await assertFails(getDoc(doc(asOther(), `users/${OWNER}/${name}/item1`)));
      await assertFails(getDocs(collection(asOther(), `users/${OWNER}/${name}`)));
      await assertFails(setDoc(doc(asOther(), `users/${OWNER}/${name}/item3`), { value: 3 }));
      await assertFails(deleteDoc(doc(asOther(), `users/${OWNER}/${name}/item1`)));
      await assertFails(getDoc(doc(asGuest(), `users/${OWNER}/${name}/item1`)));
    });
  }
});

describe('rewatch history', () => {
  // `plays` and `playDates` are viewing history at a finer grain than the watched
  // flag itself — how often and when, not just whether. They inherit the watched
  // collection's owner-only rule; this is the test that says so out loud, so a
  // later rule change that loosens `watched` fails here with the reason attached.
  it('a rewatch count is as private as the watched entry carrying it', async () => {
    await seed(db => setDoc(doc(db, `users/${OWNER}/watched/movie_1`), {
      tmdbId: 1, type: 'movie', title: 'A', plays: 4, playDates: [1, 2, 3, 4],
    }));
    await assertFails(getDoc(doc(asOther(), `users/${OWNER}/watched/movie_1`)));
    await assertFails(getDoc(doc(asGuest(), `users/${OWNER}/watched/movie_1`)));
    await assertFails(setDoc(doc(asOther(), `users/${OWNER}/watched/movie_1`), { plays: 99 }, { merge: true }));
    await assertSucceeds(getDoc(doc(asOwner(), `users/${OWNER}/watched/movie_1`)));
    await assertSucceeds(setDoc(doc(asOwner(), `users/${OWNER}/watched/movie_1`), { plays: 5 }, { merge: true }));
  });

  it('season rewatch counts stay owner-only with the rest of the episode ledger', async () => {
    await seed(db => setDoc(doc(db, `users/${OWNER}/progress/tv_1399`), {
      tmdbId: 1399, seasons: { 1: [1, 2, 3] }, seasonPlays: { 1: 3 },
    }));
    await assertFails(getDoc(doc(asOther(), `users/${OWNER}/progress/tv_1399`)));
    await assertFails(setDoc(doc(asOther(), `users/${OWNER}/progress/tv_1399`), { seasonPlays: { 1: 99 } }, { merge: true }));
    await assertSucceeds(setDoc(doc(asOwner(), `users/${OWNER}/progress/tv_1399`), { seasonPlays: { 1: 4 } }, { merge: true }));
  });
});

describe('users/{uid}/shared — the deliberate publication surface', () => {
  it('any signed-in user can read a shared list snapshot', async () => {
    await seed(db => setDoc(doc(db, `users/${OWNER}/shared/list_favorites`), { kind: 'list', items: [] }));
    await assertSucceeds(getDoc(doc(asOther(), `users/${OWNER}/shared/list_favorites`)));
  });

  it('any signed-in user can read the shared taste profile', async () => {
    await seed(db => setDoc(doc(db, `users/${OWNER}/shared/taste`), { topGenres: [28] }));
    await assertSucceeds(getDoc(doc(asOther(), `users/${OWNER}/shared/taste`)));
  });

  it('a signed-out visitor cannot read shared documents', async () => {
    await seed(db => setDoc(doc(db, `users/${OWNER}/shared/taste`), { topGenres: [28] }));
    await assertFails(getDoc(doc(asGuest(), `users/${OWNER}/shared/taste`)));
  });

  it('only the owner may publish or revoke a shared document', async () => {
    await assertSucceeds(setDoc(doc(asOwner(), `users/${OWNER}/shared/taste`), { topGenres: [18] }));
    await assertFails(setDoc(doc(asOther(), `users/${OWNER}/shared/taste`), { topGenres: [27] }));
    await seed(db => setDoc(doc(db, `users/${OWNER}/shared/list_x`), { kind: 'list' }));
    await assertFails(deleteDoc(doc(asOther(), `users/${OWNER}/shared/list_x`)));
    await assertSucceeds(deleteDoc(doc(asOwner(), `users/${OWNER}/shared/list_x`)));
  });

  it('sharing does not open the raw collection it was derived from', async () => {
    await seed(async db => {
      await setDoc(doc(db, `users/${OWNER}/shared/list_favorites`), { kind: 'list' });
      await setDoc(doc(db, `users/${OWNER}/watchlist/movie_1`), { title: 'Private' });
    });
    await assertSucceeds(getDoc(doc(asOther(), `users/${OWNER}/shared/list_favorites`)));
    await assertFails(getDoc(doc(asOther(), `users/${OWNER}/watchlist/movie_1`)));
  });
});

describe('publicProfiles — friend discovery', () => {
  it('any signed-in user can read a public profile', async () => {
    await seed(db => setDoc(doc(db, `publicProfiles/${OWNER}`), { name: 'Owner', code: 'ABC123' }));
    await assertSucceeds(getDoc(doc(asOther(), `publicProfiles/${OWNER}`)));
  });

  it('a signed-out visitor cannot', async () => {
    await seed(db => setDoc(doc(db, `publicProfiles/${OWNER}`), { name: 'Owner' }));
    await assertFails(getDoc(doc(asGuest(), `publicProfiles/${OWNER}`)));
  });

  it('only the owner may write their own entry', async () => {
    await assertSucceeds(setDoc(doc(asOwner(), `publicProfiles/${OWNER}`), { name: 'Owner' }));
    await assertFails(setDoc(doc(asOther(), `publicProfiles/${OWNER}`), { name: 'Impostor' }));
  });
});

describe('emailIndex — add a friend by email', () => {
  it('a signed-in user can look up an entry', async () => {
    await seed(db => setDoc(doc(db, 'emailIndex/owner_at_example_com'), { uid: OWNER }));
    await assertSucceeds(getDoc(doc(asOther(), 'emailIndex/owner_at_example_com')));
  });

  it('an entry can only be claimed for your own uid', async () => {
    await assertSucceeds(setDoc(doc(asOwner(), 'emailIndex/owner_at_example_com'), { uid: OWNER }));
    await assertFails(setDoc(doc(asOther(), 'emailIndex/victim_at_example_com'), { uid: OWNER }));
  });

  it('a signed-out visitor can neither read nor write', async () => {
    await seed(db => setDoc(doc(db, 'emailIndex/owner_at_example_com'), { uid: OWNER }));
    await assertFails(getDoc(doc(asGuest(), 'emailIndex/owner_at_example_com')));
    await assertFails(setDoc(doc(asGuest(), 'emailIndex/anything'), { uid: OWNER }));
  });
});

describe('friendRequests', () => {
  const REQUEST = 'req1';
  const seedRequest = () => seed(db => setDoc(doc(db, `friendRequests/${REQUEST}`), { from: OWNER, to: OTHER, status: 'pending' }));

  it('both parties can read it, an outsider cannot', async () => {
    await seedRequest();
    await assertSucceeds(getDoc(doc(asOwner(), `friendRequests/${REQUEST}`)));
    await assertSucceeds(getDoc(doc(asOther(), `friendRequests/${REQUEST}`)));
    await assertFails(getDoc(doc(env.authenticatedContext(THIRD).firestore(), `friendRequests/${REQUEST}`)));
  });

  it('a request can only be sent as yourself', async () => {
    await assertSucceeds(setDoc(doc(asOwner(), 'friendRequests/mine'), { from: OWNER, to: OTHER }));
    await assertFails(setDoc(doc(asOther(), 'friendRequests/forged'), { from: OWNER, to: THIRD }));
  });

  it('either party may resolve it and an outsider may not', async () => {
    await seedRequest();
    await assertSucceeds(deleteDoc(doc(asOther(), `friendRequests/${REQUEST}`)));
    await seedRequest();
    await assertSucceeds(deleteDoc(doc(asOwner(), `friendRequests/${REQUEST}`)));
    await seedRequest();
    await assertFails(deleteDoc(doc(env.authenticatedContext(THIRD).firestore(), `friendRequests/${REQUEST}`)));
  });

  it('a signed-out visitor cannot create one', async () => {
    await assertFails(setDoc(doc(asGuest(), 'friendRequests/guest'), { from: OWNER, to: OTHER }));
  });
});

describe('friendships', () => {
  const PAIR = 'pair1';
  const seedPair = () => seed(db => setDoc(doc(db, `friendships/${PAIR}`), { members: [OWNER, OTHER] }));

  it('members can read it through the array-contains query', async () => {
    await seedPair();
    await assertSucceeds(getDocs(query(collection(asOwner(), 'friendships'), where('members', 'array-contains', OWNER))));
    await assertSucceeds(getDoc(doc(asOther(), `friendships/${PAIR}`)));
  });

  it('a non-member cannot read it', async () => {
    await seedPair();
    await assertFails(getDoc(doc(env.authenticatedContext(THIRD).firestore(), `friendships/${PAIR}`)));
  });

  it('a friendship can only be created with yourself as a member', async () => {
    await assertSucceeds(setDoc(doc(asOwner(), 'friendships/new'), { members: [OWNER, OTHER] }));
    await assertFails(setDoc(doc(env.authenticatedContext(THIRD).firestore(), 'friendships/forged'), { members: [OWNER, OTHER] }));
  });

  it('either member may unfriend, an outsider may not', async () => {
    await seedPair();
    await assertFails(deleteDoc(doc(env.authenticatedContext(THIRD).firestore(), `friendships/${PAIR}`)));
    await assertSucceeds(deleteDoc(doc(asOwner(), `friendships/${PAIR}`)));
  });
});

describe('nothing else is reachable', () => {
  it('an undeclared top-level collection is denied by default', async () => {
    await assertFails(getDoc(doc(asOwner(), 'secretStuff/anything')));
    await assertFails(setDoc(doc(asOwner(), 'secretStuff/anything'), { value: 1 }));
  });

  it('an undeclared user subcollection is denied by default', async () => {
    await assertFails(getDoc(doc(asOwner(), `users/${OWNER}/notARealCollection/x`)));
  });
});
