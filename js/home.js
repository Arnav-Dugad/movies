// ===== HOME SECTIONS (+ personalization) =====
import { tmdb, pool } from './api.js';
import { $, esc, debounce } from './ui.js';
import { buildCard, skelCards } from './cards.js';
import { observeReveals } from './effects.js';
import { registerActions } from './events.js';
import { renderRecommendations } from './recommend.js';
import { resumeQueue, episodeLabel } from './episodes.js';
import { movieResumeQueue, formatMovieTime } from './movie-progress.js';
import { applyContinuePrefs, togglePinned, toggleHidden, moveContinue, isPinned, isHidden, resetContinuePrefs, hasContinueEdits } from './continue-prefs.js';
import { franchiseSummary, toggleFranchiseDismissed, restoreAllFranchises } from './franchise.js';
import { IMG, PH } from './config.js';
import { state } from './state.js';
import { grossingMoviesPage, formatGross, formatIndianGross, getUsdInrRate, isIndianProduction } from './box-office.js';

// Re-exported so router.js (cv:auth / cv:wl-changed) and initHome can refresh the
// personalized rows. The advanced logic lives in recommend.js.
export function renderPersonalRows() { return renderRecommendations(); }

// ===== ALL-TIME BOX OFFICE =====
export async function renderBoxOfficeRail() {
  const host = $('boxOfficeRow'); if (!host) return;
  host.innerHTML = `<section class="section reveal home-boxoffice"><div class="section-head"><div><span class="boxoffice-eyebrow">Worldwide theatrical revenue</span><h2 class="section-title"><span>$</span> Highest Grossing Movies Ever</h2><p>The biggest reported worldwide box-office totals, ranked by money earned.</p></div><a class="section-see-all" href="/box-office" data-action="show-page" data-page="box-office">Full chart<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg></a></div><div class="row boxoffice-home-row">${skelCards(8, 210)}</div></section>`;
  try {
    const data = await grossingMoviesPage(1);
    if (!$('boxOfficeRow')) return;
    const rows = data.rows.slice(0, 12);
    const usdInrRate = rows.some(isIndianProduction) ? await getUsdInrRate() : 90;
    host.querySelector('.boxoffice-home-row').innerHTML = rows.map((movie, index) => {
      const gross = isIndianProduction(movie) ? formatIndianGross(movie.revenue, { compact: true, rate: usdInrRate }) : formatGross(movie.revenue, { compact: true });
      return `<a class="bo-home-card" href="/movie/${movie.id}" data-action="open-detail" data-id="${movie.id}" data-type="movie" aria-label="Number ${index + 1}, ${esc(movie.title)}, ${esc(gross)} worldwide">
      <img src="${movie.backdrop_path ? `${IMG}w500${movie.backdrop_path}` : movie.poster_path ? `${IMG}w342${movie.poster_path}` : PH}" alt="" loading="lazy">
      <span class="bo-home-scrim"></span><b class="bo-home-rank">${String(index + 1).padStart(2, '0')}</b>
      <span class="bo-home-copy"><small>${esc((movie.release_date || '').slice(0, 4))} · Worldwide gross</small><strong>${esc(movie.title)}</strong><em>${esc(gross)}</em></span>
    </a>`;
    }).join('');
    observeReveals(host);
  } catch (_) { host.innerHTML = ''; }
}

// ===== CONTINUE WATCHING =====
// Built entirely from the local progress documents, so the rail paints on the
// first frame with no network round-trip. The episode still and title are then
// filled in asynchronously — a missing image never delays the rail, and a failed
// lookup just leaves the poster in place.
// Edit mode is per page-load, not stored: it is a thing you are doing, not a
// setting. The pins and hides it produces are what persist.
let continueEditing = false;

function continueQueue() {
  const shows = resumeQueue(500).map(row => ({ ...row, type: 'tv', key: row.key || `tv_${row.id}`, lastAt: row.entry.lastWatched?.at || 0 }));
  return [...shows, ...movieResumeQueue(500)].sort((a, b) => b.lastAt - a.lastAt);
}

export function renderContinueWatching() {
  const host = $('continueWatchingRow'); if (!host) return;
  // Every show in progress, not an arbitrary first dozen. The rail is a
  // horizontal scroller with lazy images, so length costs almost nothing, and a
  // show cut off at position 13 is a show you never get back to.
  const source = state.user ? continueQueue() : [];
  const all = state.user ? applyContinuePrefs(source) : [];
  const queue = all;
  // While editing, keep the section up even if everything has been hidden —
  // otherwise the control to unhide disappears with the last card.
  if (!queue.length && !continueEditing) { host.innerHTML = ''; continueEditing = false; return; }
  if (!state.user) { host.innerHTML = ''; return; }

  const hiddenCount = source.length - all.length;
  host.innerHTML = `<section class="section reveal continue-section${continueEditing ? ' editing' : ''}">
    <div class="section-head"><div><span class="continue-eyebrow">Pick up where you left off</span><h2 class="section-title"><span>▶</span> Continue Watching</h2><p>${continueEditing
      ? 'Pin, reorder, or hide titles.'
      : `${queue.length} title${queue.length === 1 ? '' : 's'}${hiddenCount ? ` · ${hiddenCount} hidden` : ''}`}</p></div>
      <div class="continue-tools">
        ${continueEditing && hasContinueEdits() ? '<button class="continue-tool" data-action="continue-reset">Reset all</button>' : ''}
        <button class="continue-tool${continueEditing ? ' on' : ''}" data-action="continue-edit" aria-pressed="${continueEditing}">${continueEditing ? 'Done' : 'Edit'}</button>
      </div>
    </div>
    <div class="row continue-row">${queue.map((row, index) => continueCard(row, index, queue.length)).join('')}${continueEditing ? hiddenCardsHTML() : ''}</div>
  </section>`;
  observeReveals();
  requestAnimationFrame(() => host.querySelectorAll('.continue-bar i').forEach(bar => { bar.style.width = `${+bar.dataset.w || 0}%`; }));
  stillsDone.clear();
  hydrateContinueStills(queue);
  watchContinueScroll(queue);
}

// Hidden shows are only listed while editing — visible enough to bring back,
// invisible the rest of the time, which is the point of hiding them.
function hiddenCardsHTML() {
  const hidden = continueQueue().filter(row => isHidden(row.key));
  if (!hidden.length) return '';
  return hidden.map(row => `<article class="continue-card hidden-card">
    <div class="continue-art muted"><img src="${row.entry.poster ? `${IMG}w342${row.entry.poster}` : PH}" alt="" loading="lazy"></div>
    <div class="continue-body">
      <h3>${esc(row.entry.title || (row.type === 'movie' ? 'Movie' : 'TV show'))}</h3>
      <p class="continue-next">Hidden from this rail</p>
      <button class="continue-restore" data-action="continue-hide" data-key="${row.key}">Show again</button>
    </div>
  </article>`).join('');
}

function continueCard(row, index = 0, total = 1) {
  const { id, entry, progress, next, type, key } = row;
  const art = entry.backdrop ? `${IMG}w500${entry.backdrop}` : entry.poster ? `${IMG}w342${entry.poster}` : PH;
  const isMovie = type === 'movie';
  const meta = isMovie ? '' : esc(JSON.stringify({ title: entry.title, poster: entry.poster, backdrop: entry.backdrop, episodeRuntime: entry.episodeRuntime, structure: entry.structure, aired: entry.aired, status: entry.status, numberingMode: entry.numberingMode, episodeModelV: entry.episodeModelV }));
  const title = esc(entry.title || (isMovie ? 'Movie' : 'TV show'));
  const left = isMovie ? Math.max(0, row.left || 0) : Math.max(0, progress.aired - progress.watched);
  const nextCompact = isMovie ? (entry.position ? `Resume ${formatMovieTime(entry.position)}` : 'Continue movie') : episodeLabel(entry, next, { compact: true });
  const metaLine = isMovie
    ? `<span>${entry.position ? `Stopped at ${formatMovieTime(entry.position)}` : 'Watching'}</span><b>${progress.percent}%</b>`
    : `<span>${progress.watched} of ${progress.aired} watched</span><b>${progress.percent}%</b>`;
  const leftLabel = isMovie ? (entry.runtime ? `${formatMovieTime(left, { compact: true })} left` : 'In progress') : `${left} left`;
  return `<article class="continue-card${isPinned(key) ? ' pinned' : ''}" data-continue="${key}" data-type="${type}">
    <div class="continue-art-shell"><a class="continue-art" href="/${type}/${id}" data-action="open-detail" data-id="${id}" data-type="${type}" aria-label="Open ${title}">
      <img src="${art}" alt="" loading="lazy" data-ph="${PH}">
      <span class="continue-scrim" aria-hidden="true"></span>
      <span class="continue-play" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
      <span class="continue-badge">${esc(nextCompact)}</span>
      ${isPinned(key) ? '<span class="continue-pin-mark" aria-hidden="true">&#9733;</span>' : ''}
      <span class="continue-left">${leftLabel}</span>
      <span class="continue-bar"><i style="width:0" data-w="${progress.percent}"></i></span>
    </a>
    ${continueEditing || isMovie ? '' : `<button class="continue-quick" data-action="ep-toggle" data-tid="${id}" data-sn="${next.season}" data-en="${next.episode}" data-meta="${meta}" data-from="rail" aria-label="Mark ${esc(nextCompact)} of ${title} watched" data-tip="Mark watched">${EP_CHECK_HOME}</button>`}</div>
    <div class="continue-body">
      <h3>${title}</h3>
      <p class="continue-next" data-continue-title="${key}">${esc(nextCompact)}</p>
      <div class="continue-meta">${metaLine}</div>
      ${continueEditing ? `<div class="continue-edit-bar">
        <button class="ce-btn" data-action="continue-move" data-key="${key}" data-dir="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move ${title} earlier">&#8592;</button>
        <button class="ce-btn${isPinned(key) ? ' on' : ''}" data-action="continue-pin" data-key="${key}" aria-pressed="${isPinned(key)}" aria-label="${isPinned(key) ? 'Unpin' : 'Pin'} ${title}">${isPinned(key) ? '&#9733; Pinned' : '&#9734; Pin'}</button>
        <button class="ce-btn" data-action="continue-hide" data-key="${key}" aria-label="Hide ${title}">Hide</button>
        <button class="ce-btn" data-action="continue-move" data-key="${key}" data-dir="1" ${index === total - 1 ? 'disabled' : ''} aria-label="Move ${title} later">&#8594;</button>
      </div>` : ''}
    </div>
  </article>`;
}

// One request per show, and only for what is actually on screen. The rail now
// lists every show in progress, so filling all of them up front would turn the
// home page into a burst of API calls for cards nobody has scrolled to. The
// first batch covers the visible run; the rest arrive as the rail is scrolled.
const stillsDone = new Set();

async function hydrateContinueStills(queue, from = 0, count = 8) {
  const slice = queue.filter(row => row.type === 'tv').slice(from, from + count).filter(row => !stillsDone.has(row.key));
  if (!slice.length) return;
  slice.forEach(row => stillsDone.add(row.key));
  await pool(slice, async row => {
    const season = await tmdb(`/tv/${row.id}/season/${row.next.season}`).catch(() => null);
    const episode = (season?.episodes || []).find(item => item.episode_number === row.next.episode);
    if (!episode) return;
    const card = document.querySelector(`.continue-card[data-continue="${row.key}"]`);
    if (!card) return;
    const label = card.querySelector(`[data-continue-title="${row.key}"]`);
    // Keep the season/episode prefix: the title alone loses where you are.
    if (label && episode.name) label.textContent = `${episodeLabel(row.entry, row.next, { compact: true })} · ${episode.name}`;
    if (episode.still_path) {
      const image = card.querySelector('.continue-art img');
      if (image) image.src = `${IMG}w500${episode.still_path}`;
    }
  }, 3);
}

// Fill the next batch as the rail is scrolled, so a long queue costs nothing
// until it is actually looked at.
function watchContinueScroll(queue) {
  const row = document.querySelector('.continue-row');
  if (!row || queue.length <= 8) return;
  let filled = 8;
  const onScroll = debounce(() => {
    const cards = row.querySelectorAll('.continue-card');
    if (!cards.length) return;
    const width = cards[0].getBoundingClientRect().width + 16;
    const visibleEnd = Math.ceil((row.scrollLeft + row.clientWidth) / Math.max(1, width));
    if (visibleEnd + 4 > filled) { hydrateContinueStills(queue, filled, 8); filled += 8; }
  }, 200);
  row.addEventListener('scroll', onScroll, { passive: true });
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
  try { summary = await franchiseSummary(); }
  catch (_) { host.innerHTML = ''; return; }
  if (!$('franchiseRow')) return;

  // Only series with something left, and only the actual next film — listing a
  // whole collection you have half-seen is the collection page's job.
  const rows = summary.inProgress.filter(item => item.nextUp).slice(0, 12);
  if (!rows.length) {
    host.innerHTML = `<section class="section reveal franchise-section franchise-section-empty"><div class="section-head"><div><h2 class="section-title"><span>&#9678;</span> Franchises</h2></div><button class="section-see-all" data-action="show-page" data-page="franchises">Open<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg></button></div></section>`;
    return;
  }

  const almost = rows.filter(item => item.unseen.length === 1).length;
  const lede = almost
    ? `${almost} ${almost === 1 ? 'series is' : 'series are'} one film from complete.`
    : `Carry on with ${rows.length} film series you have already started.`;

  host.innerHTML = `<section class="section reveal franchise-section">
    <div class="section-head"><div>
      <h2 class="section-title"><span>&#9678;</span> Finish the Franchise</h2>
      <p>${esc(lede)}</p>
    </div><button class="section-see-all" data-action="show-page" data-page="franchises">All franchises<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg></button></div>
    <div class="row franchise-row">${rows.map(franchiseCard).join('')}</div>
  </section>`;
  observeReveals();
  requestAnimationFrame(() => host.querySelectorAll('.fr-card-bar i').forEach(bar => { bar.style.width = `${+bar.dataset.w || 0}%`; }));
}

const EP_CHECK_HOME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>';

function franchiseCard(item) {
  const next = item.nextUp;
  const left = item.unseen.length;
  const art = item.backdrop ? `${IMG}w780${item.backdrop}` : next.poster ? `${IMG}w342${next.poster}` : item.poster ? `${IMG}w342${item.poster}` : PH;
  const stack = (item.parts || []).filter(part => part.poster).slice(0, 4);
  return `<article class="fr-card${left === 1 ? ' almost' : ''}">
    <a class="fr-card-art" href="/movie/${next.id}" data-action="open-detail" data-id="${next.id}" data-type="movie" aria-label="Open ${esc(next.title)}">
      <img src="${art}" alt="" loading="lazy" data-ph="${PH}">
      <span class="fr-card-scrim" aria-hidden="true"></span>
      <span class="fr-card-play" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
      <span class="fr-card-flag">${left === 1 ? 'Last one' : `${left} left`}</span>
    </a>
    <button class="fr-card-dismiss" data-action="franchise-dismiss" data-cid="${item.id}" aria-label="Stop suggesting ${esc(item.name)}" data-tip="Not interested in this series">&#10005;</button>
    <div class="fr-card-body">
      <a class="fr-card-series" href="/collection/${item.id}" data-action="go-collection" data-cid="${item.id}">${esc(item.name)}</a>
      <h3>${esc(next.title)}</h3>
      <div class="fr-card-line"><span class="fr-card-stack">${stack.map(part => `<img src="${IMG}w92${part.poster}" alt="" loading="lazy">`).join('')}</span><span>Continue series <b>→</b></span></div>
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
  document.addEventListener('cv:auth', renderContinueWatching);
  // A tick anywhere — the rail's own button or the detail page — re-orders the
  // queue, so the rail always rebuilds rather than trying to patch itself.
  document.addEventListener('cv:episode-progress', renderContinueWatching);
  document.addEventListener('cv:movie-progress', renderContinueWatching);
  document.addEventListener('cv:continue-prefs', renderContinueWatching);
  document.addEventListener('cv:library-sync', () => {
    renderContinueWatching();
    debouncedFranchiseRail();
  });
  registerActions({
    'continue-edit': () => { continueEditing = !continueEditing; renderContinueWatching(); },
    'continue-pin': (el) => { togglePinned(el.dataset.key); renderContinueWatching(); },
    'continue-hide': (el) => { toggleHidden(el.dataset.key); renderContinueWatching(); },
    'continue-move': (el) => {
      const visible = [...document.querySelectorAll('.continue-row .continue-card[data-continue]')].map(node => node.dataset.continue);
      if (moveContinue(el.dataset.key, +el.dataset.dir, visible)) renderContinueWatching();
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
  { id: 'top10', t: 'Top 10 Movies This Week', p: '/trending/movie/week', type: 'movie', t10: true, icon: '🔥', page: 'movies' },
  { id: 'pop_tv', t: 'Popular TV Shows', p: '/tv/popular', type: 'tv', icon: '📺', page: 'tv' },
  { id: 'top10_tv', t: 'Top 10 Shows This Week', p: '/trending/tv/week', type: 'tv', t10: true, icon: '🔥', page: 'tv' },
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
  renderBoxOfficeRail();
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
