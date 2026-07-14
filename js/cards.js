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
    genres: item.genre_ids || (item.genres || []).map(g => g.id) || []
  }));
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
  let h = `<div class="${cls}" role="button" tabindex="0" aria-label="${safeTitle}" data-action="open-detail" data-id="${item.id}" data-type="${t}"${yt}>`;
  if (opts.t10) h += `<div class="t10-num">${opts.rank}</div>`;
  h += `<div class="card-img"><img src="${poster}" alt="${safeTitle}" loading="lazy" data-ph="${PH}">`;
  if (opts.badge) h += `<div class="card-badge">${esc(opts.badge)}</div>`;
  if (rating && !opts.t10) h += `<div class="card-rating"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>${rating}</div>`;
  if (wd) h += `<div class="watched-badge show"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></div>`;
  // Watchlist toggle lives INSIDE .card-img so it overlays the poster (its
  // absolute bottom/right anchors to the poster, not the whole card) — keeps the
  // text area clean so the title sits tight under the poster.
  h += `<button class="card-wl ${wl ? 'in' : ''}" data-wl="${t}|${item.id}" data-action="toggle-wl" data-item="${wlPayload(item, t)}" aria-label="${wl ? 'Remove from list' : 'Add to list'}" data-tip="${wl ? 'Remove from list' : 'Add to list'}">${wl ? '✓' : '+'}</button>`;
  h += `</div>`;
  if (!opts.t10) h += `<div class="card-info"><div class="card-title">${safeTitle}</div><div class="card-sub"><span>${year}</span><span class="dot"></span><span>${t === 'tv' ? 'TV' : 'Movie'}</span></div></div>`;
  h += `</div>`;
  return h;
}

export function personCard(item) {
  const photo = item.profile_path ? `${IMG}w185${item.profile_path}` : PH;
  return `<div class="card" role="button" tabindex="0" aria-label="${esc(item.name)}" data-action="open-person" data-id="${item.id}"><div class="card-img"><img src="${photo}" alt="${esc(item.name)}" loading="lazy" data-ph="${PH}"></div><div class="card-info"><div class="card-title">${esc(item.name) || ''}</div><div class="card-sub">${esc(item.known_for_department) || ''}</div></div></div>`;
}

// Skeleton placeholder row content.
export function skelCards(n = 8, w = 155) {
  return Array(n).fill(`<div class="card" style="width:${w}px"><div class="card-img skel" style="aspect-ratio:2/3"></div></div>`).join('');
}

// Refresh the +/✓ state of every watchlist button on screen.
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
