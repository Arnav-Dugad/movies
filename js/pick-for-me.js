// ===== PICK FOR ME =====
// Press and hold any row of posters and CineVerse decides for you: the posters
// spin past in a single frame, slow down, and settle on one title with a thump.
// From there you can open it, or spin again.
//
// A hold, not a tap: the press has to last half a second and stay still, so
// scrolling a row and tapping a poster both behave exactly as before.
import { esc, prefersReducedMotion } from './ui.js';
import { haptic } from './haptics.js';

const HOLD_MS = 520, SLOP = 10, MIN_CARDS = 3;

/** Pure: the reel of indices to flash through, ending on the winner. */
export function spinSequence(count, winner, steps = 15) {
  if (count < 1) return [];
  const safeWinner = ((winner % count) + count) % count;
  const out = [];
  for (let i = 0; i < steps; i++) out.push((safeWinner + count - ((steps - i) % count)) % count);
  out.push(safeWinner);
  return out;
}

/** Pure: how long to hold each frame, easing from fast to slow. */
export function frameDelay(index, total, { from = 45, to = 250 } = {}) {
  if (total <= 1) return to;
  const t = index / (total - 1);
  return Math.round(from + (to - from) * (t * t));
}

/** Pure: the titles a row offers, from its cards' own data. */
export function rowPicks(cards) {
  return cards
    .map(card => ({
      id: card.dataset?.id,
      type: card.dataset?.type,
      title: card.dataset?.title || '',
      poster: card.querySelector?.('img')?.currentSrc || card.querySelector?.('img')?.src || '',
      year: card.dataset?.year || '',
    }))
    .filter(pick => pick.id && pick.type && pick.poster);
}

let sheet = null, spinning = 0;

function close() {
  if (!sheet) return;
  spinning++;
  sheet.classList.remove('is-open');
  const node = sheet;
  sheet = null;
  setTimeout(() => node.remove(), 260);
}

function render(picks, rowLabel) {
  close();
  sheet = document.createElement('div');
  sheet.className = 'pick-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Pick for me');
  sheet.innerHTML = `<div class="pick-card">
      <span class="pick-kicker">Pick for me${rowLabel ? ` · ${esc(rowLabel)}` : ''}</span>
      <div class="pick-stage"><img alt="" class="pick-poster" src="${esc(picks[0].poster)}"></div>
      <b class="pick-title" aria-live="polite">Choosing…</b>
      <div class="pick-actions">
        <button type="button" class="btn-primary pick-open" disabled>Open</button>
        <button type="button" class="btn-glass pick-again" disabled>Spin again</button>
        <button type="button" class="btn-glass pick-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet?.classList.add('is-open'));
  sheet.addEventListener('click', event => {
    if (event.target === sheet || event.target.closest('.pick-close')) close();
  });
  return sheet;
}

async function spin(picks, rowLabel) {
  const node = render(picks, rowLabel);
  const run = ++spinning;
  const poster = node.querySelector('.pick-poster');
  const titleEl = node.querySelector('.pick-title');
  const winner = Math.floor(Math.random() * picks.length);
  const quick = prefersReducedMotion();
  const reel = quick ? [winner] : spinSequence(picks.length, winner);
  for (let i = 0; i < reel.length; i++) {
    if (run !== spinning || !node.isConnected) return;
    const pick = picks[reel[i]];
    poster.src = pick.poster;
    poster.classList.remove('flip');
    void poster.offsetWidth;
    poster.classList.add('flip');
    if (i > reel.length - 6) haptic('detent');
    await new Promise(resolve => setTimeout(resolve, quick ? 0 : frameDelay(i, reel.length)));
  }
  if (run !== spinning || !node.isConnected) return;
  const pick = picks[winner];
  titleEl.textContent = pick.title + (pick.year ? ` · ${pick.year}` : '');
  node.querySelector('.pick-card').classList.add('landed');
  haptic('drop');
  const open = node.querySelector('.pick-open');
  open.disabled = false;
  open.dataset.action = 'open-detail';
  open.dataset.id = pick.id;
  open.dataset.type = pick.type;
  open.dataset.title = pick.title;
  open.addEventListener('click', () => close(), { once: true });
  const again = node.querySelector('.pick-again');
  again.disabled = false;
  again.addEventListener('click', () => spin(picks, rowLabel), { once: true });
}

/** Offer a pick from one row, if it holds enough titles. */
export function pickFromRow(row) {
  const picks = rowPicks([...row.querySelectorAll('.card[data-id]')]);
  if (picks.length < MIN_CARDS) return false;
  const label = row.closest('.section, .hs-wrap')?.querySelector('.section-title')?.textContent?.trim() || '';
  haptic('pin');
  spin(picks, label.slice(0, 40));
  return true;
}

export function initPickForMe() {
  let timer = 0, start = null, target = null;

  const cancel = () => { clearTimeout(timer); timer = 0; start = null; target = null; };

  document.addEventListener('pointerdown', event => {
    if (event.button > 0) return;
    const row = event.target.closest?.('.row');
    // The rail in edit mode belongs to drag-to-reorder.
    if (!row || row.closest('.continue-section.editing') || sheet) return;
    target = row; start = { x: event.clientX, y: event.clientY };
    clearTimeout(timer);
    timer = setTimeout(() => { if (target) pickFromRow(target); cancel(); }, HOLD_MS);
  }, { passive: true });

  document.addEventListener('pointermove', event => {
    if (!start) return;
    if (Math.abs(event.clientX - start.x) > SLOP || Math.abs(event.clientY - start.y) > SLOP) cancel();
  }, { passive: true });

  for (const type of ['pointerup', 'pointercancel', 'scroll']) {
    document.addEventListener(type, cancel, { passive: true, capture: true });
  }
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
}
