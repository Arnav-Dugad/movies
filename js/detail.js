// ===== DETAIL PAGE =====
import { tmdb } from './api.js';
import { IMG, PH, REGIONS, pickLogo, providerUrl, regionLabel } from './config.js';
import { state, pushRecentlyViewed } from './state.js';
import { esc, fmt, debounce, $, prefersReducedMotion, toast } from './ui.js';
import { buildCard } from './cards.js';
import { registerActions } from './events.js';
import { observeReveals, observeCountUps } from './effects.js';
import { mountAmbientVideo } from './video-bg.js';
import { loadAwardsSection } from './awards.js';
import { exactEpisodeTime, localEpisodeTime, localTimeZone, isEpisodeAvailable } from './episode-times.js';
import { syncShowStructure, showProgress, nextUp, seasonWatchedCount, isEpisodeWatched, toggleEpisode, markUpTo, setEpisodePosition, episodeLabel, setSeasonWatched, clearShowProgress, markShowWatched, tvShowMeta as showMeta,
  seasonAiredCount, isSeasonComplete, seasonPlayCount, seasonPlayLabel, logSeasonRewatch, removeSeasonRewatch } from './episodes.js';
import { prefs, updatePref } from './prefs.js';
import { playCount, playDates, logPlay, removeLastPlay, playLabel } from './rewatch.js';
import { collectionParts, collectionProgress, progressLabel } from './franchise.js';

let curDet = null, curType = null;
let ambientTeardown = null;   // tears down the detail ambient video
let navHint = null;           // instant-paint hint captured from the clicked card
let lastVTSource = null;      // element currently holding the shared view-transition-name
let clampResize = null;       // window resize handler that re-measures the read-more toggles
let reqGen = 0;                // bumped on every openDetail/openCollection call; guards against a slower, stale fetch overwriting a newer one
// Which account the page on screen was built for. Firebase resolves auth
// asynchronously, so a page opened straight from a URL — a shared link, a
// refresh, "open in new tab" — renders while the library is still empty. The
// watched tick, the rating, the rewatch strip and the episode panel all describe
// that empty library, and nothing corrected them afterwards.
let renderedFor = { uid: null, kind: null, id: 0 };
let epGen = 0;                 // same idea, scoped to the season-episode list (season tabs can be clicked faster than they load)
const countdownTimers = new Map(); // one precision clock per title; exact airtimes replace date-only estimates

const DETAIL_SECTION_ICONS = {
  detailBoxOfficeExpanded: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19V9m5 10V5m6 14v-7m5 7V3"/><path d="M2 21h20"/></svg>',
  detailGalleryExpanded: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m5 18 5-5 3 3 2-2 4 4"/></svg>',
  detailReviewsExpanded: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 5h14v11H9l-4 4V5Z"/><path d="M8 9h8M8 12h5"/></svg>',
};

function detailAccordion(prefKey, eyebrow, title, summary, body, tone = '') {
  const expanded = !!prefs[prefKey], bodyId = `detailSection_${prefKey}`;
  return `<section class="detail-accordion ${tone}${expanded ? ' expanded' : ''}"><button class="detail-accordion-toggle" data-action="toggle-detail-section" data-pref="${prefKey}" aria-expanded="${expanded}" aria-controls="${bodyId}"><span class="detail-accordion-icon">${DETAIL_SECTION_ICONS[prefKey] || ''}</span><span class="detail-accordion-copy"><small>${esc(eyebrow)}</small><strong>${esc(title)}</strong><em>${esc(summary)}</em></span><span class="detail-accordion-state"><b>${expanded ? 'Open' : 'Collapsed'}</b><i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></i></span></button><div class="detail-accordion-body" id="${bodyId}"${expanded ? '' : ' hidden'}>${body}</div></section>`;
}

function countdownGrid(id) {
  return `<div class="countdown-grid" aria-label="Time remaining"><div class="cd-unit"><span class="cd-index">01</span><div class="cd-num" id="cd_d_${id}">--</div><div class="cd-txt">Days</div></div><span class="cd-separator">:</span><div class="cd-unit"><span class="cd-index">02</span><div class="cd-num" id="cd_h_${id}">--</div><div class="cd-txt">Hours</div></div><span class="cd-separator">:</span><div class="cd-unit"><span class="cd-index">03</span><div class="cd-num" id="cd_m_${id}">--</div><div class="cd-txt">Minutes</div></div><span class="cd-separator">:</span><div class="cd-unit"><span class="cd-index">04</span><div class="cd-num" id="cd_s_${id}">--</div><div class="cd-txt">Seconds</div></div></div>`;
}

function countdownPanel(id, { eyebrow, title, note, localHTML = '' }) {
  return `<section class="countdown" data-countdown-shell="${id}" style="--cd-progress:0deg"><div class="countdown-gridlines"></div><div class="countdown-beam"></div><header class="countdown-head"><div><span class="countdown-signal"><i></i>${esc(eyebrow)}</span><h2>${esc(title)}</h2><p>${esc(note)}</p></div><span class="countdown-live-chip"><i></i>Live clock</span></header><div class="countdown-stage"><div class="countdown-context">${localHTML}</div>${countdownGrid(id)}<div class="countdown-orbit"><div><strong id="cd_pct_${id}">0%</strong><span>journey</span></div><small>Auto-synced</small></div></div><div class="countdown-foot"><span><i></i>Your local timezone</span><span id="cd_target_${id}">Target synchronising</span><span>Precision: 1 second</span></div></section>`;
}

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
  state.cdIntervals.forEach(clearInterval); state.cdIntervals = []; countdownTimers.clear();
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
    renderedFor = { uid: state.user?.uid || null, kind: 'detail', id: +id };

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
    const kws = det.keywords?.keywords || det.keywords?.results || [];
    const keywordMeta = kws.slice(0, 15).map(keyword => ({ id: +keyword.id, name: keyword.name || '' })).filter(keyword => keyword.id && keyword.name);

    // Record for personalization
    pushRecentlyViewed({ id, type, title, poster: det.poster_path || '', genres: (det.genres || []).map(g => g.id), keywords: keywordMeta });

    // Watchlist payload
    const contentCountry = det.origin_country?.[0] || det.production_countries?.[0]?.iso_3166_1 || '';
    const contentReleaseDate = det.release_date || det.first_air_date || '';
    const wlPayload = esc(JSON.stringify({ id, type, title, poster: det.poster_path || '', rating: det.vote_average || 0, year, genres: (det.genres || []).map(g => g.id), keywords: keywordMeta, runtime: det.runtime || det.episode_run_time?.[0] || 0, language: det.original_language || '', country: contentCountry, releaseDate: contentReleaseDate }));

    const boHTML = boxOfficeHTML(det);

    // One countdown block, shared markup. For an airing show it counts to the next
    // episode; for anything not yet out it counts to the release/premiere date.
    let cdHTML = '', cdDate = null, cdDoneMsg = '';
    if (type === 'tv' && det.next_episode_to_air && !isEpisodeAvailable(det.next_episode_to_air, { showId: id })) {
      const ne = det.next_episode_to_air;
      cdDate = `${ne.air_date}T00:00:00`; cdDoneMsg = '🎉 Now Airing!';
      const episode = `S${ne.season_number}E${ne.episode_number}${ne.name ? ` · ${ne.name}` : ''}`;
      cdHTML = countdownPanel(id, { eyebrow: 'Next episode intelligence', title: episode, note: 'A precision countdown that automatically upgrades when an exact network time is confirmed.', localHTML: `<div class="detail-local-airtime pending" id="nextAirTime_${id}"><i></i><span><b>Confirming local drop</b><small>Checking the broadcaster schedule…</small></span></div>` });
    } else if (!out) {
      const relRaw = type === 'tv' ? det.first_air_date : det.release_date;
      const rd = relRaw ? new Date(relRaw + 'T00:00:00') : null;
      if (rd && !isNaN(rd) && rd.getTime() > Date.now()) {
        cdDate = relRaw; cdDoneMsg = type === 'tv' ? '🎉 Now Airing!' : '🎉 Now Released!';
        const nice = rd.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
        cdHTML = countdownPanel(id, { eyebrow: type === 'tv' ? 'Premiere intelligence' : 'Release intelligence', title: `${type === 'tv' ? 'Premieres' : 'Releases'} ${nice}`, note: 'The calendar target is shown in your local timezone and updates every second.', localHTML: `<div class="detail-local-airtime release"><i></i><span><b>${esc(nice)}</b><small>Local calendar date · ${esc(localTimeZone())}</small></span></div>` });
      }
    }

    let seasHTML = '', initialSeason = null;
    if (type === 'tv' && det.seasons?.length) {
      const vs = det.seasons.filter(s => s.season_number > 0);
      // Keep the progress document's idea of the show current before anything
      // reads it, so "next up" is right even for a show that gained a season.
      syncShowStructure(id, showMeta(det));
      const progress = showProgress(id);
      const next = nextUp(id);
      const openSeason = next?.season ?? progress.lastWatched?.season ?? det.last_episode_to_air?.season_number ?? vs[0]?.season_number;
      initialSeason = openSeason;

      const seasonCards = vs.map(s => {
        const yr = (s.air_date || '').slice(0, 4);
        const poster = s.poster_path ? `<img src="${IMG}w185${s.poster_path}" alt="${esc(s.name)}" loading="lazy">` : '';
        const done = seasonWatchedCount(id, s.season_number);
        const pct = s.episode_count ? Math.min(100, Math.round(done / s.episode_count * 100)) : 0;
        return `<div class="season-card${s.season_number === openSeason ? ' active' : ''}${pct === 100 ? ' complete' : ''}" role="button" tabindex="0" data-action="load-season" data-tid="${id}" data-sn="${s.season_number}" data-total="${s.episode_count || 0}">
          <div class="season-poster">${poster}<span class="season-ring${done ? '' : ' idle'}" style="--season-progress:${pct * 3.6}deg"><b>${pct}%</b></span></div>
          <div class="season-nm">${esc(s.name)}</div>
          <div class="season-meta">${s.episode_count ? `${done ? `${done}/${s.episode_count}` : s.episode_count} ep${s.episode_count === 1 ? '' : 's'}` : ''}${yr && s.episode_count ? ' · ' : ''}${yr}</div>
        </div>`;
      }).join('');

      seasHTML = `<div style="margin-bottom:32px">${showProgressPanel(id, det, progress, next)}
        <div class="d-sec-title">Seasons</div><div class="season-scroll">${seasonCards}</div>
        <div class="d-sec-title" style="margin-top:24px">Episodes</div>
        <div class="season-tabs">${vs.map(s => `<div class="s-tab ${s.season_number === openSeason ? 'active' : ''}" role="button" tabindex="0" data-action="load-season" data-tid="${id}" data-sn="${s.season_number}">${esc(s.name)}</div>`).join('')}</div>
        <div class="ep-list" id="epList_${id}"><div class="skel" style="height:80px;width:100%"></div></div></div>`;
    }

    const allVids = (vids.results || []).filter(v => v.site === 'YouTube').slice(0, 10);
    let vidsHTML = ''; if (allVids.length) vidsHTML = `<div style="margin-bottom:32px"><div class="d-sec-title">Videos & Trailers</div><div class="vid-scroll">${allVids.map(v => `<div class="vid-card" role="button" tabindex="0" data-action="play-trailer" data-key="${v.key}"><div class="vid-thumb"><img src="https://img.youtube.com/vi/${v.key}/mqdefault.jpg" alt="${esc(v.name)}" loading="lazy"><div class="vid-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div></div><div class="vid-name">${esc(v.name)}</div><div class="vid-type">${esc(v.type) || ''}</div></div>`).join('')}</div></div>`;

    const cast = (cred.cast || []).slice(0, 20);
    let castHTML = ''; if (cast.length) castHTML = `<div style="margin-bottom:32px"><div class="d-sec-title">Cast</div><div class="cast-scroll">${cast.map(c => `<a class="cast-item" href="/person/${c.id}" data-action="open-person" data-id="${c.id}"><div class="cast-pic">${c.profile_path ? `<img src="${IMG}w185${c.profile_path}" alt="${esc(c.name)}" loading="lazy">` : ''}</div><div class="cast-name">${esc(c.name)}</div><div class="cast-char">${esc(c.character) || ''}</div></a>`).join('')}</div></div>`;

    const crewHTML = crewSectionHTML(cred);
    const galHTML = galleryHTML(det);

    const revsHTML = reviewsHTML(revs);

    const simItems = recs.filter(item => !state.watched[`${item.media_type || type}_${item.id}`]).slice(0, 14);
    let simHTML = ''; if (simItems.length) simHTML = `<div style="margin-bottom:32px"><div class="d-sec-title">More Like This</div><div class="similar-row">${simItems.map(s => buildCard(s, s.media_type || type)).join('')}</div></div>`;

    let kwHTML = ''; if (kws.length) kwHTML = `<div class="detail-keywords">${kws.slice(0, 15).map(k => `<button class="dtag detail-keyword" data-action="search-tag" data-tag="${esc(k.name)}" aria-label="Search titles tagged ${esc(k.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>${esc(k.name)}</button>`).join('')}</div>`;

    let collHTML = '';
    if (det.belongs_to_collection) { const c = det.belongs_to_collection;
      // The strip below the banner is filled in after paint (one extra request,
      // and only when the title actually belongs to a collection).
      // The meter is empty until the parts list lands (loadCollectionStrip already
      // fetches it, so completion costs no extra request).
      collHTML = `<a class="coll-banner" href="/collection/${c.id}" data-action="go-collection" data-cid="${c.id}" style="margin:36px 0 28px">${c.backdrop_path ? `<img src="${IMG}w780${c.backdrop_path}" alt="">` : ''}<div class="coll-banner-content"><div><h3>Part of ${esc(c.name)}</h3><p>View the full collection →</p></div><div class="coll-progress" id="collProg_${id}"></div></div></a><div id="collStrip_${id}"></div>`; }

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
              ${out ? `<button class="dbtn-icon ${wd ? 'active' : ''}" data-action="toggle-watched" data-id="${id}" data-type="${type}" data-title="${safeTitle}" data-poster="${det.poster_path || ''}" data-year="${year}" data-genres="${esc(JSON.stringify((det.genres || []).map(g => g.id)))}" data-keywords="${esc(JSON.stringify(keywordMeta))}" data-runtime="${det.runtime || det.episode_run_time?.[0] || 0}" data-language="${det.original_language || ''}" data-country="${contentCountry}" data-release-date="${contentReleaseDate}" data-tmdb-rating="${det.vote_average || 0}" data-vote-count="${det.vote_count || 0}" data-collection-id="${det.belongs_to_collection?.id || 0}" data-collection-name="${esc(det.belongs_to_collection?.name || '')}" data-collection-poster="${det.belongs_to_collection?.poster_path || ''}" aria-label="${wd ? 'Unmark watched' : 'Mark as watched'}" data-tip="${wd ? 'Unmark watched' : 'Mark as watched'}" style="${wd ? 'color:var(--green);border-color:var(--green)' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg></button>` : ''}
              ${out ? `<button class="dbtn-icon" data-action="open-rating" data-id="${id}" data-type="${type}" data-title="${safeTitle}" aria-label="Rate" data-tip="Rate">${myRating ? `<span style="font-size:.72rem;font-weight:800;color:var(--gold)">${myRating}</span>` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'}</button>` : ''}
              ${out ? '' : `<span class="unreleased-note" data-tip="You can still add it to your list">${type === 'tv' ? 'Not aired yet' : 'Not released yet'}</span>`}
              <button class="dbtn-icon" data-action="share-item" data-title="${safeTitle}" data-id="${id}" data-type="${type}" aria-label="Share" data-tip="Share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>
            </div>
            ${rewatchStripHTML(id, type)}
          </div>
        </div>
        ${cdHTML}${collHTML}
        <div class="detail-overview-wrap">
          <p class="detail-overview clamped" id="detOv">${esc(det.overview || 'No overview available.')}</p>
          <span class="detail-overview-toggle" id="detOvToggle" data-action="toggle-overview" hidden>Read more</span>
        </div>
        ${boHTML}
        <div class="stats-grid">
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
    if (type === 'tv' && initialSeason) loadEps(id, initialSeason);
    observeReveals(ct); observeCountUps(ct);
    // Animate the Box Office bar widths after paint (horizontal %-widths resolve
    // against the definite-width card).
    requestAnimationFrame(() => {
      animateBoxOffice(ct);
      // The show-progress bar is a %-width and needs a laid-out parent, same as
      // the box-office bars.
      ct.querySelectorAll('.show-progress-bar i').forEach(bar => { bar.style.width = `${+bar.dataset.w || 0}%`; });
    });
    // Reveal a "Read more" ONLY where the text actually overflows its clamp.
    if (clampResize) { window.removeEventListener('resize', clampResize); clampResize = null; }
    const remeasure = syncAllClampToggles(ct);
    clampResize = debounce(() => { remeasure(); drawBoxOffice(ct, { animate: false }); }, 150);
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

// ===== REWATCH STRIP =====
// Only rendered for something already marked watched: a rewatch of an unwatched
// title is not a rewatch, it is a first viewing, and that is the tick above.
const playDate = ms => ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';

function rewatchStripHTML(id, type) {
  const key = `${type}_${id}`;
  if (!state.watched[key]) return '';
  const plays = playCount(key), dates = playDates(key);
  const first = playDate(dates[0]), last = plays > 1 ? playDate(dates[dates.length - 1]) : '';
  // The count is authoritative; dates are only what we hold, so the caption says
  // "first" and "last" rather than listing viewings we may have aged out.
  const caption = last && last !== first ? `First ${first} · last ${last}`
    : first ? `Watched ${first}` : 'Date not recorded';
  return `<div class="rewatch-strip" id="rwStrip_${type}_${id}">
    <div class="rw-count" aria-hidden="true"><b>${plays}</b><span>${plays === 1 ? 'play' : 'plays'}</span></div>
    <div class="rw-body"><div class="rw-label">${playLabel(key)}</div><div class="rw-dates">${esc(caption)}</div></div>
    <div class="rw-acts">
      <button class="rw-btn rw-add" data-action="log-rewatch" data-id="${id}" data-type="${type}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>Log a rewatch</button>
      ${plays > 1 ? `<button class="rw-btn rw-undo" data-action="undo-rewatch" data-id="${id}" data-type="${type}">Undo</button>` : ''}
    </div>
  </div>`;
}

function paintRewatchStrip(id, type) {
  const host = $(`rwStrip_${type}_${id}`);
  const html = rewatchStripHTML(id, type);
  if (host) {
    if (html) host.outerHTML = html; else host.remove();
    return;
  }
  // The title was just marked watched, so the strip did not exist to replace.
  if (!html) return;
  const anchor = document.querySelector('.detail-head .detail-btns');
  if (anchor) anchor.insertAdjacentHTML('afterend', html);
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
    const d = await collectionParts(collectionId);
    if (!d || gen !== reqGen || !$(`collStrip_${id}`)) return;
    paintCollectionProgress(id, d.parts);
    const parts = (d.parts || [])
      .filter(p => p && p.id !== id && p.poster)
      .sort((a, b) => new Date(a.release_date || '9999') - new Date(b.release_date || '9999'))
      .map(p => ({ id: p.id, title: p.title, poster_path: p.poster, release_date: p.release_date, vote_average: p.vote }));
    if (!parts.length) return;
    host.innerHTML = `<div style="margin-bottom:32px"><div class="d-sec-title">More in ${esc(d.name || 'this collection')}</div><div class="similar-row">${parts.map(p => buildCard(p, 'movie')).join('')}</div></div>`;
    observeReveals(host);
  } catch (e) { /* the banner alone is fine */ }
}

// The collection page leads with where you stand, because that is the question
// that brought you here. Unreleased parts are named separately rather than
// counted against you — see js/franchise.js.
function collectionHeaderHTML(progress) {
  if (!progress.released) return '';
  const pct = Math.round(progress.percent);
  const next = progress.nextUp;
  return `<div class="coll-standing${progress.complete ? ' done' : ''}">
    <div class="coll-ring" style="--pct:${pct}">
      <span class="coll-ring-val"><b data-count="${pct}">${pct}</b><i>%</i></span>
    </div>
    <div class="coll-standing-body">
      <div class="coll-standing-head">${progress.complete ? 'Collection complete' : `${progress.seen} of ${progress.released} seen`}</div>
      <p>${progress.complete
        ? (progress.upcoming ? `Everything released. ${progress.upcoming} more on the way.` : 'You have seen every film in this collection.')
        : `${progress.unseen.length} film${progress.unseen.length === 1 ? '' : 's'} left${progress.upcoming ? `, plus ${progress.upcoming} not out yet` : ''}.`}</p>
      ${next ? `<button class="btn-primary coll-next" data-action="open-detail" data-id="${next.id}" data-type="movie">Carry on with ${esc(next.title)}</button>` : ''}
    </div>
  </div>`;
}

// Completion is drawn as a filled bar plus the count in words — the bar alone
// would leave the exact position to be eyeballed, and the words alone would
// hide how close to done you are.
function paintCollectionProgress(id, parts) {
  const host = $(`collProg_${id}`);
  if (!host) return;
  const progress = collectionProgress(parts);
  if (!progress.released) { host.innerHTML = ''; return; }
  const pct = Math.round(progress.percent);
  host.innerHTML = `
    <div class="coll-meter" role="img" aria-label="${progress.seen} of ${progress.released} released films seen">
      <i style="width:${pct}%"${progress.complete ? ' class="done"' : ''}></i>
    </div>
    <span class="coll-meter-label">${esc(progressLabel(progress))}${progress.upcoming ? ` · ${progress.upcoming} still to come` : ''}</span>`;
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
  if (!label) {
    // On the release date the date-only fallback may initially say "available".
    // If the broadcaster then confirms a later time today, rebuild once; the
    // cached exact timestamp makes the precision countdown render immediately.
    if (time?.airstamp && !isEpisodeAvailable(show.next_episode_to_air, { showId: id, airstamp: time.airstamp })) openDetail(id, 'tv');
    return;
  }
  if (!time?.airstamp) {
    label.className = 'detail-local-airtime';
    label.innerHTML = '<i></i><span><b>Exact time not announced</b><small>The confirmed episode date is shown above.</small></span>';
    return;
  }
  label.className = 'detail-local-airtime exact';
  label.innerHTML = `<i></i><span><b>${esc(localEpisodeTime(time.airstamp))}</b><small>Exact drop · converted to ${esc(localTimeZone())} · <a href="https://www.tvmaze.com" target="_blank" rel="noopener">TVmaze</a></small></span>`;
  state.cdIntervals.forEach(clearInterval); state.cdIntervals = []; countdownTimers.clear();
  startCD(id, time.airstamp, '🎉 Now Airing!');
  // A confirmed time can turn today's date-only episode back into "upcoming".
  // Repaint the active season so its controls use the same shared decision.
  const activeSeason = +document.querySelector('.s-tab.active')?.dataset.sn;
  if (activeSeason) loadEps(id, activeSeason);
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
  const count = backs.length + posters.length;
  return detailAccordion('detailGalleryExpanded', 'Artwork vault', 'Gallery', `${count} high-resolution image${count === 1 ? '' : 's'} · ${backs.length} backdrops · ${posters.length} posters`, `<div class="detail-gallery-body">${group(backs, 'w780', 'gal-back', 'Backdrops')}${group(posters, 'w342', 'gal-poster', 'Posters')}</div>`, 'gallery');
}

function providerHTML(det, region) {
  const results = det['watch/providers']?.results || {};
  const prov = results[region] || {};
  const title = det.title || det.name || '';
  const regionLink = prov.link || '';   // TMDB's region-level JustWatch page (fallback)
  const options = [...REGIONS].sort((a, b) => a[1].localeCompare(b[1]))
    .map(([code]) => `<option value="${code}" ${code === region ? 'selected' : ''}>${esc(regionLabel(code))}</option>`).join('');
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
  const rated = all.filter(review => review.author_details?.rating != null);
  const average = rated.length ? rated.reduce((sum, review) => sum + +review.author_details.rating, 0) / rated.length : 0;
  const summary = `${all.length} review${all.length === 1 ? '' : 's'}${average ? ` · ${average.toFixed(1)}/10 reviewer average` : ''}`;
  return detailAccordion('detailReviewsExpanded', 'Community perspective', 'Reviews', summary, `<div class="detail-reviews-body">${first}${more}</div>`, 'reviews');
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

// ===== BOX OFFICE =====
// One question, answered in one number and one chart: did it make its money back?
//
// Form: the two REPORTED figures (budget, worldwide gross) are bars on a single
// shared dollar axis, with the gross carrying the accent and the budget in the
// de-emphasis gray — the emphasis form, because one of them is the story and the
// other is context. The modelled break-even is a shaded BAND, not a bar, because
// it is a range and drawing it as a bar would give an estimate the same visual
// authority as a reported figure.
//
// Colour: a single accent (cyan-600) validated against the dark chart surface —
// lightness band, chroma floor, and 3:1 contrast all pass. Nothing here depends
// on hue alone: every bar is labelled and the table view carries every value.
const BO_ACCENT = '#0891b2';
const BO_ACCENT_SOFT = '#22d3ee';
const BO_CONTEXT = '#64748b';
const BO_BAND = '#fbbf24';
const BO_SURFACE = '#0d0e14';
const BO_GRID = 'rgba(255,255,255,.07)';
const BO_INK = '#6b7280';

const money = value => `$${fmt(Math.round(value))}`;

function boxOfficeModel(det) {
  const budget = +(det.budget || 0), revenue = +(det.revenue || 0);
  const marketingLow = budget * .5, marketingHigh = budget;
  const costLow = budget + marketingLow, costHigh = budget + marketingHigh;
  // Studios keep roughly 40-55% of the worldwide gross, so break-even sits well
  // above total cost. Both ends of that assumption are stated in the disclosure.
  const beLow = budget ? costLow / .55 : 0, beHigh = budget ? costHigh / .4 : 0;
  return {
    budget, revenue, marketingLow, marketingHigh, costLow, costHigh,
    beLow, beHigh, beMid: (beLow + beHigh) / 2,
    multiple: budget ? revenue / budget : 0,
    hasBoth: !!(budget && revenue),
    studioLow: revenue * .4, studioHigh: revenue * .55,
  };
}

function boxOfficeVerdict(m) {
  if (!m.hasBoth) return { tone: 'neutral', line: m.budget ? 'Worldwide gross has not been reported yet.' : 'The production budget has not been reported.' };
  if (m.revenue >= m.beHigh) return { tone: 'strong', line: `Grossed ${m.multiple.toFixed(1)}x its budget and cleared even the most cautious break-even estimate.` };
  if (m.revenue >= m.beMid) return { tone: 'strong', line: `Grossed ${m.multiple.toFixed(1)}x its budget, past the middle of the modelled break-even band.` };
  if (m.revenue >= m.beLow) return { tone: 'ok', line: `Grossed ${m.multiple.toFixed(1)}x its budget — inside the modelled break-even band, so the real outcome turns on what marketing actually cost.` };
  if (m.multiple >= 1) return { tone: 'ok', line: `Earned its production budget back ${m.multiple.toFixed(1)}x over, but that is before any marketing spend.` };
  return { tone: 'weak', line: `Grossed less than it cost to produce — ${m.multiple.toFixed(2)}x the budget.` };
}

// Axis ticks on clean round numbers rather than fractions of the max.
function niceTicks(max) {
  const rough = max / 4;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map(n => n * power).find(n => n >= rough) || power * 10;
  const ticks = [];
  for (let value = 0; value <= max + step * 0.001; value += step) ticks.push(value);
  return ticks;
}

// Rendered at the container's real pixel width so axis and label text stays crisp
// instead of being scaled by a viewBox.
function boxOfficeChart(m, width) {
  const W = Math.max(300, Math.round(width || 720));
  const narrow = W < 520;
  const padL = narrow ? 14 : 132, padR = narrow ? 14 : 96, padT = narrow ? 44 : 30, padB = 34;
  const barH = 22, gap = narrow ? 46 : 30;
  const H = padT + barH * 2 + gap + padB;
  const innerW = Math.max(60, W - padL - padR);
  const max = Math.max(m.budget, m.revenue, m.hasBoth ? m.beHigh : 0, 1);
  const x = value => padL + (value / max) * innerW;
  const rows = [
    { key: 'budget', label: 'Production budget', value: m.budget, color: BO_CONTEXT, emphasis: false },
    { key: 'gross', label: 'Worldwide gross', value: m.revenue, color: BO_ACCENT, emphasis: true },
  ].filter(row => row.value > 0);

  const ticks = niceTicks(max);
  const axis = ticks.map(value => `<line x1="${x(value).toFixed(1)}" x2="${x(value).toFixed(1)}" y1="${padT - 6}" y2="${H - padB + 6}" stroke="${BO_GRID}" stroke-width="1"/>` +
    `<text x="${x(value).toFixed(1)}" y="${H - padB + 22}" text-anchor="middle" fill="${BO_INK}" font-size="10" font-variant-numeric="tabular-nums">${value ? money(value) : '$0'}</text>`).join('');

  const band = m.hasBoth && m.beHigh > 0 ? (() => {
    const left = x(m.beLow), right = Math.min(x(m.beHigh), padL + innerW);
    const mid = x(m.beMid);
    const top = padT - 6, bottom = H - padB + 6;
    return `<g class="bo3-band" opacity="0">
      <rect x="${left.toFixed(1)}" y="${top}" width="${Math.max(2, right - left).toFixed(1)}" height="${(bottom - top).toFixed(1)}" fill="${BO_BAND}" fill-opacity=".045"/>
      <line x1="${left.toFixed(1)}" x2="${left.toFixed(1)}" y1="${top}" y2="${bottom}" stroke="${BO_BAND}" stroke-opacity=".3" stroke-width="1"/>
      <line x1="${right.toFixed(1)}" x2="${right.toFixed(1)}" y1="${top}" y2="${bottom}" stroke="${BO_BAND}" stroke-opacity=".3" stroke-width="1"/>
      <line class="bo3-band-rule" x1="${mid.toFixed(1)}" x2="${mid.toFixed(1)}" y1="${top}" y2="${bottom}" stroke="${BO_BAND}" stroke-width="1.5"/>
      <text x="${mid.toFixed(1)}" y="${(top - 5).toFixed(1)}" text-anchor="middle" fill="${BO_BAND}" font-size="9.5" font-weight="700">break-even</text>
      <rect class="bo3-hit" x="${(left - 6).toFixed(1)}" y="${padT - 6}" width="${Math.max(24, right - left + 12).toFixed(1)}" height="${(H - padB + 12 - padT).toFixed(1)}" fill="transparent" data-tip="Modelled break-even ${money(m.beLow)} to ${money(m.beHigh)} — production plus 50-100% marketing, divided by a 40-55% studio share of the gross"></rect>
    </g>`;
  })() : '';

  const bars = rows.map((row, index) => {
    const y = padT + index * (barH + gap);
    const full = Math.max(3, x(row.value) - padL);
    const labelY = y + barH / 2 + 4;
    const inlineLabel = narrow
      ? `<text x="${padL}" y="${(y - 9).toFixed(1)}" fill="#9ca3af" font-size="11" font-weight="600">${esc(row.label)}</text>`
      : `<text x="${(padL - 14).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="end" fill="#9ca3af" font-size="11.5" font-weight="600">${esc(row.label)}</text>`;
    return `<g class="bo3-row">
      ${inlineLabel}
      <rect class="bo3-bar${row.emphasis ? ' emphasis' : ''}" x="${padL}" y="${y}" width="0" height="${barH}" rx="4" fill="${row.color}" data-w="${full.toFixed(1)}" data-delay="${index * 140}"></rect>
      <text class="bo3-value" x="${(padL + full + 10).toFixed(1)}" y="${labelY.toFixed(1)}" fill="#f0f0f5" font-size="12" font-weight="700" opacity="0" data-delay="${index * 140 + 520}">${money(row.value)}</text>
      <rect class="bo3-hit" x="${padL}" y="${(y - 8).toFixed(1)}" width="${Math.max(24, full).toFixed(1)}" height="${barH + 16}" fill="transparent" data-tip="${esc(`${row.label}: ${money(row.value)}`)}"></rect>
    </g>`;
  }).join('');

  return `<svg class="bo3-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Reported production budget and worldwide gross on a shared dollar scale, with the modelled break-even range">
    <defs>
      <linearGradient id="bo3Gloss" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${BO_ACCENT}"/><stop offset="1" stop-color="${BO_ACCENT_SOFT}"/>
      </linearGradient>
    </defs>
    ${axis}${band}${bars}
    <line x1="${padL}" x2="${(padL + innerW).toFixed(1)}" y1="${H - padB + 6}" y2="${H - padB + 6}" stroke="${BO_GRID}" stroke-width="1"/>
  </svg>`;
}

function boxOfficeHTML(det) {
  const m = boxOfficeModel(det);
  if (!m.budget && !m.revenue) return '';
  const verdict = boxOfficeVerdict(m);
  const difference = m.revenue - m.budget;

  const tiles = [
    m.budget ? ['Production budget', money(m.budget), 'Reported by TMDB'] : null,
    m.revenue ? ['Worldwide gross', money(m.revenue), 'Theatrical, all territories'] : null,
    m.hasBoth ? ['Gross above budget', `${difference >= 0 ? '+' : '−'}${money(Math.abs(difference))}`, 'Difference, not profit'] : null,
  ].filter(Boolean);

  const tableRows = [
    m.budget ? ['Production budget', money(m.budget), 'Reported'] : null,
    m.revenue ? ['Worldwide gross', money(m.revenue), 'Reported'] : null,
    m.budget ? ['Marketing', `${money(m.marketingLow)} – ${money(m.marketingHigh)}`, 'Modelled at 50–100% of production'] : null,
    m.budget ? ['Total cost', `${money(m.costLow)} – ${money(m.costHigh)}`, 'Modelled: production plus marketing'] : null,
    m.hasBoth ? ['Break-even gross', `${money(m.beLow)} – ${money(m.beHigh)}`, 'Modelled: cost ÷ a 40–55% studio share'] : null,
    m.hasBoth ? ['Studio theatrical return', `${money(m.studioLow)} – ${money(m.studioHigh)}`, 'Modelled, before streaming and TV rights'] : null,
    m.hasBoth ? ['Gross ÷ budget', `${m.multiple.toFixed(2)}x`, 'Reported'] : null,
  ].filter(Boolean);

  const payload = esc(JSON.stringify(m));
  const core = `<div class="boxoffice3">
    <div class="bo3-lead ${verdict.tone}">
      ${m.hasBoth ? `<div class="bo3-hero"><strong data-count-decimal="${m.multiple.toFixed(2)}">0.00</strong><span>x budget</span></div>` : ''}
      <p>${esc(verdict.line)}</p>
    </div>

    <figure class="bo3-figure">
      <figcaption><strong>Where the money landed</strong><span>Reported figures on one dollar scale. The shaded band is the modelled break-even range.</span></figcaption>
      <div class="bo3-canvas" data-bo="${payload}"></div>
      <div class="bo3-legend">
        <span><i style="background:${BO_CONTEXT}"></i>Production budget</span>
        <span><i style="background:${BO_ACCENT}"></i>Worldwide gross</span>
        ${m.hasBoth ? `<span><i class="bo3-legend-band"></i>Modelled break-even</span>` : ''}
        <button type="button" class="bo3-table-toggle" data-action="toggle-bo-table" aria-expanded="false">View as table</button>
      </div>
    </figure>

    <div class="bo3-table-wrap" hidden>
      <table class="bo3-table"><caption>Every figure, reported and modelled</caption>
        <thead><tr><th scope="col">Figure</th><th scope="col">Value</th><th scope="col">Source</th></tr></thead>
        <tbody>${tableRows.map(([label, value, source]) => `<tr><th scope="row">${esc(label)}</th><td>${esc(value)}</td><td>${esc(source)}</td></tr>`).join('')}</tbody>
      </table>
    </div>

    <div class="bo3-tiles">${tiles.map(([label, value, note]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join('')}</div>

    <details class="bo3-model"><summary>How break-even is estimated</summary><div class="bo3-model-body">
      <p>TMDB reports two figures: the production budget and the worldwide gross. Studios publish neither their marketing spend nor their share of ticket sales, so everything labelled <em>modelled</em> below is an openly stated estimate — not accounting, and not profit.</p>
      <ol><li>Marketing is assumed to cost 50–100% of the production budget.</li><li>Total cost is production plus that marketing range.</li><li>Studios keep roughly 40–55% of the worldwide gross, so break-even is total cost divided by that share.</li></ol>
    </div></details>

    <p class="bo3-note">Figures in USD, as reported to TMDB.</p>
  </div>`;

  const summary = `${m.budget ? `${money(m.budget)} budget` : 'Budget unreported'} · ${m.revenue ? `${money(m.revenue)} gross` : 'Gross unreported'}${m.hasBoth ? ` · ${m.multiple.toFixed(1)}x` : ''}`;
  return detailAccordion('detailBoxOfficeExpanded', 'Financial intelligence', 'Box Office', summary, core, 'box-office');
}

// A shared tooltip for the chart's hit rects. Bars and the break-even band are
// both labelled on the chart itself, so this enhances rather than gates.
function bindBoxOfficeTooltip(scope) {
  const figure = scope?.querySelector?.('.bo3-figure');
  if (!figure || figure.dataset.bound) return;
  figure.dataset.bound = '1';
  const tip = document.createElement('div');
  tip.className = 'bo3-tooltip';
  tip.setAttribute('role', 'status');
  figure.appendChild(tip);
  const show = (text, clientX, clientY) => {
    const box = figure.getBoundingClientRect();
    tip.textContent = text;
    tip.classList.add('show');
    tip.style.left = `${Math.min(Math.max(clientX - box.left, 70), Math.max(70, box.width - 70))}px`;
    tip.style.top = `${Math.max(4, clientY - box.top - 46)}px`;
  };
  figure.addEventListener('pointermove', event => {
    const target = event.target.closest('.bo3-hit');
    if (!target) { tip.classList.remove('show'); return; }
    show(target.dataset.tip, event.clientX, event.clientY);
  });
  figure.addEventListener('pointerleave', () => tip.classList.remove('show'));
}

// ---------- render + animate ----------
// The chart is drawn at the canvas's measured width, so it has to be (re)built
// whenever that width can change: on first paint, when the accordion opens from
// collapsed (width 0 until then), and on resize.
function drawBoxOffice(scope, { animate = true } = {}) {
  const canvas = scope?.querySelector?.('.bo3-canvas') || (scope?.classList?.contains('bo3-canvas') ? scope : null);
  if (!canvas) return;
  const width = Math.round(canvas.clientWidth);
  if (width < 120) return;                       // still collapsed — redraw on open
  if (+canvas.dataset.width === width) return;   // nothing changed
  let model;
  try { model = JSON.parse(canvas.dataset.bo || '{}'); } catch (_) { return; }
  canvas.dataset.width = String(width);
  canvas.innerHTML = boxOfficeChart(model, width);
  if (animate) animateBoxOfficeChart(canvas);
  else canvas.querySelectorAll('.bo3-bar').forEach(bar => bar.setAttribute('width', bar.dataset.w || '0'));
}

const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

function animateBoxOfficeChart(canvas) {
  const reduced = prefersReducedMotion();
  const bars = [...canvas.querySelectorAll('.bo3-bar')];
  const values = [...canvas.querySelectorAll('.bo3-value')];
  const band = canvas.querySelector('.bo3-band');
  if (reduced) {
    bars.forEach(bar => bar.setAttribute('width', bar.dataset.w || '0'));
    values.forEach(node => node.setAttribute('opacity', '1'));
    band?.setAttribute('opacity', '1');
    return;
  }
  const started = performance.now(), duration = 820;
  const step = now => {
    let running = false;
    for (const bar of bars) {
      const delay = +bar.dataset.delay || 0;
      const progress = Math.min(1, Math.max(0, (now - started - delay) / duration));
      bar.setAttribute('width', String((+bar.dataset.w || 0) * easeOutCubic(progress)));
      if (progress < 1) running = true;
    }
    for (const node of values) {
      const delay = +node.dataset.delay || 0;
      const progress = Math.min(1, Math.max(0, (now - started - delay) / 320));
      node.setAttribute('opacity', String(progress));
      if (progress < 1) running = true;
    }
    if (band) {
      const progress = Math.min(1, Math.max(0, (now - started - 260) / 520));
      band.setAttribute('opacity', String(progress));
      if (progress < 1) running = true;
    }
    if (running) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Bars and the hero number, plus the show-progress bar which shares the same
// "needs a laid-out parent" constraint.
function animateBoxOffice(scope) {
  if (!scope) return;
  drawBoxOffice(scope);
  bindBoxOfficeTooltip(scope);
  scope.querySelectorAll('[data-count-decimal]').forEach(node => {
    const target = parseFloat(node.dataset.countDecimal) || 0;
    if (prefersReducedMotion()) { node.textContent = target.toFixed(2); return; }
    const started = performance.now(), duration = 1000;
    const step = now => {
      const progress = Math.min(1, (now - started) / duration);
      node.textContent = (target * easeOutCubic(progress)).toFixed(2);
      if (progress < 1) requestAnimationFrame(step); else node.textContent = target.toFixed(2);
    };
    requestAnimationFrame(step);
  });
}

export function closeDetail() {
  state.cdIntervals.forEach(clearInterval); state.cdIntervals = [];
  countdownTimers.clear();
  if (ambientTeardown) { ambientTeardown(); ambientTeardown = null; }
  if (clampResize) { window.removeEventListener('resize', clampResize); clampResize = null; }
}

function getCert(d, t) {
  if (t === 'movie') { const u = d.release_dates?.results?.find(r => r.iso_3166_1 === 'US'); return u?.release_dates?.[0]?.certification || ''; }
  return d.content_ratings?.results?.find(r => r.iso_3166_1 === 'US')?.rating || '';
}

function startCD(id, ds, doneMsg = '🎉 Now Airing!') {
  if (countdownTimers.has(id)) {
    const previous = countdownTimers.get(id); clearInterval(previous);
    state.cdIntervals = state.cdIntervals.filter(timer => timer !== previous);
  }
  const tg = new Date(ds).getTime();
  const shell = document.querySelector(`[data-countdown-shell="${id}"]`);
  const startedAt = Date.now(), span = Math.max(1000, tg - startedAt);
  if (shell) { shell.dataset.countdownTarget = String(tg); shell.dataset.countdownStarted = String(startedAt); }
  const targetLabel = $(`cd_target_${id}`);
  if (targetLabel && Number.isFinite(tg)) targetLabel.textContent = new Date(tg).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  let timer = null;
  const paintDigit = (node, value) => {
    if (!node || node.textContent === value) return;
    node.textContent = value; node.classList.remove('tick');
    void node.offsetWidth; node.classList.add('tick');
  };
  function up() {
    const df = tg - Date.now();
    if (df <= 0) {
      if (timer) { clearInterval(timer); countdownTimers.delete(id); state.cdIntervals = state.cdIntervals.filter(value => value !== timer); }
      const e = $(`cd_d_${id}`), grid = e?.closest('.countdown-grid');
      if (grid) grid.innerHTML = `<div class="countdown-arrived"><i>✓</i><span><strong>${esc(doneMsg)}</strong><small>The countdown reached its confirmed target.</small></span></div>`;
      if (shell) { shell.classList.add('arrived'); shell.style.setProperty('--cd-progress', '360deg'); }
      const pct = $(`cd_pct_${id}`); if (pct) pct.textContent = '100%';
      return;
    }
    const d = Math.floor(df / 864e5), h = Math.floor(df % 864e5 / 36e5), m = Math.floor(df % 36e5 / 6e4), s = Math.floor(df % 6e4 / 1e3);
    const de = $(`cd_d_${id}`), he = $(`cd_h_${id}`), me = $(`cd_m_${id}`), se = $(`cd_s_${id}`);
    paintDigit(de, String(d).padStart(2, '0')); paintDigit(he, String(h).padStart(2, '0')); paintDigit(me, String(m).padStart(2, '0')); paintDigit(se, String(s).padStart(2, '0'));
    const progress = Math.max(0, Math.min(1, 1 - df / span));
    if (shell) shell.style.setProperty('--cd-progress', `${progress * 360}deg`);
    const pct = $(`cd_pct_${id}`); if (pct) pct.textContent = `${Math.floor(progress * 100)}%`;
  }
  up();
  if (tg <= Date.now()) return;
  timer = setInterval(up, 1000); countdownTimers.set(id, timer); state.cdIntervals.push(timer);
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
// ===== EPISODE TRACKING (detail page) =====

const EP_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>';

// The show-level bar above the seasons: where you are, what is next, and the two
// actions that matter most when you are mid-show.
function showProgressPanel(id, det, progress, next) {
  if (!state.user) return '';
  const meta = esc(JSON.stringify(showMeta(det)));
  const positionControl = `<div class="episode-position" role="group" aria-label="Set whole-series episode position">
    <span><b>Series position</b><small>Best for anime and long-running shows</small></span>
    <label><span>Episode</span><input type="number" min="0" max="${progress.aired || det.number_of_episodes || 0}" step="1" inputmode="numeric" value="${progress.position || ''}" data-episode-position aria-label="Last episode watched overall"></label>
    <button class="btn-glass" data-action="ep-set-position" data-tid="${id}" data-meta="${meta}">Update</button>
  </div>`;
  if (!progress.started) {
    return `<section class="show-progress idle">
      <div class="show-progress-copy"><span>Episode tracking</span><strong>Track ${esc(det.name || 'this show')} episode by episode</strong><p>Tick episodes as you watch, mark everything up to where you are, or mark the whole show at once.</p></div>
      <div class="show-progress-actions">
        <button class="btn-primary" data-action="ep-mark-show" data-tid="${id}" data-meta="${meta}">I have seen it all</button>
      </div>
      ${positionControl}
    </section>`;
  }
  const nextLabel = next ? episodeLabel(id, next) : (progress.seriesCompleted ? 'Series completed' : 'All caught up');
  const stateLabel = progress.seriesCompleted ? 'Series completed' : progress.caughtUp ? 'Caught up' : progress.seasonCompleted ? 'Season completed' : 'Continue watching';
  return `<section class="show-progress${progress.caughtUp ? ' complete' : ''}">
    <div class="show-progress-copy">
      <span>${stateLabel}</span>
      <strong>${esc(nextLabel)}</strong>
      <p>${progress.watched} of ${progress.aired} aired episode${progress.aired === 1 ? '' : 's'} watched${progress.total > progress.aired ? ` · ${progress.total} total` : ''}</p>
      <div class="show-progress-bar"><i style="width:0" data-w="${progress.percent}"></i></div>
    </div>
    <div class="show-progress-actions">
      <b>${progress.percent}%</b>
      ${next ? `<button class="btn-primary" data-action="ep-toggle" data-tid="${id}" data-sn="${next.season}" data-en="${next.episode}" data-meta="${meta}">Mark ${esc(episodeLabel(id, next, { compact: true }))} watched</button>` : ''}
      ${progress.caughtUp ? '' : `<button class="btn-glass" data-action="ep-mark-show" data-tid="${id}" data-meta="${meta}">Mark all ${progress.aired - progress.watched} remaining</button>`}
      <button class="btn-glass" data-action="ep-reset" data-tid="${id}">Reset</button>
    </div>
    ${positionControl}
  </section>`;
}

// One row's tracking controls. "Up to here" is what makes a half-finished show
// trackable without ticking twenty boxes.
function episodeControls(id, ep, meta, watched) {
  if (!state.user) return '';
  return `<div class="ep-actions">
    <button class="ep-check${watched ? ' on' : ''}" data-action="ep-toggle" data-tid="${id}" data-sn="${ep.season_number}" data-en="${ep.episode_number}" data-air-date="${esc(ep.air_date || '')}" data-meta="${meta}" aria-pressed="${watched}" aria-label="${watched ? 'Unmark' : 'Mark'} episode ${ep.episode_number} watched">${EP_CHECK}<span>${watched ? 'Watched' : 'Mark watched'}</span></button>
    <button class="ep-upto" data-action="ep-mark-upto" data-tid="${id}" data-sn="${ep.season_number}" data-en="${ep.episode_number}" data-air-date="${esc(ep.air_date || '')}" data-meta="${meta}" data-tip="Mark everything up to and including this episode">Up to here</button>
  </div>`;
}

function seasonToolbar(id, season, episodes, meta) {
  if (!state.user) return '';
  const aired = episodes.filter(ep => isEpisodeAvailable(ep, { showId: id })).length;
  const done = seasonWatchedCount(id, season);
  const all = aired > 0 && done >= aired;
  return `<div class="season-toolbar">
    <span><b>${done}</b> of ${aired} aired episode${aired === 1 ? '' : 's'} watched</span>
    <button data-action="ep-season" data-tid="${id}" data-sn="${season}" data-on="${all ? '0' : '1'}" data-meta="${meta}">${all ? 'Unmark whole season' : 'Mark season watched'}</button>
    <span class="season-rewatch" id="seasonRewatch_${id}_${season}">${seasonRewatchHTML(id, season, meta)}</span>
  </div>`;
}

// Rewatching one season is the normal way people revisit television — nobody
// restarts a sixty-episode run to see their favourite year again — so the count
// lives beside the season it belongs to, and only once that season is finished.
function seasonRewatchHTML(id, season, meta) {
  if (!isSeasonComplete(id, season)) return '';
  const plays = seasonPlayCount(id, season);
  return `${plays > 1 ? `<b class="season-plays" title="${esc(seasonPlayLabel(id, season))}">${plays}&times;</b>` : ''}
    <button class="season-rw-btn" data-action="season-rewatch" data-tid="${id}" data-sn="${season}" data-meta="${meta}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>${plays > 1 ? 'Again' : 'Rewatched it'}</button>
    ${plays > 1 ? `<button class="season-rw-undo" data-action="season-rewatch-undo" data-tid="${id}" data-sn="${season}" data-meta="${meta}">Undo</button>` : ''}`;
}

function paintSeasonRewatch(id, season, meta) {
  const host = $(`seasonRewatch_${id}_${season}`);
  if (host) host.innerHTML = seasonRewatchHTML(id, season, meta);
}

function readEpisodeMeta(el) {
  let meta = {};
  try { meta = JSON.parse(el.dataset.meta || '{}'); } catch (_) {}
  if (el.dataset.airDate !== undefined) meta.episode = {
    season_number: +el.dataset.sn, episode_number: +el.dataset.en, air_date: el.dataset.airDate || '',
  };
  return meta;
}

// The toolbar carries the season's own counts, so it has to be recomputed
// separately from the show-level chrome.
function syncSeasonToolbar(tid, sn, meta = '{}') {
  const toolbar = document.querySelector('.season-toolbar');
  if (!toolbar) return;
  const aired = document.querySelectorAll('.ep-card:not(.unaired)').length;
  const done = seasonWatchedCount(tid, sn);
  const count = toolbar.querySelector('b');
  if (count) count.textContent = String(done);
  const button = toolbar.querySelector('[data-action="ep-season"]');
  if (button) {
    const all = aired > 0 && done >= aired;
    button.dataset.on = all ? '0' : '1';
    button.textContent = all ? 'Unmark whole season' : 'Mark season watched';
  }
  // Finishing the last episode of a season is exactly when the rewatch control
  // becomes meaningful, so it appears (and disappears) with the completion.
  paintSeasonRewatch(tid, sn, meta);
}

async function loadEps(tid, sn) {
  const el = $(`epList_${tid}`); if (!el) return;
  // Own generation token (mirrors reqGen): clicking season tabs quickly could
  // otherwise let a slow season-1 response land after — and overwrite — season 2.
  const gen = ++epGen;
  el.innerHTML = '<div class="skel" style="height:80px;width:100%"></div>';
  try {
    const [season, show] = await Promise.all([
      tmdb(`/tv/${tid}/season/${sn}`),
      tmdb(`/tv/${tid}`).catch(() => null),
    ]);
    if (gen !== epGen) return;
    const meta = esc(JSON.stringify(show ? showMeta(show) : {}));
    const episodes = season.episodes || [];
    if (!episodes.length) { el.innerHTML = '<p style="color:var(--text3);padding:12px">No episodes yet</p>'; return; }
    el.innerHTML = seasonToolbar(tid, sn, episodes, meta) + episodes.map(ep => {
      const watched = isEpisodeWatched(tid, ep.season_number, ep.episode_number);
      const future = !isEpisodeAvailable(ep, { showId: tid });
      return `<div class="ep-card${watched ? ' watched' : ''}${future ? ' unaired' : ''}" data-ep="${ep.season_number}-${ep.episode_number}">
        <div class="ep-still">${ep.still_path ? `<img src="${IMG}w300${ep.still_path}" alt="" loading="lazy">` : ''}<div class="ep-num">E${ep.episode_number}</div>${watched ? `<div class="ep-seen" aria-hidden="true">${EP_CHECK}</div>` : ''}</div>
        <div class="ep-body">
          <div class="ep-title">${esc(ep.name) || `Episode ${ep.episode_number}`}</div>
          <div class="ep-meta">${ep.air_date ? `<span>${new Date(ep.air_date).toLocaleDateString()}</span>` : ''}${ep.runtime ? `<span>${ep.runtime}m</span>` : ''}${ep.vote_average ? `<span>⭐ ${ep.vote_average.toFixed(1)}</span>` : ''}${future ? '<span class="ep-soon">Not aired yet</span>' : ''}</div>
          <div class="ep-desc">${esc(ep.overview || '')}</div>
          ${future ? '' : episodeControls(tid, ep, meta, watched)}
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    if (gen !== epGen) return;
    el.innerHTML = '<p style="color:var(--text3);padding:12px">Failed to load</p>';
  }
}

// Repaint the tracking chrome in place. A full detail re-render would scroll the
// reader back to the top of a long show, which is exactly the wrong reaction to
// ticking one episode.
function refreshEpisodeUI(tid) {
  const progress = showProgress(tid), next = nextUp(tid);
  const panel = document.querySelector('.show-progress');
  if (panel && curDet?.id === tid) {
    // Rebuild the controls as one unit. Updating only the heading left the old
    // S/E values on the primary button, so a second click toggled the stale row.
    panel.outerHTML = showProgressPanel(tid, curDet, progress, next);
    const bar = document.querySelector('.show-progress-bar i');
    if (bar) bar.style.width = `${progress.percent}%`;
  }
  document.querySelectorAll('.season-card').forEach(card => {
    const season = +card.dataset.sn;
    const done = seasonWatchedCount(tid, season);
    const ring = card.querySelector('.season-ring');
    const total = +(card.dataset.total || 0);
    if (ring && total) {
      const pct = Math.min(100, Math.round(done / total * 100));
      ring.style.setProperty('--season-progress', `${pct * 3.6}deg`);
      const label = ring.querySelector('b'); if (label) label.textContent = `${pct}%`;
      card.classList.toggle('complete', pct === 100);
    }
  });
}

export async function openCollection(cid) {
  const gen = ++reqGen; // shares the counter with openDetail — navigating between either invalidates the other's in-flight fetch
  const ct = $('detailContent');
  document.title = 'Collection — CineVerse';
  try {
    const d = await tmdb(`/collection/${cid}`);
    if (gen !== reqGen) return;
    renderedFor = { uid: state.user?.uid || null, kind: 'collection', id: +cid };
    if (d.parts?.length) {
      const sorted = d.parts.sort((a, b) => new Date(a.release_date || '9999') - new Date(b.release_date || '9999'));
      const progress = collectionProgress(sorted);
      document.title = `${d.name} — CineVerse`;
      ct.innerHTML = `<div style="padding:calc(var(--nav-h) + 20px) clamp(16px,4vw,40px) 100px;max-width:1100px;margin:0 auto">
        <h1 style="font-family:var(--font-display);font-size:2rem;margin-bottom:4px">${esc(d.name)}</h1>
        ${d.overview ? `<p style="color:var(--text2);font-size:.92rem;line-height:1.7;margin-bottom:20px;max-width:600px">${esc(d.overview)}</p>` : ''}
        ${collectionHeaderHTML(progress)}
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:14px">${sorted.map(m => buildCard(m, 'movie')).join('')}</div>
      </div>`;
      observeReveals(ct);
      observeCountUps(ct);
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
    'log-rewatch': async (el) => {
      const id = +el.dataset.id, type = el.dataset.type;
      el.disabled = true;
      try {
        const plays = await logPlay(id, type);
        if (plays) { paintRewatchStrip(id, type); toast(`Logged — ${plays === 2 ? 'seen twice' : `seen ${plays} times`}`, 'success'); }
        else toast('Mark it watched first', 'info');
      } catch (error) { console.error('log-rewatch', error); toast('Could not save that rewatch', 'error'); }
      finally { const live = $(`rwStrip_${type}_${id}`); if (!live && el.isConnected) el.disabled = false; }
    },
    'undo-rewatch': async (el) => {
      const id = +el.dataset.id, type = el.dataset.type;
      el.disabled = true;
      try {
        const plays = await removeLastPlay(id, type);
        paintRewatchStrip(id, type);
        toast(plays > 1 ? `Back to ${plays} plays` : 'Back to one viewing', 'info');
      } catch (error) { console.error('undo-rewatch', error); toast('Could not undo that', 'error'); }
      finally { const live = $(`rwStrip_${type}_${id}`); if (!live && el.isConnected) el.disabled = false; }
    },
    'toggle-overview': (el) => {
      const ov = $('detOv'); if (!ov) return;
      const clamped = ov.classList.toggle('clamped');
      el.textContent = clamped ? 'Read more' : 'Show less';
      // Expanded text can't overflow, so mark it — otherwise a resize re-measure
      // would decide there's nothing to expand and hide the "Show less" control.
      el.dataset.expanded = clamped ? '0' : '1';
    },
    'toggle-detail-section': el => {
      const body = $(el.getAttribute('aria-controls')); if (!body) return;
      const expanded = el.getAttribute('aria-expanded') !== 'true';
      el.setAttribute('aria-expanded', String(expanded)); body.hidden = !expanded;
      const section = el.closest('.detail-accordion'); if (section) section.classList.toggle('expanded', expanded);
      const label = el.querySelector('.detail-accordion-state b'); if (label) label.textContent = expanded ? 'Open' : 'Collapsed';
      if (el.dataset.pref) updatePref(el.dataset.pref, expanded);
      if (expanded) {
        requestAnimationFrame(() => {
          animateBoxOffice(body);
          body.querySelectorAll('.review-body').forEach(review => syncClampToggle(review, body.querySelector(`.review-toggle[data-target="${review.id}"]`)));
        });
      }
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
    'toggle-bo-table': el => {
      const wrap = el.closest('.boxoffice3')?.querySelector('.bo3-table-wrap'); if (!wrap) return;
      const open = wrap.hidden;
      wrap.hidden = !open;
      el.setAttribute('aria-expanded', String(open));
      el.textContent = open ? 'Hide table' : 'View as table';
    },
    'load-season': (el) => loadSeason(+el.dataset.tid, +el.dataset.sn, el),
    // ----- Episode tracking -----
    'ep-toggle': el => {
      const tid = +el.dataset.tid, sn = +el.dataset.sn, en = +el.dataset.en;
      const watched = toggleEpisode(tid, sn, en, readEpisodeMeta(el));
      // null means the write was refused (signed out). Painting a tick for an
      // episode that was never saved is worse than doing nothing.
      if (watched === null) return;
      if (watched === 'unavailable') { toast('This episode has not dropped yet', 'info'); return; }
      const card = document.querySelector(`.ep-card[data-ep="${sn}-${en}"]`);
      if (card) {
        card.classList.toggle('watched', watched);
        const check = card.querySelector('.ep-check');
        if (check) { check.classList.toggle('on', watched); check.setAttribute('aria-pressed', String(watched)); const label = check.querySelector('span'); if (label) label.textContent = watched ? 'Watched' : 'Mark watched'; }
        const still = card.querySelector('.ep-still');
        if (still) {
          still.querySelector('.ep-seen')?.remove();
          if (watched) still.insertAdjacentHTML('beforeend', `<div class="ep-seen" aria-hidden="true">${EP_CHECK}</div>`);
        }
      }
      refreshEpisodeUI(tid);
      syncSeasonToolbar(tid, sn, el.dataset.meta || '{}');
    },
    'ep-mark-upto': el => {
      const tid = +el.dataset.tid, sn = +el.dataset.sn, en = +el.dataset.en;
      const added = markUpTo(tid, sn, en, readEpisodeMeta(el));
      if (added === null) return;
      toast(added ? `Marked ${added} episode${added === 1 ? '' : 's'} watched` : 'Already up to date', added ? 'success' : 'info');
      loadEps(tid, sn).then(() => refreshEpisodeUI(tid));
    },
    'ep-set-position': el => {
      const tid = +el.dataset.tid;
      const input = el.closest('.episode-position')?.querySelector('[data-episode-position]');
      const result = setEpisodePosition(tid, input?.value, readEpisodeMeta(el));
      if (result === null) return;
      if (result?.error) { toast('Enter a whole episode number', 'info'); input?.focus(); return; }
      const location = result.location;
      const suffix = location ? ` · S${location.season}E${location.episode}` : '';
      toast(`Progress set to episode ${result.position}${suffix}${result.capped ? ' (latest aired)' : ''}`, 'success');
      refreshEpisodeUI(tid);
      if (location) loadSeason(tid, location.season);
    },
    'ep-mark-upto-prompt': el => {
      // Nothing to pre-fill from: send the reader to the season list, where every
      // row offers "Up to here".
      document.querySelector('.season-tabs')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      toast('Open a season and use “Up to here” on the last episode you saw', 'info');
    },
    'ep-season': el => {
      const tid = +el.dataset.tid, sn = +el.dataset.sn, on = el.dataset.on === '1';
      if (setSeasonWatched(tid, sn, on, readEpisodeMeta(el)) === null) return;
      toast(on ? `Season ${sn} marked watched` : `Season ${sn} cleared`, on ? 'success' : 'info');
      loadEps(tid, sn).then(() => refreshEpisodeUI(tid));
    },
    'ep-mark-show': async el => {
      const tid = +el.dataset.tid;
      el.disabled = true;
      const before = el.textContent;
      el.textContent = 'Marking…';
      const added = await markShowWatched(tid, readEpisodeMeta(el));
      el.disabled = false; el.textContent = before;
      if (added === null) return;              // refused: the auth modal is opening
      if (!added) { toast('Every aired episode is already marked', 'info'); return; }
      toast(`Marked ${added} episode${added === 1 ? '' : 's'} watched`, 'success');
      openDetail(tid, 'tv');
    },
    'season-rewatch': el => {
      const tid = +el.dataset.tid, sn = +el.dataset.sn;
      const plays = logSeasonRewatch(tid, sn, readEpisodeMeta(el));
      if (plays === null) return;
      if (!plays) { toast('Finish the season first', 'info'); return; }
      paintSeasonRewatch(tid, sn, el.dataset.meta || '{}');
      toast(plays === 2 ? `Season ${sn} seen twice` : `Season ${sn} seen ${plays} times`, 'success');
    },
    'season-rewatch-undo': el => {
      const tid = +el.dataset.tid, sn = +el.dataset.sn;
      const plays = removeSeasonRewatch(tid, sn, readEpisodeMeta(el));
      if (plays === null) return;
      paintSeasonRewatch(tid, sn, el.dataset.meta || '{}');
      toast(plays > 1 ? `Back to ${plays} viewings` : 'Back to one viewing', 'info');
    },
    'ep-reset': el => {
      const tid = +el.dataset.tid;
      clearShowProgress(tid);
      toast('Episode progress cleared', 'info');
      openDetail(tid, 'tv');
    },
    'go-collection': (el) => document.dispatchEvent(new CustomEvent('cv:go', { detail: `/collection/${el.dataset.cid}` })),
  });

  // Rebuild once the account arrives. Every library-dependent thing on this page
  // — the tick, the rating, the rewatch strip, the episode tracker, the
  // collection standing — was computed at render time, so patching them one by
  // one would be five chances to miss the sixth. The TMDB responses are cached,
  // so this costs a re-render and no network, and it fires at most once per
  // auth change, before anyone has had time to interact.
  document.addEventListener('cv:auth', () => {
    const uid = state.user?.uid || null;
    if (uid === renderedFor.uid || !renderedFor.kind) return;
    const page = document.getElementById('detailPage');
    if (!page || getComputedStyle(page).display === 'none') { renderedFor = { uid: null, kind: null, id: 0 }; return; }
    if (renderedFor.kind === 'collection') openCollection(renderedFor.id);
    else openDetail(renderedFor.id, curType || 'movie');
  });

  // The watched tick and the rewatch strip are two views of one fact, so ticking
  // either has to update the other. Scoped to the title actually on screen.
  document.addEventListener('cv:watched-toggled', (e) => {
    const id = +(e.detail?.id || 0), type = e.detail?.type;
    if (id && curDet && +curDet.id === id && curType === type) paintRewatchStrip(id, type);
  });

  registerActions({
    'region-change': (el) => {
      state.region = el.value;
      try { localStorage.setItem('cv_region', state.region); } catch (e) {}
      if (curDet) { const block = $('providerBlock'); if (block) block.innerHTML = providerHTML(curDet, state.region); }
      document.dispatchEvent(new Event('cv:region'));
    },
  });
}
