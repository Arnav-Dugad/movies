// ===== NOTIFICATION PREFERENCES =====
// Stored locally for instant/offline use and mirrored into the user's existing
// root profile document so this adds no extra Firestore reads.
import { state } from './state.js';
import { db, firebase } from './firebase.js';

export const DEFAULT_NOTIFICATION_PREFS = Object.freeze({
  episodes: true, releases: true, streaming: true, providerChanges: true,
  mutedItems: [], mutedProviders: [], updatedAt: 0,
});

let syncTimer = null;
const owner = () => state.user?.uid || 'guest';
const key = (uid = owner()) => `cv_notification_prefs_${uid}`;
const ids = values => [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))].slice(-150);

function clean(value = {}) {
  return {
    episodes: value.episodes !== false,
    releases: value.releases !== false,
    streaming: value.streaming !== false,
    providerChanges: value.providerChanges !== false,
    mutedItems: ids(value.mutedItems), mutedProviders: ids(value.mutedProviders),
    updatedAt: +(value.updatedAt || 0),
  };
}

function local(uid = owner()) {
  try { return clean(JSON.parse(localStorage.getItem(key(uid)) || '{}')); }
  catch (_) { return clean(); }
}

function persist() {
  const value = clean(state.notificationPreferences);
  state.notificationPreferences = value;
  try { localStorage.setItem(key(), JSON.stringify(value)); } catch (_) {}
  clearTimeout(syncTimer);
  if (!state.user) return;
  const uid = state.user.uid, payload = value;
  syncTimer = setTimeout(() => {
    if (state.user?.uid !== uid) return;
    db.collection('users').doc(uid).set({
      notificationPreferences: { ...payload, serverUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() },
    }, { merge: true }).catch(error => console.warn('notification preferences sync', error));
  }, 700);
}

export function hydrateNotificationPrefs(cloud) {
  const device = local();
  const remote = clean(cloud || {});
  state.notificationPreferences = device.updatedAt > remote.updatedAt ? device : remote;
  try { localStorage.setItem(key(), JSON.stringify(state.notificationPreferences)); } catch (_) {}
}

export function resetNotificationPrefs() {
  state.notificationPreferences = { ...DEFAULT_NOTIFICATION_PREFS, mutedItems: [], mutedProviders: [], updatedAt: Date.now() };
  persist(); document.dispatchEvent(new Event('cv:notification-prefs'));
}

export function setNotificationCategory(category, enabled) {
  if (!['episodes', 'releases', 'streaming', 'providerChanges'].includes(category)) return;
  state.notificationPreferences = { ...clean(state.notificationPreferences), [category]: !!enabled, updatedAt: Date.now() };
  persist(); document.dispatchEvent(new Event('cv:notification-prefs'));
}

function toggleIn(field, value) {
  const current = new Set(clean(state.notificationPreferences)[field]);
  current.has(String(value)) ? current.delete(String(value)) : current.add(String(value));
  state.notificationPreferences = { ...clean(state.notificationPreferences), [field]: [...current], updatedAt: Date.now() };
  persist(); document.dispatchEvent(new Event('cv:notification-prefs'));
}

export const toggleNotificationItem = value => toggleIn('mutedItems', value);
export const toggleNotificationProvider = value => toggleIn('mutedProviders', value);

export function notificationAllowed(event) {
  const prefs = clean(state.notificationPreferences);
  const category = event.category === 'provider' ? 'providerChanges' : event.category;
  return prefs[category] !== false && !prefs.mutedItems.includes(`${event.mediaType}_${event.id}`);
}

export function visibleProviders(event) {
  const muted = new Set(clean(state.notificationPreferences).mutedProviders);
  return (event.providers || []).filter(provider => !muted.has(String(provider.id)));
}

export function resetNotificationPrefsForAuth() {
  clearTimeout(syncTimer); syncTimer = null;
  state.notificationPreferences = local();
}
