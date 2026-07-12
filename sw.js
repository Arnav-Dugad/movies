// ===== CineVerse Service Worker — SELF-DESTROYING KILL SWITCH =====
// A previous version of this file was a cache-first worker that served a stale
// app shell, causing returning browsers to keep loading an old, buggy build.
// This replacement worker has NO fetch handler (so nothing is ever served from
// cache again), deletes every cache, unregisters itself, and reloads open pages.
// Browsers with the old worker pick this up on their next update check and
// self-heal. Once everyone has cycled through, this file can be deleted.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch (e) {}
    try { await self.registration.unregister(); } catch (e) {}
    try { await self.clients.claim(); } catch (e) {}
    // Force a fresh network load in every controlled page.
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => { try { client.navigate(client.url); } catch (e) {} });
  })());
});
