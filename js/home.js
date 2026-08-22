// ===== HOME SECTIONS (+ personalization) =====
import { tmdb, pool } from './api.js';
import { $, esc, debounce } from './ui.js';
import { buildCard, skelCards } from './cards.js';
import { observeReveals } from './effects.js';
import { registerActions } from './events.js';
import { renderRecommendations } from './recommend.js';
import { getStreamingArrivals } from './provider-history.js';
import { resumeQueue, episodeStats } from './episodes.js';
import { applyContinuePrefs, togglePinned, toggleHidden, moveContinue, isPinned, isHidden, resetContinuePrefs, hasContinueEdits } from './continue-prefs.js';
import { franchiseSummary, toggleFranchiseDismissed, restoreAllFranchises } from './franchise.js';
import { IMG, PH, providerUrl, regionLabel } from './config.js';
import { state } from './state.js';

// Re-exported so router.js (cv:auth / cv:wl-changed) and initHome can refresh the
// personalized rows. The advanced logic lives in recommend.js.
export function renderPersonalRows() { return renderRecommendations(); }

// ===== CONTINUE WATCHING =====
// Built entirely from the local progress documents, so the rail paints on the
// first frame with no network round-trip. The episode still and title are then
// filled in asynchronously — a missing image never delays the rail, and a failed
// lookup just leaves the poster in place.
// Edit mode is per page-load, not stored: it is a thing you are doing, not a
// setting. The pins and hides it produces are what persist.
let continueEditing = false;

export function renderContinueWatching() {
  const host = $('continueWatchingRow'); if (!host) return;
  // Pull deeper than the rail shows, so hidden shows do not eat visible slots.
  const all = state.user ? applyContinuePrefs(resumeQueue(50)) : [];
  const queue = all.slice(0, 12);
  // While editing, keep the section up even if everything has been hidden —
  // otherwise the control to unhide disappears with the last card.
  if (!queue.length && !continueEditing) { host.innerHTML = ''; continueEditing = false; return; }
  if (!state.user) { host.innerHTML = ''; return; }

  const hiddenCount = resumeQueue(50).length - all.length;
  host.innerHTML = `<section class="section reveal continue-section${continueEditing ? ' editing' : ''}">
    <div class="section-head"><div><span class="continue-eyebrow">Pick up where you left off</span><h2 class="section-title"><span>▶</span> Continue Watching</h2><p>${continueEditing
      ? 'Pin a show to keep it at the front, or hide one you have stopped watching. Hiding never touches your episode progress.'
      : `Your next unwatched episode across ${queue.length} show${queue.length === 1 ? '' : 's'}.${hiddenCount ? ` ${hiddenCount} hidden.` : ''}`}</p></div>
      <div class="continue-tools">
        ${continueEditing && hasContinueEdits() ? '<button class="continue-tool" data-action="continue-reset">Reset all</button>' : ''}
        <button class="continue-tool${continueEditing ? ' on' : ''}" data-action="continue-edit" aria-pressed="${continueEditing}">${continueEditing ? 'Done' : 'Edit'}</button>
      </div>
    </div>
    ${continueEditing ? '' : recordChaseHTML()}
    <div class="row continue-row">${queue.map((row, index) => continueCard(row, index, queue.length)).join('')}${continueEditing ? hiddenCardsHTML() : ''}</div>
  </section>`;
  observeReveals();
  requestAnimationFrame(() => host.querySelectorAll('.continue-bar i').forEach(bar => { bar.style.width = `${+bar.dataset.w || 0}%`; }));
  hydrateContinueStills(queue);
}

// The one line worth interrupting for: you are one or two episodes from your own
// best day. Counted in single ticks only, like the record itself — a personal
// best you could set by pressing "mark season watched" would be worth nothing.
function recordChaseHTML() {
  const chase = episodeStats({ months: 1 }).recordChase;
  if (!chase) return '';
  return `<div class="continue-chase" role="status">
    <span class="continue-chase-mark" aria-hidden="true">&#9889;</span>
    <span><b>${chase.needed === 1 ? 'One more episode' : `${chase.needed} more episodes`}</b> and today beats your best day of ${chase.record}. You are on ${chase.todaySolo}.</span>
  </div>`;
}

// Hidden shows are only listed while editing — visible enough to bring back,
// invisible the rest of the time, which is the point of hiding them.
function hiddenCardsHTML() {
  const hidden = resumeQueue(50).filter(row => isHidden(row.id));
  if (!hidden.length) return '';
  return hidden.map(row => `<article class="continue-card hidden-card">
    <div class="continue-art muted"><img src="${row.entry.poster ? `${IMG}w342${row.entry.poster}` : PH}" alt="" loading="lazy"></div>
    <div class="continue-body">
      <h3>${esc(row.entry.title || 'TV show')}</h3>
      <p class="continue-next">Hidden from this rail</p>
      <button class="continue-mark" data-action="continue-hide" data-tid="${row.id}">Show again</button>
    </div>
  </article>`).join('');
}

function continueCard({ id, entry, progress, next }, index = 0, total = 1) {
  const art = entry.backdrop ? `${IMG}w500${entry.backdrop}` : entry.poster ? `${IMG}w342${entry.poster}` : PH;
  const meta = esc(JSON.stringify({ title: entry.title, poster: entry.poster, backdrop: entry.backdrop, episodeRuntime: entry.episodeRuntime, structure: entry.structure, aired: entry.aired, status: entry.status }));
  return `<article class="continue-card" data-continue="${id}">
    <a class="continue-art" href="/tv/${id}" data-action="open-detail" data-id="${id}" data-type="tv" aria-label="Open ${esc(entry.title || 'show')}">
      <img src="${art}" alt="" loading="lazy" data-ph="${PH}">
      <span class="continue-play" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
      <span class="continue-badge">S${next.season} E${next.episode}</span>
    </a>
    <div class="continue-body">
      <h3>${esc(entry.title || 'TV show')}</h3>
      <p class="continue-next" data-continue-title="${id}">Episode ${next.episode}</p>
      <div class="continue-bar"><i style="width:0" data-w="${progress.percent}"></i></div>
      <div class="continue-meta"><span>${progress.watched}/${progress.aired} watched</span><b>${progress.percent}%</b></div>
      <button class="continue-mark" data-action="ep-toggle" data-tid="${id}" data-sn="${next.season}" data-en="${next.episode}" data-meta="${meta}" data-from="rail">Mark watched</button>
      ${continueEditing ? `<div class="continue-edit-bar">
        <button class="ce-btn" data-action="continue-move" data-tid="${id}" data-dir="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move ${esc(entry.title || 'show')} earlier">&#8592;</button>
        <button class="ce-btn${isPinned(id) ? ' on' : ''}" data-action="continue-pin" data-tid="${id}" aria-pressed="${isPinned(id)}" aria-label="${isPinned(id) ? 'Unpin' : 'Pin'} ${esc(entry.title || 'show')}">${isPinned(id) ? '&#9733; Pinned' : '&#9734; Pin'}</button>
        <button class="ce-btn" data-action="continue-hide" data-tid="${id}" aria-label="Hide ${esc(entry.title || 'show')}">Hide</button>
        <button class="ce-btn" data-action="continue-move" data-tid="${id}" data-dir="1" ${index === total - 1 ? 'disabled' : ''} aria-label="Move ${esc(entry.title || 'show')} later">&#8594;</button>
      </div>` : ''}
    </div>
  </article>`;
}

// One request per show, and only for the six most recent — enough to fill what
// is visible without turning the home page into a burst of API calls.
async function hydrateContinueStills(queue) {
  await pool(queue.slice(0, 6), async row => {
    const season = await tmdb(`/tv/${row.id}/season/${row.next.season}`).catch(() => null);
    const episode = (season?.episodes || []).find(item => item.episode_number === row.next.episode);
    if (!episode) return;
    const card = document.querySelector(`.continue-card[data-continue="${row.id}"]`);
    if (!card) return;
    const label = card.querySelector(`[data-continue-title="${row.id}"]`);
    if (label && episode.name) label.textContent = episode.name;
    if (episode.still_path) {
      const image = card.querySelector('.continue-art img');
      if (image) image.src = `${IMG}w500${episode.still_path}`;
    }
  }, 3);
}

export function renderStreamingArrivals() {
  const host = $('streamingArrivalRows'); if (!host) return;
  const arrivals = state.user ? getStreamingArrivals(18) : [];
  if (!arrivals.length) { host.innerHTML = ''; return; }
  host.innerHTML = `<section class="section reveal streaming-arrival-section"><div class="section-head"><div><span class="arrival-eyebrow">Subscription intelligence · ${esc(regionLabel(state.region))}</span><h2 class="section-title"><span>✦</span> Streaming Arrival Spotlight</h2><p>Newly detected on services you can stream with a subscription.</p></div><button class="section-see-all" data-action="show-page" data-page="notifications">View history<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg></button></div><div class="row arrival-row">${arrivals.map(change => `<div class="arrival-card">${buildCard({ id: change.id, title: change.title, name: change.title, poster_path: change.poster, release_date: change.year ? `${change.year}-01-01` : '', media_type: change.type }, change.type)}<a class="arrival-provider" href="${esc(providerUrl(change.provider?.name, change.title, change.regionLink))}" target="_blank" rel="noopener"><img src="${IMG}w92${change.provider?.logo}" alt="${esc(change.provider?.name || '')}"><span><small>${change.change === 'first_seen' ? 'First detected on' : 'Just arrived on'}</small><strong>${esc(change.provider?.name || 'Streaming')}</strong></span><i>↗</i></a></div>`).join('')}</div></section>`;
  observeReveals();
}

// ===== FINISH THE FRANCHISE =====
// A series you are one film from completing is a better recommendation than
// anything the scorer can produce: the interest is already proven and the gap is
// a fact, not an inference. Ranked by how close to done each one is, so the top
// of the rail is always the most finishable thing in the library.
//
// Everything it needs comes from `collectionId` stamped on watched documents plus
// a cached collection lookup, so a repeat visit costs no requests at all.
export async function renderFranchiseRail() {
  const host = $('franchiseRow');
  if (!host) return;
  if (!state.user) { host.innerHTML = ''; return; }
  let summary;
  try { summary = await franchiseSummary({ limit: 10 }); }
  catch (_) { host.innerHTML = ''; return; }
  if (!$('franchiseRow')) return;

  // Only series with something left, and only the actual next film — listing a
  // whole collection you have half-seen is the collection page's job.
  const rows = summary.inProgress.filter(item => item.nextUp).slice(0, 12);
  if (!rows.length) { host.innerHTML = ''; return; }

  const almost = rows.filter(item => item.unseen.length === 1).length;
  const lede = almost
    ? `${almost} ${almost === 1 ? 'series is' : 'series are'} one film from complete.`
    : `Carry on with ${rows.length} film series you have already started.`;

  host.innerHTML = `<section class="section reveal franchise-section">
    <div class="section-head"><div>
      <span class="franchise-eyebrow">From your own collection</span>
      <h2 class="section-title"><span>&#9678;</span> Finish the Franchise</h2>
      <p>${esc(lede)}</p>
    </div><button class="section-see-all" data-action="show-page" data-page="franchises">All franchises<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg></button></div>
    <div class="row franchise-row">${rows.map(franchiseCard).join('')}</div>
  </section>`;
  observeReveals();
  requestAnimationFrame(() => host.querySelectorAll('.fr-card-bar i').forEach(bar => { bar.style.width = `${+bar.dataset.w || 0}%`; }));
}

function franchiseCard(item) {
  const next = item.nextUp;
  const left = item.unseen.length;
  const art = next.poster ? `${IMG}w342${next.poster}` : item.poster ? `${IMG}w342${item.poster}` : PH;
  return `<article class="fr-card${left === 1 ? ' almost' : ''}">
    <a class="fr-card-art" href="/movie/${next.id}" data-action="open-detail" data-id="${next.id}" data-type="movie" aria-label="Open ${esc(next.title)}">
      <img src="${art}" alt="" loading="lazy" data-ph="${PH}">
      <span class="fr-card-flag">${left === 1 ? 'Last one' : `${left} left`}</span>
    </a>
    <button class="fr-card-dismiss" data-action="franchise-dismiss" data-cid="${item.id}" aria-label="Stop suggesting ${esc(item.name)}" data-tip="Not interested in this series">&#10005;</button>
    <div class="fr-card-body">
      <a class="fr-card-series" href="/collection/${item.id}" data-action="go-collection" data-cid="${item.id}">${esc(item.name)}</a>
      <h3>${esc(next.title)}</h3>
      <div class="fr-card-bar"><i style="width:0" data-w="${Math.round(item.percent)}"></i></div>
      <div class="fr-card-meta"><span>${item.seen} of ${item.released} seen</span><b>${Math.round(item.percent)}%</b></div>
    </div>
  </article>`;
}

// Build a row's cards from a TMDB result set, honoring t10 / wide / person / multi.
function cardsFor(s, results) {
  const items = results.slice(0, s.t10 ? 10 : 20).filter(x => s.type === 'person' ? x.profile_path : x.poster_path);
  return items.map((item, i) => {
    const t = s.type === 'multi' ? (item.media_type || 'movie') : s.type;
    return s.t10 ? buildCard(item, t, { t10: true, rank: i + 1 }) : s.wide ? buildCard(item, t, { wide: true }) : buildCard(item, t);
  }).join('');
}

export function initHomeActions() {
  registerActions({
    'retry-row': async (el) => {
      const target = $(el.dataset.target); if (!target) return;
      target.innerHTML = skelCards(8);
      let params = {}; try { params = el.dataset.params ? JSON.parse(el.dataset.params) : {}; } catch (_) {}
      const s = { t10: el.dataset.t10 === 'true', wide: el.dataset.wide === 'true', type: el.dataset.type };
      try {
        const d = await tmdb(el.dataset.path, params);
        target.innerHTML = cardsFor(s, d.results || []);
      } catch (e) { target.innerHTML = rowError(el.dataset.path, el.dataset.target, s, params); }
    },
  });
  document.addEventListener('cv:provider-history', renderStreamingArrivals);
  document.addEventListener('cv:auth', renderStreamingArrivals);
  document.addEventListener('cv:region', renderStreamingArrivals);
  document.addEventListener('cv:auth', renderContinueWatching);
  // A tick anywhere — the rail's own button or the detail page — re-orders the
  // queue, so the rail always rebuilds rather than trying to patch itself.
  document.addEventListener('cv:episode-progress', renderContinueWatching);
  registerActions({
    'continue-edit': () => { continueEditing = !continueEditing; renderContinueWatching(); },
    'continue-pin': (el) => { togglePinned(+el.dataset.tid); renderContinueWatching(); },
    'continue-hide': (el) => { toggleHidden(+el.dataset.tid); renderContinueWatching(); },
    'continue-move': (el) => {
      const visible = [...document.querySelectorAll('.continue-row .continue-card[data-continue]')].map(node => +node.dataset.continue);
      if (moveContinue(+el.dataset.tid, +el.dataset.dir, visible)) renderContinueWatching();
    },
    'continue-reset': () => { resetContinuePrefs(); renderContinueWatching(); },
    'franchise-dismiss': (el, e) => {
      if (e) e.stopPropagation();
      toggleFranchiseDismissed(+el.dataset.cid);
      renderFranchiseRail();
    },
    'franchise-restore-all': () => { restoreAllFranchises(); renderFranchiseRail(); },
  });
  document.addEventListener('cv:auth', renderFranchiseRail);
  // Marking a film watched can finish a series or shorten the gap in one, so the
  // rail rebuilds on any library change. Collection lookups are cached, so a
  // rebuild is usually free.
  document.addEventListener('cv:wl-changed', debouncedFranchiseRail);
  document.addEventListener('cv:meta-backfilled', debouncedFranchiseRail);
}

// A burst of list edits (a CSV import, a season marked watched) fires many
// changes; the rail only needs to settle once.
const debouncedFranchiseRail = debounce(() => renderFranchiseRail(), 700);

// Genre ids: 16 Animation, 27 Horror, 35 Comedy, 878 Sci-Fi, 10751 Family.
// Exported so the curated collection page (js/collection.js) can re-run the exact
// same endpoint + params behind a row's "See all".
export const SECTIONS = [
  { id: 'pop_movies', t: 'Popular Movies', p: '/movie/popular', type: 'movie', icon: '🎬', page: 'movies' },
  { id: 'top10', t: 'Top 10 This Week', p: '/trending/movie/week', type: 'movie', t10: true, icon: '🔥', page: 'movies' },
  { id: 'pop_tv', t: 'Popular TV Shows', p: '/tv/popular', type: 'tv', icon: '📺', page: 'tv' },
  { id: 'acclaimed', t: 'Critically Acclaimed', p: '/discover/movie', params: { sort_by: 'vote_average.desc', 'vote_count.gte': 3000 }, type: 'movie', icon: '🏆', page: 'movies' },
  { id: 'now_playing', t: 'Now Playing', p: '/movie/now_playing', type: 'movie', icon: '🎞️', page: 'movies' },
  { id: 'trending_people', t: 'Trending People', p: '/trending/person/week', type: 'person', icon: '🎭' },
  { id: 'gems', t: 'Hidden Gems', p: '/discover/movie', params: { sort_by: 'vote_average.desc', 'vote_average.gte': 7.2, 'vote_count.gte': 200, 'vote_count.lte': 1500 }, type: 'movie', icon: '💎', page: 'movies' },
  { id: 'upcoming', t: 'Upcoming Movies', p: '/movie/upcoming', type: 'movie', icon: '🗓️', page: 'movies' },
  { id: 'horror', t: 'Spine-Chilling Horror', p: '/discover/movie', params: { with_genres: '27', sort_by: 'popularity.desc', 'vote_count.gte': 150 }, type: 'movie', icon: '😱', page: 'movies' },
  { id: 'comedy', t: 'Laugh Out Loud', p: '/discover/movie', params: { with_genres: '35', sort_by: 'popularity.desc', 'vote_count.gte': 150 }, type: 'movie', icon: '😂', page: 'movies' },
  { id: 'top_rated', t: 'Top Rated Movies', p: '/movie/top_rated', type: 'movie', icon: '⭐', page: 'movies' },
  { id: 'animation', t: 'Animated Favorites', p: '/discover/movie', params: { with_genres: '16', sort_by: 'popularity.desc', 'vote_count.gte': 200 }, type: 'movie', icon: '🎨', page: 'movies' },
  { id: 'airing', t: 'Airing Today', p: '/tv/airing_today', type: 'tv', icon: '📡', page: 'tv' },
  { id: 'world', t: 'World Cinema', p: '/discover/movie', params: { with_original_language: 'ko', sort_by: 'popularity.desc', 'vote_count.gte': 100 }, type: 'movie', icon: '🌏', page: 'movies' },
  { id: 'top_tv', t: 'Top Rated TV', p: '/tv/top_rated', type: 'tv', icon: '🏆', page: 'tv' },
  { id: 'trending_all', t: 'Trending This Week', p: '/trending/all/week', type: 'multi', wide: true, icon: '📈', page: 'movies' },
];

function rowError(path, target, s, params) {
  return `<div class="row-error">Couldn't load this row.<button data-action="retry-row" data-path="${path}" data-target="${target}" data-t10="${!!s.t10}" data-wide="${!!s.wide}" data-type="${s.type}" data-params='${JSON.stringify(params || {})}'>Retry</button></div>`;
}

function sectionShell(s, w = 155) {
  // See All now opens the EXACT curated set (same endpoint + params), not a coarse
  // /movies page — so every row, including person rows, gets one.
  const seeAll = `<a class="section-see-all" href="/collection/${s.id}" data-action="see-all" data-id="${s.id}">See All<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg></a>`;
  return `<div class="section reveal"><div class="section-head"><h2 class="section-title"><span>${s.icon}</span> ${s.t}</h2>${seeAll}</div><div class="row" id="row_${s.id}">${skelCards(8, w)}</div></div>`;
}

export async function initHome() {
  let html = '';
  SECTIONS.forEach(s => { html += sectionShell(s); });
  $('homeRows').innerHTML = html;
  observeReveals();
  // Personalized rails belong on Home; Profile contains the private explanation
  // of their signals and scoring instead of duplicating the same cards there.
  renderRecommendations();
  renderContinueWatching();
  renderFranchiseRail();
  renderStreamingArrivals();

  await Promise.allSettled(SECTIONS.map(async s => {
    const el = $('row_' + s.id);
    try {
      const d = await tmdb(s.p, s.params || {});
      if (el) el.innerHTML = cardsFor(s, d.results || []);
    } catch (e) {
      if (el) el.innerHTML = rowError(s.p, el.id, s, s.params || {});
    }
  }));
}
