// ===== DETAIL PAGE =====
import { tmdb } from './api.js';
import { IMG, PH, REGIONS, pickLogo, providerUrl } from './config.js';
import { state, pushRecentlyViewed } from './state.js';
import { esc, fmt, debounce, $ } from './ui.js';
import { buildCard } from './cards.js';
import { registerActions } from './events.js';
import { observeReveals, observeCountUps } from './effects.js';
import { mountAmbientVideo } from './video-bg.js';
import { loadAwardsSection } from './awards.js';
import { exactEpisodeTime, localEpisodeTime, localTimeZone } from './episode-times.js';

let curDet = null, curType = null;
let ambientTeardown = null;   // tears down the detail ambient video
let navHint = null;           // instant-paint hint captured from the clicked card
let lastVTSource = null;      // element currently holding the shared view-transition-name
let clampResize = null;       // window resize handler that re-measures the read-more toggles
let reqGen = 0;                // bumped on every openDetail/openCollection call; guards against a slower, stale fetch overwriting a newer one
let epGen = 0;                 // same idea, scoped to the season-episode list (season tabs can be clicked faster than they load)

export async function openDetail(id, type) {
  const gen = ++reqGen;
  const ct = $('detailContent');
  if (ambientTeardown) { ambientTeardown(); ambientTeardown = null; }

  // Zero-layout-shift instant paint: if we arrived from a card click, render the
  // real poster + title synchronously (no spinner) before the fetch resolves.
  const hint = (navHint && navHint.id === id && navHint.type === type) ? navHint : null;
  navHint = null;
  // Clear the shared-element name from the source poster BEFORE this new render is
  // snapshotted, so at most one element ever holds `cv-hero` at snapshot time.
  if (lastVTSource) { try { lastVTSource.style.viewTransitionName = ''; } catch (e) {} lastVTSource = null; }
  if (hint) {
    ct.innerHTML = `<div class="detail-back detail-back-pending"><div class="detail-back-grad"></div></div>
      <div class="detail-inner"><div class="detail-top">
        <div class="detail-poster" style="view-transition-name:cv-hero"><img src="${esc(hint.poster)}" alt=""></div>
        <div class="detail-head"><h1 class="detail-title">${esc(hint.title)}</h1><div class="detail-skel"><span></span><span></span><span></span></div></div>
      </div></div>`;
  } else {
    ct.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:60vh"><div class="loader-text">Loading...</div></div>';
  }
  document.title = 'Loading… — CineVerse';
  state.cdIntervals.forEach(clearInterval); state.cdIntervals = [];
  try {
    const [det, cred, vids, sim, revs] = await Promise.all([
      tmdb(`/${type}/${id}`, { append_to_response: 'external_ids,content_ratings,release_dates,watch/providers,keywords,recommendations,images,alternative_titles', include_image_language: 'en,null' }),
      tmdb(`/${type}/${id}/credits`), tmdb(`/${type}/${id}/videos`), tmdb(`/${type}/${id}/similar`), tmdb(`/${type}/${id}/reviews`)
    ]);
    // Bail if a newer openDetail()/openCollection() call has started since — a
    // slower response for a title the user already navigated away from must not
    // overwrite the page (or leak this call's ambient-video listener) once a
    // faster, newer response has already rendered.
    if (gen !== reqGen) return;
    curDet = det; curType = type;

    const title = det.title || det.name || ''; const safeTitle = esc(title);
    const logoPath = pickLogo(det.images?.logos);
    // Official title-logo art when available, else the plain title text.
    const titleHTML = logoPath
      ? `<h1 class="detail-title has-logo"><img class="title-logo" src="${IMG}w500${logoPath}" alt="${safeTitle}"></h1>`
      : `<h1 class="detail-title">${safeTitle}</h1>`;
    const year = (det.release_date || det.first_air_date || '').slice(0, 4);
    document.title = `${title}${year ? ' (' + year + ')' : ''} — CineVerse`;
    const back = det.backdrop_path ? `${IMG}original${det.backdrop_path}` : ''; const poster = det.poster_path ? `${IMG}w500${det.poster_path}` : PH;
    const rat = det.vote_average ? det.vote_average.toFixed(1) : 'N/A';
    const rt = det.runtime ? `${Math.floor(det.runtime / 60)}h ${det.runtime % 60}m` : (det.episode_run_time?.length ? `${det.episode_run_time[0]}m/ep` : '');
    const genres = (det.genres || []).map(g => g.name); const cert = getCert(det, type);
    const dirs = directorsOf(det, cred, type);
    const trailer = vids.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube') || vids.results?.find(v => v.site === 'YouTube');
    const wl = state.watchlist.some(w => w.id === `${type}_${id}`);
    const myRating = state.ratings[`${type}_${id}`];
    const wd = !!state.watched[`${type}_${id}`];
    // You can't have watched — or have an opinion on — something that isn't out yet.
    const out = isReleased(det, type);
    const recs = det.recommendations?.results || sim.results || [];

    // Record for personalization
    pushRecentlyViewed({ id, type, title, poster: det.poster_path || '', genres: (det.genres || []).map(g => g.id) });

    // Watchlist payload
    const contentCountry = det.origin_country?.[0] || det.production_countries?.[0]?.iso_3166_1 || '';
    const contentReleaseDate = det.release_date || det.first_air_date || '';
    const wlPayload = esc(JSON.stringify({ id, type, title, poster: det.poster_path || '', rating: det.vote_average || 0, year, genres: (det.genres || []).map(g => g.id), runtime: det.runtime || det.episode_run_time?.[0] || 0, language: det.original_language || '', country: contentCountry, releaseDate: contentReleaseDate }));

    const boHTML = boxOfficeHTML(det);

    // One countdown block, shared markup. For an airing show it counts to the next
    // episode; for anything not yet out it counts to the release/premiere date.
    let cdHTML = '', cdDate = null, cdDoneMsg = '';
    const cdGrid = `<div class="countdown-grid"><div class="cd-unit"><div class="cd-num" id="cd_d_${id}">--</div><div class="cd-txt">Days</div></div><div class="cd-unit"><div class="cd-num" id="cd_h_${id}">--</div><div class="cd-txt">Hours</div></div><div class="cd-unit"><div class="cd-num" id="cd_m_${id}">--</div><div class="cd-txt">Min</div></div><div class="cd-unit"><div class="cd-num" id="cd_s_${id}">--</div><div class="cd-txt">Sec</div></div></div>`;
    if (type === 'tv' && det.next_episode_to_air && new Date(`${det.next_episode_to_air.air_date}T23:59:59`) > new Date()) {
      const ne = det.next_episode_to_air;
      cdDate = `${ne.air_date}T23:59:59`; cdDoneMsg = '🎉 Now Airing!';
      cdHTML = `<div class="countdown"><div class="countdown-label"><span class="live-dot"></span>Next Episode — S${ne.season_number}E${ne.episode_number}${ne.name ? ` "${esc(ne.name)}"` : ''}</div><div class="detail-local-airtime pending" id="nextAirTime_${id}"><i></i><span>Checking the exact local drop time…</span></div>${cdGrid}</div>`;
    } else if (!out) {
      const relRaw = type === 'tv' ? det.first_air_date : det.release_date;
      const rd = relRaw ? new Date(relRaw + 'T00:00:00') : null;
      if (rd && !isNaN(rd) && rd.getTime() > Date.now()) {
        cdDate = relRaw; cdDoneMsg = type === 'tv' ? '🎉 Now Airing!' : '🎉 Now Released!';
        const nice = rd.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
        cdHTML = `<div class="countdown"><div class="countdown-label"><span class="live-dot"></span>${type === 'tv' ? 'Premieres' : 'Releases'} ${esc(nice)}</div>${cdGrid}</div>`;
      }
    }

    let seasHTML = '';
    if (type === 'tv' && det.seasons?.length) { const vs = det.seasons.filter(s => s.season_number > 0);
      // Season-at-a-glance strip: poster, episode count and year per season, so
      // you can size up a long-running show without stepping through the tabs.
      const seasonCards = vs.map(s => {
        const yr = (s.air_date || '').slice(0, 4);
        const poster = s.poster_path ? `<img src="${IMG}w185${s.poster_path}" alt="${esc(s.name)}" loading="lazy">` : '';
        return `<div class="season-card" role="button" tabindex="0" data-action="load-season" data-tid="${id}" data-sn="${s.season_number}"><div class="season-poster">${poster}</div><div class="season-nm">${esc(s.name)}</div><div class="season-meta">${s.episode_count ? `${s.episode_count} ep${s.episode_count === 1 ? '' : 's'}` : ''}${yr && s.episode_count ? ' · ' : ''}${yr}</div></div>`;
      }).join('');
      seasHTML = `<div style="margin-bottom:32px"><div class="d-sec-title">Seasons</div><div class="season-scroll">${seasonCards}</div>`
        + `<div class="d-sec-title" style="margin-top:24px">Episodes</div><div class="season-tabs">${vs.map((s, i) => `<div class="s-tab ${i === 0 ? 'active' : ''}" role="button" tabindex="0" data-action="load-season" data-tid="${id}" data-sn="${s.season_number}">${esc(s.name)}</div>`).join('')}</div><div class="ep-list" id="epList_${id}"><div class="skel" style="height:80px;width:100%"></div></div></div>`; }

    const allVids = (vids.results || []).filter(v => v.site === 'YouTube').slice(0, 10);
    let vidsHTML = ''; if (allVids.length) vidsHTML = `<div style="margin-bottom:32px"><div class="d-sec-title">Videos & Trailers</div><div class="vid-scroll">${allVids.map(v => `<div class="vid-card" role="button" tabindex="0" data-action="play-trailer" data-key="${v.key}"><div class="vid-thumb"><img src="https://img.youtube.com/vi/${v.key}/mqdefault.jpg" alt="${esc(v.name)}" loading="lazy"><div class="vid-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div></div><div class="vid-name">${esc(v.name)}</div><div class="vid-type">${esc(v.type) || ''}</div></div>`).join('')}</div></div>`;

    const cast = (cred.cast || []).slice(0, 20);
    let castHTML = ''; if (cast.length) castHTML = `<div style="margin-bottom:32px"><div class="d-sec-title">Cast</div><div class="cast-scroll">${cast.map(c => `<a class="cast-item" href="/person/${c.id}" data-action="open-person" data-id="${c.id}"><div class="cast-pic">${c.profile_path ? `<img src="${IMG}w185${c.profile_path}" alt="${esc(c.name)}" loading="lazy">` : ''}</div><div class="cast-name">${esc(c.name)}</div><div class="cast-char">${esc(c.character) || ''}</div></a>`).join('')}</div></div>`;

    const crewHTML = crewSectionHTML(cred);
    const galHTML = galleryHTML(det);

    const revsHTML = reviewsHTML(revs);

    const simItems = recs.filter(item => !state.watched[`${item.media_type || type}_${item.id}`]).slice(0, 14);
    let simHTML = ''; if (simItems.length) simHTML = `<div style="margin-bottom:32px"><div class="d-sec-title">More Like This</div><div class="similar-row">${simItems.map(s => buildCard(s, s.media_type || type)).join('')}</div></div>`;

    const kws = det.keywords?.keywords || det.keywords?.results || [];
    let kwHTML = ''; if (kws.length) kwHTML = `<div style="margin-bottom:32px;display:flex;flex-wrap:wrap;gap:6px">${kws.slice(0, 15).map(k => `<span class="dtag" style="font-size:.72rem">${esc(k.name)}</span>`).join('')}</div>`;

    let collHTML = '';
    if (det.belongs_to_collection) { const c = det.belongs_to_collection;
      // The strip below the banner is filled in after paint (one extra request,
      // and only when the title actually belongs to a collection).
      collHTML = `<a class="coll-banner" href="/collection/${c.id}" data-action="go-collection" data-cid="${c.id}" style="margin:36px 0 28px">${c.backdrop_path ? `<img src="${IMG}w780${c.backdrop_path}" alt="">` : ''}<div class="coll-banner-content"><div><h3>Part of ${esc(c.name)}</h3><p>View the full collection →</p></div></div></a><div id="collStrip_${id}"></div>`; }

    ct.innerHTML = `
      ${back ? `<div class="detail-back"><img src="${back}" alt=""><div class="detail-back-grad"></div></div>` : '<div style="height:var(--nav-h)"></div>'}
      <div class="detail-inner">
        <div class="detail-top">
          <div class="detail-poster"><img src="${poster}" alt="${safeTitle}" data-ph="${PH}"></div>
          <div class="detail-head">
            ${titleHTML}
            ${det.tagline ? `<p class="detail-tagline">"${esc(det.tagline)}"</p>` : ''}
            <div class="detail-tags">
              <span class="dtag gold"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg><span data-count="${det.vote_average || 0}" data-decimals="1">${rat}</span></span>
              <span class="dtag">${year}</span>
              ${rt ? `<span class="dtag">${rt}</span>` : ''}
              ${cert ? `<span class="dtag">${cert}</span>` : ''}
              ${genres.map(g => `<span class="dtag">${esc(g)}</span>`).join('')}
            </div>
            <div class="detail-btns">
              ${trailer ? `<button class="btn-primary magnetic" data-action="play-trailer" data-key="${trailer.key}" data-tip="Play trailer"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>Play Trailer</button>` : ''}
              <button class="dbtn-icon ${wl ? 'active' : ''}" data-wl="${type}|${id}" data-action="open-list-picker" data-item="${wlPayload}" aria-label="${wl ? 'Edit lists' : 'Add to a list'}" data-tip="${wl ? 'Edit lists' : 'Add to a list'}">${wl ? '✓' : '+'}</button>
              ${out ? `<button class="dbtn-icon ${wd ? 'active' : ''}" data-action="toggle-watched" data-id="${id}" data-type="${type}" data-title="${safeTitle}" data-poster="${det.poster_path || ''}" data-year="${year}" data-genres="${esc(JSON.stringify((det.genres || []).map(g => g.id)))}" data-runtime="${det.runtime || det.episode_run_time?.[0] || 0}" data-language="${det.original_language || ''}" data-country="${contentCountry}" data-release-date="${contentReleaseDate}" data-tmdb-rating="${det.vote_average || 0}" data-vote-count="${det.vote_count || 0}" aria-label="${wd ? 'Unmark watched' : 'Mark as watched'}" data-tip="${wd ? 'Unmark watched' : 'Mark as watched'}" style="${wd ? 'color:var(--green);border-color:var(--green)' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg></button>` : ''}
              ${out ? `<button class="dbtn-icon" data-action="open-rating" data-id="${id}" data-type="${type}" data-title="${safeTitle}" aria-label="Rate" data-tip="Rate">${myRating ? `<span style="font-size:.72rem;font-weight:800;color:var(--gold)">${myRating}</span>` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'}</button>` : ''}
              ${out ? '' : `<span class="unreleased-note" data-tip="You can still add it to your list">${type === 'tv' ? 'Not aired yet' : 'Not released yet'}</span>`}
              <button class="dbtn-icon" data-action="share-item" data-title="${safeTitle}" data-id="${id}" data-type="${type}" aria-label="Share" data-tip="Share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>
            </div>
          </div>
        </div>
        ${cdHTML}${collHTML}
        <div class="detail-overview-wrap">
          <p class="detail-overview clamped" id="detOv">${esc(det.overview || 'No overview available.')}</p>
          <span class="detail-overview-toggle" id="detOvToggle" data-action="toggle-overview" hidden>Read more</span>
        </div>
        <div class="stats-grid">
          ${boHTML}
          ${det.status ? `<div class="stat-card"><div class="stat-label">Status</div><div class="stat-val"><span style="color:${det.status === 'Released' || det.status === 'Returning Series' ? 'var(--green2)' : 'var(--text)'}">${det.status === 'Returning Series' ? '<span class="live-dot"></span>' : ''} ${esc(det.status)}</span></div></div>` : ''}
          ${det.original_language ? `<div class="stat-card"><div class="stat-label">Language</div><div class="stat-val">${det.original_language.toUpperCase()}</div></div>` : ''}
          ${det.vote_count ? `<div class="stat-card"><div class="stat-label">Votes</div><div class="stat-val" data-count="${det.vote_count}">${det.vote_count.toLocaleString()}</div></div>` : ''}
          ${directorCardHTML(dirs, type)}
          ${type === 'tv' && det.number_of_seasons ? `<div class="stat-card"><div class="stat-label">Seasons</div><div class="stat-val" data-count="${det.number_of_seasons}">${det.number_of_seasons}</div></div>` : ''}
          ${type === 'tv' && det.number_of_episodes ? `<div class="stat-card"><div class="stat-label">Episodes</div><div class="stat-val" data-count="${det.number_of_episodes}">${det.number_of_episodes}</div></div>` : ''}
          ${networksHTML(det, type)}
          ${companiesHTML(det)}
          ${originalTitleHTML(det, type, title)}
          ${listCardHTML('Countries', (det.production_countries || []).map(c => c.name))}
          ${listCardHTML('Languages', (det.spoken_languages || []).map(l => l.english_name || l.name))}
          ${altTitlesHTML(det)}
          ${det.homepage ? `<div class="stat-card"><div class="stat-label">Website</div><div class="stat-val"><a href="${esc(det.homepage)}" target="_blank" rel="noopener" style="color:var(--cyan);font-size:.82rem;word-break:break-all">Visit →</a></div></div>` : ''}
          ${linksHTML(det)}
          <div id="providerBlock">${providerHTML(det, state.region)}</div>
        </div>
        <section class="awards-section" id="awardsSection_${id}" hidden></section>
        ${kwHTML}${vidsHTML}${castHTML}${crewHTML}${galHTML}${seasHTML}${revsHTML}${simHTML}
      </div>`;

    if (cdDate) startCD(id, cdDate, cdDoneMsg);
    if (type === 'tv' && det.next_episode_to_air) hydrateNextEpisodeTime(det, id, gen);
    if (type === 'tv' && det.seasons?.length) { const fs = det.seasons.find(s => s.season_number > 0); if (fs) loadEps(id, fs.season_number); }
    observeReveals(ct); observeCountUps(ct);
    // Animate the Box Office bar widths after paint (horizontal %-widths resolve
    // against the definite-width card).
    requestAnimationFrame(() => ct.querySelectorAll('.bo-fill').forEach(f => { f.style.width = (+f.dataset.w || 0) + '%'; }));
    // Reveal a "Read more" ONLY where the text actually overflows its clamp.
    if (clampResize) { window.removeEventListener('resize', clampResize); clampResize = null; }
    const remeasure = syncAllClampToggles(ct);
    clampResize = debounce(remeasure, 150);
    window.addEventListener('resize', clampResize);
    loadAwardsSection(det.external_ids?.imdb_id || '', `awardsSection_${id}`);
    // The rest of the franchise, under the collection banner.
    if (det.belongs_to_collection) loadCollectionStrip(id, det.belongs_to_collection.id, gen);
    // Video-forward: fade a muted looping trailer in behind the backdrop (desktop + motion only).
    if (back && trailer?.key) { const backEl = ct.querySelector('.detail-back'); if (backEl) ambientTeardown = mountAmbientVideo(backEl, trailer.key); }
  } catch (e) {
    console.error(e);
    ct.innerHTML = '<div style="text-align:center;padding:120px 20px"><p style="font-size:1.1rem;font-weight:600">Failed to load</p><p style="color:var(--text3);margin:8px 0 20px">Please try again</p><button class="btn-primary" data-action="back">Back</button></div>';
  }
}

// ===== RELEASE STATE =====
// Has this actually come out? Drives whether "mark as watched" and "rate" are
// offered — they're meaningless on an unreleased title, and because this is
// computed from the date at render time, both appear on their own the day it lands.
// The date is the source of truth (TMDB `status` lags, and lists "Released" for
// titles still weeks out in some regions); status is only a fallback when a title
// carries no date at all.
export function isReleased(det, type) {
  const raw = type === 'tv' ? det.first_air_date : det.release_date;
  if (raw) {
    const d = new Date(raw + 'T00:00:00');
    if (!isNaN(d)) return d.getTime() <= Date.now();
  }
  // No date on record: trust status, and default to treating it as out so a data
  // gap can never silently strip the buttons from an old title.
  if (type === 'tv') return det.status !== 'Planned' && det.status !== 'In Production';
  return det.status ? det.status === 'Released' : true;
}

// ===== DIRECTORS =====
// A film can have several (the Coens, the Russos, the Daniels). Dedupe by person —
// TMDB lists someone once per job — and fall back to a TV show's creators, which is
// the closest equivalent when the crew carries no series-level director.
function directorsOf(det, cred, type) {
  const seen = new Map();
  (cred.crew || []).forEach(c => { if (c.job === 'Director' && !seen.has(c.id)) seen.set(c.id, { id: c.id, name: c.name || '', profile_path: c.profile_path }); });
  if (!seen.size && type === 'tv') {
    (det.created_by || []).forEach(c => { if (!seen.has(c.id)) seen.set(c.id, { id: c.id, name: c.name || '', profile_path: c.profile_path, __creator: true }); });
  }
  return [...seen.values()].slice(0, 4);
}

function directorCardHTML(dirs, type) {
  if (!dirs.length) return '';
  const isCreator = type === 'tv' && dirs.some(d => d.__creator);
  const label = dirs.length > 1 ? (isCreator ? 'Creators' : 'Directors') : (isCreator ? 'Creator' : 'Director');
  const rows = dirs.map(d => `<a class="sp-row" href="/person/${d.id}" data-action="open-person" data-id="${d.id}" data-tip="View ${esc(d.name)}"><div class="sp-pic">${d.profile_path ? `<img src="${IMG}w185${d.profile_path}" alt="${esc(d.name)}" loading="lazy" data-ph="${PH}">` : `<span class="sp-mono">${esc((d.name || '?')[0])}</span>`}</div><div class="sp-name">${esc(d.name)}</div></a>`).join('');
  // Each name is its own link now, so the card itself is no longer the click target.
  return `<div class="stat-card stat-person${dirs.length > 1 ? ' stat-person-multi' : ''}"><div class="stat-label">${label}</div>${rows}</div>`;
}

// ===== EXTERNAL LINKS =====
// external_ids ships on the main response (append_to_response) and was previously
// fetched and thrown away entirely.
const EXT_LINKS = [
  ['imdb_id', 'IMDb', id => `https://www.imdb.com/title/${id}/`],
  ['wikidata_id', 'Wikidata', id => `https://www.wikidata.org/wiki/${id}`],
  ['instagram_id', 'Instagram', id => `https://instagram.com/${id}`],
  ['twitter_id', 'X', id => `https://x.com/${id}`],
  ['facebook_id', 'Facebook', id => `https://facebook.com/${id}`],
];

// The other films in this title's collection, rendered under the banner. Skips
// the film you're already looking at, and stays silent on failure.
async function loadCollectionStrip(id, collectionId, gen) {
  const host = $(`collStrip_${id}`);
  if (!host) return;
  try {
    const d = await tmdb(`/collection/${collectionId}`);
    if (gen !== reqGen || !$(`collStrip_${id}`)) return;
    const parts = (d.parts || [])
      .filter(p => p && p.id !== id && p.poster_path)
      .sort((a, b) => new Date(a.release_date || '9999') - new Date(b.release_date || '9999'));
    if (!parts.length) return;
    host.innerHTML = `<div style="margin-bottom:32px"><div class="d-sec-title">More in ${esc(d.name || 'this collection')}</div><div class="similar-row">${parts.map(p => buildCard(p, 'movie')).join('')}</div></div>`;
    observeReveals(host);
  } catch (e) { /* the banner alone is fine */ }
}

// ===== STUDIOS / NETWORKS =====
// Every production company, not just the first one with a logo — each opens its
// own /studio/:id page. Logo-less companies fall back to a text chip.
function companiesHTML(det) {
  const cos = (det.production_companies || []).filter(c => c && c.id);
  if (!cos.length) return '';
  const one = c => c.logo_path
    ? `<a class="studio-logo" href="/studio/${c.id}" data-action="open-studio" data-id="${c.id}" data-tip="See ${esc(c.name)} titles"><img src="${IMG}w185${c.logo_path}" alt="${esc(c.name)}" title="${esc(c.name)}" loading="lazy"></a>`
    : `<a class="studio-name-link" href="/studio/${c.id}" data-action="open-studio" data-id="${c.id}" data-tip="See ${esc(c.name)} titles">${esc(c.name)}</a>`;
  return `<div class="stat-card stat-media"><div class="stat-label">${cos.length > 1 ? 'Studios' : 'Studio'}</div><div class="studio-logos">${cos.map(one).join('')}</div></div>`;
}

// TV networks get their own page too (/network/:id), since a network's catalogue
// is a different question from a production company's.
function networksHTML(det, type) {
  if (type !== 'tv') return '';
  const nets = (det.networks || []).filter(n => n && n.id);
  if (!nets.length) return '';
  const one = n => n.logo_path
    ? `<a class="studio-logo" href="/network/${n.id}" data-action="open-network" data-id="${n.id}" data-tip="See ${esc(n.name)} shows"><img src="${IMG}w185${n.logo_path}" alt="${esc(n.name)}" title="${esc(n.name)}" loading="lazy"></a>`
    : `<a class="studio-name-link" href="/network/${n.id}" data-action="open-network" data-id="${n.id}" data-tip="See ${esc(n.name)} shows">${esc(n.name)}</a>`;
  return `<div class="stat-card stat-media"><div class="stat-label">${nets.length > 1 ? 'Networks' : 'Network'}</div><div class="studio-logos">${nets.map(one).join('')}</div></div>`;
}

// A generic comma-list stat card (countries, languages).
function listCardHTML(label, values) {
  const vals = (values || []).filter(Boolean);
  if (!vals.length) return '';
  return `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-val" style="font-size:.82rem;line-height:1.5">${esc(vals.join(', '))}</div></div>`;
}

// Only worth showing when it actually differs from the title you're reading.
function originalTitleHTML(det, type, title) {
  const orig = type === 'tv' ? det.original_name : det.original_title;
  if (!orig || orig === title) return '';
  return `<div class="stat-card"><div class="stat-label">Original Title</div><div class="stat-val" style="font-size:.86rem">${esc(orig)}</div></div>`;
}

// A few alternative titles, preferring the user's region.
function altTitlesHTML(det) {
  const raw = det.alternative_titles || {};
  const all = raw.titles || raw.results || [];
  if (!all.length) return '';
  const region = state.region || 'US';
  const pick = [...all.filter(t => t.iso_3166_1 === region), ...all.filter(t => t.iso_3166_1 !== region)]
    .map(t => t.title).filter(Boolean);
  const seen = [...new Set(pick)].slice(0, 4);
  if (!seen.length) return '';
  return `<div class="stat-card"><div class="stat-label">Also Known As</div><div class="stat-val" style="font-size:.8rem;line-height:1.6">${esc(seen.join(' · '))}</div></div>`;
}

function linksHTML(det) {
  const ext = det.external_ids || {};
  const links = EXT_LINKS
    .filter(([k]) => ext[k])
    .map(([k, label, url]) => `<a class="ext-link" href="${esc(url(ext[k]))}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  if (!links.length) return '';
  return `<div class="stat-card"><div class="stat-label">Links</div><div class="stat-val ext-links">${links.join('')}</div></div>`;
}

// ===== FULL CREW =====
// credits.crew is already fetched; only the Director was ever surfaced. Ordered
// by importance, deduped by person (one human can hold several jobs).
const CREW_JOBS = ['Director', 'Creator', 'Writer', 'Screenplay', 'Story', 'Original Music Composer', 'Director of Photography', 'Editor', 'Producer', 'Executive Producer'];

function crewSectionHTML(cred) {
  const crew = cred.crew || [];
  const byPerson = new Map();
  crew.forEach(c => {
    const rank = CREW_JOBS.indexOf(c.job);
    if (rank === -1) return;
    const e = byPerson.get(c.id);
    if (e) { if (!e.jobs.includes(c.job)) e.jobs.push(c.job); e.rank = Math.min(e.rank, rank); }
    else byPerson.set(c.id, { id: c.id, name: c.name || '', profile_path: c.profile_path, jobs: [c.job], rank });
  });
  const people = [...byPerson.values()].sort((a, b) => a.rank - b.rank).slice(0, 30);
  if (!people.length) return '';
  // Crew now mirrors Cast: one ranked horizontal strip, with each person's jobs
  // kept directly below their name instead of splitting the row by department.
  const items = people.map(p => {
    const jobs = p.jobs.join(', ');
    return `<a class="cast-item" href="/person/${p.id}" data-action="open-person" data-id="${p.id}"><div class="cast-pic">${p.profile_path ? `<img src="${IMG}w185${p.profile_path}" alt="${esc(p.name)}" loading="lazy">` : ''}</div><div class="cast-name">${esc(p.name)}</div><div class="cast-char" title="${esc(jobs)}">${esc(jobs)}</div></a>`;
  }).join('');
  return `<div style="margin-bottom:32px"><div class="d-sec-title">Crew</div><div class="cast-scroll crew-scroll">${items}</div></div>`;
}

async function hydrateNextEpisodeTime(show, id, gen) {
  const time = await exactEpisodeTime(show);
  if (gen !== reqGen) return;
  const label = $(`nextAirTime_${id}`);
  if (!label) return;
  if (!time?.airstamp) {
    label.className = 'detail-local-airtime';
    label.innerHTML = '<i></i><span><b>Exact time not announced</b><small>The confirmed episode date is shown above.</small></span>';
    return;
  }
  label.className = 'detail-local-airtime exact';
  label.innerHTML = `<i></i><span><b>${esc(localEpisodeTime(time.airstamp))}</b><small>Exact drop · converted to ${esc(localTimeZone())} · <a href="https://www.tvmaze.com" target="_blank" rel="noopener">TVmaze</a></small></span>`;
  state.cdIntervals.forEach(clearInterval); state.cdIntervals = [];
  startCD(id, time.airstamp, '🎉 Now Airing!');
}

// ===== MEDIA GALLERY =====
// images.{backdrops,posters} already ride along with the logo fetch. Capped at 12
// each — a popular title can carry 100+. Thumbs get an explicit aspect-ratio so
// lazy-loaded images reserve their box and never shift the page.
function galleryHTML(det) {
  const backs = (det.images?.backdrops || []).slice(0, 12);
  const posters = (det.images?.posters || []).slice(0, 12);
  if (!backs.length && !posters.length) return '';
  const group = (list, size, cls, label) => {
    if (!list.length) return '';
    const paths = esc(JSON.stringify(list.map(i => i.file_path)));
    return `<div class="gal-group"><div class="gal-label">${label}</div><div class="gal-scroll">${list.map((i, idx) =>
      `<button class="gal-item ${cls}" data-action="open-lightbox" data-paths="${paths}" data-idx="${idx}" aria-label="${label} ${idx + 1} of ${list.length}"><img src="${IMG}${size}${i.file_path}" alt="" loading="lazy"></button>`
    ).join('')}</div></div>`;
  };
  return `<div style="margin-bottom:32px"><div class="d-sec-title">Gallery</div>${group(backs, 'w780', 'gal-back', 'Backdrops')}${group(posters, 'w342', 'gal-poster', 'Posters')}</div>`;
}

function providerHTML(det, region) {
  const results = det['watch/providers']?.results || {};
  const prov = results[region] || {};
  const title = det.title || det.name || '';
  const regionLink = prov.link || '';   // TMDB's region-level JustWatch page (fallback)
  const options = REGIONS.map(([code, label]) => `<option value="${code}" ${code === region ? 'selected' : ''}>${label}</option>`).join('');
  // Each logo is now a link to that provider's OWN search for the title (or the
  // JustWatch page / web search as a fallback). Rent + Buy are surfaced too.
  const logoLink = p => {
    const url = providerUrl(p.provider_name, title, regionLink);
    return `<a class="provider-logo-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Search ${esc(p.provider_name)}"><img class="provider-logo" src="${IMG}w92${p.logo_path}" alt="${esc(p.provider_name)}" loading="lazy"></a>`;
  };
  const groups = [['Stream', prov.flatrate], ['Rent', prov.rent], ['Buy', prov.buy], ['Ads', prov.ads]]
    .filter(([, list]) => list && list.length);
  const inner = groups.length
    ? groups.map(([label, list]) => `<div class="provider-group"><div class="provider-group-label">${label}</div><div class="provider-icons">${list.slice(0, 6).map(logoLink).join('')}</div></div>`).join('')
    : '<span style="font-size:.78rem;color:var(--text3)">Not available in your region</span>';
  return `<div class="stat-card"><div class="stat-label" style="display:flex;align-items:center">Where to Watch<select class="region-select" data-action="region-change">${options}</select></div><div class="stat-val providers">${inner}</div></div>`;
}

// ===== REVIEWS =====
// A 0–10 rating rendered as a 5-star meter (a gold fill clipped to the score) plus
// the raw number; long bodies get a per-review "Read more"; the first 6 show, the
// rest reveal behind "Show all".
function starMeter(score10) {
  const pct = Math.max(0, Math.min(100, score10 * 10));
  const stars = '★★★★★';
  return `<span class="rev-stars" aria-label="${score10} out of 10"><span class="rev-stars-bg">${stars}</span><span class="rev-stars-fill" style="width:${pct}%">${stars}</span></span><span class="rev-score-num">${score10}/10</span>`;
}

function reviewCard(r, i) {
  const rating = r.author_details?.rating;
  const date = r.created_at ? new Date(r.created_at).toLocaleDateString() : '';
  return `<div class="review"><div class="review-top"><div class="review-av">${esc((r.author || '?')[0].toUpperCase())}</div><div class="review-who"><div class="review-author">${esc(r.author)}</div><div class="review-date">${date}</div></div>${rating != null ? `<div class="review-score">${starMeter(rating)}</div>` : ''}</div><div class="review-body" id="rev_body_${i}">${esc(r.content || '')}</div><span class="review-toggle" data-action="toggle-review" data-target="rev_body_${i}" hidden>Read more</span></div>`;
}

function reviewsHTML(revs) {
  const all = revs.results || [];
  if (!all.length) return '';
  const first = all.slice(0, 6).map(reviewCard).join('');
  const rest = all.slice(6);
  const more = rest.length
    ? `<div id="revMore" hidden>${rest.map((r, i) => reviewCard(r, i + 6)).join('')}</div><button class="review-showall" data-action="show-all-reviews">Show all ${all.length} reviews</button>`
    : '';
  return `<div style="margin-bottom:32px"><div class="d-sec-title">Reviews</div>${first}${more}</div>`;
}

// Reveal a clamp toggle ONLY when the text actually overflows its line-clamp.
//
// A hidden unclamped copy gives us a reliable full height. Reading scrollHeight
// directly is inconsistent with CSS line-clamp and can produce false positives.
function hasClampedOverflow(body) {
  const width = body.getBoundingClientRect().width;
  if (!width) return false;
  const clone = body.cloneNode(true);
  clone.removeAttribute('id');
  clone.classList.remove('clamped', 'expanded');
  Object.assign(clone.style, {
    position: 'fixed', left: '-10000px', top: '0', visibility: 'hidden',
    pointerEvents: 'none', width: `${width}px`, maxWidth: 'none', height: 'auto',
    maxHeight: 'none', overflow: 'visible', display: 'block',
    WebkitLineClamp: 'unset', lineClamp: 'unset'
  });
  body.parentElement.appendChild(clone);
  const fullHeight = clone.getBoundingClientRect().height;
  clone.remove();
  return fullHeight > body.getBoundingClientRect().height + 1;
}

function syncClampToggle(body, toggle) {
  if (!body || !toggle) return;
  // An expanded body has no clamp to overflow — leave the toggle as the user set it.
  if (toggle.dataset.expanded === '1') return;
  toggle.hidden = !hasClampedOverflow(body);
}

// Measure every clamped block on the page, after fonts are ready and on resize
// (a narrower window turns 4 lines into 6, and vice versa).
function syncAllClampToggles(scope) {
  const run = () => {
    syncClampToggle($('detOv'), $('detOvToggle'));
    scope.querySelectorAll('.review-body').forEach(b => syncClampToggle(b, scope.querySelector(`.review-toggle[data-target="${b.id}"]`)));
  };
  requestAnimationFrame(run);
  // Fonts change the metrics, so re-measure once they've loaded.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => requestAnimationFrame(run)).catch(() => {});
  return run;
}

// Premium financial overview. Revenue minus production budget is labelled as a
// gross difference—not profit—because marketing and exhibitor shares are absent.
function boxOfficeHTML(det) {
  const budget = det.budget || 0, revenue = det.revenue || 0;
  if (!budget && !revenue) return '';
  const max = Math.max(budget, revenue, 1);
  const bW = Math.round(budget / max * 100), rW = Math.round(revenue / max * 100);
  const hasBoth = !!(budget && revenue);
  const difference = revenue - budget;
  const multiple = budget ? revenue / budget : 0;
  const recovery = budget ? Math.round(multiple * 100) : 0;
  const variance = budget ? Math.round(difference / budget * 100) : 0;
  const ring = Math.min(100, Math.max(0, recovery));
  const status = !hasBoth ? 'Reported figures' : difference >= 0 ? 'Gross above budget' : 'Gross below budget';
  return `<div class="stat-card boxoffice">
    <div class="bo-head"><div><span class="bo-eyebrow">Financial performance</span><h3>Box Office</h3></div><span class="bo-status${hasBoth ? difference >= 0 ? ' positive' : ' negative' : ''}">${status}</span></div>
    <div class="bo-dashboard">
      <div class="bo-main">
        <div class="bo-metrics">
          ${budget ? `<div><span>Production budget</span><strong>$${fmt(budget)}</strong></div>` : ''}
          ${revenue ? `<div><span>Worldwide gross</span><strong>$${fmt(revenue)}</strong></div>` : ''}
          ${hasBoth ? `<div class="${difference >= 0 ? 'positive' : 'negative'}"><span>Gross difference</span><strong>${difference >= 0 ? '+' : '−'}$${fmt(Math.abs(difference))}</strong></div>` : ''}
        </div>
        <div class="bo-bars" aria-label="Budget and worldwide gross comparison">
          ${budget ? `<div class="bo-row"><span class="bo-name">Budget</span><div class="bo-track"><div class="bo-fill budget" style="width:0" data-w="${bW}"></div></div><span class="bo-val">$${fmt(budget)}</span></div>` : ''}
          ${revenue ? `<div class="bo-row"><span class="bo-name">Gross</span><div class="bo-track"><div class="bo-fill revenue" style="width:0" data-w="${rW}"></div></div><span class="bo-val">$${fmt(revenue)}</span></div>` : ''}
        </div>
      </div>
      ${budget && revenue ? `<div class="bo-recovery"><div class="bo-ring" style="--bo-progress:${ring * 3.6}deg"><div><strong>${recovery}%</strong><span>of budget</span></div></div><p>Budget recovery</p></div>` : ''}
    </div>
    ${hasBoth ? `<div class="bo-summary"><div class="bo-chip"><span class="bo-clabel">Gross multiple</span><span class="bo-cval">${multiple.toFixed(2)}×</span></div><div class="bo-chip ${variance >= 0 ? 'up' : 'down'}"><span class="bo-clabel">Budget difference</span><span class="bo-cval">${variance >= 0 ? '+' : ''}${variance}%</span></div></div>` : ''}
    <p class="bo-note">Worldwide gross compared with reported production budget. Marketing, distribution, and cinema shares are not included.</p>
  </div>`;
}

export function closeDetail() {
  state.cdIntervals.forEach(clearInterval); state.cdIntervals = [];
  if (ambientTeardown) { ambientTeardown(); ambientTeardown = null; }
  if (clampResize) { window.removeEventListener('resize', clampResize); clampResize = null; }
}

function getCert(d, t) {
  if (t === 'movie') { const u = d.release_dates?.results?.find(r => r.iso_3166_1 === 'US'); return u?.release_dates?.[0]?.certification || ''; }
  return d.content_ratings?.results?.find(r => r.iso_3166_1 === 'US')?.rating || '';
}

function startCD(id, ds, doneMsg = '🎉 Now Airing!') {
  const tg = new Date(ds).getTime();
  function up() {
    const df = tg - Date.now();
    if (df <= 0) { const e = $(`cd_d_${id}`); if (e) e.parentElement.parentElement.innerHTML = `<div style="color:var(--green2);font-size:1rem;font-weight:700">${doneMsg}</div>`; return; }
    const d = Math.floor(df / 864e5), h = Math.floor(df % 864e5 / 36e5), m = Math.floor(df % 36e5 / 6e4), s = Math.floor(df % 6e4 / 1e3);
    const de = $(`cd_d_${id}`), he = $(`cd_h_${id}`), me = $(`cd_m_${id}`), se = $(`cd_s_${id}`);
    if (de) de.textContent = String(d).padStart(2, '0'); if (he) he.textContent = String(h).padStart(2, '0'); if (me) me.textContent = String(m).padStart(2, '0'); if (se) se.textContent = String(s).padStart(2, '0');
  }
  up(); state.cdIntervals.push(setInterval(up, 1000));
}

async function loadSeason(tid, sn, el) {
  // Triggered by a season TAB or by a card in the seasons strip, so sync the tab
  // by season number rather than assuming the clicked element is the tab itself.
  const ct = $('detailContent');
  if (ct) {
    ct.querySelectorAll('.s-tab').forEach(t => t.classList.toggle('active', +t.dataset.sn === sn));
    ct.querySelectorAll('.season-card').forEach(c => c.classList.toggle('active', +c.dataset.sn === sn));
  }
  await loadEps(tid, sn);
  // Coming from the strip, the episode list is further down — bring it into view.
  if (el && el.classList.contains('season-card')) {
    const list = $(`epList_${tid}`);
    if (list && list.scrollIntoView) list.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
async function loadEps(tid, sn) {
  const el = $(`epList_${tid}`); if (!el) return;
  // Own generation token (mirrors reqGen): clicking season tabs quickly could
  // otherwise let a slow season-1 response land after — and overwrite — season 2.
  const gen = ++epGen;
  el.innerHTML = '<div class="skel" style="height:80px;width:100%"></div>';
  try {
    const d = await tmdb(`/tv/${tid}/season/${sn}`);
    if (gen !== epGen) return;
    el.innerHTML = (d.episodes || []).map(ep => `<div class="ep-card"><div class="ep-still">${ep.still_path ? `<img src="${IMG}w300${ep.still_path}" alt="" loading="lazy">` : ''}<div class="ep-num">E${ep.episode_number}</div></div><div class="ep-body"><div class="ep-title">${esc(ep.name) || `Episode ${ep.episode_number}`}</div><div class="ep-meta">${ep.air_date ? `<span>${new Date(ep.air_date).toLocaleDateString()}</span>` : ''}${ep.runtime ? `<span>${ep.runtime}m</span>` : ''}${ep.vote_average ? `<span>⭐ ${ep.vote_average.toFixed(1)}</span>` : ''}</div><div class="ep-desc">${esc(ep.overview || '')}</div></div></div>`).join('') || '<p style="color:var(--text3);padding:12px">No episodes yet</p>';
  } catch (e) {
    if (gen !== epGen) return;
    el.innerHTML = '<p style="color:var(--text3);padding:12px">Failed to load</p>';
  }
}

export async function openCollection(cid) {
  const gen = ++reqGen; // shares the counter with openDetail — navigating between either invalidates the other's in-flight fetch
  const ct = $('detailContent');
  document.title = 'Collection — CineVerse';
  try {
    const d = await tmdb(`/collection/${cid}`);
    if (gen !== reqGen) return;
    if (d.parts?.length) {
      const sorted = d.parts.sort((a, b) => new Date(a.release_date || '9999') - new Date(b.release_date || '9999'));
      document.title = `${d.name} — CineVerse`;
      ct.innerHTML = `<div style="padding:calc(var(--nav-h) + 20px) clamp(16px,4vw,40px) 100px;max-width:1100px;margin:0 auto">
        <h1 style="font-family:var(--font-display);font-size:2rem;margin-bottom:4px">${esc(d.name)}</h1>
        ${d.overview ? `<p style="color:var(--text2);font-size:.92rem;line-height:1.7;margin-bottom:24px;max-width:600px">${esc(d.overview)}</p>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:14px">${sorted.map(m => buildCard(m, 'movie')).join('')}</div>
      </div>`;
      observeReveals(ct);
    }
  } catch (e) { ct.innerHTML = '<div style="text-align:center;padding:120px 20px"><p style="font-weight:600">Failed to load collection</p><button class="btn-primary" data-action="back">Back</button></div>'; }
}

export function initDetail() {
  registerActions({
    'open-detail': (el, e) => {
      if (e) e.stopPropagation();
      const id = +el.dataset.id, type = el.dataset.type;
      // Capture the clicked card's poster + title for the instant-paint scaffold,
      // and tag the poster as the shared-element morph source.
      const img = el.querySelector && el.querySelector('.card-img img');
      if (img && img.src) {
        navHint = { id, type, poster: img.src, title: (el.querySelector('.card-title')?.textContent) || el.getAttribute('aria-label') || '' };
        if (lastVTSource) { try { lastVTSource.style.viewTransitionName = ''; } catch (er) {} }
        try { img.style.viewTransitionName = 'cv-hero'; lastVTSource = img; } catch (er) {}
      } else { navHint = null; }
      document.dispatchEvent(new CustomEvent('cv:go', { detail: `/${type}/${id}` }));
    },
    'toggle-overview': (el) => {
      const ov = $('detOv'); if (!ov) return;
      const clamped = ov.classList.toggle('clamped');
      el.textContent = clamped ? 'Read more' : 'Show less';
      // Expanded text can't overflow, so mark it — otherwise a resize re-measure
      // would decide there's nothing to expand and hide the "Show less" control.
      el.dataset.expanded = clamped ? '0' : '1';
    },
    'toggle-review': (el) => {
      const body = $(el.dataset.target); if (!body) return;
      const expanded = body.classList.toggle('expanded');
      el.textContent = expanded ? 'Show less' : 'Read more';
      el.dataset.expanded = expanded ? '1' : '0';
    },
    'show-all-reviews': (el) => {
      const more = $('revMore');
      if (more) {
        more.hidden = false;
        // Reveal Read-more on the newly shown bodies that overflow.
        more.querySelectorAll('.review-body').forEach(b => {
          const t = more.querySelector(`.review-toggle[data-target="${b.id}"]`);
          if (t) syncClampToggle(b, t);
        });
      }
      el.remove();
    },
    'load-season': (el) => loadSeason(+el.dataset.tid, +el.dataset.sn, el),
    'go-collection': (el) => document.dispatchEvent(new CustomEvent('cv:go', { detail: `/collection/${el.dataset.cid}` })),
    'region-change': (el) => {
      state.region = el.value;
      try { localStorage.setItem('cv_region', state.region); } catch (e) {}
      if (curDet) { const block = $('providerBlock'); if (block) block.innerHTML = providerHTML(curDet, state.region); }
      document.dispatchEvent(new Event('cv:region'));
    },
  });
}
