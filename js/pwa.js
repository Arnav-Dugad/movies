// ===== SERVICE-WORKER CLEANUP =====
// The app previously registered a cache-first service worker for offline use,
// which caused returning browsers to keep serving a stale build. We no longer
// use a caching service worker (the site is served fresh from Vercel). This
// unregisters any lingering registration and clears all caches on load, so a
// browser that reaches this fresh code never gets stuck on old content again.
// (Browsers still stuck on the OLD worker self-heal via the kill-switch in sw.js.)
export function cleanupServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then(regs => regs.forEach(r => r.unregister()))
      .catch(() => {});
  }
  if (window.caches) {
    caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
  }
}
