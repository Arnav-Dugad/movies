// ===== PWA REGISTRATION (feature-detected, degrades gracefully) =====
export function initPWA() {
  if (!('serviceWorker' in navigator)) return;
  // Service workers require a secure context (https or localhost). On file:// or
  // plain http this silently no-ops — no errors.
  if (!window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline features simply unavailable */ });
  });
}
