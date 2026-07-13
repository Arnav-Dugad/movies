// ===== DETAIL PAGE =====
import { tmdb } from './api.js';
import { IMG, PH, REGIONS } from './config.js';
import { state, pushRecentlyViewed } from './state.js';
import { esc, fmt, $ } from './ui.js';
import { buildCard } from './cards.js';
import { registerActions } from './events.js';
import { observeReveals, observeCountUps } from './effects.js';

let curDet = null, curType = null;

export async function openDetail(id, type) {
  const ct = $('detailContent');
  ct.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:60vh"><div class="loader-text">Loading...</div></div>';
  document.title = 'Loading… — CineVerse';
  state.cdIntervals.forEach(clearInterval); state.cdIntervals = [];
  try {
    const [det, cred, vids, sim, revs] = await Promise.all([
      tmdb(`/${type}/${id}`, { append_to_response: 'external_ids,content_ratings,release_dates,watch/providers,keywords,recommendations' }),
      tmdb(`/${type}/${id}/credits`), tmdb(`/${type}/${id}/videos`), tmdb(`/${type}/${id}/similar`), tmdb(`/${type}/${id}/reviews`)
    ]);
    curDet = det; curType = type;

    const title = det.title || det.name || ''; const safeTitle = esc(title);
    const year = (det.release_date || det.first_air_date || '').slice(0, 4);
    document.title = `${title}${year ? ' (' + year + ')' : ''} — CineVerse`;
    const back = det.backdrop_path ? `${IMG}original${det.backdrop_path}` : ''; const poster = det.poster_path ? `${IMG}w500${det.poster_path}` : PH;
    const rat = det.vote_average ? det.vote_average.toFixed(1) : 'N/A';
    const rt = det.runtime ? `${Math.floor(det.runtime / 60)}h ${det.runtime % 60}m` : (det.episode_run_time?.length ? `${det.episode_run_time[0]}m/ep` : '');
    const genres = (det.genres || []).map(g => g.name); const cert = getCert(det, type);
    const dir = cred.crew?.find(c => c.job === 'Director');
    const trailer = vids.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube') || vids.results?.find(v => v.site === 'YouTube');
    const wl = state.watchlist.some(w => w.id === `${type}_${id}`);
    const myRating = state.ratings[`${type}_${id}`];
    const wd = !!state.watched[`${type}_${id}`];
    const recs = det.recommendations?.results || sim.results || [];

    // Record for personalization
    pushRecentlyViewed({ id, type, title, poster: det.poster_path || '', genres: (det.genres || []).map(g => g.id) });

    // Watchlist payload
    const wlPayload = esc(JSON.stringify({ id, type, title, poster: det.poster_path || '', rating: det.vote_average || 0, year, genres: (det.genres || []).map(g => g.id) }));

    // Prefer a production company that actually has a logo; else the first.
    const studio = det.production_companies?.length ? (det.production_companies.find(c => c.logo_path) || det.production_companies[0]) : null;
    const boHTML = boxOfficeHTML(det);

    let cdHTML = '';
    if (type === 'tv' && det.next_episode_to_air) { const nd = new Date(det.next_episode_to_air.air_date); if (nd > new Date()) {
      cdHTML = `<div class="countdown"><div class="countdown-label"><span class="live-dot"></span>Next Episode — S${det.next_episode_to_air.season_number}E${det.next_episode_to_air.episode_number}${det.next_episode_to_air.name ? ` "${esc(det.next_episode_to_air.name)}"` : ''}</div><div class="countdown-grid"><div class="cd-unit"><div class="cd-num" id="cd_d_${id}">--</div><div class="cd-txt">Days</div></div><div class="cd-unit"><div class="cd-num" id="cd_h_${id}">--</div><div class="cd-txt">Hours</div></div><div class="cd-unit"><div class="cd-num" id="cd_m_${id}">--</div><div class="cd-txt">Min</div></div><div class="cd-unit"><div class="cd-num" id="cd_s_${id}">--</div><div class="cd-txt">Sec</div></div></div></div>`;
    }}

    let seasHTML = '';
    if (type === 'tv' && det.seasons?.length) { const vs = det.seasons.filter(s => s.season_number > 0);
      seasHTML = `<div style="margin-bottom:32px"><div class="d-sec-title">Episodes</div><div class="season-tabs">${vs.map((s, i) => `<div class="s-tab ${i === 0 ? 'active' : ''}" role="button" tabindex="0" data-action="load-season" data-tid="${id}" data-sn="${s.season_number}">${esc(s.name)}</div>`).join('')}</div><div class="ep-list" id="epList_${id}"><div class="skel" style="height:80px;width:100%"></div></div></div>`; }

    const allVids = (vids.results || []).filter(v => v.site === 'YouTube').slice(0, 10);
    let vidsHTML = ''; if (allVids.length) vidsHTML = `<div style="margin-bottom:32px"><div class="d-sec-title">Videos & Trailers</div><div class="vid-scroll">${allVids.map(v => `<div class="vid-card" role="button" tabindex="0" data-action="play-trailer" data-key="${v.key}"><div class="vid-thumb"><img src="https://img.youtube.com/vi/${v.key}/mqdefault.jpg" alt="${esc(v.name)}" loading="lazy"><div class="vid-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div></div><div class="vid-name">${esc(v.name)}</div><div class="vid-type">${esc(v.type) || ''}</div></div>`).join('')}</div></div>`;

    const cast = (cred.cast || []).slice(0, 20);
    let castHTML = ''; if (cast.length) castHTML = `<div style="margin-bottom:32px"><div class="d-sec-title">Cast</div><div class="cast-scroll">${cast.map(c => `<div class="cast-item" role="button" tabindex="0" data-action="open-person" data-id="${c.id}"><div class="cast-pic">${c.profile_path ? `<img src="${IMG}w185${c.profile_path}" alt="${esc(c.name)}" loading="lazy">` : ''}</div><div class="cast-name">${esc(c.name)}</div><div class="cast-char">${esc(c.character) || ''}</div></div>`).join('')}</div></div>`;

    const revList = (revs.results || []).slice(0, 4);
    let revsHTML = ''; if (revList.length) revsHTML = `<div style="margin-bottom:32px"><div class="d-sec-title">Reviews</div>${revList.map(r => `<div class="review"><div class="review-top"><div class="review-av">${(r.author || '?')[0].toUpperCase()}</div><div><div class="review-author">${esc(r.author)}</div><div class="review-date">${r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}</div></div>${r.author_details?.rating ? `<div class="review-score"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>${r.author_details.rating}</div>` : ''}</div><div class="review-body">${esc(r.content || '')}</div></div>`).join('')}</div>`;

    const simItems = recs.slice(0, 14);
    let simHTML = ''; if (simItems.length) simHTML = `<div style="margin-bottom:32px"><div class="d-sec-title">More Like This</div><div class="similar-row">${simItems.map(s => buildCard(s, s.media_type || type)).join('')}</div></div>`;

    const kws = det.keywords?.keywords || det.keywords?.results || [];
    let kwHTML = ''; if (kws.length) kwHTML = `<div style="margin-bottom:32px;display:flex;flex-wrap:wrap;gap:6px">${kws.slice(0, 15).map(k => `<span class="dtag" style="font-size:.72rem">${esc(k.name)}</span>`).join('')}</div>`;

    let collHTML = '';
    if (det.belongs_to_collection) { const c = det.belongs_to_collection;
      collHTML = `<div class="coll-banner" role="button" tabindex="0" data-action="go-collection" data-cid="${c.id}" style="margin:36px 0 28px">${c.backdrop_path ? `<img src="${IMG}w780${c.backdrop_path}" alt="">` : ''}<div class="coll-banner-content"><div><h3>Part of ${esc(c.name)}</h3><p>View the full collection →</p></div></div></div>`; }

    ct.innerHTML = `
      ${back ? `<div class="detail-back"><img src="${back}" alt=""><div class="detail-back-grad"></div></div>` : '<div style="height:var(--nav-h)"></div>'}
      <div class="detail-inner">
        <div class="detail-top">
          <div class="detail-poster"><img src="${poster}" alt="${safeTitle}" data-ph="${PH}"></div>
          <div class="detail-head">
            <h1 class="detail-title">${safeTitle}</h1>
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
              <button class="dbtn-icon ${wl ? 'active' : ''}" data-wl="${type}|${id}" data-action="toggle-wl" data-item="${wlPayload}" aria-label="Watchlist" data-tip="${wl ? 'Remove from list' : 'Add to list'}">${wl ? '✓' : '+'}</button>
              <button class="dbtn-icon ${wd ? 'active' : ''}" data-action="toggle-watched" data-id="${id}" data-type="${type}" data-title="${safeTitle}" aria-label="${wd ? 'Unmark watched' : 'Mark as watched'}" data-tip="${wd ? 'Unmark watched' : 'Mark as watched'}" style="${wd ? 'color:var(--green);border-color:var(--green)' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg></button>
              <button class="dbtn-icon" data-action="open-rating" data-id="${id}" data-type="${type}" data-title="${safeTitle}" aria-label="Rate" data-tip="Rate">${myRating ? `<span style="font-size:.72rem;font-weight:800;color:var(--gold)">${myRating}</span>` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'}</button>
              <button class="dbtn-icon" data-action="share-item" data-title="${safeTitle}" data-id="${id}" data-type="${type}" aria-label="Share" data-tip="Share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>
            </div>
          </div>
        </div>
        ${cdHTML}${collHTML}
        <p class="detail-overview clamped" id="detOv">${esc(det.overview || 'No overview available.')}</p>
        ${(det.overview || '').length > 280 ? `<span class="detail-overview-toggle" data-action="toggle-overview">Read more</span>` : ''}
        <div class="stats-grid">
          ${det.status ? `<div class="stat-card"><div class="stat-label">Status</div><div class="stat-val"><span style="color:${det.status === 'Released' || det.status === 'Returning Series' ? 'var(--green2)' : 'var(--text)'}">${det.status === 'Returning Series' ? '<span class="live-dot"></span>' : ''} ${esc(det.status)}</span></div></div>` : ''}
          ${det.original_language ? `<div class="stat-card"><div class="stat-label">Language</div><div class="stat-val">${det.original_language.toUpperCase()}</div></div>` : ''}
          ${boHTML}
          ${det.vote_count ? `<div class="stat-card"><div class="stat-label">Votes</div><div class="stat-val" data-count="${det.vote_count}">${det.vote_count.toLocaleString()}</div></div>` : ''}
          ${dir ? `<div class="stat-card stat-person" style="cursor:pointer" data-action="open-person" data-id="${dir.id}" data-tip="View ${esc(dir.name)}"><div class="stat-label">Director</div><div class="sp-row"><div class="sp-pic">${dir.profile_path ? `<img src="${IMG}w185${dir.profile_path}" alt="${esc(dir.name)}" loading="lazy" data-ph="${PH}">` : `<span class="sp-mono">${esc((dir.name || '?')[0])}</span>`}</div><div class="sp-name">${esc(dir.name)}</div></div></div>` : ''}
          ${type === 'tv' && det.number_of_seasons ? `<div class="stat-card"><div class="stat-label">Seasons</div><div class="stat-val" data-count="${det.number_of_seasons}">${det.number_of_seasons}</div></div>` : ''}
          ${type === 'tv' && det.number_of_episodes ? `<div class="stat-card"><div class="stat-label">Episodes</div><div class="stat-val" data-count="${det.number_of_episodes}">${det.number_of_episodes}</div></div>` : ''}
          ${type === 'tv' && det.networks?.length ? `<div class="stat-card"><div class="stat-label">Network</div><div class="stat-val">${det.networks.map(n => esc(n.name)).join(', ')}</div></div>` : ''}
          ${studio ? `<div class="stat-card"><div class="stat-label">Studio</div>${studio.logo_path ? `<div class="studio-logo"><img src="${IMG}w185${studio.logo_path}" alt="${esc(studio.name)}" title="${esc(studio.name)}" loading="lazy"></div>` : `<div class="stat-val">${esc(studio.name)}</div>`}</div>` : ''}
          ${det.homepage ? `<div class="stat-card"><div class="stat-label">Website</div><div class="stat-val"><a href="${esc(det.homepage)}" target="_blank" rel="noopener" style="color:var(--cyan);font-size:.82rem;word-break:break-all">Visit →</a></div></div>` : ''}
          <div id="providerBlock">${providerHTML(det, state.region)}</div>
        </div>
        ${kwHTML}${vidsHTML}${castHTML}${seasHTML}${revsHTML}${simHTML}
      </div>`;

    if (type === 'tv' && det.next_episode_to_air) startCD(id, det.next_episode_to_air.air_date);
    if (type === 'tv' && det.seasons?.length) { const fs = det.seasons.find(s => s.season_number > 0); if (fs) loadEps(id, fs.season_number); }
    observeReveals(ct); observeCountUps(ct);
    // Animate the Box Office bar widths after paint (horizontal %-widths resolve
    // against the definite-width card).
    requestAnimationFrame(() => ct.querySelectorAll('.bo-fill').forEach(f => { f.style.width = (+f.dataset.w || 0) + '%'; }));
  } catch (e) {
    console.error(e);
    ct.innerHTML = '<div style="text-align:center;padding:120px 20px"><p style="font-size:1.1rem;font-weight:600">Failed to load</p><p style="color:var(--text3);margin:8px 0 20px">Please try again</p><button class="btn-primary" data-action="back">Back</button></div>';
  }
}

function providerHTML(det, region) {
  const results = det['watch/providers']?.results || {};
  const prov = results[region] || {};
  const options = REGIONS.map(([code, label]) => `<option value="${code}" ${code === region ? 'selected' : ''}>${label}</option>`).join('');
  const groups = [['Stream', prov.flatrate], ['Ads', prov.ads]]
    .filter(([, list]) => list && list.length);
  const inner = groups.length
    ? groups.map(([label, list]) => `<div class="provider-group"><div class="provider-group-label">${label}</div><div class="provider-icons">${list.slice(0, 6).map(p => `<img class="provider-logo" src="${IMG}w92${p.logo_path}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)}" loading="lazy">`).join('')}</div></div>`).join('')
    : '<span style="font-size:.78rem;color:var(--text3)">Not available in your region</span>';
  return `<div class="stat-card"><div class="stat-label" style="display:flex;align-items:center">Where to Watch<select class="region-select" data-action="region-change">${options}</select></div><div class="stat-val providers">${inner}</div></div>`;
}

// Combined Budget / Revenue / Profit "Box Office" graph card (spans the grid).
function boxOfficeHTML(det) {
  const budget = det.budget || 0, revenue = det.revenue || 0;
  if (!budget && !revenue) return '';
  const max = Math.max(budget, revenue, 1);
  const bW = Math.round(budget / max * 100), rW = Math.round(revenue / max * 100);
  const profit = revenue - budget, hasBoth = budget && revenue, roi = budget ? revenue / budget : 0;
  return `<div class="stat-card boxoffice">
    <div class="stat-label">💰 Box Office</div>
    <div class="bo-bars">
      ${budget ? `<div class="bo-row"><span class="bo-name">Budget</span><div class="bo-track"><div class="bo-fill budget" style="width:0" data-w="${bW}"></div></div><span class="bo-val">$${fmt(budget)}</span></div>` : ''}
      ${revenue ? `<div class="bo-row"><span class="bo-name">Revenue</span><div class="bo-track"><div class="bo-fill revenue" style="width:0" data-w="${rW}"></div></div><span class="bo-val">$${fmt(revenue)}</span></div>` : ''}
    </div>
    ${hasBoth ? `<div class="bo-summary"><div class="bo-chip ${profit >= 0 ? 'up' : 'down'}"><span class="bo-clabel">${profit >= 0 ? 'Profit' : 'Loss'}</span><span class="bo-cval">${profit >= 0 ? '+' : '−'}$${fmt(Math.abs(profit))}</span></div><div class="bo-chip roi"><span class="bo-clabel">ROI</span><span class="bo-cval">${roi.toFixed(1)}×</span></div></div>` : ''}
  </div>`;
}

export function closeDetail() {
  state.cdIntervals.forEach(clearInterval); state.cdIntervals = [];
}

function getCert(d, t) {
  if (t === 'movie') { const u = d.release_dates?.results?.find(r => r.iso_3166_1 === 'US'); return u?.release_dates?.[0]?.certification || ''; }
  return d.content_ratings?.results?.find(r => r.iso_3166_1 === 'US')?.rating || '';
}

function startCD(id, ds) {
  const tg = new Date(ds).getTime();
  function up() {
    const df = tg - Date.now();
    if (df <= 0) { const e = $(`cd_d_${id}`); if (e) e.parentElement.parentElement.innerHTML = '<div style="color:var(--green2);font-size:1rem;font-weight:700">🎉 Now Airing!</div>'; return; }
    const d = Math.floor(df / 864e5), h = Math.floor(df % 864e5 / 36e5), m = Math.floor(df % 36e5 / 6e4), s = Math.floor(df % 6e4 / 1e3);
    const de = $(`cd_d_${id}`), he = $(`cd_h_${id}`), me = $(`cd_m_${id}`), se = $(`cd_s_${id}`);
    if (de) de.textContent = String(d).padStart(2, '0'); if (he) he.textContent = String(h).padStart(2, '0'); if (me) me.textContent = String(m).padStart(2, '0'); if (se) se.textContent = String(s).padStart(2, '0');
  }
  up(); state.cdIntervals.push(setInterval(up, 1000));
}

async function loadSeason(tid, sn, el) {
  el.parentElement.querySelectorAll('.s-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  await loadEps(tid, sn);
}
async function loadEps(tid, sn) {
  const el = $(`epList_${tid}`); if (!el) return;
  el.innerHTML = '<div class="skel" style="height:80px;width:100%"></div>';
  try {
    const d = await tmdb(`/tv/${tid}/season/${sn}`);
    el.innerHTML = (d.episodes || []).map(ep => `<div class="ep-card"><div class="ep-still">${ep.still_path ? `<img src="${IMG}w300${ep.still_path}" alt="" loading="lazy">` : ''}<div class="ep-num">E${ep.episode_number}</div></div><div class="ep-body"><div class="ep-title">${esc(ep.name) || `Episode ${ep.episode_number}`}</div><div class="ep-meta">${ep.air_date ? `<span>${new Date(ep.air_date).toLocaleDateString()}</span>` : ''}${ep.runtime ? `<span>${ep.runtime}m</span>` : ''}${ep.vote_average ? `<span>⭐ ${ep.vote_average.toFixed(1)}</span>` : ''}</div><div class="ep-desc">${esc(ep.overview || '')}</div></div></div>`).join('') || '<p style="color:var(--text3);padding:12px">No episodes yet</p>';
  } catch (e) { el.innerHTML = '<p style="color:var(--text3);padding:12px">Failed to load</p>'; }
}

export async function openCollection(cid) {
  const ct = $('detailContent');
  document.title = 'Collection — CineVerse';
  try {
    const d = await tmdb(`/collection/${cid}`);
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
      document.dispatchEvent(new CustomEvent('cv:go', { detail: `/${type}/${id}` }));
    },
    'toggle-overview': (el) => {
      const ov = $('detOv'); if (!ov) return;
      ov.classList.toggle('clamped');
      el.textContent = ov.classList.contains('clamped') ? 'Read more' : 'Show less';
    },
    'load-season': (el) => loadSeason(+el.dataset.tid, +el.dataset.sn, el),
    'go-collection': (el) => document.dispatchEvent(new CustomEvent('cv:go', { detail: `/collection/${el.dataset.cid}` })),
    'region-change': (el) => {
      state.region = el.value;
      try { localStorage.setItem('cv_region', state.region); } catch (e) {}
      if (curDet) { const block = $('providerBlock'); if (block) block.innerHTML = providerHTML(curDet, state.region); }
    },
  });
}
