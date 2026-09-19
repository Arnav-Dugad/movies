import './harness.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmdb } from '../../js/api.js';

function timers(t) {
  const pending = new Map();
  let next = 0;
  t.mock.method(globalThis, 'setTimeout', (fn, ms) => {
    const id = ++next;
    pending.set(id, fn);
    if (ms < 12000) queueMicrotask(() => { pending.delete(id); fn(); });
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', id => pending.delete(id));
  return pending;
}

test('permanent API errors are not retried and release their deadline', async t => {
  const pending = timers(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 404 }));
  await assert.rejects(tmdb('/movie/404', {}, { cache: false }), /404/);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(pending.size, 0);
});

test('transient API errors retry once and clean up every deadline', async t => {
  const pending = timers(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++calls === 1) throw new TypeError('Network unavailable');
    return { ok: true, json: async () => ({ id: 7 }) };
  });
  assert.deepEqual(await tmdb('/movie/7', {}, { cache: false }), { id: 7 });
  assert.equal(calls, 2);
  assert.equal(pending.size, 0);
});

test('rate limits retry once but repeated failures stop', async t => {
  const pending = timers(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 429 }));
  await assert.rejects(tmdb('/movie/429', {}, { cache: false }), /429/);
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(pending.size, 0);
});

test('API deadline remains active while the response body is pending', async t => {
  const pending = timers(t);
  let bodyStarted;
  const started = new Promise(resolve => { bodyStarted = resolve; });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_, { signal }) => {
    if (++calls > 1) return { ok: true, json: async () => ({ recovered: true }) };
    return { ok: true, json: () => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Timed out')), { once: true });
      bodyStarted();
    }) };
  });
  const request = tmdb('/movie/stalled', {}, { cache: false });
  await started;
  assert.equal(pending.size, 1);
  [...pending.values()][0]();
  assert.deepEqual(await request, { recovered: true });
  assert.equal(pending.size, 0);
});
