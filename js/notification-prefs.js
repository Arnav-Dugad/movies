// ===== NOTIFICATION PREFERENCES =====
// Stored locally for instant/offline use and mirrored into the user's existing
// root profile document so this adds no extra Firestore reads.
import { state } from './state.js';
import { db, firebase } from './firebase.js';

export const NOTIFICATION_CATEGORIES = ['episodes', 'releases', 'streaming', 'departures', 'providerChanges'];

export const DEFAULT_NOTIFICATION_PREFS = Object.freeze({
  episodes: true, releases: true, streaming: true, departures: true, providerChanges: true,
  push: false, sound: false,
  mutedItems: [], mutedProviders: [], snoozed: {}, dismissed: [], updatedAt: 0,
});

let syncTimer = null;
const owner = () => state.user?.uid || 'guest';
const key = (uid = owner()) => `cv_notification_prefs_${uid}`;
const ids = values => [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))].slice(-150);

// Snoozes are pruned on read so an old entry can never keep hiding a card that
// has already come back around.
function liveSnoozes(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const now = Date.now(), out = {};
  for (const [name, until] of Object.entries(source)) if (+until > now) out[String(name)] = +until;
  return out;
}

function clean(value = {}) {
  const cleaned = { push: !!value.push, sound: !!value.sound, mutedItems: ids(value.mutedItems), mutedProviders: ids(value.mutedProviders), snoozed: liveSnoozes(value.snoozed), dismissed: ids(value.dismissed).slice(-200), updatedAt: +(value.updatedAt || 0) };
  for (const category of NOTIFICATION_CATEGORIES) cleaned[category] = value[category] !== false;
  return cleaned;
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

const announce = () => document.dispatchEvent(new Event('cv:notification-prefs'));

export function hydrateNotificationPrefs(cloud) {
  const device = local();
  const remote = clean(cloud || {});
  state.notificationPreferences = device.updatedAt > remote.updatedAt ? device : remote;
  try { localStorage.setItem(key(), JSON.stringify(state.notificationPreferences)); } catch (_) {}
}

export function resetNotificationPrefs() {
  state.notificationPreferences = { ...DEFAULT_NOTIFICATION_PREFS, mutedItems: [], mutedProviders: [], snoozed: {}, dismissed: [], updatedAt: Date.now() };
  persist(); announce();
}

export function setNotificationCategory(category, enabled) {
  if (!NOTIFICATION_CATEGORIES.includes(category)) return;
  state.notificationPreferences = { ...clean(state.notificationPreferences), [category]: !!enabled, updatedAt: Date.now() };
  persist(); announce();
}

export function setNotificationFlag(flag, enabled) {
  if (!['push', 'sound'].includes(flag)) return;
  state.notificationPreferences = { ...clean(state.notificationPreferences), [flag]: !!enabled, updatedAt: Date.now() };
  persist(); announce();
}

function toggleIn(field, value) {
  const current = new Set(clean(state.notificationPreferences)[field]);
  current.has(String(value)) ? current.delete(String(value)) : current.add(String(value));
  state.notificationPreferences = { ...clean(state.notificationPreferences), [field]: [...current], updatedAt: Date.now() };
  persist(); announce();
}

export const toggleNotificationItem = value => toggleIn('mutedItems', value);
export const toggleNotificationProvider = value => toggleIn('mutedProviders', value);

export function snoozeNotification(eventKey, hours = 24) {
  if (!eventKey) return;
  const prefs = clean(state.notificationPreferences);
  state.notificationPreferences = { ...prefs, snoozed: { ...prefs.snoozed, [eventKey]: Date.now() + Math.max(1, hours) * 3600000 }, updatedAt: Date.now() };
  persist(); announce();
}

export function unsnoozeNotification(eventKey) {
  const prefs = clean(state.notificationPreferences);
  if (!prefs.snoozed[eventKey]) return;
  const snoozed = { ...prefs.snoozed }; delete snoozed[eventKey];
  state.notificationPreferences = { ...prefs, snoozed, updatedAt: Date.now() };
  persist(); announce();
}

export function dismissNotification(eventKey) {
  if (!eventKey) return;
  const prefs = clean(state.notificationPreferences);
  state.notificationPreferences = { ...prefs, dismissed: [...new Set([...prefs.dismissed, String(eventKey)])].slice(-200), updatedAt: Date.now() };
  persist(); announce();
}

export function restoreDismissed() {
  state.notificationPreferences = { ...clean(state.notificationPreferences), dismissed: [], snoozed: {}, updatedAt: Date.now() };
  persist(); announce();
}

export function snoozedCount() {
  const prefs = clean(state.notificationPreferences);
  return Object.keys(prefs.snoozed).length + prefs.dismissed.length;
}

export function notificationAllowed(event) {
  const prefs = clean(state.notificationPreferences);
  const category = event.category === 'provider' ? 'providerChanges' : event.category;
  if (prefs[category] === false) return false;
  if (prefs.mutedItems.includes(`${event.mediaType}_${event.id}`)) return false;
  if (prefs.dismissed.includes(event.key)) return false;
  return !prefs.snoozed[event.key];
}

export function isSnoozed(eventKey) { return !!clean(state.notificationPreferences).snoozed[eventKey]; }

export function visibleProviders(event) {
  const muted = new Set(clean(state.notificationPreferences).mutedProviders);
  return (event.providers || []).filter(provider => !muted.has(String(provider.id)));
}

export function pushEnabled() { return !!clean(state.notificationPreferences).push; }

export function resetNotificationPrefsForAuth() {
  clearTimeout(syncTimer); syncTimer = null;
  state.notificationPreferences = local();
}
