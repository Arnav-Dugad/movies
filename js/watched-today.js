// ===== WATCHED TODAY =====
// A small count on the My List tab: how many titles and episodes you have
// watched today. It is where the ticket stubs land, so it is where the day's
// tally belongs — it bumps as each stub arrives and clears itself at midnight.
import { state } from './state.js';
import { diaryEvents, dayKey } from './diary.js';

const TABS = '.mob-item[data-page="watchlist"], .nav-link[data-page="watchlist"]';

/** Pure: how many real viewings happened on `day`, from the diary's own ledger. */
export function watchedOn(day, events) {
  return (events || []).filter(event => !event.bulk && dayKey(event.at) === day).length;
}

export function watchedToday() {
  try { return watchedOn(dayKey(Date.now()), diaryEvents(state)); } catch (_) { return 0; }
}

let last = -1;
export function paintWatchedToday(count = watchedToday()) {
  const bump = count > last && last >= 0;
  last = count;
  document.querySelectorAll(TABS).forEach(tab => {
    let pip = tab.querySelector(':scope > .today-pip');
    if (!count) { pip?.remove(); tab.removeAttribute('data-today'); return; }
    if (!pip) {
      pip = document.createElement('b');
      pip.className = 'today-pip';
      tab.appendChild(pip);
    }
    pip.textContent = String(count);
    pip.title = `${count} watched today`;
    tab.dataset.today = String(count);
    if (bump) { pip.classList.remove('bump'); void pip.offsetWidth; pip.classList.add('bump'); }
  });
}

export function initWatchedToday() {
  const paint = () => paintWatchedToday();
  paint();
  for (const event of ['cv:watched-toggled', 'cv:episode-progress', 'cv:library-sync', 'cv:auth', 'cv:wl-changed']) {
    document.addEventListener(event, () => setTimeout(paint, 0));
  }
  // The day rolls over while the tab is open, and a tab woken from the
  // background may have missed it.
  setInterval(paint, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) paint(); });
}
