// ===== SMART WATCH-PARTY MATCHER (/party) =====
import { tmdb } from './api.js';
import { genreMap, mGenreList, tGenreList, moods } from './config.js';
import { state } from './state.js';
import { esc, $ } from './ui.js';
import { registerActions } from './events.js';
import { buildCard, skelCards } from './cards.js';
import { social, getFriendTaste } from './social.js';
import { buildTasteProfile, profileFromShared, blendProfiles, fetchCandidates, rankAndDedupe, matchBadge, scoreRange, diversify, tag } from './recommend.js';

const MOVIE_GENRES = new Set(mGenreList.map(g => g.id));
const TV_GENRES = new Set(tGenreList.map(g => g.id));
const sel = new Set();      // selected friend uids
const picks = new Set();    // genre ids picked on the spot ("tonight's vibe")
let allowSeen = false;
let partyMode = 'movie';    // 'movie' | 'tv'

const moodGenres = (m) => String(m.genres || '').split(',').map(Number).filter(Boolean);
const moodOn = (m) => { const ids = moodGenres(m); return ids.length > 0 && ids.every(i => picks.has(i)); };

// The on-the-spot vibe as a synthetic group member: it steers both the discover
// query and the scoring, which is what lets a group with NO history get picks.
function pickedProfile() {
  const genreWeights = {};
  picks.forEach(g => { genreWeights[g] = 3; });
  return {
    genreWeights, topGenres: [...picks], seedIds: [], seen: new Set(),
    movieBias: partyMode !== 'tv',
    actorWeights: {}, actorNames: {}, topActors: [],
    directorWeights: {}, directorNames: {}, topDirectors: [],
    decadeWeights: {}, topDecade: null,
    hasSignal: picks.size > 0,
  };
}

export function renderParty() {
  const ct = $('partyContent');
  if (!ct) return;
  if (!state.user) {
    ct.innerHTML = `<div class="wl-empty" style="padding:40px 20px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:56px;height:56px;color:var(--text3);margin-bottom:14px;opacity:.5"><path d="M8 5v14l11-7z"/></svg><h3>Sign in to host a watch party</h3><p>Blend everyone's taste to find the perfect film for movie night.</p><br><button class="btn-primary" data-action="open-auth">Sign In</button></div>`;
    return;
  }
  if (!social.friends.length) {
    ct.innerHTML = `<div class="wl-empty" style="padding:40px 20px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:56px;height:56px;color:var(--text3);margin-bottom:14px;opacity:.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><h3>Add friends first</h3><p>The matcher blends your circle's tastes — add a friend or two to begin.</p><br><button class="btn-primary" data-action="show-page" data-page="friends">Go to Friends</button></div>`;
    return;
  }

  const members = `
    <div class="party-members">
      <div class="party-chip you"><div class="friend-av sm">${esc((state.user.displayName || 'Y')[0].toUpperCase())}</div>You</div>
      ${social.friends.map(f => `<div class="party-chip ${sel.has(f.uid) ? 'on' : ''}" role="button" tabindex="0" data-action="party-toggle" data-uid="${esc(f.uid)}"><div class="friend-av sm">${esc((f.name || '?')[0].toUpperCase())}</div>${esc(f.name)}<span class="party-check">${sel.has(f.uid) ? '✓' : '+'}</span></div>`).join('')}
    </div>`;

  // "Set tonight's vibe" — moods + genre pills. Optional for a group with history,
  // essential for one without: it gives the matcher something to work from.
  const gList = partyMode === 'tv' ? tGenreList : mGenreList;
  const moodList = moods.filter(m => m.type === partyMode || m.type === 'multi');
  const vibe = `
    <div class="party-vibe">
      <div class="party-vibe-head">
        <span class="party-vibe-title">🎯 Set tonight's vibe</span>
        <span class="party-vibe-sub">${picks.size ? `${picks.size} picked` : 'Optional — use this when someone has no history yet'}</span>
        ${picks.size ? `<button class="party-vibe-clear" data-action="party-clear-vibe">Clear</button>` : ''}
      </div>
      <div class="party-moods">${moodList.map(m => `<button class="party-mood${moodOn(m) ? ' on' : ''}" data-action="party-mood" data-genres="${esc(String(m.genres || ''))}"><span class="party-mood-emoji">${m.emoji}</span>${esc(m.name)}</button>`).join('')}</div>
      <div class="party-genres">${gList.map(g => `<button class="g-pill${picks.has(g.id) ? ' active' : ''}" data-action="party-genre" data-id="${g.id}">${esc(g.n)}</button>`).join('')}</div>
    </div>`;

  ct.innerHTML = `
    <p style="color:var(--text2);margin-bottom:18px">Pick who's watching, and we'll find the film that satisfies everyone.</p>
    ${members}
    <div class="party-mode">
      <button class="party-mode-btn ${partyMode === 'movie' ? 'on' : ''}" data-action="party-mode" data-mode="movie"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/></svg>Movie</button>
      <button class="party-mode-btn ${partyMode === 'tv' ? 'on' : ''}" data-action="party-mode" data-mode="tv"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>TV Show</button>
    </div>
    ${vibe}
    <div class="party-controls">
      <button class="btn-primary" data-action="party-compute"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>Find our ${partyMode === 'tv' ? 'show' : 'movie'}</button>
      <label class="party-toggle"><input type="checkbox" data-action="party-allow-seen" ${allowSeen ? 'checked' : ''}> Include ${partyMode === 'tv' ? 'shows' : 'films'} some have seen</label>
    </div>
    <div id="partyResults"></div>`;
}

function whyGenres(blended) {
  const shared = (blended.topGenres || []).filter(g => (blended.genreMembers?.[g] || 0) >= blended.members).map(g => genreMap[g]).filter(Boolean).slice(0, 3);
  const fallback = (blended.topGenres || []).map(g => genreMap[g]).filter(Boolean).slice(0, 3);
  return (shared.length ? shared : fallback);
}

async function compute() {
  const res = $('partyResults');
  if (!res) return;
  res.innerHTML = `<div class="row" style="padding:0 0 8px">${skelCards(6)}</div>`;

  // Build each member's profile: me live from state, friends from shared taste docs.
  const profiles = [buildTasteProfile(state)];
  const names = ['You'];
  for (const uid of sel) {
    const f = social.friends.find(x => x.uid === uid);
    const t = await getFriendTaste(uid);
    if (t) { profiles.push(profileFromShared(t)); names.push(f?.name || 'Friend'); }
  }

  // The on-the-spot vibe joins as a member, so picks steer the query and scoring.
  if (picks.size) { profiles.push(pickedProfile()); }

  const blended = blendProfiles(profiles);
  if (allowSeen) blended.seen = new Set();

  // NO hard stop on "not enough data" any more — a group where nobody has history
  // still gets a real answer, from their vibe picks and/or what's trending.
  let cands = blended.hasSignal ? await fetchCandidates(blended, { only: partyMode }) : [];

  const path = partyMode === 'tv' ? '/discover/tv' : '/discover/movie';
  const gset = partyMode === 'tv' ? TV_GENRES : MOVIE_GENRES;
  // Tonight's pick has to be watchable tonight, so bound the query to titles
  // that are already out (rankAndDedupe enforces this too).
  const outParam = partyMode === 'tv'
    ? { 'first_air_date.lte': new Date().toISOString().slice(0, 10) }
    : { 'release_date.lte': new Date().toISOString().slice(0, 10) };
  const g = (blended.topGenres || []).filter(x => gset.has(x)).slice(0, 3);
  if (g.length) {
    // OR-joined for breadth (a comma would demand a title match ALL of them).
    try {
      const d = await tmdb(path, { with_genres: g.join('|'), sort_by: 'popularity.desc', 'vote_count.gte': 200, ...outParam });
      cands = cands.concat(tag(d.results, partyMode, 'genre'));
    } catch (e) {}
  }

  // Weak or absent signal → blend in this week's trending as a neutral baseline.
  if (!blended.hasSignal || cands.length < 8) {
    try {
      const d = await tmdb(`/trending/${partyMode}/week`);
      cands = cands.concat(tag(d.results, partyMode, 'trending'));
    } catch (e) {}
  }

  let ranked = diversify(rankAndDedupe(cands, blended), 18);

  // Last resort, so the group is never left staring at an error: broadly popular
  // titles of the chosen type.
  if (!ranked.length) {
    try {
      const d = await tmdb(path, { sort_by: 'popularity.desc', 'vote_count.gte': 300, ...outParam });
      ranked = diversify(rankAndDedupe(tag(d.results, partyMode, 'trending'), blended), 18);
    } catch (e) {}
  }
  if (!ranked.length) { res.innerHTML = `<p style="color:var(--text3);padding:20px">Couldn't find a crossover pick — try including ${partyMode === 'tv' ? 'shows' : 'films'} some have seen.</p>`; return; }

  const top = ranked[0];
  // The whole ranked set, so the badges spread across the real spread of scores
  // rather than clustering at 99% (see matchBadge).
  const topScore = scoreRange(ranked);
  const why = whyGenres(blended);
  // When the group leaned on the vibe picker, say so — "you all love X" would be a
  // lie for people with no history.
  const pickedNames = [...picks].map(g => genreMap[g]).filter(Boolean).slice(0, 3);
  const whyLine = picks.size && pickedNames.length
    ? `Because you picked <strong>${pickedNames.map(esc).join(', ')}</strong>.`
    : (why.length ? `Because you all love <strong>${why.map(esc).join(', ')}</strong>.` : '');
  const memberLine = names.length > 1 ? names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1] : names[0];
  const poster = top.poster_path ? `https://image.tmdb.org/t/p/w500${top.poster_path}` : '';

  res.innerHTML = `
    <div class="party-hero">
      <a class="party-hero-poster" href="/${top.__type}/${top.id}" data-action="open-detail" data-id="${top.id}" data-type="${top.__type}">${poster ? `<img src="${poster}" alt="${esc(top.title || top.name || '')}" loading="lazy">` : ''}</a>
      <div class="party-hero-body">
        <div class="party-hero-tag">🍿 The one ${partyMode === 'tv' ? 'show' : 'film'} for tonight</div>
        <h2 class="party-hero-title">${esc(top.title || top.name || '')}</h2>
        <div class="party-hero-match">${matchBadge(top.__score, topScore)} for ${esc(memberLine)}</div>
        ${whyLine ? `<p class="party-hero-why">${whyLine}</p>` : ''}
        <a class="btn-primary" href="/${top.__type}/${top.id}" data-action="open-detail" data-id="${top.id}" data-type="${top.__type}"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>View</a>
      </div>
    </div>
    <div class="d-sec-title" style="margin-top:28px">More perfect for your group</div>
    <div class="party-grid">${ranked.slice(1).map(c => buildCard(c, c.__type, { badge: matchBadge(c.__score, topScore) })).join('')}</div>`;
}

export function initParty() {
  document.addEventListener('cv:social', () => { if (location.pathname === '/party') renderParty(); });
  // Selection state is per-account — clear it on sign-out so a second user signing
  // in on the same tab/session doesn't inherit the previous user's selected
  // friends/mode (social.js already resets the friends list itself the same way).
  document.addEventListener('cv:auth', () => {
    if (state.user) return;
    sel.clear(); picks.clear(); allowSeen = false; partyMode = 'movie';
  });
  registerActions({
    'party-toggle': (el) => { const uid = el.dataset.uid; sel.has(uid) ? sel.delete(uid) : sel.add(uid); renderParty(); },
    'party-mode': (el) => { partyMode = el.dataset.mode === 'tv' ? 'tv' : 'movie'; renderParty(); },
    'party-allow-seen': (el) => { allowSeen = !!el.checked; },
    'party-compute': () => compute(),
    // ----- Tonight's vibe -----
    'party-genre': (el) => { const id = +el.dataset.id; picks.has(id) ? picks.delete(id) : picks.add(id); renderParty(); },
    'party-mood': (el) => {
      const ids = String(el.dataset.genres || '').split(',').map(Number).filter(Boolean);
      const allOn = ids.length > 0 && ids.every(i => picks.has(i));
      ids.forEach(i => (allOn ? picks.delete(i) : picks.add(i)));
      renderParty();
    },
    'party-clear-vibe': () => { picks.clear(); renderParty(); },
  });
}
