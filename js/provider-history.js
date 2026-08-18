// ===== SUBSCRIPTION PROVIDER HISTORY =====
// TMDB/JustWatch gives the CURRENT subscription catalog, not an official arrival
// or departure timestamp. Everything here is therefore labelled honestly as
// "detected by CineVerse": we diff consecutive scans of the same region and record
// what changed between them. No date is ever invented.
//
// The ledger stores three things:
//   snapshots — the last seen provider set per title (+ the peak and per-provider
//               first-seen stamps, which is what makes departure warnings possible)
//   changes   — an append-only log of added / removed / first_seen events
//   samples   — one daily catalog-size sample per provider, so the charts can plot
//               a real trend instead of guessing one from the change log
import { state } from './state.js';
import { db, firebase } from './firebase.js';

const SNAPSHOT_CAP = 240;      // titles tracked; eviction is by last-checked
const CHANGE_CAP = 320;        // change-log entries kept
const SAMPLE_CAP = 120;        // ~4 months of daily catalog samples
const DEPARTURE_WINDOW = 60 * 86400000;   // how long a removal stays "recent"

const empty = region => ({ region, snapshots: {}, changes: [], samples: [], updatedAt: 0 });
const owner = () => state.user?.uid || 'guest';
const storageKey = (uid = owner(), region = state.region) => `cv_provider_history_${uid}_${region}`;
const dayStamp = ms => new Date(ms).toISOString().slice(0, 10);
let syncTimer = null;

function sanitize(value, region = state.region) {
  if (!value || value.region !== region) return empty(region);
  const snapshots = value.snapshots && typeof value.snapshots === 'object' ? value.snapshots : {};
  return {
    region,
    snapshots,
    changes: Array.isArray(value.changes) ? value.changes.filter(Boolean).slice(0, CHANGE_CAP) : [],
    samples: Array.isArray(value.samples) ? value.samples.filter(entry => entry && entry.day).slice(-SAMPLE_CAP) : [],
    updatedAt: +(value.updatedAt || 0),
  };
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

// One sample per calendar day. Re-scanning the same day overwrites that day's
// value rather than appending, so the trend line stays evenly spaced.
function recordSample(ledger, now) {
  const byProvider = {};
  let total = 0;
  for (const snapshot of Object.values(ledger.snapshots)) {
    if (!(snapshot.providers || []).length) continue;
    total++;
    for (const provider of snapshot.providers) byProvider[provider.id] = (byProvider[provider.id] || 0) + 1;
  }
  const day = dayStamp(now), sample = { day, at: now, total, byProvider };
  const index = ledger.samples.findIndex(entry => entry.day === day);
  if (index >= 0) ledger.samples[index] = sample; else ledger.samples.push(sample);
  ledger.samples = ledger.samples.sort((a, b) => a.day.localeCompare(b.day)).slice(-SAMPLE_CAP);
}

export function recordProviderBatch(records, region = state.region) {
  const ledger = sanitize(state.providerHistory, region), now = Date.now();
  let changed = false;
  for (const record of records.filter(Boolean)) {
    const key = `${record.type}_${record.id}`, before = ledger.snapshots[key];
    const providers = [...new Map((record.providers || []).map(provider => [String(provider.id), provider])).values()].slice(0, 12);
    const old = new Map((before?.providers || []).map(provider => [String(provider.id), provider]));
    const next = new Map(providers.map(provider => [String(provider.id), provider]));
    // When a title's provider set is unchanged we keep the previous stamps, so
    // "available since" survives every re-scan.
    const providerSince = { ...(before?.providerSince || {}) };
    const missing = { ...(before?.missing || {}) };
    const event = extra => ({
      itemKey: key, id: record.id, type: record.type, title: record.title,
      poster: record.poster || before?.poster || '', year: record.year || before?.year || '',
      at: now, region, regionLink: record.regionLink || before?.regionLink || '', ...extra,
    });

    if (before) {
      for (const [id, provider] of next) if (!old.has(id)) {
        ledger.changes.unshift(event({ key: `${key}_${id}_added_${now}`, provider, change: 'added' }));
        changed = true;
      }
      for (const [id, provider] of old) if (!next.has(id)) {
        ledger.changes.unshift(event({ key: `${key}_${id}_removed_${now}`, provider, change: 'removed', heldSince: +(providerSince[id] || 0) }));
        missing[id] = { id: provider.id, name: provider.name, logo: provider.logo, at: now, heldSince: +(providerSince[id] || 0) };
        changed = true;
      }
    } else {
      for (const [id, provider] of next) ledger.changes.unshift(event({ key: `${key}_${id}_first_${now}`, provider, change: 'first_seen' }));
      changed ||= next.size > 0;
    }
    for (const id of next.keys()) { if (!providerSince[id]) providerSince[id] = now; delete missing[id]; }
    for (const id of Object.keys(providerSince)) if (!next.has(id)) delete providerSince[id];

    const peak = Math.max(+(before?.peak || 0), next.size);
    ledger.snapshots[key] = {
      id: record.id, type: record.type, title: record.title,
      poster: record.poster || before?.poster || '', year: record.year || before?.year || '',
      regionLink: record.regionLink || before?.regionLink || '',
      providers, providerSince, missing, peak,
      firstTracked: +(before?.firstTracked || now), lastChecked: now,
      // Set by the caller so departure warnings can rank "saved but never watched"
      // above titles you have already finished.
      saved: !!record.saved, watched: !!record.watched,
    };
  }
  const ordered = Object.entries(ledger.snapshots).sort((a, b) => +(b[1].lastChecked || 0) - +(a[1].lastChecked || 0)).slice(0, SNAPSHOT_CAP);
  ledger.snapshots = Object.fromEntries(ordered);
  ledger.changes = ledger.changes.slice(0, CHANGE_CAP);
  recordSample(ledger, now);
  ledger.updatedAt = now;
  state.providerHistory = ledger; persist(changed);
  return ledger.changes;
}

export const getProviderChanges = () => sanitize(state.providerHistory).changes;
export const getProviderLedger = () => sanitize(state.providerHistory);

export function getStreamingArrivals(limit = 20) {
  const ledger = sanitize(state.providerHistory), seen = new Set();
  return ledger.changes.filter(change => change.change !== 'removed').filter(change => {
    const current = ledger.snapshots[change.itemKey]?.providers || [];
    const key = `${change.itemKey}_${change.provider?.id}`;
    if (seen.has(key) || !current.some(provider => String(provider.id) === String(change.provider?.id))) return false;
    seen.add(key); return true;
  }).slice(0, limit);
}

// ===== PROVIDER LEADERBOARD =====
// `gained` counts only real additions to an existing snapshot. A first_seen event
// is the moment CineVerse started tracking a title, not a catalog gain, so it is
// reported separately and never inflates the net figure.
export function getProviderStats({ days = 90 } = {}) {
  const ledger = sanitize(state.providerHistory);
  const since = Date.now() - days * 86400000;
  const table = new Map();
  const touch = provider => {
    const id = String(provider?.id ?? '');
    if (!id) return null;
    if (!table.has(id)) table.set(id, { id: provider.id, name: provider.name || 'Streaming service', logo: provider.logo || '', current: 0, gained: 0, lost: 0, tracked: 0, checkedTitles: 0, lastCheckedAt: 0, oldestCheckedAt: 0, lastChangeAt: 0, series: [] });
    const row = table.get(id);
    if (provider.name) row.name = provider.name;
    if (provider.logo) row.logo = provider.logo;
    return row;
  };

  for (const snapshot of Object.values(ledger.snapshots))
    for (const provider of snapshot.providers || []) {
      const row = touch(provider); if (!row) continue;
      const checkedAt = +(snapshot.lastChecked || 0);
      row.current++; row.checkedTitles++;
      row.lastCheckedAt = Math.max(row.lastCheckedAt, checkedAt);
      row.oldestCheckedAt = row.oldestCheckedAt ? Math.min(row.oldestCheckedAt, checkedAt || row.oldestCheckedAt) : checkedAt;
    }

  for (const change of ledger.changes) {
    if (change.at < since) continue;
    const row = touch(change.provider);
    if (!row) continue;
    if (change.change === 'added') row.gained++;
    else if (change.change === 'removed') row.lost++;
    else row.tracked++;
    row.lastChangeAt = Math.max(row.lastChangeAt, +change.at || 0);
  }

  const samples = ledger.samples.filter(sample => sample.at >= since);
  for (const row of table.values())
    row.series = samples.map(sample => ({ day: sample.day, value: +(sample.byProvider?.[row.id] || 0) }));

  const now = Date.now();
  return [...table.values()]
    .map(row => {
      const checkedAt = row.lastCheckedAt || row.lastChangeAt;
      const ageDays = checkedAt ? Math.max(0, (now - checkedAt) / 86400000) : Infinity;
      const reliability = Number.isFinite(ageDays) ? Math.max(5, Math.round(100 - Math.min(ageDays, 30) * 3.15)) : 0;
      return { ...row, checkedAt, ageDays, reliability, net: row.gained - row.lost };
    })
    .filter(row => row.current || row.gained || row.lost)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || b.current - a.current || a.name.localeCompare(b.name));
}

export function getCatalogSeries({ days = 90 } = {}) {
  const since = Date.now() - days * 86400000;
  return sanitize(state.providerHistory).samples
    .filter(sample => sample.at >= since)
    .map(sample => ({ day: sample.day, at: sample.at, total: +(sample.total || 0) }));
}

// ===== STREAMING DEPARTURE WARNINGS =====
// Three honest, verifiable signals — every one of them is a diff between two
// CineVerse scans, never a prediction sourced from anywhere else:
//   departed  — every subscription provider we had detected is now gone
//   shrinking — at least one provider dropped recently, others remain
//   last-copy — down to a single provider from a previously wider catalog
const LEVEL_RANK = { departed: 3, shrinking: 2, 'last-copy': 1 };

export function getDepartureRisks({ limit = 40, days = 60 } = {}) {
  const ledger = sanitize(state.providerHistory);
  const cutoff = Date.now() - Math.min(days, 365) * 86400000;
  const risks = [];

  for (const [itemKey, snapshot] of Object.entries(ledger.snapshots)) {
    const history = Object.values(snapshot.missing || {}).filter(Boolean).sort((a, b) => +b.at - +a.at);
    const recent = history.filter(entry => +entry.at >= cutoff);
    const remaining = snapshot.providers || [];
    const peak = +(snapshot.peak || remaining.length);
    let level = '';
    if (recent.length && !remaining.length) level = 'departed';
    else if (recent.length && remaining.length) level = 'shrinking';
    else if (remaining.length === 1 && peak >= 2) level = 'last-copy';
    if (!level) continue;

    // The timestamp must be stable across scans: a key derived from lastChecked
    // would mint a brand-new (unread, un-snoozable) alert every single day.
    const at = recent[0]?.at || history[0]?.at || +(snapshot.firstTracked || snapshot.lastChecked) || Date.now();
    risks.push({
      key: `departure_${itemKey}_${level}_${dayStamp(at)}`,
      itemKey, id: snapshot.id, type: snapshot.type, title: snapshot.title || 'Title',
      poster: snapshot.poster || '', year: snapshot.year || '', regionLink: snapshot.regionLink || '',
      level, at, lost: history.slice(0, 4), remaining, peak,
      saved: !!snapshot.saved, watched: !!snapshot.watched,
      heldSince: +(recent[0]?.heldSince || history[0]?.heldSince || 0),
    });
  }

  return risks
    .sort((a, b) =>
      (LEVEL_RANK[b.level] - LEVEL_RANK[a.level]) ||
      (Number(!b.watched) - Number(!a.watched)) ||
      (b.at - a.at))
    .slice(0, limit);
}

export const DEPARTURE_WINDOW_MS = DEPARTURE_WINDOW;

export function resetProviderHistoryForAuth() {
  clearTimeout(syncTimer); syncTimer = null; state.providerHistory = local();
}
