// ===== FRIENDS PAGE (/friends) =====
import { state } from './state.js';
import { esc, toast, $ } from './ui.js';
import { registerActions } from './events.js';
import { social, displayCode, sendRequest, acceptRequest, declineRequest, removeFriend, resolveCode, resolveEmail, searchByName, getFriendTaste } from './social.js';
import { avatarInner } from './avatar.js';
import { friendQrSvg } from './qrcode.js';
import { openScanner, scannerSupported, initScan } from './scan.js';
import { buildTasteProfile } from './recommend.js';
import { genreMap } from './config.js';

let pendingRemove = null;   // pairId awaiting a second confirming click
let pendingAdd = null;      // a ?add= / scanned code waiting for sign-in to resolve
let pendingTaste = null, tasteResult = null, tasteLoading = false;

export function compareTasteProfiles(mine, theirs) {
  const a = mine?.genreWeights || {}, b = theirs?.genreWeights || {}, keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0, magA = 0, magB = 0;
  keys.forEach(key => { const av = Math.max(0, +a[key] || 0), bv = Math.max(0, +b[key] || 0); dot += av * bv; magA += av * av; magB += bv * bv; });
  const genreScore = magA && magB ? dot / Math.sqrt(magA * magB) : 0;
  const biasScore = mine && theirs ? 1 - Math.min(1, Math.abs((mine.movieBias ? 1 : 0) - (theirs.movieBias ? 1 : 0))) : 0;
  const score = Math.round(Math.min(99, Math.max(0, genreScore * 90 + biasScore * 10)));
  const topA = new Set((mine?.topGenres || []).map(Number)), topB = new Set((theirs?.topGenres || []).map(Number));
  const common = [...topA].filter(id => topB.has(id)).slice(0, 4).map(id => genreMap[id]).filter(Boolean);
  return { score, common, sharedLean: mine?.movieBias === theirs?.movieBias ? (mine?.movieBias ? 'Both lean toward movies' : 'Both lean toward TV') : 'A balanced movie-and-TV pairing' };
}

async function processTasteMatch() {
  if (!pendingTaste || !state.user || tasteLoading) return;
  tasteLoading = true;
  try {
    const profile = await resolveCode(pendingTaste);
    if (!profile || profile.uid === state.user.uid) throw new Error(profile ? 'This is your own Taste Match code' : 'Taste Match profile was not found');
    const shared = await getFriendTaste(profile.uid);
    if (!shared) throw new Error('Their taste profile is still being prepared');
    const mine = buildTasteProfile(state);
    if (!mine?.hasSignal) throw new Error('Watch or rate a few titles before comparing tastes');
    tasteResult = { profile, ...compareTasteProfiles(mine, shared) };
    pendingTaste = null;
    if (location.pathname === '/friends') renderFriends();
  } catch (error) { toast(error.message || 'Could not compare tastes', 'error'); pendingTaste = null; }
  finally { tasteLoading = false; }
}

function tasteMatchHTML() {
  if (tasteLoading) return `<section class="taste-match-result loading"><span>Comparing Cineprints…</span></section>`;
  if (!tasteResult) return '';
  const { profile, score, common, sharedLean } = tasteResult, already = social.friends.some(friend => friend.uid === profile.uid);
  return `<section class="taste-match-result"><button class="taste-match-close" data-action="dismiss-taste-match" aria-label="Close">×</button><div class="taste-match-score" style="--match:${score * 3.6}deg"><strong>${score}%</strong><span>Taste match</span></div><div class="taste-match-copy"><span>Instant Cineprint comparison</span><h2>You + ${esc(profile.name || 'CineVerse friend')}</h2><p>${esc(sharedLean)}</p><div>${common.length ? common.map(name => `<b>${esc(name)}</b>`).join('') : '<b>Fresh perspectives</b>'}</div>${already ? '<small>Already in your circle</small>' : `<button class="btn-primary" data-action="friend-request" data-uid="${esc(profile.uid)}" data-name="${esc(profile.name || 'Friend')}">Connect</button>`}</div></section>`;
}

// Pull a bare friend code out of whatever the camera read (a full add-URL or a raw
// code, with or without the CINE- prefix).
function codeFromScan(text) {
  let v = (text || '').trim();
  try { const u = new URL(v); if (u.searchParams.get('add')) v = u.searchParams.get('add'); } catch (_) {}
  return v;
}
// A QR for the code's add-URL. Never let a QR failure take down the page.
function qrCodeSvg(code) {
  try { return friendQrSvg(code); }
  catch (e) { console.error('qr', e); return ''; }
}

// Resolve a scanned/linked code and send a request, with clear feedback.
async function addByCode(raw) {
  const code = codeFromScan(raw);
  if (!code) { toast('No code found', 'error'); return; }
  const profile = await resolveCode(code);
  if (!profile) { toast('No CineVerse user found for that code', 'error'); return; }
  const r = await sendRequest(profile.uid, profile.name);
  toast(r.ok ? `Request sent to ${profile.name}!` : r.msg, r.ok ? 'success' : 'error');
  if (location.pathname === '/friends') renderFriends();
}

// A ?add=<code> link (from a scanned QR opened in the phone's browser, or a shared
// link) adds that friend once we're signed in and the friend graph is ready.
function maybeProcessPending() {
  if (pendingAdd && state.user && social.ready) { const c = pendingAdd; pendingAdd = null; addByCode(c); }
  if (pendingTaste && state.user && social.ready) processTasteMatch();
}
export function initFriendDeepLink() {
  document.addEventListener('cv:social', maybeProcessPending);
  const params = new URLSearchParams(location.search);
  const add = params.get('add');
  const taste = params.get('taste');
  if (!add && !taste) return;
  // Strip ?add= from the URL so a refresh or re-render can't re-add.
  params.delete('add');
  params.delete('taste');
  const qs = params.toString();
  history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  pendingAdd = add || null; pendingTaste = taste || null;
  if (!state.user) { toast(taste ? 'Sign in to compare your Cineprints' : 'Sign in to add this friend', 'info'); document.dispatchEvent(new Event('cv:open-auth')); }
  maybeProcessPending();
}

export function renderFriends() {
  const ct = $('friendsContent');
  if (!ct) return;
  if (!state.user) {
    ct.innerHTML = `<div class="wl-empty" style="padding:40px 20px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:56px;height:56px;color:var(--text3);margin-bottom:14px;opacity:.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg><h3>Sign in to add friends</h3><p>Connect with friends & family to plan movie nights together.</p><br><button class="btn-primary" data-action="open-auth">Sign In</button></div>`;
    return;
  }

  const reqIn = social.reqIn.map(r => `<div class="friend-row">${avatarInner(null, r.fromName)}<div class="friend-meta"><div class="friend-name">${esc(r.fromName || 'Someone')}</div><div class="friend-sub">wants to connect</div></div><div class="friend-actions"><button class="btn-primary" style="height:36px;padding:0 16px;font-size:.8rem" data-action="accept-req" data-id="${r.id}">Accept</button><button class="dbtn-icon" data-action="decline-req" data-id="${r.id}" data-tip="Decline" aria-label="Decline friend request" style="width:36px;height:36px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div></div>`).join('');

  const friends = social.friends.length
    ? social.friends.map(f => {
        const armed = pendingRemove === f.pairId;
        const remBtn = armed
          ? `<button class="btn-glass danger" style="padding:8px 14px;font-size:.78rem" data-action="remove-friend" data-pair="${esc(f.pairId)}">Remove?</button>`
          : `<button class="dbtn-icon" data-action="remove-friend" data-pair="${esc(f.pairId)}" data-tip="Remove friend" aria-label="Remove friend" style="width:36px;height:36px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H9a4 4 0 00-4 4v2"/><circle cx="11" cy="7" r="4"/><line x1="17" y1="8" x2="23" y2="8"/></svg></button>`;
        return `<div class="friend-row">${avatarInner(null, f.name)}<div class="friend-meta"><div class="friend-name">${esc(f.name)}</div><div class="friend-sub">Friend</div></div><div class="friend-actions">${remBtn}</div></div>`;
      }).join('')
    : `<p style="color:var(--text3);font-size:.88rem">No friends yet — share your code or add one above.</p>`;

  const out = social.reqOut.length ? `<div class="d-sec-title" style="margin-top:24px">Pending</div>${social.reqOut.map(r => `<div class="friend-row">${avatarInner(null, r.toName)}<div class="friend-meta"><div class="friend-name">${esc(r.toName || 'Friend')}</div><div class="friend-sub">Request sent</div></div></div>`).join('')}` : '';

  ct.innerHTML = `
    ${tasteMatchHTML()}
    <div class="friend-code-card">
      <div class="friend-code-main">
        <div class="stat-label">Your Friend Code</div>
        <div class="friend-code-row"><span class="friend-code">${esc(displayCode(social.code) || '…')}</span><button class="btn-glass" style="padding:8px 16px;font-size:.82rem" data-action="copy-code" data-code="${esc(displayCode(social.code))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy</button></div>
        <p style="color:var(--text3);font-size:.8rem;margin-top:8px">Share your code — or let a friend scan the QR — so they can add you.</p>
      </div>
      ${social.code ? `<div class="friend-qr" title="Scan to add me">${qrCodeSvg(social.code)}<span class="friend-qr-cap">Scan to add me</span></div>` : ''}
    </div>

    <div class="d-sec-title" style="margin-top:28px">Add a Friend</div>
    <div class="friend-add">
      <input id="friendAddInput" type="text" placeholder="Friend code, name, or email…" autocomplete="off">
      <button class="btn-primary" style="height:44px" data-action="friend-add">Add</button>
      ${scannerSupported() ? `<button class="btn-glass friend-scan-btn" style="height:44px" data-action="open-scanner" data-tip="Scan a friend's QR"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>Scan</button>` : ''}
    </div>
    <div id="friendSearchResults"></div>

    ${reqIn ? `<div class="d-sec-title" style="margin-top:28px">Requests</div>${reqIn}` : ''}

    <div class="d-sec-title" style="margin-top:28px">Your Circle ${social.friends.length ? `(${social.friends.length})` : ''}</div>
    ${friends}
    ${social.friends.length ? `<div style="margin-top:20px"><button class="btn-primary" data-action="show-page" data-page="party"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>Start a Watch Party</button></div>` : ''}
    ${out}
  `;
}

async function doAdd() {
  const input = $('friendAddInput'); if (!input) return;
  const val = input.value.trim(); if (!val) return;
  const results = $('friendSearchResults');
  results.innerHTML = '<p style="color:var(--text3);font-size:.85rem;padding:8px 0">Searching…</p>';

  // 1) Looks like a code → resolve + request. 2) Has @ → email. 3) Else name search.
  let profile = null;
  if (val.includes('@')) profile = await resolveEmail(val);
  else if (/^(cine-)?[a-z0-9]{4,}$/i.test(val.replace(/[^a-z0-9]/gi, '')) && !val.includes(' ')) profile = await resolveCode(val);

  if (profile) {
    const r = await sendRequest(profile.uid, profile.name);
    toast(r.msg, r.ok ? 'success' : 'error');
    results.innerHTML = '';
    input.value = '';
    renderFriends();
    return;
  }

  // Name search
  const matches = await searchByName(val);
  if (!matches.length) { results.innerHTML = '<p style="color:var(--text3);font-size:.85rem;padding:8px 0">No one found. Try their exact friend code.</p>'; return; }
  results.innerHTML = matches.map(m => `<div class="friend-row">${avatarInner(m.avatar || null, m.name)}<div class="friend-meta"><div class="friend-name">${esc(m.name)}</div><div class="friend-sub">CINE-${esc(m.code || '')}</div></div><div class="friend-actions"><button class="btn-glass" style="padding:8px 16px;font-size:.8rem" data-action="friend-request" data-uid="${esc(m.uid)}" data-name="${esc(m.name)}">Add</button></div></div>`).join('');
}

export function initFriends() {
  initScan();
  initFriendDeepLink();
  document.addEventListener('cv:social', () => { if (location.pathname === '/friends') renderFriends(); });
  document.addEventListener('keydown', e => { if (e.target && e.target.id === 'friendAddInput' && e.key === 'Enter') { e.preventDefault(); doAdd(); } });

  registerActions({
    'copy-code': (el) => {
      const code = el.dataset.code || '';
      if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => toast('Code copied!', 'success')).catch(() => toast(code, 'info'));
      else toast(code, 'info');
    },
    'friend-add': () => doAdd(),
    'open-scanner': () => openScanner(addByCode),
    'friend-request': async (el) => { const r = await sendRequest(el.dataset.uid, el.dataset.name); toast(r.msg, r.ok ? 'success' : 'error'); if (r.ok) { const results = $('friendSearchResults'); if (results) results.innerHTML = ''; renderFriends(); } },
    'dismiss-taste-match': () => { tasteResult = null; renderFriends(); },
    'accept-req': async (el) => { const req = social.reqIn.find(r => r.id === el.dataset.id); if (req) { await acceptRequest(req); toast('Friend added!', 'success'); renderFriends(); } },
    'decline-req': async (el) => { const req = social.reqIn.find(r => r.id === el.dataset.id); if (req) { await declineRequest(req); renderFriends(); } },
    // Two-tap: the first click arms (button becomes "Remove?"), the second confirms.
    'remove-friend': async (el) => {
      const pair = el.dataset.pair;
      if (pendingRemove !== pair) { pendingRemove = pair; renderFriends(); return; }
      pendingRemove = null;
      const r = await removeFriend(pair);
      if (r.ok) toast('Friend removed', 'info');
      renderFriends();   // the live listener also re-renders both sides
    },
  });
}
