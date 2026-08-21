import { check, summary } from './harness.mjs';
import { webcrypto } from 'node:crypto';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true });

// Resolved from this file so the suite runs from any checkout, on any OS.
const SRC = new URL('../../js/', import.meta.url).href;
const { state } = await import(SRC + 'state.js');
const lists = await import(SRC + 'lists.js');
const lock = await import(SRC + 'list-lock.js');

state.user = { uid: 'u1' };
state.lists = [
  { id: 'watchlist', name: 'Watchlist', icon: 'W', order: 0 },
  { id: 'secret', name: 'Late Night', icon: 'M', order: 1 },
];
state.watchlist = [
  { id: 'movie_1', tmdbId: 1, type: 'movie', title: 'A', lists: ['watchlist'] },
  { id: 'movie_2', tmdbId: 2, type: 'movie', title: 'B', lists: ['secret'] },
  { id: 'movie_3', tmdbId: 3, type: 'movie', title: 'C', lists: ['watchlist', 'secret'] },
];

check('isValidPin accepts 4-8 digits', lock.isValidPin('1234') && lock.isValidPin('12345678'));
check('isValidPin rejects short/long/non-numeric', !lock.isValidPin('123') && !lock.isValidPin('123456789') && !lock.isValidPin('12a4'));
check('a list with no lock is not locked', !lock.isListLocked('secret') && !lock.listHasPin('secret'));
check('lists.listIsLocked agrees', !lists.listIsLocked('secret'));

// saveListLock writes through the firebase stub, so this exercises the real path.
const saved = await lists.saveListLock('secret', { v: 1, salt: 'x', hash: 'y' });
check('saveListLock stores the lock', saved === true && lock.listHasPin('secret'));
check('a pinned, unopened list reads as locked', lock.isListLocked('secret'));
check('lists.listIsLocked sees it too', lists.listIsLocked('secret'));
check('other lists stay open', !lock.isListLocked('watchlist'));

// Full derive/verify round trip through the real PBKDF2 path.
await lists.saveListLock('secret', null);
state.unlockedLists.clear();
const applied = await (async () => {
  // openPinModal needs DOM, so drive the exported primitives instead.
  const salt = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  const probe = await import(SRC + 'list-lock.js');
  // Reuse verifyPin's own derivation by installing a lock built the same way.
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode('4821'), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode('cineverse:' + salt), iterations: 150000, hash: 'SHA-256' }, key, 256);
  const hash = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  await lists.saveListLock('secret', { v: 1, algo: 'PBKDF2-SHA256', iterations: 150000, salt, hash });
  return probe;
})();
check('verifyPin accepts the right PIN', await applied.verifyPin('secret', '4821'));
check('verifyPin rejects a wrong PIN', !(await applied.verifyPin('secret', '4822')));
check('unlockList refuses a wrong PIN', !(await lock.unlockList('secret', '0000')) && lock.isListLocked('secret'));
check('unlockList accepts the right PIN', await lock.unlockList('secret', '4821'));
check('an unlocked list is no longer locked', !lock.isListLocked('secret') && !lists.listIsLocked('secret'));
check('relockList closes it again', (lock.relockList('secret'), lock.isListLocked('secret')));
check('relockAllLists clears everything', (state.unlockedLists.add('secret'), lock.relockAllLists(), lock.isListLocked('secret')));

// Sharing must refuse while a PIN exists.
state.lists.find(l => l.id === 'secret').shared = true;
await lists.shareList('secret');
check('shareList refuses a pinned list', state.lists.find(l => l.id === 'secret').shared === true, 'flag untouched (no publish attempted)');
check('lockedListIds reports it', lock.lockedListIds().includes('secret'));

summary();
