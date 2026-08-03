// ===== SUBSCRIPTION PROVIDER HISTORY =====
// TMDB/JustWatch gives the current subscription catalog, not an official arrival
// timestamp. We therefore label dates honestly as "first detected" by CineVerse.
import { state } from './state.js';
import { db, firebase } from './firebase.js';

const empty = region => ({ region, snapshots: {}, changes: [], updatedAt: 0 });
const owner = () => state.user?.uid || 'guest';
const storageKey = (uid = owner(), region = state.region) => `cv_provider_history_${uid}_${region}`;
let syncTimer = null;

function sanitize(value, region = state.region) {
  if (!value || value.region !== region) return empty(region);
  const snapshots = value.snapshots && typeof value.snapshots === 'object' ? value.snapshots : {};
  return { region, snapshots, changes: Array.isArray(value.changes) ? value.changes.filter(Boolean).slice(0, 180) : [], updatedAt: +(value.updatedAt || 0) };
}

function local(region = state.region) {
  try { return sanitize(JSON.parse(localStorage.getItem(storageKey(owner(), region)) || '{}'), region); }
  catch (_) { return empty(region); }
}

export function hydrateProviderHistory(cloud) {
  const device = local(), remote = sanitize(cloud, state.region);
  state.providerHistory = device.updatedAt >= remote.updatedAt ? device : remote;
  try { localStorage.setItem(storageKey(), JSON.stringify(state.providerHistory)); } catch (_) {}
}

function persist(changed) {
  try { localStorage.setItem(storageKey(), JSON.stringify(state.providerHistory)); } catch (_) {}
  document.dispatchEvent(new Event('cv:provider-history'));
  if (!changed || !state.user) return;
  clearTimeout(syncTimer);
  const uid = state.user.uid, payload = state.providerHistory;
  syncTimer = setTimeout(() => {
    if (state.user?.uid !== uid) return;
    db.collection('users').doc(uid).set({
      providerHistory: { ...payload, serverUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() },
    }, { merge: true }).catch(error => console.warn('provider history sync', error));
  }, 1000);
}

export function recordProviderBatch(records, region = state.region) {
  const ledger = sanitize(state.providerHistory, region), now = Date.now();
  let changed = false;
  for (const record of records.filter(Boolean)) {
    const key = `${record.type}_${record.id}`, before = ledger.snapshots[key];
    const providers = [...new Map((record.providers || []).map(provider => [String(provider.id), provider])).values()].slice(0, 12);
    const old = new Map((before?.providers || []).map(provider => [String(provider.id), provider]));
    const next = new Map(providers.map(provider => [String(provider.id), provider]));
    if (before) {
      for (const [id, provider] of next) if (!old.has(id)) {
        ledger.changes.unshift({ key: `${key}_${id}_added_${now}`, itemKey: key, id: record.id, type: record.type, title: record.title, poster: record.poster || '', year: record.year || '', provider, change: 'added', at: now, region, regionLink: record.regionLink || '' }); changed = true;
      }
      for (const [id, provider] of old) if (!next.has(id)) {
        ledger.changes.unshift({ key: `${key}_${id}_removed_${now}`, itemKey: key, id: record.id, type: record.type, title: record.title, poster: record.poster || before.poster || '', year: record.year || before.year || '', provider, change: 'removed', at: now, region, regionLink: record.regionLink || before.regionLink || '' }); changed = true;
      }
    } else {
      for (const [id, provider] of next) ledger.changes.unshift({ key: `${key}_${id}_first_${now}`, itemKey: key, id: record.id, type: record.type, title: record.title, poster: record.poster || '', year: record.year || '', provider, change: 'first_seen', at: now, region, regionLink: record.regionLink || '' });
      changed ||= next.size > 0;
    }
    ledger.snapshots[key] = { ...record, providers, lastChecked: now };
  }
  const ordered = Object.entries(ledger.snapshots).sort((a, b) => +(b[1].lastChecked || 0) - +(a[1].lastChecked || 0)).slice(0, 90);
  ledger.snapshots = Object.fromEntries(ordered); ledger.changes = ledger.changes.slice(0, 180); ledger.updatedAt = now;
  state.providerHistory = ledger; persist(changed);
  return ledger.changes;
}

export const getProviderChanges = () => sanitize(state.providerHistory).changes;
export function getStreamingArrivals(limit = 20) {
  const ledger = sanitize(state.providerHistory), seen = new Set();
  return ledger.changes.filter(change => change.change !== 'removed').filter(change => {
    const current = ledger.snapshots[change.itemKey]?.providers || [];
    const key = `${change.itemKey}_${change.provider?.id}`;
    if (seen.has(key) || !current.some(provider => String(provider.id) === String(change.provider?.id))) return false;
    seen.add(key); return true;
  }).slice(0, limit);
}

export function resetProviderHistoryForAuth() {
  clearTimeout(syncTimer); syncTimer = null; state.providerHistory = local();
}
