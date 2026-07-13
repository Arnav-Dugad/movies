// ===== FRIENDS PAGE (/friends) =====
import { state } from './state.js';
import { esc, toast, $ } from './ui.js';
import { registerActions } from './events.js';
import { social, displayCode, sendRequest, acceptRequest, declineRequest, resolveCode, resolveEmail, searchByName, loadFriends } from './social.js';

export function renderFriends() {
  const ct = $('friendsContent');
  if (!ct) return;
  if (!state.user) {
    ct.innerHTML = `<div class="wl-empty" style="padding:40px 20px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:56px;height:56px;color:var(--text3);margin-bottom:14px;opacity:.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg><h3>Sign in to add friends</h3><p>Connect with friends & family to plan movie nights together.</p><br><button class="btn-primary" data-action="open-auth">Sign In</button></div>`;
    return;
  }

  const reqIn = social.reqIn.map(r => `<div class="friend-row"><div class="friend-av">${esc((r.fromName || '?')[0].toUpperCase())}</div><div class="friend-meta"><div class="friend-name">${esc(r.fromName || 'Someone')}</div><div class="friend-sub">wants to connect</div></div><div class="friend-actions"><button class="btn-primary" style="height:36px;padding:0 16px;font-size:.8rem" data-action="accept-req" data-id="${r.id}">Accept</button><button class="dbtn-icon" data-action="decline-req" data-id="${r.id}" data-tip="Decline" style="width:36px;height:36px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div></div>`).join('');

  const friends = social.friends.length
    ? social.friends.map(f => `<div class="friend-row"><div class="friend-av">${esc((f.name || '?')[0].toUpperCase())}</div><div class="friend-meta"><div class="friend-name">${esc(f.name)}</div><div class="friend-sub">Friend</div></div></div>`).join('')
    : `<p style="color:var(--text3);font-size:.88rem">No friends yet — share your code or add one above.</p>`;

  const out = social.reqOut.length ? `<div class="d-sec-title" style="margin-top:24px">Pending</div>${social.reqOut.map(r => `<div class="friend-row"><div class="friend-av">${esc((r.toName || '?')[0].toUpperCase())}</div><div class="friend-meta"><div class="friend-name">${esc(r.toName || 'Friend')}</div><div class="friend-sub">Request sent</div></div></div>`).join('')}` : '';

  ct.innerHTML = `
    <div class="friend-code-card">
      <div class="stat-label">Your Friend Code</div>
      <div class="friend-code-row"><span class="friend-code">${esc(displayCode(social.code) || '…')}</span><button class="btn-glass" style="padding:8px 16px;font-size:.82rem" data-action="copy-code" data-code="${esc(displayCode(social.code))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy</button></div>
      <p style="color:var(--text3);font-size:.8rem;margin-top:8px">Share this code with friends & family so they can add you.</p>
    </div>

    <div class="d-sec-title" style="margin-top:28px">Add a Friend</div>
    <div class="friend-add">
      <input id="friendAddInput" type="text" placeholder="Friend code, name, or email…" autocomplete="off">
      <button class="btn-primary" style="height:44px" data-action="friend-add">Add</button>
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
  results.innerHTML = matches.map(m => `<div class="friend-row"><div class="friend-av">${esc((m.name || '?')[0].toUpperCase())}</div><div class="friend-meta"><div class="friend-name">${esc(m.name)}</div><div class="friend-sub">CINE-${esc(m.code || '')}</div></div><div class="friend-actions"><button class="btn-glass" style="padding:8px 16px;font-size:.8rem" data-action="friend-request" data-uid="${esc(m.uid)}" data-name="${esc(m.name)}">Add</button></div></div>`).join('');
}

export function initFriends() {
  document.addEventListener('cv:social', () => { if (location.pathname === '/friends') renderFriends(); });
  document.addEventListener('keydown', e => { if (e.target && e.target.id === 'friendAddInput' && e.key === 'Enter') { e.preventDefault(); doAdd(); } });

  registerActions({
    'copy-code': (el) => {
      const code = el.dataset.code || '';
      if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => toast('Code copied!', 'success')).catch(() => toast(code, 'info'));
      else toast(code, 'info');
    },
    'friend-add': () => doAdd(),
    'friend-request': async (el) => { const r = await sendRequest(el.dataset.uid, el.dataset.name); toast(r.msg, r.ok ? 'success' : 'error'); if (r.ok) { $('friendSearchResults').innerHTML = ''; renderFriends(); } },
    'accept-req': async (el) => { const req = social.reqIn.find(r => r.id === el.dataset.id); if (req) { await acceptRequest(req); toast('Friend added!', 'success'); renderFriends(); } },
    'decline-req': async (el) => { const req = social.reqIn.find(r => r.id === el.dataset.id); if (req) { await declineRequest(req); renderFriends(); } },
  });
}
