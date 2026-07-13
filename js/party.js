// ===== SMART WATCH-PARTY MATCHER (/party) =====
import { tmdb } from './api.js';
import { genreMap, mGenreList } from './config.js';
import { state } from './state.js';
import { esc, $ } from './ui.js';
import { registerActions } from './events.js';
import { buildCard, skelCards } from './cards.js';
import { social, loadFriends, getFriendTaste } from './social.js';
import { buildTasteProfile, profileFromShared, blendProfiles, fetchCandidates, rankAndDedupe, matchBadge } from './recommend.js';

const MOVIE_GENRES = new Set(mGenreList.map(g => g.id));
const sel = new Set();      // selected friend uids
let allowSeen = false;

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

  ct.innerHTML = `
    <p style="color:var(--text2);margin-bottom:18px">Pick who's watching, and we'll find the film that satisfies everyone.</p>
    ${members}
    <div class="party-controls">
      <button class="btn-primary" data-action="party-compute"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>Find our movie</button>
      <label class="party-toggle"><input type="checkbox" data-action="party-allow-seen" ${allowSeen ? 'checked' : ''}> Include films some have seen</label>
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

  const blended = blendProfiles(profiles);
  if (allowSeen) blended.seen = new Set();
  if (!blended.hasSignal) { res.innerHTML = `<p style="color:var(--text3);padding:20px">Not enough shared taste data yet. Add a few titles to your lists and try again.</p>`; return; }

  let cands = await fetchCandidates(blended);
  // Extra: discover by the group's shared top genres for breadth.
  const mg = blended.topGenres.filter(g => MOVIE_GENRES.has(g)).slice(0, 3);
  if (mg.length) { try { const d = await tmdb('/discover/movie', { with_genres: mg.join(','), sort_by: 'popularity.desc', 'vote_count.gte': 200 }); cands = cands.concat((d.results || []).map(r => ({ ...r, __type: 'movie', __source: 'discover' }))); } catch (e) {} }

  const ranked = rankAndDedupe(cands, blended).slice(0, 18);
  if (!ranked.length) { res.innerHTML = `<p style="color:var(--text3);padding:20px">Couldn't find a crossover pick — try including films some have seen.</p>`; return; }

  const top = ranked[0];
  const topScore = top.__score || 1;
  const why = whyGenres(blended);
  const memberLine = names.length > 1 ? names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1] : names[0];
  const poster = top.poster_path ? `https://image.tmdb.org/t/p/w500${top.poster_path}` : '';

  res.innerHTML = `
    <div class="party-hero">
      <div class="party-hero-poster" role="button" tabindex="0" data-action="open-detail" data-id="${top.id}" data-type="${top.__type}">${poster ? `<img src="${poster}" alt="${esc(top.title || top.name || '')}" loading="lazy">` : ''}</div>
      <div class="party-hero-body">
        <div class="party-hero-tag">🍿 The one for tonight</div>
        <h2 class="party-hero-title">${esc(top.title || top.name || '')}</h2>
        <div class="party-hero-match">${matchBadge(top.__score, topScore)} for ${esc(memberLine)}</div>
        ${why.length ? `<p class="party-hero-why">Because you all love <strong>${why.map(esc).join(', ')}</strong>.</p>` : ''}
        <button class="btn-primary" data-action="open-detail" data-id="${top.id}" data-type="${top.__type}"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>View</button>
      </div>
    </div>
    <div class="d-sec-title" style="margin-top:28px">More perfect for your group</div>
    <div class="party-grid">${ranked.slice(1).map(c => buildCard(c, c.__type, { badge: matchBadge(c.__score, topScore) })).join('')}</div>`;
}

export function initParty() {
  document.addEventListener('cv:social', () => { if (location.pathname === '/party') renderParty(); });
  registerActions({
    'party-toggle': (el) => { const uid = el.dataset.uid; sel.has(uid) ? sel.delete(uid) : sel.add(uid); renderParty(); },
    'party-allow-seen': (el) => { allowSeen = !!el.checked; },
    'party-compute': () => compute(),
  });
}
