// ===== SHARED LIST VIEW (/shared-list/:uid/:listId) =====
// Opening a shared link shows a read-only grid of the owner's snapshot
// (users/{uid}/shared/list_{listId} — the same friend-readable subcollection as
// the taste doc), plus "Save a copy" to clone it into the viewer's own lists.
import { db } from './firebase.js';
import { state } from './state.js';
import { IMG, PH } from './config.js';
import { esc, toast, $ } from './ui.js';
import { registerActions } from './events.js';
import { observeReveals } from './effects.js';
import { avatarInner } from './avatar.js';
import { createList, addToList } from './lists.js';

let reqGen = 0, curDoc = null;

function cardHTML(it) {
  const poster = it.poster ? `${IMG}w342${it.poster}` : PH;
  return `<a class="card" href="/${it.type}/${it.id}" aria-label="${esc(it.title)}" data-action="open-detail" data-id="${it.id}" data-type="${it.type}"><div class="card-img"><img src="${poster}" alt="${esc(it.title)}" loading="lazy" data-ph="${PH}"></div><div class="card-info"><div class="card-title">${esc(it.title) || ''}</div><div class="card-sub"><span>${esc(it.year || '')}</span><span class="dot"></span><span>${it.type === 'tv' ? 'TV' : 'Movie'}</span></div></div></a>`;
}

export async function openSharedList(uid, listId) {
  const gen = ++reqGen;
  const ct = $('sharedListContent');
  if (!ct) return;
  ct.innerHTML = '<div style="text-align:center;padding:100px"><div class="loader-text">Loading...</div></div>';
  document.title = 'Shared list — CineVerse';
  try {
    const snap = await db.collection('users').doc(uid).collection('shared').doc(`list_${listId}`).get();
    if (gen !== reqGen) return;
    if (!snap.exists) {
      ct.innerHTML = '<div style="text-align:center;padding:120px 20px"><p style="font-weight:600">This list isn’t shared</p><p style="color:var(--text3);margin:8px 0 20px">The link may be old, or the owner stopped sharing it.</p><button class="btn-primary" data-action="back">Back</button></div>';
      return;
    }
    const d = snap.data(); curDoc = { uid, listId, ...d };
    document.title = `${d.name} — CineVerse`;
    const items = d.items || [];
    const mine = state.user && state.user.uid === uid;
    const grid = items.length
      ? `<div class="browse-grid">${items.map(cardHTML).join('')}</div>`
      : '<p style="color:var(--text3);padding:20px 0">This list is empty.</p>';
    ct.innerHTML = `
      <div class="shared-head">
        <div class="shared-head-main">
          <div class="shared-owner">${avatarInner(null, d.ownerName || 'A friend')}<span>${esc(d.ownerName || 'A friend')}’s list</span></div>
          <h1 class="studio-name">${d.icon || '📁'} ${esc(d.name || 'List')}</h1>
          <div class="studio-meta">${items.length} title${items.length !== 1 ? 's' : ''}</div>
        </div>
        ${mine ? '' : `<button class="btn-primary shared-clone" data-action="clone-shared-list"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Save a copy</button>`}
      </div>
      ${grid}`;
    observeReveals(ct);
  } catch (e) {
    console.error('openSharedList', e);
    ct.innerHTML = '<div style="text-align:center;padding:120px 20px"><p style="font-weight:600">Couldn’t open this list</p><button class="btn-primary" data-action="back" style="margin-top:16px">Back</button></div>';
  }
}

async function cloneList() {
  if (!state.user) return document.dispatchEvent(new Event('cv:open-auth'));
  if (!curDoc || !curDoc.items) return;
  const name = `${curDoc.name} (from ${curDoc.ownerName || 'a friend'})`;
  const list = await createList(name, { icon: curDoc.icon || '📁' });
  if (!list) { toast('Could not create the list', 'error'); return; }
  let n = 0;
  for (const it of curDoc.items) {
    try { await addToList({ id: it.id, title: it.title, poster: it.poster, year: it.year, rating: it.rating, genres: [] }, it.type, list.id, { silent: true }); n++; }
    catch (e) { console.error('clone item', e); }
  }
  toast(`Saved ${n} title${n !== 1 ? 's' : ''} to “${name}”`, 'success');
  document.dispatchEvent(new CustomEvent('cv:go', { detail: '/watchlist' }));
}

export function initSharedList() {
  registerActions({ 'clone-shared-list': () => cloneList() });
}
