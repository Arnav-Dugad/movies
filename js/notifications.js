// ===== PERSONAL NOTIFICATION CENTER =====
// A derived inbox built from the user's watched TV shows and saved movies.
// Nothing is scraped or invented: episode dates come from TMDB, exact timestamps
// are added only when TVmaze has an airstamp, and streaming uses flatrate only.
import { tmdb, pool } from './api.js';
import { state } from './state.js';
import { IMG, PH, providerUrl } from './config.js';
import { $, esc, debounce, toast } from './ui.js';
import { registerActions } from './events.js';
import { exactEpisodeTime, localEpisodeTime, localTimeZone } from './episode-times.js';
import { db, firebase } from './firebase.js';
import { notificationAllowed, visibleProviders, setNotificationCategory, toggleNotificationItem, toggleNotificationProvider, resetNotificationPrefs } from './notification-prefs.js';
import { recordProviderBatch, getProviderChanges } from './provider-history.js';

const CACHE_TTL = 3 * 60 * 60 * 1000;
let events = [], filter = 'all', query = '', loading = false, rebuildRequested = false, generation = 0, readSyncTimer = null, preferencesOpen = false;

const today = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const uid = () => state.user?.uid || 'guest';
const cacheKey = (owner = uid(), region = state.region) => `cv_notification_cache_v2_${owner}_${region}`;
const sourceSignature = () => `v2:${state.region}:${Object.keys(state.watched).sort().join(',')}:${state.watchlist.map(item => item.id).sort().join(',')}`;

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

function dedupeSort(items) {
  return [...new Map(items.filter(Boolean).map(item => [item.key, item])).values()]
    .sort((a, b) => eventTime(a) - eventTime(b) || a.title.localeCompare(b.title));
}

async function collectEpisodeAlerts(output, exactJobs) {
  const shows = Object.entries(state.watched).map(([key, doc]) => ({ key, doc, ...itemIdentity(key, doc) }))
    .filter(item => item.type === 'tv' && item.id)
    .sort((a, b) => +(b.doc.watchedAt?.seconds || 0) - +(a.doc.watchedAt?.seconds || 0))
    .slice(0, 40);
  await pool(shows, async item => {
    const [show, availability] = await Promise.all([
      tmdb(`/tv/${item.id}`).catch(() => null),
      tmdb(`/tv/${item.id}/watch/providers`).catch(() => null),
    ]);
    const episode = show?.next_episode_to_air;
    if (!episode?.air_date || episode.air_date < today()) return;
    const providerResult = availability?.results?.[state.region] || {};
    const providers = (providerResult.flatrate || []).filter(provider => provider.logo_path)
      .filter((provider, index, list) => list.findIndex(other => other.provider_id === provider.provider_id) === index).slice(0, 5);
    const event = {
      key: `episode_${item.id}_${episode.season_number}_${episode.episode_number}`,
      category: 'episodes', id: item.id, mediaType: 'tv', title: show.name || item.title || 'TV show',
      headline: `S${episode.season_number} · E${episode.episode_number} is coming`,
      detail: episode.name || 'New episode', date: episode.air_date, airstamp: '',
      poster: episode.still_path || show.poster_path || item.doc.poster || '', posterKind: episode.still_path ? 'still' : 'poster',
      language: show.original_language || item.doc.language || '', source: 'Watched show', regionLink: providerResult.link || '',
      providers: providers.map(provider => ({ id: provider.provider_id, name: provider.provider_name, logo: provider.logo_path })),
    };
    output.push(event);
    exactJobs.push(exactEpisodeTime(show).then(exact => {
      if (!exact?.airstamp) return;
      if (new Date(exact.airstamp).getTime() <= Date.now()) event.expired = true;
      else event.airstamp = exact.airstamp;
    }));
  }, 4);
}

async function collectMovieAlerts(output, region, providerRecords) {
  const movies = state.watchlist.map(item => {
    const fallback = itemIdentity(item.id, item);
    return { ...item, tmdbId: +(item.tmdbId || fallback.id), type: item.type || fallback.type };
  }).filter(item => item.type === 'movie' && item.tmdbId).slice(0, 60);
  await pool(movies, async item => {
    const [movie, availability] = await Promise.all([
      tmdb(`/movie/${item.tmdbId}`).catch(() => null),
      tmdb(`/movie/${item.tmdbId}/watch/providers`).catch(() => null),
    ]);
    if (!movie) return;
    const releaseDate = movie.release_date || item.releaseDate || '';
    if (releaseDate && releaseDate >= today()) output.push({
      key: `release_movie_${movie.id}_${releaseDate}`, category: 'releases', id: movie.id, mediaType: 'movie',
      title: movie.title || item.title || 'Movie', headline: 'Saved movie release', detail: 'A movie in your lists is releasing',
      date: releaseDate, poster: movie.poster_path || item.poster || '', source: 'My Lists', language: movie.original_language || item.language || '',
    });
    const regionResult = availability?.results?.[region] || {};
    const providers = (regionResult.flatrate || [])
      .filter(provider => provider.logo_path)
      .filter((provider, index, list) => list.findIndex(other => other.provider_id === provider.provider_id) === index)
      .slice(0, 5);
    if (availability) providerRecords.push({ id: movie.id, type: 'movie', title: movie.title || item.title || 'Movie', poster: movie.poster_path || item.poster || '', year: (releaseDate || '').slice(0, 4), regionLink: regionResult.link || '', providers: providers.map(provider => ({ id: provider.provider_id, name: provider.provider_name, logo: provider.logo_path })) });
    if (!providers.length) return;
    const providerKey = providers.map(provider => provider.provider_id).sort((a, b) => a - b).join('-');
    const coming = !!releaseDate && releaseDate > today();
    output.push({
      key: `stream_movie_${movie.id}_${providerKey}`, category: 'streaming', id: movie.id, mediaType: 'movie',
      title: movie.title || item.title || 'Movie', headline: coming ? 'Coming to subscription streaming' : 'Now on subscription streaming',
      detail: providers.map(provider => provider.provider_name).join(', '), date: coming ? releaseDate : today(),
      poster: movie.poster_path || item.poster || '', providers: providers.map(provider => ({ id: provider.provider_id, name: provider.provider_name, logo: provider.logo_path })),
      source: 'My Lists', language: movie.original_language || item.language || '', regionLink: regionResult.link || '',
    });
  }, 4);
}

function providerChangeEvents() {
  return getProviderChanges().slice(0, 40).map(change => ({
    key: `provider_${change.key}`, category: 'provider', id: change.id, mediaType: change.type,
    title: change.title || 'Movie', headline: change.change === 'removed' ? `Left ${change.provider?.name || 'a streaming service'}` : change.change === 'added' ? `Arrived on ${change.provider?.name || 'subscription streaming'}` : `First detected on ${change.provider?.name || 'subscription streaming'}`,
    detail: change.change === 'removed' ? 'No longer detected in this region’s subscription catalog' : 'Subscription availability detected by CineVerse',
    date: new Date(change.at).toISOString().slice(0, 10), airstamp: new Date(change.at).toISOString(), poster: change.poster || '',
    providers: change.provider ? [change.provider] : [], regionLink: change.regionLink || '', source: 'Provider history', providerChange: change.change,
  }));
}

async function buildNotifications(force = false) {
  if (!state.user) return;
  if (loading) { rebuildRequested = true; return; }
  const cached = readCache();
  if (!force && cached && cached.signature === sourceSignature() && Date.now() - cached.at < CACHE_TTL) {
    events = cached.events; paintBell(); return;
  }
  loading = true;
  const request = ++generation, owner = state.user.uid, region = state.region, signature = sourceSignature(), output = [], exactJobs = [], providerRecords = [];
  try {
    await Promise.all([collectEpisodeAlerts(output, exactJobs), collectMovieAlerts(output, region, providerRecords)]);
    if (request !== generation || state.user?.uid !== owner || state.region !== region) return;
    recordProviderBatch(providerRecords, region);
    output.push(...providerChangeEvents());
    events = dedupeSort(output); saveCache(signature, owner, region); paintBell(); paintDropdown();
    Promise.allSettled(exactJobs).then(() => {
      if (request !== generation || state.user?.uid !== owner || state.region !== region) return;
      events = dedupeSort(output.filter(event => !event.expired)); saveCache(signature, owner, region); paintBell(); paintDropdown();
      if (location.pathname === '/notifications') {
        if (document.activeElement?.id === 'notificationSearch') renderNotificationResults();
        else renderInbox();
      }
    });
  } finally {
    loading = false;
    if (rebuildRequested) {
      rebuildRequested = false;
      if (state.user) setTimeout(() => buildNotifications(true).then(() => { if (location.pathname === '/notifications') renderInbox(); }), 0);
    }
  }
}

function unread(event) { return !state.notificationRead.includes(event.key); }
function eventVisible(event) { return notificationAllowed(event) && (!['streaming', 'provider'].includes(event.category) || visibleProviders(event).length); }
function paintBell() {
  const count = events.filter(eventVisible).filter(unread).length, badge = $('notificationCount'), bell = $('notificationBell');
  if (badge) { badge.hidden = !count; badge.textContent = count > 99 ? '99+' : String(count); }
  if (bell) { bell.classList.toggle('has-unread', !!count); bell.setAttribute('aria-label', count ? `Notifications, ${count} unread` : 'Notifications'); }
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

function dateLabel(event) {
  if (event.airstamp) return localEpisodeTime(event.airstamp);
  const date = new Date(`${event.date}T12:00:00`);
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function card(event) {
  const isUnread = unread(event), image = event.poster ? `${IMG}${event.posterKind === 'still' ? 'w500' : 'w342'}${event.poster}` : PH;
  const providerLogos = visibleProviders(event).map(provider => event.providerChange === 'removed'
    ? `<span class="provider-left" title="No longer detected on ${esc(provider.name)}"><img src="${IMG}w92${provider.logo}" alt="${esc(provider.name)}"></span>`
    : `<a href="${esc(providerUrl(provider.name, event.title, event.regionLink))}" target="_blank" rel="noopener" aria-label="Open ${esc(event.title)} on ${esc(provider.name)}"><img src="${IMG}w92${provider.logo}" alt="${esc(provider.name)}" title="Open in ${esc(provider.name)}"></a>`).join('');
  const exact = event.category === 'episodes' ? `<div class="notification-time${event.airstamp ? ' exact' : ''}"><span>${event.airstamp ? 'Exact local time' : 'Release date'}</span><strong>${esc(dateLabel(event))}</strong><small>${event.airstamp ? `Converted to ${esc(localTimeZone())} · <a href="https://www.tvmaze.com" target="_blank" rel="noopener">TVmaze</a>` : 'Exact time has not been announced'}</small></div>` : `<div class="notification-time"><span>${['streaming','provider'].includes(event.category) ? 'Detected' : 'Release date'}</span><strong>${esc(dateLabel(event))}</strong></div>`;
  return `<article class="notification-card${isUnread ? ' unread' : ''}" data-notification-key="${esc(event.key)}">
    <a class="notification-art${event.posterKind === 'still' ? ' landscape' : ''}" href="/${event.mediaType}/${event.id}" data-action="open-notification" data-key="${esc(event.key)}" data-id="${event.id}" data-type="${event.mediaType}"><img src="${image}" alt="${esc(event.title)}" loading="lazy" data-ph="${PH}"><i></i></a>
    <div class="notification-copy"><div class="notification-meta"><span class="category-${event.category}">${event.category}</span><b>${esc(event.source)}</b>${isUnread ? '<em>New</em>' : ''}</div><h3>${esc(event.title)}</h3><h4>${esc(event.headline)}</h4><p>${esc(event.detail)}</p>${providerLogos ? `<div class="notification-providers">${providerLogos}<span>Subscription only</span></div>` : ''}${exact}<div class="notification-actions"><a href="/${event.mediaType}/${event.id}" data-action="open-notification" data-key="${esc(event.key)}" data-id="${event.id}" data-type="${event.mediaType}">Open title</a>${isUnread ? `<button data-action="read-notification" data-key="${esc(event.key)}">Mark read</button>` : '<span>Read</span>'}</div></div>
  </article>`;
}

function visibleEvents() {
  const term = query.toLowerCase();
  return events.filter(eventVisible)
    .filter(event => (filter === 'all' || event.category === filter) && (!term || `${event.title} ${event.headline} ${event.detail}`.toLowerCase().includes(term)));
}

function resultsHTML(list) {
  return list.length ? `<div class="notification-grid">${list.map(card).join('')}</div>` : `<div class="notification-empty"><i>✓</i><h2>All quiet here</h2><p>${events.length ? 'No notifications match this view.' : 'Watch a TV show or save a movie to start your personal feed.'}</p><button class="btn-glass" data-action="show-page" data-page="discover">Explore titles</button></div>`;
}

function compactCard(event) {
  const image = event.poster ? `${IMG}${event.posterKind === 'still' ? 'w300' : 'w185'}${event.poster}` : PH;
  const provider = visibleProviders(event)[0];
  return `<a class="notification-drop-item${unread(event) ? ' unread' : ''}" href="/${event.mediaType}/${event.id}" data-action="open-notification" data-key="${esc(event.key)}" data-id="${event.id}" data-type="${event.mediaType}"><img src="${image}" alt="" loading="lazy"><span><em>${esc(event.category)}</em><strong>${esc(event.title)}</strong><small>${esc(event.headline)} · ${esc(dateLabel(event))}</small></span>${provider ? `<img class="drop-provider" src="${IMG}w92${provider.logo}" alt="${esc(provider.name)}">` : ''}</a>`;
}

export function isNotificationDropdownOpen() { return !!$('notificationDropdown')?.classList.contains('active'); }
export function closeNotificationDropdown() {
  const dropdown = $('notificationDropdown'), bell = $('notificationBell');
  dropdown?.classList.remove('active'); dropdown?.setAttribute('aria-hidden', 'true'); bell?.setAttribute('aria-expanded', 'false');
}

function paintDropdown() {
  const host = $('notificationDropdown'); if (!host) return;
  if (!state.user) {
    host.innerHTML = `<div class="notification-drop-head"><span>Premiere desk</span><strong>Notifications</strong></div><div class="notification-drop-empty"><i>✦</i><p>Sign in for episode times, releases, and streaming arrivals.</p><button data-action="open-auth">Sign in</button></div>`; return;
  }
  const list = events.filter(eventVisible)
    .sort((a, b) => Number(unread(b)) - Number(unread(a)) || Math.abs(Date.now() - eventTime(a)) - Math.abs(Date.now() - eventTime(b))).slice(0, 6);
  const count = list.filter(unread).length;
  host.innerHTML = `<div class="notification-drop-head"><span>Live collection intelligence</span><strong>Notifications <b>${count ? `${count} new` : 'caught up'}</b></strong><button data-action="close-notifications" aria-label="Close notifications">×</button></div><div class="notification-drop-feed">${list.length ? list.map(compactCard).join('') : '<div class="notification-drop-empty"><i>✓</i><p>No alerts yet. Watch a show or save a movie to begin.</p></div>'}</div><div class="notification-drop-foot"><button data-action="show-page" data-page="notifications">View full notification center</button><button data-action="open-notification-preferences">Preferences</button></div>`;
}

function toggleDropdown() {
  const host = $('notificationDropdown'), bell = $('notificationBell'); if (!host) return;
  const open = !host.classList.contains('active');
  if (open) { paintDropdown(); host.classList.add('active'); host.setAttribute('aria-hidden', 'false'); bell?.setAttribute('aria-expanded', 'true'); }
  else closeNotificationDropdown();
}

function preferenceHTML() {
  const prefs = state.notificationPreferences || {}, mutedItems = new Set(prefs.mutedItems || []), mutedProviders = new Set((prefs.mutedProviders || []).map(String));
  const watchedShows = Object.entries(state.watched).map(([key, doc]) => ({ ...itemIdentity(key, doc), mediaType: doc.type || 'tv', poster: doc.poster || '' })).filter(item => item.mediaType === 'tv' && item.id);
  const savedMovies = state.watchlist.map(item => { const id = itemIdentity(item.id, item); return { ...id, mediaType: item.type || id.type, poster: item.poster || '' }; }).filter(item => item.mediaType === 'movie' && item.id);
  const items = [...new Map([...events.filter(event => event.category !== 'provider'), ...watchedShows, ...savedMovies].map(event => [`${event.mediaType}_${event.id}`, event])).values()].slice(0, 40);
  const snapshotProviders = Object.values(state.providerHistory?.snapshots || {}).flatMap(snapshot => snapshot.providers || []);
  const providers = [...new Map([...events.flatMap(event => event.providers || []), ...snapshotProviders].map(provider => [String(provider.id), provider])).values()];
  const category = (key, label, detail) => `<label class="notification-pref-row"><span><strong>${label}</strong><small>${detail}</small></span><input type="checkbox" data-action="notification-pref-category" data-category="${key}" ${prefs[key] !== false ? 'checked' : ''}><i></i></label>`;
  return `<section class="notification-preferences"><div class="notification-pref-head"><div><span>Fine-grained controls</span><h2>Notification Preferences</h2><p>Choose the titles and subscription services allowed to reach your premiere desk.</p></div><button data-action="toggle-notification-preferences">Done</button></div><div class="notification-pref-grid">${category('episodes','New TV episodes','Upcoming episodes from shows you watched')}${category('releases','Movie releases','Release dates for saved movies')}${category('streaming','Streaming arrivals','Subscription arrivals only—never rent or buy')}${category('providerChanges','Provider changes','When saved movies appear or disappear')}</div><div class="notification-pref-section"><h3>Titles</h3><p>Tap a title to mute or restore it.</p><div class="notification-pref-chips">${items.length ? items.map(item => { const value = `${item.mediaType}_${item.id}`, muted = mutedItems.has(value); return `<button class="${muted ? 'muted' : ''}" data-action="notification-pref-item" data-value="${value}"><img src="${item.poster ? `${IMG}w92${item.poster}` : PH}" alt=""><span>${esc(item.title)}</span><b>${muted ? 'Muted' : 'On'}</b></button>`; }).join('') : '<small>Your watched shows and saved movies will appear here.</small>'}</div></div><div class="notification-pref-section"><h3>Streaming services</h3><p>Only subscription providers detected in your selected region are shown.</p><div class="notification-provider-prefs">${providers.length ? providers.map(provider => { const muted = mutedProviders.has(String(provider.id)); return `<button class="${muted ? 'muted' : ''}" data-action="notification-pref-provider" data-value="${provider.id}"><img src="${IMG}w92${provider.logo}" alt=""><span>${esc(provider.name)}</span><b>${muted ? 'Muted' : 'On'}</b></button>`; }).join('') : '<small>Providers appear after your first availability scan.</small>'}</div></div><button class="notification-pref-reset" data-action="reset-notification-preferences">Restore recommended defaults</button></section>`;
}

function providerHistoryHTML() {
  const changes = getProviderChanges().slice(0, 16); if (!changes.length) return '';
  return `<section class="provider-history"><div class="provider-history-head"><div><span>Subscription timeline</span><h2>Provider Change History</h2><p>First detected dates from CineVerse scans—not rental or purchase offers.</p></div><b>${esc(state.region)}</b></div><div class="provider-history-list">${changes.map(change => `<article><i class="${change.change}"></i><img src="${change.poster ? `${IMG}w185${change.poster}` : PH}" alt=""><span><small>${new Date(change.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</small><strong>${esc(change.title)}</strong><em>${change.change === 'removed' ? 'Left' : change.change === 'added' ? 'Appeared on' : 'First detected on'} ${esc(change.provider?.name || 'streaming')}</em></span>${change.change !== 'removed' && change.provider ? `<a href="${esc(providerUrl(change.provider.name, change.title, change.regionLink))}" target="_blank" rel="noopener"><img src="${IMG}w92${change.provider.logo}" alt="${esc(change.provider.name)}">Open</a>` : ''}</article>`).join('')}</div></section>`;
}

function renderNotificationResults() {
  const host = $('notificationResults');
  if (host) host.innerHTML = resultsHTML(visibleEvents());
}

function renderInbox() {
  const host = $('notificationsContent'); if (!host) return;
  if (!state.user) {
    host.innerHTML = `<div class="notification-auth"><i>✦</i><h2>Your personal premiere desk</h2><p>Sign in to see episode drops, saved movie releases, and subscription-streaming arrivals.</p><button class="btn-primary" data-action="open-auth">Sign in</button></div>`; return;
  }
  const allowed = events.filter(eventVisible), list = visibleEvents(), unreadCount = allowed.filter(unread).length;
  const counts = { episodes: allowed.filter(item => item.category === 'episodes').length, releases: allowed.filter(item => item.category === 'releases').length, streaming: allowed.filter(item => item.category === 'streaming').length, provider: allowed.filter(item => item.category === 'provider').length };
  host.innerHTML = `<section class="notifications-hero"><div><span>Personal premiere desk</span><h1>Notifications</h1><p>Upcoming episodes from watched shows, saved movie releases, and subscription-streaming availability—without rental noise.</p><div class="notification-hero-meta"><b>${unreadCount} unread</b><span>Times in ${esc(localTimeZone())}</span><span>${esc(state.region)} streaming region</span></div></div><div class="notification-radar" aria-hidden="true"><i></i><b>${events.length}</b><span>live signals</span></div></section>
    <section class="notification-toolbar"><div class="notification-tabs">${[['all','All',allowed.length],['episodes','Episodes',counts.episodes],['releases','Releases',counts.releases],['streaming','Streaming',counts.streaming],['provider','History',counts.provider]].map(([value,label,count]) => `<button class="${filter === value ? 'active' : ''}" data-action="notification-filter" data-filter="${value}">${label}<b>${count}</b></button>`).join('')}</div><div class="notification-tools"><label><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><input id="notificationSearch" value="${esc(query)}" placeholder="Search notifications"></label><button data-action="toggle-notification-preferences">Preferences</button><button data-action="refresh-notifications">Refresh</button><button data-action="read-all-notifications" ${unreadCount ? '' : 'disabled'}>Mark all read</button></div></section>
    <div class="notification-trust"><span>Live collection intelligence</span><p>Streaming alerts use subscription providers only. Availability is checked when this page refreshes because free catalog data does not publish every future provider start time. Availability by <a href="https://www.justwatch.com" target="_blank" rel="noopener">JustWatch</a>.</p></div>
    ${preferencesOpen ? preferenceHTML() : ''}<div id="notificationResults">${resultsHTML(list)}</div>${providerHistoryHTML()}`;
  const input = $('notificationSearch'); if (input) input.addEventListener('input', debounce(function () { query = this.value.trim(); renderNotificationResults(); }, 180));
}

export async function renderNotifications(force = false) {
  const host = $('notificationsContent'); if (!host) return;
  const cached = readCache();
  if (cached?.events) { events = cached.events; paintBell(); }
  if (!state.user) return renderInbox();
  if (!events.length || force || !cached || cached.signature !== sourceSignature() || Date.now() - cached.at >= CACHE_TTL) {
    host.innerHTML = '<div class="notification-loading"><span>Scanning your universe</span><div></div><div></div><div></div></div>';
    await buildNotifications(force);
  }
  renderInbox();
}

export function initNotifications() {
  registerActions({
    'toggle-notifications': () => toggleDropdown(),
    'close-notifications': () => closeNotificationDropdown(),
    'open-notification-preferences': () => { preferencesOpen = true; closeNotificationDropdown(); document.dispatchEvent(new CustomEvent('cv:go', { detail: '/notifications' })); },
    'toggle-notification-preferences': () => { preferencesOpen = !preferencesOpen; renderInbox(); },
    'notification-pref-category': element => { setNotificationCategory(element.dataset.category, element.checked); renderInbox(); paintDropdown(); },
    'notification-pref-item': element => { toggleNotificationItem(element.dataset.value); renderInbox(); paintDropdown(); },
    'notification-pref-provider': element => { toggleNotificationProvider(element.dataset.value); renderInbox(); paintDropdown(); },
    'reset-notification-preferences': () => { resetNotificationPrefs(); renderInbox(); paintDropdown(); toast('Notification preferences restored', 'success'); },
    'notification-filter': element => { filter = element.dataset.filter || 'all'; renderInbox(); },
    'read-notification': element => { mark([element.dataset.key]); renderInbox(); paintDropdown(); toast('Marked as read', 'success'); },
    'read-all-notifications': () => { mark(events.filter(eventVisible).map(event => event.key)); renderInbox(); paintDropdown(); toast('All notifications read', 'success'); },
    'refresh-notifications': async element => { element.disabled = true; await renderNotifications(true); toast('Notifications refreshed', 'success'); },
    'open-notification': element => { mark([element.dataset.key]); document.dispatchEvent(new CustomEvent('cv:go', { detail: `/${element.dataset.type}/${element.dataset.id}` })); },
  });
  document.addEventListener('click', event => { if (isNotificationDropdownOpen() && !event.target.closest('.notification-menu-wrap')) closeNotificationDropdown(); });
  document.addEventListener('cv:notification-prefs', () => { paintBell(); paintDropdown(); if (location.pathname === '/notifications') renderInbox(); });
  document.addEventListener('cv:auth', () => {
    clearTimeout(readSyncTimer); readSyncTimer = null;
    generation++;
    const local = (() => { try { return JSON.parse(localStorage.getItem(`cv_notification_read_${uid()}`) || '[]'); } catch (_) { return []; } })();
    state.notificationRead = [...new Set([...(state.notificationRead || []), ...(Array.isArray(local) ? local : [])])].slice(-400);
    const cached = readCache(); events = cached?.events || []; paintBell(); paintDropdown();
    if (state.user) buildNotifications(false).then(() => { if (location.pathname === '/notifications') renderInbox(); });
  });
  document.addEventListener('cv:wl-changed', () => {
    generation++;
    if (location.pathname === '/notifications') renderNotifications(true);
    else setTimeout(() => buildNotifications(true), 900);
  });
  document.addEventListener('cv:region', () => { generation++; events = []; paintBell(); paintDropdown(); if (state.user) buildNotifications(true).then(() => { if (location.pathname === '/notifications') renderInbox(); }); });
}
