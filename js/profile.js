// ===== PROFILE PAGE (/profile) =====
import { state, isWatched } from './state.js';
import { $, esc, toast } from './ui.js';
import { registerActions } from './events.js';
import { AVATARS, genreMap, IMG, PH } from './config.js';
import { avatarBg, avatarMarkup, avatarPresetId } from './avatar.js';
import { buildCtx, BADGES } from './badges.js';
import { myRatingHTML, WATCHED_BADGE_HTML } from './cards.js';
import { social, displayCode } from './social.js';
import { saveProfile } from './auth.js';
import { friendQrSvg, tasteMatchQrSvg, tasteMatchUrl } from './qrcode.js';
import { renderRecommendations } from './recommend.js';

let editing = false;
let draftAvatar = undefined;   // undefined = untouched; null = cleared to initial
let draftPinned = undefined;
let intelligenceOpen = false;

const PROFILE_ICONS = {
  watched: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1Z"/></svg>',
  saved: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.1h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3h4a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>',
};

function memberSince(created) {
  if (!created) return '';
  const ms = created.seconds ? created.seconds * 1000 : (created.__ts || (typeof created.toMillis === 'function' ? created.toMillis() : 0));
  if (!ms) return '';
  return new Date(ms).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function profileInsights(ctx) {
  const watched = Object.entries(state.watched).map(([key, doc]) => ({ key, ...doc }));
  const ratings = Object.values(state.ratings).map(Number).filter(Boolean);
  const genres = new Map(), decades = new Map();
  watched.forEach(item => {
    (item.genres || []).forEach(id => { if (genreMap[id]) genres.set(id, (genres.get(id) || 0) + 1); });
    const year = +(item.year || 0); if (year) { const decade = Math.floor(year / 10) * 10; decades.set(decade, (decades.get(decade) || 0) + 1); }
  });
  const top = map => [...map].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0];
  const topGenre = top(genres), topDecade = top(decades), nowYear = new Date().getFullYear();
  const watchedYear = item => {
    const ms = item.watchedAt?.seconds ? item.watchedAt.seconds * 1000 : (typeof item.watchedAt?.toMillis === 'function' ? item.watchedAt.toMillis() : 0);
    return ms && ms <= Date.now() ? new Date(ms).getFullYear() : 0;
  };
  const ratedWatched = watched.filter(item => state.ratings[item.key]).length;
  const snapshot = state.statsSnapshot || {};
  return {
    watched,
    avgRating: ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : 0,
    topGenre: topGenre ? genreMap[topGenre[0]] : 'Discovering', topDecade: topDecade ? `${topDecade[0]}s` : 'Discovering',
    ratingCoverage: watched.length ? Math.round(ratedWatched / watched.length * 100) : 0,
    thisYear: watched.filter(item => watchedYear(item) === nowYear).length,
    health: +(snapshot.collection?.health?.score || 0), streak: +(snapshot.activity?.currentStreak || 0),
    level: snapshot.identity?.level || (ctx.watchedTotal >= 100 ? 'Cinephile' : ctx.watchedTotal >= 50 ? 'Curator' : ctx.watchedTotal >= 10 ? 'Explorer' : 'New Voyager'),
  };
}

export function renderProfile() {
  const ct = $('profileContent');
  if (!ct) return;
  if (!state.user) {
    ct.innerHTML = `<div class="wl-empty" style="padding:40px 20px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:56px;height:56px;color:var(--text3);margin-bottom:14px;opacity:.5"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1"/></svg><h3>Sign in to view your profile</h3><p>Create an account to personalise CineVerse.</p><br><button class="btn-primary" data-action="open-auth">Sign In</button></div>`;
    return;
  }

  const u = state.user;
  const name = u.displayName || (u.email || 'User').split('@')[0];
  const av = draftAvatar !== undefined ? draftAvatar : state.profile.avatar;
  const since = memberSince(state.profile.created);
  const code = displayCode(social.code);
  const c = buildCtx();
  const insight = profileInsights(c);
  const earnedBadges = BADGES.filter(badge => badge.value(c) >= badge.goal);
  const earnedIds = new Set(earnedBadges.map(badge => badge.id));
  const selectedPins = (draftPinned !== undefined ? draftPinned : state.profile.pinnedBadges || []).filter(id => earnedIds.has(id)).slice(0, 3);
  const pinnedBadges = selectedPins.map(id => BADGES.find(badge => badge.id === id)).filter(Boolean);
  const strengthChecks = [!!u.displayName, !!av, !!code, !!state.profile.created, !!state.profile.headline, !!state.profile.bio, c.watchedTotal > 0, c.ratedTotal > 0, pinnedBadges.length > 0];
  const strength = Math.round(strengthChecks.filter(Boolean).length / strengthChecks.length * 100);
  const backdropItems = [...insight.watched].filter(item => item.poster).sort((a, b) => (b.watchedAt?.seconds || 0) - (a.watchedAt?.seconds || 0)).slice(0, 4);
  const backdrop = backdropItems.length ? `<div class="profile-cinema-wall">${backdropItems.map(item => `<img src="${IMG}w342${item.poster}" alt="" loading="lazy">`).join('')}</div>` : '';

  const header = `
    <section class="profile-premium-hero">${backdrop}<div class="profile-hero-shade"></div>
      <div class="profile-hero-content">
        <div class="profile-avatar-wrap"><div class="profile-av-lg${avatarPresetId(av) ? ' has-avatar-image' : ''}" style="background:${avatarBg(av)}">${avatarMarkup(av, name)}</div><span>${esc(insight.level)}</span></div>
        <div class="profile-id">
          <div class="profile-eyebrow"><i></i>Private Cineprint</div>
          <h1 class="profile-nm">${esc(name)}</h1>
          <div class="profile-email">${esc(state.profile.headline || u.email || '')}</div>
          <div class="profile-identity-tags">${since ? `<span>Member since ${esc(since)}</span>` : ''}${state.profile.location ? `<span>${esc(state.profile.location)}</span>` : ''}<span>${esc(insight.topGenre)} taste</span><span>${social.friends.length} friend${social.friends.length === 1 ? '' : 's'}</span></div>
          ${pinnedBadges.length ? `<div class="profile-pinned" aria-label="Pinned achievements">${pinnedBadges.map(badge => `<span class="profile-pin tier-${badge.tier}" title="${esc(badge.desc)}"><i>${badge.icon}</i><b>${esc(badge.name)}</b></span>`).join('')}</div>` : `<button class="profile-pin-empty" data-action="profile-edit">Pin achievements to your hero</button>`}
        </div>
        <div class="profile-hero-actions"><button class="btn-primary profile-edit-btn" data-action="profile-edit">Edit profile</button><button class="btn-glass" data-action="show-page" data-page="settings">${PROFILE_ICONS.settings}Settings</button></div>
      </div>
    </section>`;

  const editForm = editing ? `
    <div class="profile-editcard profile-panel">
      <div class="profile-panel-head"><div><span>Personal identity studio</span><h2>Edit your Cineprint</h2></div><b>Private</b></div>
      <div class="profile-edit-grid">
        <label class="profile-field"><span>Display name</span><input id="profileName" type="text" value="${esc(name)}" maxlength="40" autocomplete="off"></label>
        <label class="profile-field"><span>Cinephile headline</span><input id="profileHeadline" type="text" value="${esc(state.profile.headline || '')}" maxlength="70" placeholder="Midnight movies and impossible worlds"></label>
        <label class="profile-field"><span>Location</span><input id="profileLocation" type="text" value="${esc(state.profile.location || '')}" maxlength="60" placeholder="Mumbai, India"></label>
        <label class="profile-field"><span>Favorite film</span><input id="profileFavorite" type="text" value="${esc(state.profile.favoriteFilm || '')}" maxlength="80" placeholder="The title you always return to"></label>
        <label class="profile-field profile-field-wide"><span>About your taste</span><textarea id="profileBio" maxlength="220" placeholder="What makes a movie unforgettable for you?">${esc(state.profile.bio || '')}</textarea><small>Shown only on your private Profile page.</small></label>
      </div>
      <div class="profile-field profile-avatar-studio"><span>Choose a cinematic identity</span>
        <div class="avatar-grid">
          <button class="avatar-opt${av ? '' : ' sel'}" data-action="pick-avatar" data-idx="-1" aria-label="Initial" style="background:linear-gradient(135deg,var(--red),var(--purple))">${esc((name || '?')[0].toUpperCase())}</button>
          ${AVATARS.map((a, i) => `<button class="avatar-opt has-avatar-image${avatarPresetId(av) === a.id ? ' sel' : ''}" data-action="pick-avatar" data-idx="${i}" aria-label="${esc(a.name)}" title="${esc(a.name)}"><img src="${a.src}" alt=""></button>`).join('')}
        </div>
      </div>
      <div class="profile-showcase-editor"><div><span>Achievement Showcase</span><h3>Pin up to three earned badges</h3><p>Your selections appear beside your identity in the Profile hero.</p></div><b id="profilePinCount">${selectedPins.length}/3 pinned</b><div class="profile-earned-grid">${earnedBadges.length ? earnedBadges.map(badge => `<button class="tier-${badge.tier}${selectedPins.includes(badge.id) ? ' selected' : ''}" data-action="profile-pin-badge" data-badge="${badge.id}"><i>${badge.icon}</i><span><strong>${esc(badge.name)}</strong><small>${esc(badge.desc)}</small></span><em>✓</em></button>`).join('') : '<p>Earn your first badge to unlock the showcase.</p>'}</div></div>
      <div class="profile-editactions">
        <button class="btn-glass" data-action="profile-cancel">Cancel</button>
        <button class="btn-primary" data-action="profile-save">Save</button>
      </div>
    </div>` : '';

  const codeCard = code ? `<section class="profile-connect-card"><div class="profile-connect-copy"><span>Connect instantly</span><h2>Your friend pass</h2><p>Let friends scan the QR code or share your private connect code.</p><div class="profile-code-row"><strong>${esc(code)}</strong><button data-action="copy-code" data-code="${esc(code)}">Copy code</button></div></div><div class="profile-qr" title="Scan to add me">${friendQrSvg(code)}<span>Scan to connect</span></div></section>` : `<section class="profile-connect-card waiting"><div><span>Connect instantly</span><h2>Preparing your friend pass…</h2><p>Your private QR identity will appear here when social sync completes.</p></div></section>`;
  const tastePass = code ? `<section class="profile-taste-pass"><div><span>Cineprint chemistry</span><h2>Taste Match QR</h2><p>A friend scans once to see your shared genres and instant compatibility score.</p><button data-action="copy-taste-link" data-code="${esc(code)}">Copy Taste Match link</button></div><div class="profile-qr taste">${tasteMatchQrSvg(code)}<span>Scan to compare</span></div></section>` : '';

  const snapshot = `
    <section class="profile-panel profile-cineprint"><div class="profile-panel-head"><div><span>Live collection intelligence</span><h2>Your Cineprint</h2></div><button data-action="show-page" data-page="stats">Open full stats →</button></div>
      <div class="profile-stats">
        ${[[PROFILE_ICONS.watched, c.watchedTotal, 'Watched', 'watched'], [PROFILE_ICONS.clock, c.hours, 'Hours', 'stats'], [PROFILE_ICONS.star, c.ratedTotal, 'Rated', 'stats'], [PROFILE_ICONS.saved, state.watchlist.length, 'Saved', 'watchlist']]
          .map(([icon, value, label, page]) => `<button class="profile-stat" data-action="show-page" data-page="${page}"><div class="ps-ico">${icon}</div><div><div class="ps-num">${value}</div><div class="ps-lbl">${label}</div></div></button>`).join('')}
      </div>
      <div class="profile-insight-grid"><article><span>Your average</span><strong>${insight.avgRating ? insight.avgRating.toFixed(1) : '—'}${insight.avgRating ? '<small>/10</small>' : ''}</strong><p>${insight.ratingCoverage}% of watched titles rated</p></article><article><span>Signature genre</span><strong>${esc(insight.topGenre)}</strong><p>Your most-watched genre</p></article><article><span>Favorite era</span><strong>${esc(insight.topDecade)}</strong><p>Your leading release decade</p></article><article><span>This year</span><strong>${insight.thisYear}</strong><p>${insight.streak ? `${insight.streak}-day current streak` : 'Build your viewing streak'}</p></article></div>
    </section>`;

  const pulse = `<section class="profile-panel profile-pulse"><div class="profile-panel-head"><div><span>Account readiness</span><h2>Collection pulse</h2></div><b>${insight.health || strength}%</b></div><div class="profile-progress-row"><div><span>Collection health</span><strong>${insight.health ? `${insight.health}%` : 'Calculating'}</strong></div><i><em style="width:${insight.health || 0}%"></em></i></div><div class="profile-progress-row"><div><span>Rating coverage</span><strong>${insight.ratingCoverage}%</strong></div><i><em style="width:${insight.ratingCoverage}%"></em></i></div><div class="profile-progress-row"><div><span>Profile setup</span><strong>${strength}%</strong></div><i><em style="width:${strength}%"></em></i></div><button class="profile-repair-link" data-action="show-page" data-page="stats">Review Collection Health →</button></section>`;

  const quick = `<section class="profile-panel profile-quick"><div class="profile-panel-head"><div><span>One-tap navigation</span><h2>Quick launch</h2></div></div><div class="profile-quick-grid">${[[PROFILE_ICONS.calendar, 'Release calendar', 'reminders'], [PROFILE_ICONS.watched, 'Watch history', 'watched'], [PROFILE_ICONS.users, 'Friends & family', 'friends'], [PROFILE_ICONS.chart, 'Cineprint stats', 'stats']].map(([icon, label, page]) => `<button data-action="show-page" data-page="${page}">${icon}<span>${label}</span><b>→</b></button>`).join('')}<button class="profile-intelligence-key" data-action="profile-toggle-intelligence">${PROFILE_ICONS.star}<span>Private picks</span><b>${intelligenceOpen ? '×' : '→'}</b></button></div></section>`;

  const about = state.profile.bio || state.profile.favoriteFilm ? `<section class="profile-panel profile-about"><div><span>Personal note</span><h2>${esc(state.profile.bio || 'A collection shaped by curiosity.')}</h2></div>${state.profile.favoriteFilm ? `<p><small>Always returning to</small><strong>${esc(state.profile.favoriteFilm)}</strong></p>` : ''}</section>` : '';
  const intelligence = intelligenceOpen ? `<section class="profile-intelligence-vault"><div class="profile-intelligence-head"><span>Low-key, private, yours</span><h2>Personalized intelligence</h2><p>Recommendations adapt to your watches, ratings and dismissals. This space stays off the homepage.</p></div><div id="personalRows"></div></section>` : '';

  const rv = (state.recentlyViewed || []).slice(0, 12);
  const recent = rv.length ? `
    <section class="profile-panel profile-recent"><div class="profile-panel-head"><div><span>Pick up where you left off</span><h2>Recently viewed</h2></div><button data-action="profile-clear-recent">Clear</button></div>
    <div class="profile-recent-row">${rv.map(r => {
      const poster = r.poster ? `${IMG}w342${r.poster}` : PH;
      const wd = isWatched(r.id, r.type);
      return `<a class="card" href="/${r.type}/${r.id}" aria-label="${esc(r.title)}" data-action="open-detail" data-id="${r.id}" data-type="${r.type}"><div class="card-img"><img src="${poster}" alt="${esc(r.title)}" loading="lazy" data-ph="${PH}">${wd ? WATCHED_BADGE_HTML : ''}${myRatingHTML(r.id, r.type)}</div><div class="card-info"><div class="card-title">${esc(r.title)}</div><div class="card-sub">${r.type === 'tv' ? 'TV show' : 'Movie'}</div></div></a>`;
    }).join('')}</div></section>` : `<section class="profile-panel profile-recent-empty"><span>Recently viewed</span><h2>Your next discovery will appear here.</h2><button class="btn-glass" data-action="show-page" data-page="discover">Explore titles</button></section>`;

  ct.innerHTML = `<div class="profile-shell">${header}${editForm}<div class="profile-dashboard"><main>${about}${snapshot}${recent}</main><aside>${codeCard}${tastePass}${pulse}${quick}</aside></div>${intelligence}</div>`;
  if (intelligenceOpen) queueMicrotask(() => renderRecommendations());
}

export function initProfile() {
  registerActions({
    // The dropdown name/email block is the profile button now (the separate
    // "Profile" item is gone). Signed out, there's no profile to show — open auth.
    'open-profile-page': () => {
      const dd = $('profileDD'); if (dd) dd.classList.remove('active');
      if (state.user) document.dispatchEvent(new CustomEvent('cv:go', { detail: '/profile' }));
      else document.dispatchEvent(new Event('cv:open-auth'));
    },
    'profile-edit': () => { editing = true; draftAvatar = undefined; draftPinned = [...(state.profile.pinnedBadges || [])]; renderProfile(); const n = $('profileName'); if (n) n.focus(); },
    'profile-cancel': () => { editing = false; draftAvatar = undefined; draftPinned = undefined; renderProfile(); },
    'pick-avatar': (el) => {
      const idx = +el.dataset.idx;
      draftAvatar = idx < 0 ? null : { id: AVATARS[idx].id };
      el.closest('.avatar-grid')?.querySelectorAll('.avatar-opt').forEach(option => option.classList.toggle('sel', option === el));
    },
    'profile-pin-badge': el => {
      const id = el.dataset.badge; draftPinned = draftPinned || [];
      if (draftPinned.includes(id)) draftPinned = draftPinned.filter(value => value !== id);
      else if (draftPinned.length >= 3) { toast('You can pin up to three achievements', 'info'); return; }
      else draftPinned = [...draftPinned, id];
      el.classList.toggle('selected', draftPinned.includes(id));
      const count = $('profilePinCount'); if (count) count.textContent = `${draftPinned.length}/3 pinned`;
    },
    'profile-save': async (el) => {
      const name = ($('profileName') || {}).value || '';
      const avatar = draftAvatar !== undefined ? draftAvatar : state.profile.avatar;
      const ctx = buildCtx();
      const safePins = (draftPinned !== undefined ? draftPinned : state.profile.pinnedBadges || [])
        .filter(id => BADGES.some(badge => badge.id === id && badge.value(ctx) >= badge.goal)).slice(0, 3);
      el.disabled = true;
      const r = await saveProfile({
        name, avatar,
        headline: ($('profileHeadline') || {}).value || '', bio: ($('profileBio') || {}).value || '',
        location: ($('profileLocation') || {}).value || '', favoriteFilm: ($('profileFavorite') || {}).value || '',
        pinnedBadges: safePins,
      });
      toast(r.msg, r.ok ? 'success' : 'error');
      if (r.ok) { editing = false; draftAvatar = undefined; draftPinned = undefined; renderProfile(); }
      else el.disabled = false;
    },
    'copy-taste-link': el => {
      const link = tasteMatchUrl(el.dataset.code || social.code);
      if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => toast('Taste Match link copied', 'success')).catch(() => toast(link, 'info'));
      else toast(link, 'info');
    },
    'profile-toggle-intelligence': () => { intelligenceOpen = !intelligenceOpen; renderProfile(); },
    'profile-clear-recent': () => {
      state.recentlyViewed = [];
      try { localStorage.removeItem(`cv_recent_${state.user?.uid || 'guest'}`); } catch (_) {}
      toast('Recently viewed cleared', 'success'); renderProfile();
    },
  });
  // Friend code arrives asynchronously (cv:social); refresh if we're on /profile.
  document.addEventListener('cv:social', () => { if (location.pathname === '/profile') renderProfile(); });
  document.addEventListener('cv:auth', () => { if (!state.user) { editing = false; draftAvatar = undefined; draftPinned = undefined; intelligenceOpen = false; } });
}
