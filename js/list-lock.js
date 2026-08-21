// ===== LIST PIN LOCK =====
// A privacy screen for a single list: its titles, count, and showcase stay hidden
// behind a PIN until you enter it. Honest scope — this protects against someone
// glancing at a shared screen, NOT against an attacker. The titles still live in
// your own Firestore documents and anyone who can sign in as you can read them.
// The UI says exactly that; nothing here pretends otherwise.
//
// The PIN itself is never stored. What goes into the list document is a
// PBKDF2-SHA256 derivation with a random per-list salt, so the stored value
// cannot be read back as a PIN, and 150k iterations make guessing slow even
// though a numeric PIN has a small keyspace.
import { state } from './state.js';
import { $, esc, toast, trapFocus, lockScroll, unlockScroll } from './ui.js';
import { registerActions } from './events.js';
import { listById, saveListLock, unshareList } from './lists.js';

const ITERATIONS = 150000;
const MIN_LENGTH = 4;
const MAX_LENGTH = 8;

// Session-only: a reload always re-locks. That is the point of the feature.
// The set lives on `state` so lists.js can honour it without a circular import.
const unlocked = state.unlockedLists;
let modal = null;
let releaseFocus = null;

const subtle = () => (typeof crypto !== 'undefined' && crypto.subtle) || null;
const bytesToHex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const randomSalt = () => bytesToHex(crypto.getRandomValues(new Uint8Array(16)));

export const isValidPin = value => /^\d{4,8}$/.test(String(value || ''));

async function derive(pin, salt) {
  const engine = subtle();
  if (!engine) throw new Error('insecure-context');
  const encoder = new TextEncoder();
  const key = await engine.importKey('raw', encoder.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await engine.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode('cineverse:' + salt), iterations: ITERATIONS, hash: 'SHA-256' },
    key, 256,
  );
  return bytesToHex(bits);
}

// Both sides are hex we produced ourselves, so this is belt-and-braces rather
// than a real side-channel concern.
function sameDigest(a, b) {
  const left = String(a || ''), right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

export function listHasPin(list) {
  const lock = (typeof list === 'string' ? listById(list) : list)?.lock;
  return !!(lock && lock.hash && lock.salt);
}

export function isListLocked(listId) { return listHasPin(listId) && !unlocked.has(listId); }
export function isListUnlocked(listId) { return listHasPin(listId) && unlocked.has(listId); }
export function lockedListIds() { return state.lists.filter(list => isListLocked(list.id)).map(list => list.id); }

const announce = (listId, locked) => document.dispatchEvent(new CustomEvent('cv:list-lock', { detail: { listId, locked } }));

export function relockList(listId) { unlocked.delete(listId); announce(listId, true); }

export function relockAllLists() {
  if (!unlocked.size) return;
  unlocked.clear();
  announce(null, true);
}

export async function verifyPin(listId, pin) {
  const list = listById(listId);
  if (!listHasPin(list)) return true;
  return sameDigest(await derive(pin, list.lock.salt), list.lock.hash);
}

export async function unlockList(listId, pin) {
  if (!(await verifyPin(listId, pin))) return false;
  unlocked.add(listId);
  announce(listId, false);
  return true;
}

async function applyPin(listId, pin) {
  const salt = randomSalt();
  const hash = await derive(pin, salt);
  const saved = await saveListLock(listId, { v: 1, algo: 'PBKDF2-SHA256', iterations: ITERATIONS, salt, hash, updatedAt: Date.now() });
  if (!saved) return false;
  unlocked.add(listId);
  // A locked list must not stay readable through a share link published earlier.
  await unshareList(listId);
  announce(listId, false);
  return true;
}

async function removePin(listId) {
  if (!(await saveListLock(listId, null))) return false;
  unlocked.delete(listId);
  announce(listId, false);
  return true;
}

// ---------- modal ----------
const COPY = {
  set: { eyebrow: 'Private list', title: 'Set a PIN', hint: 'Choose 4-8 digits. You will need it again after every reload.' },
  change: { eyebrow: 'Private list', title: 'Change the PIN', hint: 'Enter the current PIN first, then choose a new one.' },
  remove: { eyebrow: 'Private list', title: 'Remove the PIN', hint: 'Enter the current PIN to open this list permanently.' },
  unlock: { eyebrow: 'Locked list', title: 'Enter the PIN', hint: 'Unlocks this list until you reload CineVerse.' },
};
const STEP_LABEL = { current: 'Current PIN', first: 'New PIN', confirm: 'Confirm the new PIN', unlock: 'PIN' };
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

export function isPinModalOpen() { return !!$('pinOverlay')?.classList.contains('active'); }

export function closePinModal() {
  const overlay = $('pinOverlay');
  if (!overlay || !overlay.classList.contains('active')) return;
  overlay.classList.remove('active');
  unlockScroll();
  if (releaseFocus) { releaseFocus(); releaseFocus = null; }
  modal = null;
}

function keyButton(key) {
  if (key === 'clear') return '<button type="button" class="pin-key ghost" data-action="pin-key" data-key="clear">Clear</button>';
  if (key === 'back') return '<button type="button" class="pin-key ghost" data-action="pin-key" data-key="back" aria-label="Delete last digit">&#9003;</button>';
  return `<button type="button" class="pin-key" data-action="pin-key" data-key="${key}">${key}</button>`;
}

function paintModal() {
  const body = $('pinModalBody');
  if (!body || !modal) return;
  const list = listById(modal.listId);
  const copy = COPY[modal.mode] || COPY.unlock;
  const digits = modal.value.length;
  const dots = Array.from({ length: MAX_LENGTH }, (_, index) => `<i class="${index < digits ? 'on' : ''}${index === MIN_LENGTH - 1 ? ' gate' : ''}"></i>`).join('');
  const label = STEP_LABEL[modal.step] || 'PIN';
  body.innerHTML = `<div class="pin-head"><span>${esc(copy.eyebrow)}</span><h2>${esc(copy.title)}</h2><p>${esc(list ? `${list.icon || '\u{1F4C1}'} ${list.name}` : 'List')} &middot; ${esc(label)}</p></div>
    <div class="pin-dots" role="status" aria-label="${digits} of ${MAX_LENGTH} digits entered">${dots}</div>
    ${modal.error ? `<p class="pin-error" role="alert">${esc(modal.error)}</p>` : `<p class="pin-hint">${esc(copy.hint)}</p>`}
    <div class="pin-pad">${KEYS.map(keyButton).join('')}</div>
    <div class="pin-actions"><button type="button" class="btn-glass" data-action="close-pin">Cancel</button><button type="button" class="btn-primary" data-action="pin-submit"${modal.busy || !isValidPin(modal.value) ? ' disabled' : ''}>${modal.busy ? 'Checking…' : modal.step === 'confirm' ? 'Save PIN' : 'Continue'}</button></div>
    <p class="pin-note">A PIN hides this list on screen. It is a privacy screen, not encryption — the titles stay in your own account and remain visible to anyone who can sign in as you.</p>`;
}

export function openPinModal(mode, listId) {
  if (!state.user) return document.dispatchEvent(new Event('cv:open-auth'));
  if (!subtle()) { toast('A secure (https) connection is required to lock a list', 'info'); return; }
  const overlay = $('pinOverlay'); if (!overlay) return;
  const trigger = document.activeElement;
  modal = {
    mode, listId, value: '', first: '', error: '', busy: false,
    step: mode === 'set' ? 'first' : mode === 'unlock' ? 'unlock' : 'current',
  };
  paintModal();
  overlay.classList.add('active');
  lockScroll();
  releaseFocus = trapFocus(overlay, trigger);
  overlay.querySelector('.pin-key')?.focus();
}

function pressKey(key) {
  if (!modal || modal.busy) return;
  if (key === 'clear') modal.value = '';
  else if (key === 'back') modal.value = modal.value.slice(0, -1);
  else if (/^\d$/.test(key) && modal.value.length < MAX_LENGTH) modal.value += key;
  else return;
  modal.error = '';
  paintModal();
}

async function submit() {
  if (!modal || modal.busy) return;
  const pin = modal.value, listId = modal.listId, mode = modal.mode, step = modal.step;
  if (!isValidPin(pin)) { modal.error = `Use ${MIN_LENGTH}-${MAX_LENGTH} digits.`; paintModal(); return; }
  modal.busy = true; paintModal();
  try {
    if (step === 'unlock' || step === 'current') {
      if (!(await verifyPin(listId, pin))) {
        if (modal) { modal.busy = false; modal.value = ''; modal.error = 'That PIN does not match.'; paintModal(); }
        return;
      }
      if (step === 'unlock') {
        unlocked.add(listId);
        closePinModal();
        announce(listId, false);
        toast('List unlocked', 'success');
        return;
      }
      if (mode === 'remove') {
        const done = await removePin(listId);
        closePinModal();
        if (done) toast('PIN removed - this list is open again', 'success');
        return;
      }
      if (modal) { modal.step = 'first'; modal.value = ''; modal.busy = false; paintModal(); }
      return;
    }
    if (step === 'first') {
      if (modal) { modal.first = pin; modal.step = 'confirm'; modal.value = ''; modal.busy = false; paintModal(); }
      return;
    }
    if (pin !== modal.first) {
      if (modal) { modal.busy = false; modal.step = 'first'; modal.value = ''; modal.first = ''; modal.error = 'The two PINs did not match. Start again.'; paintModal(); }
      return;
    }
    const done = await applyPin(listId, pin);
    closePinModal();
    if (done) toast('List locked - the PIN is needed after every reload', 'success');
  } catch (error) {
    console.error('list pin', error);
    if (modal) { modal.busy = false; modal.error = 'That could not be completed. Try again.'; paintModal(); }
    else toast('That could not be completed. Try again.', 'error');
  }
}

export function initListLock() {
  registerActions({
    'pin-key': element => pressKey(element.dataset.key),
    'pin-submit': () => submit(),
    'close-pin': () => closePinModal(),
    'open-list-pin': element => openPinModal(element.dataset.mode || 'set', element.dataset.list),
    'relock-list': element => { relockList(element.dataset.list); toast('List locked', 'info'); },
  });

  const overlay = $('pinOverlay');
  overlay?.addEventListener('click', event => { if (event.target === overlay) closePinModal(); });

  // Typing is faster than tapping the pad, so accept both.
  document.addEventListener('keydown', event => {
    if (!isPinModalOpen() || !modal) return;
    if (/^\d$/.test(event.key)) { event.preventDefault(); pressKey(event.key); }
    else if (event.key === 'Backspace') { event.preventDefault(); pressKey('back'); }
    else if (event.key === 'Enter') { event.preventDefault(); submit(); }
  });

  // A different account must never inherit the previous one's unlocked lists.
  document.addEventListener('cv:auth', () => { unlocked.clear(); closePinModal(); });
}
