// ===== PROFILE PAGE (/profile) =====
import { state, isWatched } from './state.js';
import { $, esc, toast } from './ui.js';
import { registerActions } from './events.js';
import { AVATARS } from './config.js';
import { avatarBg, avatarGlyph } from './avatar.js';
import { buildCtx } from './badges.js';
import { myRatingHTML } from './cards.js';
import { social, displayCode } from './social.js';
import { saveProfile } from './auth.js';

let editing = false;
let draftAvatar = undefined;   // undefined = untouched; null = cleared to initial

function memberSince(created) {
  if (!created) return '';
  const ms = created.seconds ? created.seconds * 1000 : (created.__ts || (typeof created.toMillis === 'function' ? created.toMillis() : 0));
  if (!ms) return '';
  return new Date(ms).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
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

  const header = `
    <div class="profile-hero">
      <div class="profile-av-lg" style="background:${avatarBg(av)}">${esc(avatarGlyph(av, name))}</div>
      <div class="profile-id">
        <h1 class="profile-nm">${esc(name)}</h1>
        <div class="profile-email">${esc(u.email || '')}</div>
        ${since ? `<div class="profile-since">Member since ${esc(since)}</div>` : ''}
      </div>
      <button class="btn-glass profile-edit-btn" data-action="profile-edit">Edit profile</button>
    </div>`;

  const editForm = editing ? `
    <div class="profile-editcard">
      <div class="d-sec-title">Edit profile</div>
      <label class="profile-field"><span>Display name</span><input id="profileName" type="text" value="${esc(name)}" maxlength="40" autocomplete="off"></label>
      <div class="profile-field"><span>Avatar</span>
        <div class="avatar-grid">
          <button class="avatar-opt${av ? '' : ' sel'}" data-action="pick-avatar" data-idx="-1" aria-label="Initial" style="background:linear-gradient(135deg,var(--red),var(--purple))">${esc((name || '?')[0].toUpperCase())}</button>
          ${AVATARS.map((a, i) => `<button class="avatar-opt${av && av.emoji === a.emoji && av.grad === a.grad ? ' sel' : ''}" data-action="pick-avatar" data-idx="${i}" aria-label="${a.emoji}" style="background:${avatarBg(a)}">${a.emoji}</button>`).join('')}
        </div>
      </div>
      <div class="profile-editactions">
        <button class="btn-glass" data-action="profile-cancel">Cancel</button>
        <button class="btn-primary" data-action="profile-save">Save</button>
      </div>
    </div>` : '';

  const codeCard = code ? `
    <div class="friend-code-card" style="margin-top:20px">
      <div class="stat-label">Your Friend Code</div>
      <div class="friend-code-row"><span class="friend-code">${esc(code)}</span><button class="btn-glass" style="padding:8px 16px;font-size:.82rem" data-action="copy-code" data-code="${esc(code)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy</button></div>
      <p style="color:var(--text3);font-size:.8rem;margin-top:8px">Share this so friends & family can add you.</p>
    </div>` : '';

  const snapshot = `
    <div class="d-sec-title" style="margin-top:28px">Your CineVerse</div>
    <div class="profile-stats">
      ${[['🎬', c.watchedTotal, 'Watched'], ['⏱️', c.hours, 'Hours'], ['⭐', c.ratedTotal, 'Rated'], ['📋', state.watchlist.length, 'Saved']]
        .map(([ic, n, l]) => `<button class="profile-stat" data-action="show-page" data-page="stats"><div class="ps-ico">${ic}</div><div class="ps-num">${n}</div><div class="ps-lbl">${l}</div></button>`).join('')}
    </div>
    <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn-glass" data-action="show-page" data-page="stats">View full stats →</button>
      <button class="btn-glass" data-action="show-page" data-page="watchlist">My lists →</button>
      <button class="btn-glass" data-action="show-page" data-page="settings">Settings →</button>
    </div>`;

  const rv = (state.recentlyViewed || []).slice(0, 12);
  const recent = rv.length ? `
    <div class="d-sec-title" style="margin-top:28px">Recently viewed</div>
    <div class="row">${rv.map(r => {
      const poster = r.poster ? `https://image.tmdb.org/t/p/w342${r.poster}` : '';
      const wd = isWatched(r.id, r.type);
      return `<div class="card" role="button" tabindex="0" aria-label="${esc(r.title)}" data-action="open-detail" data-id="${r.id}" data-type="${r.type}"><div class="card-img">${poster ? `<img src="${poster}" alt="${esc(r.title)}" loading="lazy">` : ''}${wd ? '<div class="watched-badge show"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></div>' : ''}${myRatingHTML(r.id, r.type)}</div><div class="card-info"><div class="card-title">${esc(r.title)}</div></div></div>`;
    }).join('')}</div>` : '';

  ct.innerHTML = header + editForm + codeCard + snapshot + recent;
}

export function initProfile() {
  registerActions({
    'profile-edit': () => { editing = true; draftAvatar = undefined; renderProfile(); const n = $('profileName'); if (n) n.focus(); },
    'profile-cancel': () => { editing = false; draftAvatar = undefined; renderProfile(); },
    'pick-avatar': (el) => {
      const idx = +el.dataset.idx;
      draftAvatar = idx < 0 ? null : AVATARS[idx];
      // Re-mark selection without losing the typed name.
      const nameVal = ($('profileName') || {}).value;
      renderProfile();
      if (nameVal != null) { const n = $('profileName'); if (n) n.value = nameVal; }
    },
    'profile-save': async (el) => {
      const name = ($('profileName') || {}).value || '';
      const avatar = draftAvatar !== undefined ? draftAvatar : state.profile.avatar;
      el.disabled = true;
      const r = await saveProfile({ name, avatar });
      toast(r.msg, r.ok ? 'success' : 'error');
      if (r.ok) { editing = false; draftAvatar = undefined; renderProfile(); }
      else el.disabled = false;
    },
  });
  // Friend code arrives asynchronously (cv:social); refresh if we're on /profile.
  document.addEventListener('cv:social', () => { if (location.pathname === '/profile') renderProfile(); });
  document.addEventListener('cv:auth', () => { if (!state.user) { editing = false; draftAvatar = undefined; } });
}
