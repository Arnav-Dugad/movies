// ===== DESKTOP ALERTS =====
// Local, on-device notifications only. There is no push server and no
// subscription endpoint: while CineVerse is open in a tab, genuinely new,
// high-priority items are surfaced through the OS notification centre. Each
// alert is delivered at most once per device, tracked in localStorage.
import { state } from './state.js';
import { pushEnabled, setNotificationFlag } from './notification-prefs.js';
import { toast } from './ui.js';
import { IMG } from './config.js';

const SENT_KEY = () => `cv_notification_sent_${state.user?.uid || 'guest'}`;
const MAX_PER_BURST = 3;

export function pushSupported() { return typeof window !== 'undefined' && 'Notification' in window; }
export function pushPermission() { return pushSupported() ? Notification.permission : 'unsupported'; }

function readSent() {
  try { const value = JSON.parse(localStorage.getItem(SENT_KEY()) || '[]'); return Array.isArray(value) ? value : []; }
  catch (_) { return []; }
}
function writeSent(keys) {
  try { localStorage.setItem(SENT_KEY(), JSON.stringify(keys.slice(-300))); } catch (_) {}
}

// Called from a click handler so the browser accepts the permission request.
export async function enableDesktopAlerts() {
  if (!pushSupported()) { toast('This browser cannot show desktop alerts', 'info'); return false; }
  if (Notification.permission === 'denied') {
    toast('Notifications are blocked for this site. Allow them in your browser settings.', 'info');
    return false;
  }
  let permission = Notification.permission;
  if (permission !== 'granted') {
    try { permission = await Notification.requestPermission(); }
    catch (_) { permission = 'denied'; }
  }
  if (permission !== 'granted') { toast('Desktop alerts were not allowed', 'info'); return false; }
  setNotificationFlag('push', true);
  toast('Desktop alerts are on', 'success');
  return true;
}

export function disableDesktopAlerts() {
  setNotificationFlag('push', false);
  toast('Desktop alerts are off', 'info');
}

function show(event) {
  const body = [event.headline, event.detail].filter(Boolean).join(' — ');
  const notification = new Notification(event.title || 'CineVerse', {
    body: body.slice(0, 160),
    // Chrome will not render an SVG notification icon, so there is no point in
    // pointing at the app icon: with no poster we let the browser use its default.
    ...(event.poster ? { icon: `${IMG}w185${event.poster}` } : {}),
    tag: `cineverse-${event.key}`,
    silent: !state.notificationPreferences?.sound,
    data: { path: `/${event.mediaType}/${event.id}` },
  });
  notification.onclick = () => {
    try { window.focus(); } catch (_) {}
    document.dispatchEvent(new CustomEvent('cv:go', { detail: notification.data?.path || '/notifications' }));
    notification.close();
  };
  setTimeout(() => { try { notification.close(); } catch (_) {} }, 20000);
}

// `events` must already be filtered to what the user is allowed to see. Only
// urgent, unread items qualify, and nothing fires while the tab is focused —
// an OS alert for something already on screen is just noise.
export function deliverDesktopAlerts(events) {
  if (!pushEnabled() || pushPermission() !== 'granted' || !state.user) return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  const sent = new Set(readSent());
  const queue = events.filter(event => event.urgent && !sent.has(event.key)).slice(0, MAX_PER_BURST);
  if (!queue.length) return;
  for (const event of queue) {
    try { show(event); sent.add(event.key); } catch (error) { console.warn('desktop alert', error); return; }
  }
  writeSent([...sent]);
}
