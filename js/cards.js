// ===== CARD BUILDERS =====
// Pure presentation. Emits data-action attributes only (no inline JS), so titles
// with quotes/apostrophes can never break the markup.
import { IMG, PH, genreMap } from './config.js';
import { esc } from './ui.js';
import { inWL, isWatched, state } from './state.js';

// Minimal payload stored in data-item for the watchlist toggle.
function wlPayload(item, type) {
  return esc(JSON.stringify({
    id: item.id, type,
    title: item.title || item.name || '',
    poster: item.poster_path || '',
    rating: item.vote_average || 0,
    year: (item.release_date || item.first_air_date || '').slice(0, 4),
    genres: item.genre_ids || (item.genres || []).map(g => g.id) || [],
    runtime: item.runtime || (item.episode_run_time || [])[0] || 0,
    language: item.original_language || '',
    country: (item.origin_country || [])[0] || '',
    releaseDate: item.release_date || item.first_air_date || ''
  }));
}

const STAR_OUTLINE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

// The single add-to-list button on a poster: shows + when the title is in no list,
// ✓ when it's saved in ≥1 list, and ALWAYS opens the list picker (which list?).
// data-wl keeps refreshWLBtns able to flip +/✓ after a change made elsewhere.
export function wlBtnHTML(id, type, payload) {
  const wl = inWL(id, type);
  return `<button class="card-wl ${wl ? 'in' : ''}" data-wl="${type}|${id}" data-action="open-list-picker" data-item="${payload}" aria-label="${wl ? 'Edit lists' : 'Add to a list'}" data-tip="${wl ? 'Edit lists' : 'Add to a list'}">${wl ? '✓' : '+'}</button>`;
}

// The watched tint + check. One definition, reused by buildCard and the live
// re-sync below (it used to be copy-pasted into every custom card renderer).
export const WATCHED_BADGE_HTML = '<div class="watched-badge show"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></div>';

// Quick-rate control. Only emitted on WATCHED cards — rating something you
// haven't seen is meaningless, and that constraint is also what keeps the card
// from growing a third always-on control. Reuses the existing `open-rating`
// action (which already stopPropagation()s), so tapping it never opens the
// detail page: events.js resolves data-action via closest(), and this button is
// deeper than the card root's open-detail.
//
// It always shows a STAR, never the score — the score lives in the top-left
// my-rating badge, and rendering it here too printed it twice on the same poster.
// The `rated` class still tints it gold, so "I've rated this" is still visible.
export function rateBtnHTML(id, type, title) {
  const score = state.ratings[`${type}_${id}`];
  const tip = score ? `Your rating: ${score}/10` : 'Rate this';
  return `<button class="card-rate${score ? ' rated' : ''}" data-rate="${type}|${id}" data-action="open-rating" data-id="${id}" data-type="${type}" data-title="${esc(title)}" aria-label="${score ? `Rated ${score} of 10` : 'Rate this'}" data-tip="${tip}">${STAR_OUTLINE}</button>`;
}

// A passive "my rating" badge (distinct from the TMDB score pill): a SOLID gold
// star+number in the top-LEFT corner, shown only when you've rated the title.
// The TMDB score stays translucent top-right, so both are visible at once.
// data-myr lets refreshMyRatings() insert/update/remove it live after a rating
// change made anywhere, without a full re-render.
export function myRatingHTML(id, type) {
  const score = state.ratings[`${type}_${id}`];
  if (!score) return '';
  return `<div class="card-myrating" data-myr="${type}|${id}" data-tip="Your rating: ${score}/10" aria-label="Your rating: ${score} of 10"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>${score}</div>`;
}

export function buildCard(item, type, opts = {}) {
  const t = type || item.media_type || 'movie';
  if (t === 'person') return personCard(item);

  const title = item.title || item.name || '';
  const year = (item.release_date || item.first_air_date || '').slice(0, 4);
  const poster = item.poster_path ? `${IMG}w342${item.poster_path}` : PH;
  const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
  const wl = inWL(item.id, t);
  const wd = isWatched(item.id, t);
  const genres = (item.genre_ids || []).slice(0, 3).map(gid => genreMap[gid] || '').filter(Boolean);
  const safeTitle = esc(title);

  let cls = 'card';
  if (opts.wide) cls += ' card-w';
  if (opts.t10) cls += ' card-t10';

  const yt = item.__ytKey ? ` data-yt="${item.__ytKey}"` : '';
  const recKey = opts.dismissible ? `${t}_${item.id}` : '';
  let h = `<a class="${cls}" href="/${t}/${item.id}" aria-label="${safeTitle}" data-action="open-detail" data-id="${item.id}" data-type="${t}" data-title="${safeTitle}" data-year="${esc(year)}" data-rating="${esc(rating)}" data-backdrop="${esc(item.backdrop_path || '')}"${recKey ? ` data-recommendation-key="${recKey}"` : ''}${yt}>`;
  if (opts.t10) h += `<div class="t10-num">${opts.rank}</div>`;
  h += `<div class="card-img"><img src="${poster}" alt="${safeTitle}" loading="lazy" data-ph="${PH}">`;
  if (opts.dismissible) h += `<button class="card-dismiss" data-action="dismiss-recommendation" data-id="${item.id}" data-type="${t}" data-title="${safeTitle}" data-poster="${esc(item.poster_path || '')}" data-source="${esc((item.__sources || [item.__source]).filter(Boolean).join(','))}" data-genres="${esc(JSON.stringify(item.genre_ids || []))}" data-keywords="${esc(JSON.stringify(item.__keywordIds || []))}" data-score="${Number(item.__score || 0).toFixed(3)}" aria-label="Not interested in ${safeTitle}" data-tip="Not interested"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>`;
  if (opts.badge) h += `<div class="card-badge">${esc(opts.badge)}</div>`;
  if (rating && !opts.t10) h += `<div class="card-rating"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>${rating}</div>`;
  if (wd) h += WATCHED_BADGE_HTML;
  h += myRatingHTML(item.id, t);
  if (wd && !opts.t10) h += rateBtnHTML(item.id, t, title);
  // One add-to-list button, overlaying the poster (absolute bottom-right); tapping
  // it opens the picker to choose which list(s).
  h += wlBtnHTML(item.id, t, wlPayload(item, t));
  h += `</div>`;
  if (!opts.t10) h += `<div class="card-info"><div class="card-title">${safeTitle}</div><div class="card-sub"><span>${year}</span><span class="dot"></span><span>${t === 'tv' ? 'TV' : 'Movie'}</span></div></div>`;
  h += `</a>`;
  return h;
}

export function personCard(item) {
  const photo = item.profile_path ? `${IMG}w185${item.profile_path}` : PH;
  return `<a class="card" href="/person/${item.id}" aria-label="${esc(item.name)}" data-action="open-person" data-id="${item.id}"><div class="card-img"><img src="${photo}" alt="${esc(item.name)}" loading="lazy" data-ph="${PH}"></div><div class="card-info"><div class="card-title">${esc(item.name) || ''}</div><div class="card-sub">${esc(item.known_for_department) || ''}</div></div></a>`;
}

// Skeleton placeholder row content.
export function skelCards(n = 8, w = 155) {
  return Array(n).fill(`<div class="card" style="width:${w}px"><div class="card-img skel" style="aspect-ratio:2/3"></div></div>`).join('');
}

// Refresh the +/✓ state of every add-to-list button on screen, so a change made
// anywhere (the picker, another card) reflects everywhere without a re-render.
export function refreshWLBtns() {
  document.querySelectorAll('[data-wl]').forEach(b => {
    const [t, i] = b.dataset.wl.split('|');
    const yes = inWL(parseInt(i), t);
    b.classList.toggle('in', yes);
    b.classList.toggle('active', yes);
    // wl-remove buttons use an SVG icon, not the +/✓ glyph — don't clobber it.
    if (b.classList.contains('card-wl') && !b.classList.contains('wl-remove')) b.textContent = yes ? '✓' : '+';
  });
}

// Refresh every quick-rate button on screen, so rating from the detail page (or
// any other card) updates the rest without a full re-render.
export function refreshRateBtns() {
  document.querySelectorAll('[data-rate]').forEach(b => {
    const [t, i] = b.dataset.rate.split('|');
    const score = state.ratings[`${t}_${i}`];
    b.classList.toggle('rated', !!score);
    const tip = score ? `Your rating: ${score}/10` : 'Rate this';
    b.dataset.tip = tip;
    b.setAttribute('aria-label', score ? `Rated ${score} of 10` : 'Rate this');
  });
}

// Re-sync EVERY per-user mark on every visible card: the watched tint/check, the
// my-rating badge, the quick-rate button, and the +/✓ add-to-list state.
//
// This matters because cards are frequently built before the user's data exists.
// The home page renders its 16 section rows at startup, well before auth resolves
// and loadRatings()/loadWatched() land, and nothing ever rebuilt them — so those
// posters stayed blank no matter what you'd rated. Sweeping the DOM fixes that
// (and the same latent gap on /movies, /tv and /search) without refetching.
export function refreshCardMarks() {
  document.querySelectorAll('.card[data-id][data-type]').forEach(card => {
    const { id, type } = card.dataset;
    const img = card.querySelector('.card-img');
    if (!img) return;
    const wd = isWatched(id, type);

    // Watched tint + check.
    const wb = img.querySelector('.watched-badge');
    if (wd && !wb) img.insertAdjacentHTML('afterbegin', WATCHED_BADGE_HTML);
    else if (!wd && wb) wb.remove();

    // My-rating badge (exists in the DOM only while a score exists).
    const score = state.ratings[`${type}_${id}`];
    const badge = img.querySelector('.card-myrating');
    if (score) {
      if (badge) { badge.lastChild.textContent = score; badge.dataset.tip = `Your rating: ${score}/10`; badge.setAttribute('aria-label', `Your rating: ${score} of 10`); }
      else img.insertAdjacentHTML('afterbegin', myRatingHTML(id, type));
    } else if (badge) badge.remove();

    // Quick-rate button — watched cards only, never on a Top-10 card.
    const rateBtn = img.querySelector('.card-rate');
    if (wd && !rateBtn && !card.classList.contains('card-t10')) {
      const html = rateBtnHTML(id, type, card.getAttribute('aria-label') || '');
      const wlBtn = img.querySelector('.card-wl');
      // Keep DOM order matching buildCard: rate button before the list button.
      if (wlBtn) wlBtn.insertAdjacentHTML('beforebegin', html);
      else img.insertAdjacentHTML('beforeend', html);
    } else if (!wd && rateBtn) rateBtn.remove();
  });
  refreshWLBtns();
  refreshRateBtns();
}

// Cards can be on screen before the user's lists/ratings/watched arrive, and the
// watched-meta backfill lands later still — re-sync on each of those.
export function initCardSync() {
  ['cv:auth', 'cv:wl-changed', 'cv:library-sync', 'cv:meta-backfilled'].forEach(ev => document.addEventListener(ev, refreshCardMarks));
}

// Image error fallback via delegation (replaces inline onerror).
export function initImageFallback() {
  document.addEventListener('error', e => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.dataset.ph && img.src !== img.dataset.ph) {
      img.src = img.dataset.ph;
      img.removeAttribute('data-ph');
    }
  }, true);
}

export { state };
