// ===== DESKTOP HOVER PREVIEW =====
// Hovering a poster in a rail opens a floating panel above it: the backdrop
// first, the trailer once it is genuinely playing, and — the part the old
// version was missing entirely — the information and the controls that make the
// preview worth stopping on. Rating, year, runtime, certificate and genres are
// all there, and so are Play, add-to-list, watched and rate, so a decision can
// be made without opening the title at all.
//
// It is a fixed-position panel, not an in-row expansion. The previous build
// animated the card's own `width` and `flex-basis`, so every neighbouring poster
// in the rail was laid out again on every frame; the rail shifted under the
// pointer, which both looked unsteady and caused open/close loops near the
// edges. Nothing here touches layout: the panel is positioned once and animated
// with transform and opacity only.
import { tmdb } from './api.js';
import { IMG } from './config.js';
import { esc, prefersReducedMotion } from './ui.js';
import { state, inWL, isWatched } from './state.js';
import { mountAmbientVideo } from './video-bg.js';
import { showProgress, nextUp } from './episodes.js';
import { movieProgressEntry } from './movie-progress.js';

const metaCache = new Map();
const DESKTOP_HOVER = '(hover:hover) and (pointer:fine) and (min-width:901px)';

// Dwell before anything opens, so sweeping the pointer along a rail never fires.
const OPEN_DELAY = 340;
// The still is up as soon as the panel is, so the trailer can wait for the open
// animation to finish. Mounting an iframe during a transform animation forces
// composite work on every frame of it.
const VIDEO_DELAY = 620;
// Long enough to cross the gap between the poster and the panel without the
// panel vanishing, short enough that leaving feels immediate.
const CLOSE_DELAY = 200;

const MIN_W = 300, MAX_W = 420, EDGE = 14;
// The nav is fixed, so clamping the panel to the raw viewport would let it slide
// underneath the bar for a card near the top of a page.
const navHeight = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 60;

let openTimer = null, closeTimer = null, videoTimer = null;
let hoveredCard = null, activeCard = null, panel = null;
let teardownVideo = () => {};
let token = 0;

const previewsOK = () => typeof window !== 'undefined'
  && document.documentElement.dataset.posterPreview !== 'hide'
  && !prefersReducedMotion()
  && window.matchMedia?.(DESKTOP_HOVER).matches;

// ---------- data ----------

function pickTrailer(videos) {
  const youtube = (videos || []).filter(video => video.site === 'YouTube' && video.key);
  return youtube.find(video => video.type === 'Trailer' && video.official)?.key
    || youtube.find(video => video.type === 'Trailer')?.key
    || youtube.find(video => /teaser|clip/i.test(video.type || ''))?.key
    || youtube[0]?.key || '';
}

function pickLogo(images) {
  const logos = (images?.logos || []).filter(logo => logo.file_path);
  return (logos.find(logo => logo.iso_639_1 === 'en') || logos.find(logo => logo.iso_639_1 === null) || logos[0])?.file_path || '';
}

// The certificate for the viewer's own region where TMDB has one, falling back
// to US — an unlabeled preview is better than one labeled for the wrong country.
function pickCertificate(detail, type) {
  const region = (navigator.language || 'en-US').split('-')[1] || 'US';
  if (type === 'movie') {
    const rows = detail.release_dates?.results || [];
    const find = code => (rows.find(row => row.iso_3166_1 === code)?.release_dates || [])
      .map(entry => entry.certification).find(Boolean);
    return find(region) || find('US') || '';
  }
  const rows = detail.content_ratings?.results || [];
  return rows.find(row => row.iso_3166_1 === region)?.rating || rows.find(row => row.iso_3166_1 === 'US')?.rating || '';
}

const runtimeLabel = minutes => {
  const total = Math.round(+minutes || 0);
  if (!total) return '';
  const hours = Math.floor(total / 60), rest = total % 60;
  return hours ? `${hours}h${rest ? ` ${rest}m` : ''}` : `${rest}m`;
};

// ONE request per title instead of the old build's separate /videos call: the
// trailer, the title logo, the runtime, the genres and the certificate all ride
// on the same append_to_response.
async function metaFor(card) {
  const type = card.dataset.type === 'tv' ? 'tv' : 'movie';
  const id = +card.dataset.id;
  if (!id) return null;
  const key = `${type}_${id}`;
  if (metaCache.has(key)) return metaCache.get(key);
  const request = (async () => {
    try {
      const detail = await tmdb(`/${type}/${id}`, {
        append_to_response: type === 'movie' ? 'videos,images,release_dates' : 'videos,images,content_ratings',
        include_image_language: 'en,null',
      });
      const seasons = +detail.number_of_seasons || 0;
      return {
        id, type,
        trailer: pickTrailer(detail.videos?.results),
        logo: pickLogo(detail.images),
        title: detail.title || detail.name || card.dataset.title || '',
        year: (detail.release_date || detail.first_air_date || card.dataset.year || '').slice(0, 4),
        rating: +detail.vote_average || 0,
        certificate: pickCertificate(detail, type),
        runtime: +detail.runtime || 0,
        length: type === 'tv'
          ? (seasons ? `${seasons} season${seasons === 1 ? '' : 's'}` : '')
          : runtimeLabel(detail.runtime),
        genres: (detail.genres || []).slice(0, 3).map(genre => genre.name).filter(Boolean),
        backdrop: detail.backdrop_path || card.dataset.backdrop || '',
        poster: detail.poster_path || '',
      };
    } catch (_) {
      // A failed lookup still gets a panel — everything below falls back to what
      // the card itself already carries.
      return {
        id, type, trailer: '', logo: '', title: card.dataset.title || '',
        year: card.dataset.year || '', rating: +card.dataset.rating || 0,
        certificate: '', length: '', runtime: 0,
        genres: [], backdrop: card.dataset.backdrop || '', poster: '',
      };
    }
  })();
  metaCache.set(key, request);
  // Bounded: one long browsing session can hover hundreds of posters, and none
  // of these entries is ever read again once the panel is gone.
  if (metaCache.size > 150) for (const stale of [...metaCache.keys()].slice(0, 50)) metaCache.delete(stale);
  return request;
}

// The add-to-list button needs the same payload every other surface sends, so a
// title saved from the preview lands in the list identically.
function listPayload(meta) {
  return esc(JSON.stringify({
    id: meta.id, type: meta.type, title: meta.title, poster: meta.poster,
    rating: meta.rating, year: meta.year, genres: [], runtime: 0,
    language: '', country: '', releaseDate: '',
  }));
}

// ---------- markup ----------

const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.53.85l10.72-6.86a1 1 0 0 0 0-1.7L9.53 4.29A1 1 0 0 0 8 5.14Z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.47 6.04.88-4.37 4.26 1.03 6.02L12 16.78 6.6 19.63l1.03-6.02L3.26 9.35l6.04-.88Z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  sound: '<svg class="cvp-ico-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a9 9 0 0 1 0 12"/></svg><svg class="cvp-ico-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>',
};

function metaRow(meta) {
  const bits = [];
  if (meta.rating) bits.push(`<b class="cvp-score">${meta.rating.toFixed(1)}</b>`);
  if (meta.year) bits.push(`<span>${esc(meta.year)}</span>`);
  if (meta.length) bits.push(`<span>${esc(meta.length)}</span>`);
  if (meta.certificate) bits.push(`<span class="cvp-cert">${esc(meta.certificate)}</span>`);
  bits.push(`<span>${meta.type === 'tv' ? 'TV' : 'Film'}</span>`);
  return bits.join('<i class="cvp-dot" aria-hidden="true"></i>');
}

// Where the viewer actually is in this title. A preview that cannot tell you
// "you are four episodes in" is missing the one fact you most want from a rail
// you have already been watching from.
function resumeState(meta) {
  if (meta.type === 'tv') {
    const progress = showProgress(meta.id);
    if (!progress.started || progress.percent <= 0) return null;
    const next = nextUp(meta.id);
    return {
      percent: Math.min(100, progress.percent),
      label: progress.caughtUp
        ? 'Caught up'
        : next ? `Next · S${next.season} E${next.episode}` : `${progress.watched} of ${progress.aired} watched`,
    };
  }
  const entry = movieProgressEntry(meta.id);
  if (!entry) return null;
  const seconds = +entry.position || 0;
  if (!seconds) return { percent: 0, label: 'Started' };
  const minutes = Math.round(seconds / 60);
  // The bar is only drawn against a runtime we actually know. Without one it
  // stays at zero, which reads as "near the start" rather than as a number
  // invented to fill the track.
  const runtime = +meta.runtime || 0;
  return {
    percent: runtime ? Math.min(100, Math.round((minutes / runtime) * 100)) : 0,
    label: `Resume at ${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h ` : ''}${minutes % 60}m`,
  };
}

function buildPanel(meta) {
  const saved = inWL(meta.id, meta.type);
  const watched = isWatched(meta.id, meta.type);
  const score = state.ratings?.[`${meta.type}_${meta.id}`];
  const resume = resumeState(meta);
  const still = meta.backdrop ? `${IMG}w780${meta.backdrop}` : (meta.poster ? `${IMG}w500${meta.poster}` : '');
  const href = `/${meta.type}/${meta.id}`;

  const el = document.createElement('div');
  el.className = 'cvp';
  // Decorative: everything in here also exists on the card and on the detail
  // page, and a hover-only surface a screen reader cannot reach is noise.
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <a class="cvp-media" href="${href}" data-action="open-detail" data-id="${meta.id}" data-type="${meta.type}" tabindex="-1">
      ${still ? `<img class="cvp-still" src="${still}" alt="">` : ''}
      <span class="cvp-shade"></span>
      <span class="cvp-load" aria-hidden="true"><i></i></span>
      ${meta.logo
        ? `<img class="cvp-logo" src="${IMG}w300${meta.logo}" alt="">`
        : `<span class="cvp-wordmark">${esc(meta.title)}</span>`}
      ${resume ? `<span class="cvp-resume"><span class="cvp-track"><i style="width:${resume.percent}%"></i></span><b>${esc(resume.label)}</b></span>` : ''}
    </a>
    <button class="cvp-sound" type="button" tabindex="-1" aria-label="Unmute preview">${ICON.sound}</button>
    <div class="cvp-body">
      <div class="cvp-actions">
        <a class="cvp-play" href="${href}" data-action="open-detail" data-id="${meta.id}" data-type="${meta.type}" tabindex="-1">${ICON.play}<span>${resume ? 'Resume' : 'Play'}</span></a>
        <button class="cvp-round${saved ? ' on' : ''}" type="button" tabindex="-1" data-action="open-list-picker" data-item="${listPayload(meta)}" data-tip="${saved ? 'Edit lists' : 'Add to a list'}">${saved ? ICON.check : ICON.plus}</button>
        <button class="cvp-round${watched ? ' on green' : ''}" type="button" tabindex="-1" data-action="toggle-watched" data-id="${meta.id}" data-type="${meta.type}" data-title="${esc(meta.title)}" data-poster="${esc(meta.poster)}" data-year="${esc(meta.year)}" data-tmdb-rating="${meta.rating}" data-tip="${watched ? 'Watched' : 'Mark as watched'}">${ICON.check}</button>
        <button class="cvp-round${score ? ' on gold' : ''}" type="button" tabindex="-1" data-action="open-rating" data-id="${meta.id}" data-type="${meta.type}" data-title="${esc(meta.title)}" data-tip="${score ? `Your rating: ${score}/10` : 'Rate this'}">${score ? `<b>${score}</b>` : ICON.star}</button>
        <a class="cvp-round cvp-more" href="${href}" data-action="open-detail" data-id="${meta.id}" data-type="${meta.type}" tabindex="-1" data-tip="More info">${ICON.chevron}</a>
      </div>
      <div class="cvp-meta">${metaRow(meta)}</div>
      ${meta.genres.length ? `<div class="cvp-genres">${meta.genres.map(genre => `<span>${esc(genre)}</span>`).join('')}</div>` : ''}
    </div>`;
  return el;
}

// ---------- placement ----------

// Fixed coordinates derived from the poster, then clamped to the viewport so a
// card at either end of a rail still gets a whole panel. The transform origin
// tracks the poster's centre, so the panel always grows out of the thing that
// was hovered rather than out of the middle of the screen.
function place(el, card) {
  // `.card:hover` lifts the poster 6px. Measuring the lifted rect would anchor
  // the panel 6px high and leave it there after the lift settles, so the offset
  // is taken back out.
  const raw = card.getBoundingClientRect();
  const lift = card.matches(':hover') ? 6 : 0;
  const box = { left: raw.left, width: raw.width, height: raw.height, top: raw.top + lift };
  const width = Math.round(Math.min(MAX_W, Math.max(MIN_W, box.width * 1.55)));
  let left = Math.round(box.left + box.width / 2 - width / 2);
  left = Math.min(Math.max(left, EDGE), window.innerWidth - width - EDGE);

  el.style.width = `${width}px`;
  el.style.left = `${left}px`;
  el.style.visibility = 'hidden';
  el.style.top = '0px';
  // Height is only knowable once the body has laid out, so measure, then place.
  const height = el.offsetHeight;
  const ceiling = navHeight() + EDGE;
  let top = Math.round(box.top + box.height / 2 - height / 2);
  top = Math.min(Math.max(top, ceiling), Math.max(ceiling, window.innerHeight - height - EDGE));
  el.style.top = `${top}px`;
  el.style.visibility = '';

  const originX = Math.min(Math.max(box.left + box.width / 2 - left, 0), width);
  const originY = Math.min(Math.max(box.top + box.height / 2 - top, 0), height);
  el.style.transformOrigin = `${originX}px ${originY}px`;
}

// ---------- open / close ----------

function open(card, meta) {
  close(true);
  activeCard = card;
  panel = buildPanel(meta);
  document.body.appendChild(panel);
  place(panel, card);
  card.classList.add('card-previewing');

  // The sound control is inside the panel, so it cannot use the global data-action
  // delegation without also being a route change; it owns its own listener.
  panel.querySelector('.cvp-sound').addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation();
    const button = event.currentTarget;
    const nowMuted = !teardownVideo.isMuted?.();
    teardownVideo.setMuted?.(nowMuted);
    button.classList.toggle('unmuted', !nowMuted);
    button.setAttribute('aria-label', nowMuted ? 'Unmute preview' : 'Mute preview');
  });

  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (panel) panel.classList.add('in');
  }));

  if (!meta.trailer) { panel.classList.add('no-trailer'); return; }

  videoTimer = setTimeout(() => {
    videoTimer = null;
    if (!panel || activeCard !== card || !panel.isConnected) return;
    const stage = panel.querySelector('.cvp-media');
    // mountAmbientVideo only reveals the iframe on a confirmed PLAYING state, so
    // the still stays up if autoplay is blocked instead of exposing YouTube's
    // paused chrome. `.playing` is what fades the still out and stops the
    // loading shimmer, so both are driven by the same signal.
    teardownVideo = mountAmbientVideo(stage, meta.trailer, {
      delay: 0, overlaySelector: '.cvp-shade', clean: true, respectAutoplay: false,
      onPlaying: () => panel?.classList.add('playing'),
    });
  }, VIDEO_DELAY);
}

function close(immediate = false) {
  token++;
  clearTimeout(openTimer); clearTimeout(closeTimer); clearTimeout(videoTimer);
  openTimer = closeTimer = videoTimer = null;

  const stop = teardownVideo; teardownVideo = () => {};
  const el = panel, card = activeCard;
  panel = null; activeCard = null;
  card?.classList.remove('card-previewing');
  if (!el) { stop(); return; }

  // Mute before tearing down: a trailer that keeps playing for the length of the
  // close animation should not also keep talking.
  stop.setMuted?.(true);
  if (immediate) { stop(); el.remove(); return; }
  el.classList.remove('in');
  el.classList.add('out');
  setTimeout(() => { stop(); el.remove(); }, 200);
}

function scheduleClose() {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    // A pointer resting on either the poster or the panel keeps it open; this is
    // what lets the mouse travel from one to the other.
    if (activeCard?.matches(':hover') || panel?.matches(':hover')) { scheduleClose(); return; }
    hoveredCard = null;
    close();
  }, CLOSE_DELAY);
}

function enter(card) {
  if (!previewsOK() || hoveredCard === card) return;
  if (!card.parentElement?.classList.contains('row')) return;
  hoveredCard = card;
  clearTimeout(closeTimer); clearTimeout(openTimer);
  const mine = ++token;
  const started = performance.now();
  // The request starts now and the dwell runs alongside it, so a title whose
  // metadata is already cached opens the moment the dwell is up.
  const request = metaFor(card);
  openTimer = setTimeout(async () => {
    const meta = await request;
    if (!meta || mine !== token || hoveredCard !== card || !card.isConnected || !previewsOK()) return;
    open(card, meta);
  }, Math.max(0, OPEN_DELAY - (performance.now() - started)));
}

export function initCardPreviews() {
  document.addEventListener('pointerover', event => {
    const card = event.target.closest?.('.row > .card[data-id][data-type]');
    if (card) { if (!card.contains(event.relatedTarget)) enter(card); return; }
    // Moving onto the panel itself is not leaving the preview.
    if (event.target.closest?.('.cvp')) clearTimeout(closeTimer);
  });

  document.addEventListener('pointerout', event => {
    if (!activeCard && !hoveredCard) return;
    const to = event.relatedTarget;
    if (to && (to.closest?.('.cvp') || to.closest?.('.row > .card[data-id][data-type]') === (activeCard || hoveredCard))) return;
    if (event.target.closest?.('.cvp') || event.target.closest?.('.row > .card[data-id][data-type]')) scheduleClose();
  });

  // Anything that navigates or opens a dialog dismisses the panel: after adding
  // to a list or marking watched, a preview still hanging over the rail is in the
  // way. Scoped to `[data-action]` on purpose — this runs in the capture phase,
  // so a blanket "anything inside .cvp" tore the panel down before its own
  // controls could handle their click, which is exactly what stopped the sound
  // toggle from ever firing.
  document.addEventListener('click', event => {
    if (event.target.closest?.('.cvp [data-action]')) close(true);
  }, true);

  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) close(true); });
  document.addEventListener('cv:go', () => close(true));
  document.addEventListener('cv:prefs', () => { if (!previewsOK()) close(true); });
  window.addEventListener('blur', () => close(true));
  // The panel is positioned once, in viewport coordinates — scrolling or
  // resizing under it would leave it stranded away from its poster.
  window.addEventListener('scroll', () => close(true), { passive: true, capture: true });
  window.addEventListener('resize', () => close(true), { passive: true });
  window.matchMedia?.(DESKTOP_HOVER).addEventListener?.('change', event => { if (!event.matches) close(true); });
}

export { pickTrailer };
