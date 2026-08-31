// ===== COLLABORATIVE LIST PAGE (/collab/:id) =====
// The list itself, live. Everything on this page reflects the shared document
// rather than a copy of it, so two people looking at the same link see the same
// thing without either of them refreshing.
import { state } from './state.js';
import { esc, toast, $ } from './ui.js';
import { IMG, PH } from './config.js';
import { registerActions } from './events.js';
import { observeReveals } from './effects.js';
import { avatarInner } from './avatar.js';
import {
  fetchCollabList, watchCollabItems, joinCollabList, leaveCollabList, deleteCollabList,
  renameCollabList, removeFromCollabList, collabListById, isCollabMember, membersLabel, collabLink,
} from './collab-lists.js';

let reqGen = 0;
let current = null;          // the list document currently on screen
let stopItems = null;
let latestItems = null;      // null while loading, [] when genuinely empty
let openId = null;           // the list this page is showing, for the auth re-render

const shell = html => { const host = $('collabContent'); if (host) host.innerHTML = html; };

const notice = (title, body, action = '') => `<div class="collab-notice">
  <h1>${esc(title)}</h1><p>${esc(body)}</p>${action}</div>`;

function itemHTML(item, canEdit) {
  const poster = item.poster ? `${IMG}w342${item.poster}` : PH;
  const who = item.addedByName ? `Added by ${item.addedByName}` : '';
  return `<article class="collab-item">
    <a class="card" href="/${item.type}/${item.tmdbId}" data-action="open-detail" data-id="${item.tmdbId}" data-type="${item.type}" aria-label="${esc(item.title)}">
      <div class="card-img"><img src="${poster}" alt="" loading="lazy" data-ph="${PH}"></div>
      <div class="card-info">
        <div class="card-title">${esc(item.title || 'Untitled')}</div>
        <div class="card-sub"><span>${esc(item.year || '')}</span><span class="dot"></span><span>${item.type === 'tv' ? 'TV' : 'Movie'}</span></div>
      </div>
    </a>
    ${who ? `<p class="collab-credit">${esc(who)}</p>` : ''}
    ${canEdit ? `<button class="collab-remove" data-action="collab-remove" data-key="${esc(item.key)}" aria-label="Remove ${esc(item.title)} from this list">Remove</button>` : ''}
  </article>`;
}

function paint() {
  if (!current) return;
  const list = collabListById(current.id) || current;   // prefer the live copy
  current = list;
  const member = isCollabMember(list);
  const mine = list.createdBy === state.user?.uid;

  const body = !member
    ? `<div class="collab-gate">
        <p>You have been invited to a shared list. Join it and you can both add titles — one list, not two copies.</p>
        <button class="btn-primary" data-action="collab-join" data-id="${esc(list.id)}">Join this list</button>
      </div>`
    : latestItems === null
      ? '<p class="collab-loading">Loading titles…</p>'
      : latestItems.length
        ? `<div class="collab-grid">${latestItems.map(item => itemHTML(item, true)).join('')}</div>`
        : `<div class="collab-empty">
            <h2>Nothing on it yet</h2>
            <p>Add a title from any poster's <b>+</b> menu, or from the buttons on a film or show page. Whatever either of you adds appears here for both.</p>
          </div>`;

  shell(`<div class="collab-head">
      <div class="collab-head-main">
        <span class="collab-eyebrow">Shared list</span>
        <h1 class="studio-name">${esc(list.icon)} ${esc(list.name)}</h1>
        <div class="collab-people">
          ${list.members.map(uid => `<span class="collab-person" title="${esc(list.memberNames?.[uid] || 'Someone')}">${avatarInner(null, list.memberNames?.[uid] || 'S')}</span>`).join('')}
          <span class="collab-people-label">${esc(membersLabel(list))}${member && latestItems ? ` · ${latestItems.length} title${latestItems.length === 1 ? '' : 's'}` : ''}</span>
        </div>
      </div>
      ${member ? `<div class="collab-actions">
        <button class="btn-primary" data-action="collab-invite" data-id="${esc(list.id)}">Copy invite link</button>
        <button class="btn-glass" data-action="collab-rename" data-id="${esc(list.id)}">Rename</button>
        ${mine
          ? `<button class="btn-glass danger" data-action="collab-delete" data-id="${esc(list.id)}">Delete list</button>`
          : `<button class="btn-glass danger" data-action="collab-leave" data-id="${esc(list.id)}">Leave</button>`}
      </div>` : ''}
    </div>
    ${body}`);
  observeReveals($('collabPage'));
}

export async function openCollabPage(id) {
  const gen = ++reqGen;
  stopItems?.(); stopItems = null;
  latestItems = null; current = null;
  if (!$('collabContent')) return;
  document.title = 'Shared list — CineVerse';
  shell('<p class="collab-loading">Loading list…</p>');

  openId = id;
  if (!state.user) {
    // Opening this URL directly beats Firebase to it: the route renders on the
    // first frame, while the session is still resolving. Telling someone to
    // sign in when they already are would be wrong, so an unresolved session
    // waits and the cv:auth listener below re-opens the page.
    if (!state.authReady) { shell('<p class="collab-loading">Loading list…</p>'); return; }
    // A list is only readable by a signed-in account, so there is nothing to
    // show yet — but the link is still good, and it is worth saying so.
    shell(notice('Sign in to open this list',
      'Shared lists are only visible to the people on them. Sign in and this link will take you straight there.',
      '<button class="btn-primary" data-action="open-auth">Sign in</button>'));
    return;
  }
  try {
    const list = await fetchCollabList(id);
    if (gen !== reqGen) return;
    if (!list) {
      shell(notice('This list is gone',
        'The link may be old, or whoever made the list deleted it.',
        '<button class="btn-primary" data-action="back">Back</button>'));
      return;
    }
    current = list;
    document.title = `${list.name} — CineVerse`;
    paint();
    if (isCollabMember(list)) subscribe(id, gen);
  } catch (error) {
    if (gen !== reqGen) return;
    console.error('openCollabPage', error);
    shell(notice('Could not open this list', 'Something went wrong reaching it. Try again in a moment.',
      '<button class="btn-primary" data-action="back">Back</button>'));
  }
}

function subscribe(id, gen) {
  stopItems = watchCollabItems(id, items => {
    if (gen !== reqGen) return;
    latestItems = items || [];
    paint();
  });
}

/** Called by the router so a live listener never outlives the page showing it. */
export function closeCollabPage() {
  reqGen++;
  stopItems?.(); stopItems = null;
  latestItems = null; current = null; openId = null;
}

export function initCollabPage() {
  registerActions({
    'collab-join': async el => {
      const id = el.dataset.id;
      el.disabled = true; el.textContent = 'Joining…';
      const result = await joinCollabList(id);
      if (result === 'joined' || result === 'already') {
        toast(result === 'joined' ? 'You are on the list' : 'You were already on this list', 'success');
        openCollabPage(id);
        return;
      }
      el.disabled = false; el.textContent = 'Join this list';
      const message = { missing: 'That list no longer exists', full: 'This list already has as many people as it can hold',
        'signed-out': 'Sign in first' }[result] || 'Could not join — try again';
      toast(message, 'error');
    },
    'collab-invite': async el => {
      const link = collabLink(el.dataset.id);
      let copied = false;
      if (navigator.clipboard) { try { await navigator.clipboard.writeText(link); copied = true; } catch (_) {} }
      toast(copied ? 'Invite link copied' : `Invite link: ${link}`, copied ? 'success' : 'info');
    },
    'collab-rename': async el => {
      const list = collabListById(el.dataset.id);
      if (!list) return;
      // eslint-disable-next-line no-alert
      const name = prompt('Name this list', list.name);
      if (name === null) return;
      if (!String(name).trim()) { toast('A list needs a name', 'error'); return; }
      toast(await renameCollabList(list.id, name, list.icon) ? 'Renamed' : 'Could not rename it',
        'info');
      paint();
    },
    'collab-leave': async el => {
      const id = el.dataset.id;
      if (!await leaveCollabList(id)) { toast('Could not leave the list', 'error'); return; }
      toast('You left the list', 'info');
      document.dispatchEvent(new CustomEvent('cv:go', { detail: '/watchlist' }));
    },
    'collab-delete': async el => {
      const list = collabListById(el.dataset.id);
      if (!list) return;
      if (el.dataset.confirm !== '1') {
        // A second, deliberate press instead of a modal: it is destructive for
        // everyone on the list, so it should not be one stray click away.
        el.dataset.confirm = '1';
        el.textContent = 'Delete for everyone?';
        setTimeout(() => { if (el.isConnected) { el.dataset.confirm = ''; el.textContent = 'Delete list'; } }, 4000);
        return;
      }
      if (!await deleteCollabList(list.id)) { toast('Could not delete the list', 'error'); return; }
      toast('List deleted', 'info');
      document.dispatchEvent(new CustomEvent('cv:go', { detail: '/watchlist' }));
    },
    'collab-remove': async el => {
      if (!current) return;
      el.disabled = true;
      if (!await removeFromCollabList(current.id, el.dataset.key)) {
        el.disabled = false;
        toast('Could not remove that title', 'error');
      }
    },
  });

  // The live document can change while the page is open — someone else renames
  // it, or joins — so repaint from the list state rather than only on load.
  document.addEventListener('cv:collab-lists', () => {
    if (current && $('collabPage')?.style.display !== 'none') paint();
  });

  // The session resolving is the other thing that changes what this page should
  // show, and it usually lands after the first render.
  document.addEventListener('cv:auth', () => {
    if (openId && $('collabPage')?.style.display !== 'none') openCollabPage(openId);
  });
}
