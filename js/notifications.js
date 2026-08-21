// ===== PERSONAL NOTIFICATION CENTER =====
// A derived inbox built from the user's watched TV shows and saved titles.
// Nothing is scraped or invented: episode dates come from TMDB, exact timestamps
// are added only when TVmaze has an airstamp, and streaming uses flatrate only.
// Departure warnings are diffs between two CineVerse scans of the same region —
// no service publishes a leave date, so we never pretend to know one.
import { tmdb, pool } from './api.js';
import { state } from './state.js';
import { IMG, PH, providerUrl, regionLabel } from './config.js';
import { $, esc, debounce, toast } from './ui.js';
import { registerActions } from './events.js';
import { exactEpisodeTime, localEpisodeTime, localTimeZone } from './episode-times.js';
import { db, firebase } from './firebase.js';
import {
  notificationAllowed, visibleProviders, setNotificationCategory, toggleNotificationItem, toggleNotificationProvider,
  resetNotificationPrefs, snoozeNotification, dismissNotification, restoreDismissed, snoozedCount, setNotificationFlag, pushEnabled,
} from './notification-prefs.js';
import { recordProviderBatch, getProviderChanges, getDepartureRisks } from './provider-history.js';
import { providerIntelHTML, mountProviderIntel, setProviderChartRange, toggleProviderChartTable } from './provider-charts.js';
import { enableDesktopAlerts, disableDesktopAlerts, deliverDesktopAlerts, pushSupported, pushPermission } from './notification-push.js';

const CACHE_TTL = 3 * 60 * 60 * 1000;
const DAY = 86400000;
const CACHE_VERSION = 'v3';

let events = [], filter = 'all', query = '', sortMode = 'smart', unreadOnly = false;
let loading = false, rebuildRequested = false, generation = 0, readSyncTimer = null, preferencesOpen = false;
let countdownTimer = null, dropIndex = -1;

const today = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const uid = () => state.user?.uid || 'guest';
const cacheKey = (owner = uid(), region = state.region) => `cv_notification_cache_${CACHE_VERSION}_${owner}_${region}`;
const sourceSignature = () => `${CACHE_VERSION}:${state.region}:${Object.keys(state.watched).sort().join(',')}:${state.watchlist.map(item => item.id).sort().join(',')}`;

function readCache(owner, region) {
  try {
    const value = JSON.parse(localStorage.getItem(cacheKey(owner, region)) || '{}');
    return value && Array.isArray(value.events) ? value : null;
  } catch (_) { return null; }
}

function saveCache(signature = sourceSignature(), owner, region) {
  try { localStorage.setItem(cacheKey(owner, region), JSON.stringify({ events, at: Date.now(), signature })); } catch (_) {}
}

function itemIdentity(key, doc) {
  const parts = String(key || '').split('_');
  return { id: +(doc.tmdbId || parts.at(-1) || 0), type: doc.type || parts[0], title: doc.title || '' };
}

function eventTime(event) {
  const value = event.airstamp || `${event.date || today()}T12:00:00`;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

const flatrate = result => (result?.flatrate || [])
  .filter(provider => provider.logo_path)
  .filter((provider, index, list) => list.findIndex(other => other.provider_id === provider.provider_id) === index)
  .slice(0, 5)
  .map(provider => ({ id: provider.provider_id, name: provider.provider_name, logo: provider.logo_path }));

// ===== SEVERITY =====
// One score decides card order, the "Needs attention" group, and which items are
// allowed to raise an OS-level alert. Everything feeding it is observed data.
const BUCKETS = [
  ['urgent', 'Needs attention', 'Time-critical — act on these first'],
  ['today', 'Today', 'Landing in the next few hours'],
  ['week', 'This week', 'Within the next seven days'],
  ['later', 'Coming later', 'Further out on your calendar'],
  ['recent', 'Recently detected', 'Availability changes found by the last scans'],
];

// A *scheduled* event has a real future date on the calendar (an air date, a
// release date, a confirmed streaming start). A *detection* is something we
// noticed during a scan and is dated "now" by definition — treating those as
// imminent would file the whole inbox under "Needs attention".
function isScheduled(event, todayKey) {
  if (['episodes', 'releases'].includes(event.category)) return true;
  return event.category === 'streaming' && String(event.date || '') > todayKey;
}

function decorate(event) {
  const at = eventTime(event), now = Date.now(), delta = at - now;
  const scheduled = isScheduled(event, today()) && delta > -6 * 3600000;
  const ageDays = Math.max(0, Math.round((now - at) / DAY));
  let bucket = 'recent', priority = 20;

  if (event.category === 'departures') {
    priority = { departed: 96, shrinking: 82, 'last-copy': 64 }[event.level] || 55;
    if (event.saved && !event.watched) priority += 6;
    if (event.watched) priority -= 26;
    bucket = priority >= 80 ? 'urgent' : 'recent';
  } else if (scheduled) {
    if (delta <= DAY) { bucket = 'urgent'; priority = 90; }
    else if (new Date(at).toDateString() === new Date(now).toDateString()) { bucket = 'today'; priority = 86; }
    else if (delta <= 7 * DAY) { bucket = 'week'; priority = 70 - Math.round(delta / DAY); }
    else { bucket = 'later'; priority = 44 - Math.min(20, Math.round(delta / (7 * DAY))); }
    if (event.category === 'episodes') priority += 6;
    if (event.airstamp) priority += 3;
  } else if (event.category === 'streaming') {
    priority = 52 - Math.min(20, ageDays);
  } else if (event.category === 'provider') {
    priority = (event.providerChange === 'removed' ? 46 : 38) - Math.min(18, Math.round(ageDays / 3));
  }

  return {
    ...event, at, bucket,
    countdown: scheduled && delta > 0 && delta <= 3 * DAY,
    priority: Math.max(1, Math.min(100, Math.round(priority))),
    urgent: bucket === 'urgent',
  };
}

function dedupeSort(items) {
  return [...new Map(items.filter(Boolean).map(item => [item.key, item])).values()]
    .map(decorate)
    .sort((a, b) => b.priority - a.priority || a.at - b.at || a.title.localeCompare(b.title));
}

// ===== COLLECTORS =====
async function collectEpisodeAlerts(output, exactJobs, region, providerRecords) {
  const shows = Object.entries(state.watched).map(([key, doc]) => ({ key, doc, ...itemIdentity(key, doc) }))
    .filter(item => item.type === 'tv' && item.id)
    .sort((a, b) => +(b.doc.watchedAt?.seconds || 0) - +(a.doc.watchedAt?.seconds || 0))
    .slice(0, 40);
  await pool(shows, async item => {
    const [show, availability] = await Promise.all([
      tmdb(`/tv/${item.id}`).catch(() => null),
      tmdb(`/tv/${item.id}/watch/providers`).catch(() => null),
    ]);
    if (!show) return;
    const providerResult = availability?.results?.[region] || {};
    const providers = flatrate(providerResult);
    if (availability) providerRecords.push({
      id: item.id, type: 'tv', title: show.name || item.title || 'TV show', poster: show.poster_path || item.doc.poster || '',
      year: (show.first_air_date || '').slice(0, 4), regionLink: providerResult.link || '', providers,
      watched: true, saved: state.watchlist.some(entry => entry.id === `tv_${item.id}`),
    });
    const episode = show.next_episode_to_air;
    if (!episode?.air_date || episode.air_date < today()) return;
    const event = {
      key: `episode_${item.id}_${episode.season_number}_${episode.episode_number}`,
      category: 'episodes', id: item.id, mediaType: 'tv', title: show.name || item.title || 'TV show',
      headline: `S${episode.season_number} · E${episode.episode_number} is coming`,
      detail: episode.name || 'New episode', date: episode.air_date, airstamp: '',
      poster: episode.still_path || show.poster_path || item.doc.poster || '', posterKind: episode.still_path ? 'still' : 'poster',
      language: show.original_language || item.doc.language || '', source: 'Watched show', regionLink: providerResult.link || '',
      providers,
    };
    output.push(event);
    exactJobs.push(exactEpisodeTime(show).then(exact => {
      if (!exact?.airstamp) return;
      if (new Date(exact.airstamp).getTime() <= Date.now()) event.expired = true;
      else event.airstamp = exact.airstamp;
    }));
  }, 4);
}

// Saved movies AND saved shows: both need release, streaming, and — most
// importantly — a provider snapshot, because a title CineVerse never scans can
// never produce a departure warning.
async function collectSavedAlerts(output, region, providerRecords) {
  const saved = state.watchlist.map(item => {
    const fallback = itemIdentity(item.id, item);
    return { ...item, tmdbId: +(item.tmdbId || fallback.id), type: item.type || fallback.type };
  }).filter(item => ['movie', 'tv'].includes(item.type) && item.tmdbId).slice(0, 70);

  await pool(saved, async item => {
    const type = item.type;
    const [detail, availability] = await Promise.all([
      tmdb(`/${type}/${item.tmdbId}`).catch(() => null),
      tmdb(`/${type}/${item.tmdbId}/watch/providers`).catch(() => null),
    ]);
    if (!detail) return;
    const title = detail.title || detail.name || item.title || (type === 'tv' ? 'TV show' : 'Movie');
    const releaseDate = (type === 'tv' ? detail.first_air_date : detail.release_date) || item.releaseDate || '';
    const regionResult = availability?.results?.[region] || {};
    const providers = flatrate(regionResult);
    const watched = !!state.watched[`${type}_${item.tmdbId}`];

    if (availability) providerRecords.push({
      id: detail.id, type, title, poster: detail.poster_path || item.poster || '',
      year: (releaseDate || '').slice(0, 4), regionLink: regionResult.link || '', providers, saved: true, watched,
    });

    if (releaseDate && releaseDate >= today()) output.push({
      key: `release_${type}_${detail.id}_${releaseDate}`, category: 'releases', id: detail.id, mediaType: type,
      title, headline: type === 'tv' ? 'Saved series premiere' : 'Saved movie release',
      detail: type === 'tv' ? 'A show in your lists premieres' : 'A movie in your lists is releasing',
      date: releaseDate, poster: detail.poster_path || item.poster || '', source: 'My Lists',
      language: detail.original_language || item.language || '', providers, regionLink: regionResult.link || '',
    });

    if (!providers.length) return;
    const providerKey = providers.map(provider => provider.id).sort((a, b) => a - b).join('-');
    const coming = !!releaseDate && releaseDate > today();
    output.push({
      key: `stream_${type}_${detail.id}_${providerKey}`, category: 'streaming', id: detail.id, mediaType: type,
      title, headline: coming ? 'Coming to subscription streaming' : 'Now on subscription streaming',
      detail: providers.map(provider => provider.name).join(', '), date: coming ? releaseDate : today(),
      poster: detail.poster_path || item.poster || '', providers,
      source: 'My Lists', language: detail.original_language || item.language || '', regionLink: regionResult.link || '',
    });
  }, 4);
}

// `first_seen` is the moment CineVerse started tracking a title, not a catalog
// change — surfacing it would bury the inbox under one card per saved title on
// the very first scan. It still feeds the charts and the home arrival spotlight.
function providerChangeEvents() {
  return getProviderChanges().filter(change => change.change !== 'first_seen').slice(0, 40).map(change => ({
    key: `provider_${change.key}`, category: 'provider', id: change.id, mediaType: change.type,
    title: change.title || 'Title',
    headline: change.change === 'removed'
      ? `Left ${change.provider?.name || 'a streaming service'}`
      : `Arrived on ${change.provider?.name || 'subscription streaming'}`,
    detail: change.change === 'removed' ? 'No longer detected in this region’s subscription catalog' : 'Subscription availability detected by CineVerse',
    date: new Date(change.at).toISOString().slice(0, 10), airstamp: new Date(change.at).toISOString(), poster: change.poster || '',
    providers: change.provider ? [change.provider] : [], regionLink: change.regionLink || '', source: 'Provider history', providerChange: change.change,
  }));
}

// ===== STREAMING DEPARTURE WARNING =====
const DEPARTURE_COPY = {
  departed: { label: 'Gone from streaming', detail: 'Every subscription service CineVerse had detected for this title has dropped it in your region.' },
  shrinking: { label: 'Leaving services', detail: 'A subscription service that carried this title no longer lists it. The remaining options could follow.' },
  'last-copy': { label: 'One source left', detail: 'This title is down to a single subscription service after previously appearing on more.' },
};

function departureEvents() {
  return getDepartureRisks({ limit: 40 }).map(risk => {
    const copy = DEPARTURE_COPY[risk.level] || DEPARTURE_COPY.shrinking;
    const lostNames = risk.lost.map(entry => entry.name).filter(Boolean);
    const heldDays = risk.heldSince ? Math.round((risk.at - risk.heldSince) / DAY) : 0;
    return {
      key: risk.key, category: 'departures', id: risk.id, mediaType: risk.type, title: risk.title,
      headline: risk.level === 'last-copy'
        ? `Only on ${risk.remaining[0]?.name || 'one service'} now`
        : `Left ${lostNames.slice(0, 2).join(' and ') || 'a streaming service'}${lostNames.length > 2 ? ` +${lostNames.length - 2}` : ''}`,
      detail: copy.detail,
      date: new Date(risk.at).toISOString().slice(0, 10), airstamp: new Date(risk.at).toISOString(),
      poster: risk.poster || '', providers: risk.remaining, lostProviders: risk.lost,
      regionLink: risk.regionLink || '', source: 'Departure watch',
      level: risk.level, levelLabel: copy.label, watched: risk.watched, saved: risk.saved,
      heldDays: heldDays > 0 ? heldDays : 0, peak: risk.peak,
    };
  });
}

// ===== BUILD =====
async function buildNotifications(force = false) {
  if (!state.user) return;
  if (loading) { rebuildRequested = true; return; }
  const cached = readCache();
  if (!force && cached && cached.signature === sourceSignature() && Date.now() - cached.at < CACHE_TTL) {
    events = dedupeSort(cached.events); paintBell(); return;
  }
  loading = true;
  const request = ++generation, owner = state.user.uid, region = state.region, signature = sourceSignature();
  const output = [], exactJobs = [], providerRecords = [];
  try {
    await Promise.all([
      collectEpisodeAlerts(output, exactJobs, region, providerRecords),
      collectSavedAlerts(output, region, providerRecords),
    ]);
    if (request !== generation || state.user?.uid !== owner || state.region !== region) return;
    // Record BEFORE deriving change/departure events so both read the fresh diff.
    recordProviderBatch(providerRecords, region);
    const derived = () => [...output.filter(event => !event.expired), ...providerChangeEvents(), ...departureEvents()];
    events = dedupeSort(derived()); saveCache(signature, owner, region); paintBell(); paintDropdown();
    deliverDesktopAlerts(events.filter(eventVisible).filter(unread));
    Promise.allSettled(exactJobs).then(() => {
      if (request !== generation || state.user?.uid !== owner || state.region !== region) return;
      events = dedupeSort(derived()); saveCache(signature, owner, region); paintBell(); paintDropdown();
      if (onNotificationsPage()) {
        if (document.activeElement?.id === 'notificationSearch') renderNotificationResults();
        else renderInbox();
      }
    });
  } finally {
    loading = false;
    if (rebuildRequested) {
      rebuildRequested = false;
      if (state.user) setTimeout(() => buildNotifications(true).then(() => { if (onNotificationsPage()) renderInbox(); }), 0);
    }
  }
}

const onNotificationsPage = () => /^\/notifications\/?$/.test(location.pathname);
function unread(event) { return !state.notificationRead.includes(event.key); }
function eventVisible(event) {
  if (!notificationAllowed(event)) return false;
  if (['streaming', 'provider'].includes(event.category)) return visibleProviders(event).length > 0;
  return true;
}

function paintBell() {
  const allowed = events.filter(eventVisible);
  const count = allowed.filter(unread).length, urgent = allowed.filter(event => event.urgent && unread(event)).length;
  const badge = $('notificationCount'), bell = $('notificationBell');
  if (badge) { badge.hidden = !count; badge.textContent = count > 99 ? '99+' : String(count); badge.classList.toggle('urgent', !!urgent); }
  if (bell) {
    bell.classList.toggle('has-unread', !!count);
    bell.classList.toggle('has-urgent', !!urgent);
    bell.setAttribute('aria-label', count ? `Notifications, ${count} unread${urgent ? `, ${urgent} needing attention` : ''}` : 'Notifications');
  }
}

function persistRead() {
  try { localStorage.setItem(`cv_notification_read_${uid()}`, JSON.stringify(state.notificationRead)); } catch (_) {}
  paintBell();
  if (!state.user) return;
  clearTimeout(readSyncTimer);
  const owner = state.user.uid, values = state.notificationRead.slice(-400);
  readSyncTimer = setTimeout(() => {
    if (state.user?.uid !== owner) return;
    db.collection('users').doc(owner).set({
      notificationRead: values, notificationReadUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }).catch(error => console.warn('notification read sync', error));
  }, 800);
}

function mark(keys) {
  state.notificationRead = [...new Set([...state.notificationRead, ...keys])].slice(-400);
  persistRead();
}

// ===== TIME =====
function dateLabel(event) {
  if (event.airstamp) return localEpisodeTime(event.airstamp);
  const date = new Date(`${event.date}T12:00:00`);
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function relativeLabel(ms) {
  const delta = ms - Date.now(), past = delta < 0, span = Math.abs(delta);
  const units = [[DAY * 365, 'year'], [DAY * 30, 'month'], [DAY * 7, 'week'], [DAY, 'day'], [3600000, 'hour'], [60000, 'minute']];
  for (const [size, name] of units) {
    if (span >= size) { const value = Math.round(span / size); return past ? `${value} ${name}${value === 1 ? '' : 's'} ago` : `in ${value} ${name}${value === 1 ? '' : 's'}`; }
  }
  return past ? 'just now' : 'any moment';
}

function countdownText(ms) {
  const delta = ms - Date.now();
  if (delta <= 0) return 'Airing now';
  const days = Math.floor(delta / DAY), hours = Math.floor((delta % DAY) / 3600000);
  const minutes = Math.floor((delta % 3600000) / 60000), seconds = Math.floor((delta % 60000) / 1000);
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function startCountdowns() {
  clearInterval(countdownTimer);
  const tick = () => {
    const nodes = document.querySelectorAll('[data-countdown]');
    if (!nodes.length) { clearInterval(countdownTimer); countdownTimer = null; return; }
    nodes.forEach(node => { node.textContent = countdownText(+node.dataset.countdown); });
  };
  if (document.querySelector('[data-countdown]')) { tick(); countdownTimer = setInterval(tick, 1000); }
}
export function stopNotificationCountdowns() { clearInterval(countdownTimer); countdownTimer = null; }

// ===== CARDS =====
function providerStrip(event) {
  const providers = visibleProviders(event);
  if (!providers.length && !event.lostProviders?.length) return '';
  const live = providers.map(provider => `<a href="${esc(providerUrl(provider.name, event.title, event.regionLink))}" target="_blank" rel="noopener" aria-label="Open ${esc(event.title)} on ${esc(provider.name)}"><img src="${IMG}w92${provider.logo}" alt="${esc(provider.name)}" title="Open in ${esc(provider.name)}" loading="lazy"></a>`).join('');
  const gone = (event.lostProviders || []).map(provider => `<span class="provider-left" title="No longer detected on ${esc(provider.name)}"><img src="${IMG}w92${provider.logo}" alt="${esc(provider.name)} (no longer detected)" loading="lazy"></span>`).join('');
  const note = event.category === 'departures'
    ? (providers.length ? `Still on ${providers.length} service${providers.length === 1 ? '' : 's'}` : 'No subscription source left')
    : 'Subscription only';
  return `<div class="notification-providers">${gone}${live}<span>${esc(note)}</span></div>`;
}

function timeBlock(event) {
  if (event.category === 'episodes') {
    return `<div class="notification-time${event.airstamp ? ' exact' : ''}">
      <span>${event.airstamp ? 'Exact local time' : 'Release date'}</span><strong>${esc(dateLabel(event))}</strong>
      <small>${event.airstamp ? `Converted to ${esc(localTimeZone())} · <a href="https://www.tvmaze.com" target="_blank" rel="noopener">TVmaze</a>` : 'Exact time has not been announced'}</small>
      ${event.countdown ? `<b class="notification-countdown" data-countdown="${event.at}">${esc(countdownText(event.at))}</b>` : ''}
    </div>`;
  }
  if (event.category === 'departures') {
    return `<div class="notification-time departure">
      <span>Change detected</span><strong>${esc(dateLabel(event))}</strong>
      <small>${event.heldDays ? `Available for about ${event.heldDays} day${event.heldDays === 1 ? '' : 's'} before this` : 'Found by comparing your last two catalog scans'}</small>
    </div>`;
  }
  const label = ['streaming', 'provider'].includes(event.category) ? 'Detected' : 'Release date';
  return `<div class="notification-time"><span>${label}</span><strong>${esc(dateLabel(event))}</strong><small>${esc(relativeLabel(event.at))}</small>${event.countdown ? `<b class="notification-countdown" data-countdown="${event.at}">${esc(countdownText(event.at))}</b>` : ''}</div>`;
}

function card(event) {
  const isUnread = unread(event);
  const image = event.poster ? `${IMG}${event.posterKind === 'still' ? 'w500' : 'w342'}${event.poster}` : PH;
  const watchLink = event.category === 'departures' && visibleProviders(event)[0];
  return `<article class="notification-card${isUnread ? ' unread' : ''}${event.urgent ? ' urgent' : ''}${event.category === 'departures' ? ` departure level-${esc(event.level)}` : ''}" data-notification-key="${esc(event.key)}" data-priority="${event.priority}">
    ${event.category === 'departures' ? `<div class="departure-ribbon"><i aria-hidden="true">!</i>${esc(event.levelLabel)}</div>` : ''}
    <a class="notification-art${event.posterKind === 'still' ? ' landscape' : ''}" href="/${event.mediaType}/${event.id}" data-action="open-notification" data-key="${esc(event.key)}" data-id="${event.id}" data-type="${event.mediaType}"><img src="${image}" alt="${esc(event.title)}" loading="lazy" data-ph="${PH}"><i></i></a>
    <div class="notification-copy">
      <div class="notification-meta"><span class="category-${esc(event.category)}">${esc(event.category)}</span><b>${esc(event.source)}</b>${event.urgent ? '<u>Priority</u>' : ''}${isUnread ? '<em>New</em>' : ''}</div>
      <h3>${esc(event.title)}</h3><h4>${esc(event.headline)}</h4><p>${esc(event.detail)}</p>
      ${event.category === 'departures' && !event.watched ? '<p class="departure-nudge">Still unwatched in your list — worth prioritising.</p>' : ''}
      ${providerStrip(event)}${timeBlock(event)}
      <div class="notification-actions">
        <a href="/${event.mediaType}/${event.id}" data-action="open-notification" data-key="${esc(event.key)}" data-id="${event.id}" data-type="${event.mediaType}">Open title</a>
        ${watchLink ? `<a class="watch-now" href="${esc(providerUrl(watchLink.name, event.title, event.regionLink))}" target="_blank" rel="noopener">Watch on ${esc(watchLink.name)}</a>` : ''}
        ${isUnread ? `<button data-action="read-notification" data-key="${esc(event.key)}">Mark read</button>` : '<span>Read</span>'}
        <button class="ghost" data-action="snooze-notification" data-key="${esc(event.key)}" title="Hide for 24 hours">Snooze</button>
        <button class="ghost" data-action="dismiss-notification" data-key="${esc(event.key)}" title="Hide this alert">Dismiss</button>
      </div>
    </div>
  </article>`;
}

function visibleEvents() {
  const term = query.toLowerCase();
  let list = events.filter(eventVisible)
    .filter(event => filter === 'all' || event.category === filter)
    .filter(event => !unreadOnly || unread(event))
    .filter(event => !term || `${event.title} ${event.headline} ${event.detail} ${event.source}`.toLowerCase().includes(term));
  if (sortMode === 'soonest') list = [...list].sort((a, b) => a.at - b.at);
  else if (sortMode === 'newest') list = [...list].sort((a, b) => b.at - a.at);
  else if (sortMode === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title));
  return list;
}

function emptyState() {
  const filtered = events.filter(eventVisible).length;
  const hidden = snoozedCount();
  return `<div class="notification-empty"><i>✓</i><h2>All quiet here</h2>
    <p>${filtered ? 'No notifications match this view.' : events.length ? 'Everything here is currently muted, snoozed, or dismissed.' : 'Watch a TV show or save a movie to start your personal feed.'}</p>
    <div class="notification-empty-actions">
      ${filtered ? '<button class="btn-glass" data-action="notification-reset-view">Clear filters</button>' : ''}
      ${hidden ? `<button class="btn-glass" data-action="restore-notifications">Restore ${hidden} hidden</button>` : ''}
      <button class="btn-glass" data-action="show-page" data-page="discover">Explore titles</button>
    </div></div>`;
}

function resultsHTML(list) {
  if (!list.length) return emptyState();
  if (sortMode !== 'smart') return `<div class="notification-grid">${list.map(card).join('')}</div>`;
  return BUCKETS.map(([id, title, hint]) => {
    const group = list.filter(event => event.bucket === id);
    if (!group.length) return '';
    const unreadInGroup = group.filter(unread).length;
    return `<section class="notification-group${id === 'urgent' ? ' priority' : ''}">
      <header class="notification-group-head"><div><h2>${title}<b>${group.length}</b></h2><p>${hint}</p></div>
      ${unreadInGroup ? `<button data-action="read-group-notifications" data-bucket="${id}">Mark ${unreadInGroup} read</button>` : ''}</header>
      <div class="notification-grid">${group.map(card).join('')}</div></section>`;
  }).join('');
}

// ===== DROPDOWN =====
function compactCard(event, index) {
  const image = event.poster ? `${IMG}${event.posterKind === 'still' ? 'w300' : 'w185'}${event.poster}` : PH;
  const provider = visibleProviders(event)[0];
  return `<a class="notification-drop-item${unread(event) ? ' unread' : ''}${event.urgent ? ' urgent' : ''}" href="/${event.mediaType}/${event.id}" role="option" data-drop-index="${index}" data-action="open-notification" data-key="${esc(event.key)}" data-id="${event.id}" data-type="${event.mediaType}">
    <img src="${image}" alt="" loading="lazy">
    <span><em>${esc(event.category)}</em><strong>${esc(event.title)}</strong><small>${esc(event.headline)} · ${esc(event.countdown ? countdownText(event.at) : relativeLabel(event.at))}</small></span>
    ${provider ? `<img class="drop-provider" src="${IMG}w92${provider.logo}" alt="${esc(provider.name)}">` : '<i class="drop-dot" aria-hidden="true"></i>'}
  </a>`;
}

export function isNotificationDropdownOpen() { return !!$('notificationDropdown')?.classList.contains('active'); }
export function closeNotificationDropdown() {
  const dropdown = $('notificationDropdown'), bell = $('notificationBell');
  dropdown?.classList.remove('active'); dropdown?.setAttribute('aria-hidden', 'true'); bell?.setAttribute('aria-expanded', 'false');
  dropIndex = -1;
}

function paintDropdown() {
  const host = $('notificationDropdown'); if (!host) return;
  if (!state.user) {
    host.innerHTML = `<div class="notification-drop-head"><span>Premiere desk</span><strong>Notifications</strong></div><div class="notification-drop-empty"><i>✦</i><p>Sign in for episode times, releases, streaming arrivals, and departure warnings.</p><button data-action="open-auth">Sign in</button></div>`;
    return;
  }
  const allowed = events.filter(eventVisible);
  const list = [...allowed].sort((a, b) => Number(unread(b)) - Number(unread(a)) || b.priority - a.priority).slice(0, 6);
  const count = allowed.filter(unread).length;
  const urgent = allowed.filter(event => event.urgent).length;
  host.innerHTML = `<div class="notification-drop-head">
      <span>Live collection intelligence</span>
      <strong>Notifications <b>${count ? `${count} new` : 'caught up'}</b></strong>
      <button data-action="close-notifications" aria-label="Close notifications">×</button>
    </div>
    ${urgent ? `<div class="notification-drop-alert"><i aria-hidden="true">!</i>${urgent} item${urgent === 1 ? '' : 's'} need${urgent === 1 ? 's' : ''} attention</div>` : ''}
    <div class="notification-drop-feed" role="listbox" aria-label="Recent notifications">${list.length ? list.map(compactCard).join('') : '<div class="notification-drop-empty"><i>✓</i><p>No alerts yet. Watch a show or save a movie to begin.</p></div>'}</div>
    <div class="notification-drop-foot">
      <button data-action="show-page" data-page="notifications">Open notification center</button>
      ${count ? '<button data-action="read-all-notifications" title="Mark everything read">Read all</button>' : ''}
      <button data-action="open-notification-preferences">Preferences</button>
    </div>`;
  dropIndex = -1;
}

function moveDropSelection(step) {
  const items = [...($('notificationDropdown')?.querySelectorAll('.notification-drop-item') || [])];
  if (!items.length) return;
  dropIndex = (dropIndex + step + items.length) % items.length;
  items.forEach((item, index) => item.classList.toggle('active', index === dropIndex));
  items[dropIndex]?.focus?.();
  items[dropIndex]?.scrollIntoView({ block: 'nearest' });
}

function toggleDropdown() {
  const host = $('notificationDropdown'), bell = $('notificationBell'); if (!host) return;
  const open = !host.classList.contains('active');
  if (open) {
    paintDropdown(); host.classList.add('active'); host.setAttribute('aria-hidden', 'false'); bell?.setAttribute('aria-expanded', 'true');
  } else closeNotificationDropdown();
}

// ===== PREFERENCES =====
function preferenceHTML() {
  const prefs = state.notificationPreferences || {};
  const mutedItems = new Set(prefs.mutedItems || []), mutedProviders = new Set((prefs.mutedProviders || []).map(String));
  const watchedShows = Object.entries(state.watched).map(([key, doc]) => ({ ...itemIdentity(key, doc), mediaType: doc.type || 'tv', poster: doc.poster || '' })).filter(item => item.mediaType === 'tv' && item.id);
  const savedTitles = state.watchlist.map(item => { const id = itemIdentity(item.id, item); return { ...id, mediaType: item.type || id.type, poster: item.poster || '' }; }).filter(item => item.id);
  const items = [...new Map([...events.filter(event => !['provider', 'departures'].includes(event.category)), ...watchedShows, ...savedTitles].map(event => [`${event.mediaType}_${event.id}`, event])).values()].slice(0, 40);
  const snapshotProviders = Object.values(state.providerHistory?.snapshots || {}).flatMap(snapshot => snapshot.providers || []);
  const providers = [...new Map([...events.flatMap(event => [...(event.providers || []), ...(event.lostProviders || [])]), ...snapshotProviders].map(provider => [String(provider.id), provider])).values()];
  const hidden = snoozedCount();
  const permission = pushPermission();
  const category = (key, label, detail) => `<label class="notification-pref-row"><span><strong>${label}</strong><small>${detail}</small></span><input type="checkbox" data-action="notification-pref-category" data-category="${key}" ${prefs[key] !== false ? 'checked' : ''}><i></i></label>`;

  return `<section class="notification-preferences">
    <div class="notification-pref-head"><div><span>Fine-grained controls</span><h2>Notification Preferences</h2><p>Choose the titles, alert types, and subscription services allowed to reach your premiere desk.</p></div><button data-action="toggle-notification-preferences">Done</button></div>
    <div class="notification-pref-grid">
      ${category('episodes', 'New TV episodes', 'Upcoming episodes from shows you watched')}
      ${category('releases', 'Releases &amp; premieres', 'Release dates for saved movies and shows')}
      ${category('streaming', 'Streaming arrivals', 'Subscription arrivals only—never rent or buy')}
      ${category('departures', 'Departure warnings', 'When a saved title starts leaving subscription services')}
      ${category('providerChanges', 'Provider change log', 'Every add and drop CineVerse detects')}
    </div>
    <div class="notification-pref-section">
      <h3>Delivery</h3><p>Alerts stay on this device. CineVerse has no notification server and never emails you.</p>
      <div class="notification-pref-grid">
        <label class="notification-pref-row${!pushSupported() || permission === 'denied' ? ' disabled' : ''}">
          <span><strong>Desktop alerts</strong><small>${!pushSupported() ? 'This browser cannot show system notifications' : permission === 'denied' ? 'Blocked in your browser settings for this site' : 'Only urgent items, only while CineVerse is open in the background'}</small></span>
          <input type="checkbox" data-action="toggle-desktop-alerts" ${pushEnabled() && permission === 'granted' ? 'checked' : ''} ${!pushSupported() || permission === 'denied' ? 'disabled' : ''}><i></i>
        </label>
        <label class="notification-pref-row"><span><strong>Alert sound</strong><small>Let desktop alerts play your system notification sound</small></span><input type="checkbox" data-action="toggle-notification-sound" ${prefs.sound ? 'checked' : ''}><i></i></label>
      </div>
    </div>
    <div class="notification-pref-section"><h3>Titles</h3><p>Tap a title to mute or restore it.</p>
      <div class="notification-pref-chips">${items.length ? items.map(item => { const value = `${item.mediaType}_${item.id}`, muted = mutedItems.has(value); return `<button class="${muted ? 'muted' : ''}" data-action="notification-pref-item" data-value="${value}" aria-pressed="${!muted}"><img src="${item.poster ? `${IMG}w92${item.poster}` : PH}" alt=""><span>${esc(item.title)}</span><b>${muted ? 'Muted' : 'On'}</b></button>`; }).join('') : '<small>Your watched shows and saved titles will appear here.</small>'}</div>
    </div>
    <div class="notification-pref-section"><h3>Streaming services</h3><p>Only subscription providers detected in your selected region are shown.</p>
      <div class="notification-provider-prefs">${providers.length ? providers.map(provider => { const muted = mutedProviders.has(String(provider.id)); return `<button class="${muted ? 'muted' : ''}" data-action="notification-pref-provider" data-value="${provider.id}" aria-pressed="${!muted}"><img src="${IMG}w92${provider.logo}" alt=""><span>${esc(provider.name)}</span><b>${muted ? 'Muted' : 'On'}</b></button>`; }).join('') : '<small>Providers appear after your first availability scan.</small>'}</div>
    </div>
    <div class="notification-pref-foot">
      ${hidden ? `<button class="notification-pref-restore" data-action="restore-notifications">Restore ${hidden} snoozed or dismissed</button>` : '<span>Nothing is snoozed or dismissed.</span>'}
      <button class="notification-pref-reset" data-action="reset-notification-preferences">Restore recommended defaults</button>
    </div>
  </section>`;
}

// ===== PAGE =====
function renderNotificationResults() {
  const host = $('notificationResults');
  if (!host) return;
  host.innerHTML = resultsHTML(visibleEvents());
  startCountdowns();
}

function heroHTML(allowed) {
  const unreadCount = allowed.filter(unread).length;
  const urgent = allowed.filter(event => event.urgent);
  // Only calendar events can be "next up" — a detection is dated now, not ahead.
  const next = allowed.filter(event => event.bucket !== 'recent' && event.at > Date.now()).sort((a, b) => a.at - b.at)[0];
  const departures = allowed.filter(event => event.category === 'departures').length;
  return `<section class="notifications-hero">
    <div>
      <span>Personal premiere desk</span><h1>Notifications</h1>
      <p>Upcoming episodes from watched shows, saved releases, subscription arrivals, and early warning when a title starts leaving streaming—without rental noise.</p>
      <div class="notification-hero-meta">
        <b>${unreadCount} unread</b>
        ${urgent.length ? `<u>${urgent.length} need${urgent.length === 1 ? 's' : ''} attention</u>` : ''}
        ${departures ? `<i>${departures} departure warning${departures === 1 ? '' : 's'}</i>` : ''}
        <span>Times in ${esc(localTimeZone())}</span><span>${esc(regionLabel(state.region))}</span>
      </div>
      ${next ? `<div class="notification-next"><span>Next up</span><strong>${esc(next.title)}</strong><em>${esc(next.headline)}</em><b data-countdown="${next.at}">${esc(countdownText(next.at))}</b></div>` : ''}
    </div>
    <div class="notification-radar" aria-hidden="true"><i></i><b>${allowed.length}</b><span>live signals</span></div>
  </section>`;
}

function renderInbox() {
  const host = $('notificationsContent'); if (!host) return;
  if (!state.user) {
    stopNotificationCountdowns();
    host.innerHTML = `<div class="notification-auth"><i>✦</i><h2>Your personal premiere desk</h2><p>Sign in to see episode drops, saved releases, subscription-streaming arrivals, and departure warnings.</p><button class="btn-primary" data-action="open-auth">Sign in</button></div>`;
    return;
  }
  const allowed = events.filter(eventVisible), list = visibleEvents(), unreadCount = allowed.filter(unread).length;
  const count = category => allowed.filter(event => event.category === category).length;
  const tabs = [['all', 'All', allowed.length], ['episodes', 'Episodes', count('episodes')], ['releases', 'Releases', count('releases')],
    ['streaming', 'Streaming', count('streaming')], ['departures', 'Departures', count('departures')], ['provider', 'History', count('provider')]];

  host.innerHTML = `${heroHTML(allowed)}
    <section class="notification-toolbar">
      <div class="notification-tabs" role="tablist" aria-label="Notification categories">${tabs.map(([value, label, total]) => `<button class="${filter === value ? 'active' : ''}" role="tab" aria-selected="${filter === value}" data-action="notification-filter" data-filter="${value}">${label}<b>${total}</b></button>`).join('')}</div>
      <div class="notification-tools">
        <label><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><input id="notificationSearch" value="${esc(query)}" placeholder="Search notifications" aria-label="Search notifications"></label>
        <select class="notification-sort" data-action="notification-sort" aria-label="Sort notifications">
          <option value="smart"${sortMode === 'smart' ? ' selected' : ''}>Smart order</option>
          <option value="soonest"${sortMode === 'soonest' ? ' selected' : ''}>Soonest first</option>
          <option value="newest"${sortMode === 'newest' ? ' selected' : ''}>Newest first</option>
          <option value="title"${sortMode === 'title' ? ' selected' : ''}>Title A–Z</option>
        </select>
        <button class="${unreadOnly ? 'active' : ''}" data-action="notification-unread-only" aria-pressed="${unreadOnly}">Unread only</button>
        <button data-action="toggle-notification-preferences" aria-expanded="${preferencesOpen}">Preferences</button>
        <button data-action="refresh-notifications">Refresh</button>
        <button data-action="read-all-notifications" ${unreadCount ? '' : 'disabled'}>Mark all read</button>
      </div>
    </section>
    <div class="notification-trust"><span>Live collection intelligence</span><p>Streaming alerts use subscription providers only. Availability is checked when this page refreshes because free catalog data does not publish future provider start or end times—so arrivals and departures are reported as detected by CineVerse. Availability by <a href="https://www.justwatch.com" target="_blank" rel="noopener">JustWatch</a>.</p></div>
    ${preferencesOpen ? preferenceHTML() : ''}
    <div id="notificationResults">${resultsHTML(list)}</div>
    ${providerIntelHTML({ width: host.clientWidth || 720 })}`;

  const input = $('notificationSearch');
  if (input) input.addEventListener('input', debounce(function () { query = this.value.trim(); renderNotificationResults(); }, 180));
  mountProviderIntel();
  startCountdowns();
}

export async function renderNotifications(force = false) {
  const host = $('notificationsContent'); if (!host) return;
  const cached = readCache();
  if (cached?.events) { events = dedupeSort(cached.events); paintBell(); }
  if (!state.user) return renderInbox();
  if (!events.length || force || !cached || cached.signature !== sourceSignature() || Date.now() - cached.at >= CACHE_TTL) {
    host.innerHTML = '<div class="notification-loading"><span>Scanning your universe</span><div></div><div></div><div></div></div>';
    await buildNotifications(force);
  }
  renderInbox();
}

// ===== INIT =====
export function initNotifications() {
  registerActions({
    'toggle-notifications': () => toggleDropdown(),
    'close-notifications': () => closeNotificationDropdown(),
    'open-notification-preferences': () => { preferencesOpen = true; closeNotificationDropdown(); document.dispatchEvent(new CustomEvent('cv:go', { detail: '/notifications' })); },
    'toggle-notification-preferences': () => { preferencesOpen = !preferencesOpen; renderInbox(); },
    'notification-pref-category': element => { setNotificationCategory(element.dataset.category, element.checked); },
    'notification-pref-item': element => { toggleNotificationItem(element.dataset.value); },
    'notification-pref-provider': element => { toggleNotificationProvider(element.dataset.value); },
    'toggle-desktop-alerts': async element => {
      if (element.checked) { const ok = await enableDesktopAlerts(); if (!ok) element.checked = false; }
      else disableDesktopAlerts();
      if (onNotificationsPage()) renderInbox();
    },
    'toggle-notification-sound': element => setNotificationFlag('sound', element.checked),
    'reset-notification-preferences': () => { resetNotificationPrefs(); toast('Notification preferences restored', 'success'); },
    'restore-notifications': () => { restoreDismissed(); toast('Hidden notifications restored', 'success'); },
    'notification-filter': element => { filter = element.dataset.filter || 'all'; renderInbox(); },
    'notification-sort': element => { sortMode = element.value || 'smart'; renderNotificationResults(); },
    'notification-unread-only': () => { unreadOnly = !unreadOnly; renderInbox(); },
    'notification-reset-view': () => { filter = 'all'; query = ''; unreadOnly = false; renderInbox(); },
    'read-notification': element => { mark([element.dataset.key]); renderNotificationResults(); paintDropdown(); toast('Marked as read', 'success'); },
    'read-group-notifications': element => {
      const bucket = element.dataset.bucket;
      mark(visibleEvents().filter(event => event.bucket === bucket).map(event => event.key));
      renderNotificationResults(); paintDropdown();
    },
    'read-all-notifications': () => {
      mark(events.filter(eventVisible).map(event => event.key));
      if (onNotificationsPage()) renderInbox(); else paintBell();
      paintDropdown(); toast('All notifications read', 'success');
    },
    'snooze-notification': element => { snoozeNotification(element.dataset.key, 24); toast('Snoozed for 24 hours', 'info'); },
    'dismiss-notification': element => { dismissNotification(element.dataset.key); toast('Notification dismissed', 'info'); },
    'refresh-notifications': async element => {
      element.disabled = true; element.textContent = 'Refreshing…';
      await renderNotifications(true);
      toast('Notifications refreshed', 'success');
    },
    'open-notification': element => { mark([element.dataset.key]); document.dispatchEvent(new CustomEvent('cv:go', { detail: `/${element.dataset.type}/${element.dataset.id}` })); },
    'provider-chart-range': element => { setProviderChartRange(element.dataset.range); renderInbox(); },
    'provider-chart-table': () => { toggleProviderChartTable(); renderInbox(); },
  });

  document.addEventListener('click', event => { if (isNotificationDropdownOpen() && !event.target.closest('.notification-menu-wrap')) closeNotificationDropdown(); });

  // Arrow-key navigation inside the popover; Escape is handled by the router.
  document.addEventListener('keydown', event => {
    if (!isNotificationDropdownOpen()) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); moveDropSelection(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveDropSelection(-1); }
  });

  document.addEventListener('cv:notification-prefs', () => {
    paintBell(); paintDropdown();
    if (onNotificationsPage()) renderInbox();
  });

  document.addEventListener('cv:auth', () => {
    clearTimeout(readSyncTimer); readSyncTimer = null;
    generation++;
    const local = (() => { try { return JSON.parse(localStorage.getItem(`cv_notification_read_${uid()}`) || '[]'); } catch (_) { return []; } })();
    state.notificationRead = [...new Set([...(state.notificationRead || []), ...(Array.isArray(local) ? local : [])])].slice(-400);
    const cached = readCache(); events = cached?.events ? dedupeSort(cached.events) : []; paintBell(); paintDropdown();
    if (state.user) buildNotifications(false).then(() => { if (onNotificationsPage()) renderInbox(); });
  });

  document.addEventListener('cv:wl-changed', () => {
    generation++;
    if (onNotificationsPage()) renderNotifications(true);
    else setTimeout(() => buildNotifications(true), 900);
  });

  document.addEventListener('cv:region', () => {
    generation++; events = []; paintBell(); paintDropdown();
    if (state.user) buildNotifications(true).then(() => { if (onNotificationsPage()) renderInbox(); });
  });

  // A backgrounded tab keeps its interval but no longer needs a per-second repaint.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopNotificationCountdowns();
    else if (onNotificationsPage()) startCountdowns();
  });

  // A minute-by-minute re-score of the events we already hold. No network cost:
  // it just lets an episode cross into the urgent window during a long session so
  // the bell, the priority group, and any desktop alert stay honest.
  setInterval(() => {
    if (!state.user || !events.length) return;
    const before = events.filter(eventVisible).filter(event => event.urgent && unread(event)).length;
    events = dedupeSort(events);
    paintBell();
    const now = events.filter(eventVisible).filter(unread);
    deliverDesktopAlerts(now);
    if (before !== now.filter(event => event.urgent).length) paintDropdown();
  }, 60000);
}
