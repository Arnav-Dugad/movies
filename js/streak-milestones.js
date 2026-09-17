// ===== STREAK MILESTONES =====
// Seven, thirty and a hundred days in a row with something watched are
// celebrated with the same toast as a cast milestone: a gauge that fills and a
// number that rolls up like an odometer.
//
// A milestone belongs to the day it is reached. It is announced only when your
// streak, counted the Watch Diary's way (js/diary.js: viewing only, never bulk
// marks), is exactly that long and includes today, and only once per streak on
// this device. So an old streak that passed 30 weeks ago never announces 30, a
// second episode on the same day does not repeat it, and a new streak can earn
// each milestone again. It is checked after your own ticks and watched marks,
// not after syncs. Settings → Streak milestones turns it off.
import { state } from './state.js';
import { prefs } from './prefs.js';
import { esc } from './ui.js';
import { icon } from './icons.js';
import { diaryEvents, diaryDays, diaryStreaks, dayKey, shiftDay } from './diary.js';
import { odometerHTML } from './cast-hours.js';

export const STREAK_MILESTONES = [7, 30, 100];

/**
 * Pure: the milestone to announce now, or null.
 * @param {{ current: number, todayActive: boolean, start: string }} streak
 * @param {string[]} announced  "start:days" already announced on this device
 */
export function streakMilestoneToday({ current, todayActive, start }, announced = []) {
  if (!todayActive || !start) return null;
  const milestone = STREAK_MILESTONES.find(days => days === current);
  return milestone && !announced.includes(`${start}:${milestone}`) ? milestone : null;
}

/** Pure: the current streak from a diary day map, with the day it began. */
export function currentStreak(days, now = Date.now()) {
  const today = dayKey(now);
  const todayActive = !!days.get(today)?.items;
  const { current } = diaryStreaks(days, now);
  const end = todayActive ? today : shiftDay(today, -1);
  return { current, todayActive, start: current ? shiftDay(end, -(current - 1)) : '' };
}

const storeKey = () => `cv_streak_milestones_v1_${state.user?.uid || 'guest'}`;
function readAnnounced() {
  try { const value = JSON.parse(localStorage.getItem(storeKey()) || '[]'); return Array.isArray(value) ? value.map(String) : []; }
  catch (_) { return []; }
}
function writeAnnounced(list) {
  try { localStorage.setItem(storeKey(), JSON.stringify(list.slice(-20))); } catch (_) {}
}

function announce(days) {
  const zone = document.getElementById('toastZone');
  if (!zone) return;
  zone.querySelector('.streak-milestone')?.remove();
  const card = document.createElement('div');
  card.className = 'toast success cast-milestone streak-milestone';
  card.setAttribute('role', 'status');
  card.innerHTML = `<span class="club-gauge club-arrive cast-milestone-photo streak-gauge" style="--delay:160ms" aria-hidden="true"><svg viewBox="0 0 64 64" focusable="false"><circle class="club-track" cx="32" cy="32" r="29"/><circle class="club-fill" cx="32" cy="32" r="29" pathLength="1"/></svg><span class="club-face">${icon('flame')}</span><b class="club-num">${odometerHTML(days)}d</b></span>`
    + `<span class="cast-milestone-copy"><small>Streak milestone</small><strong>${esc(`${days} days in a row with something watched`)}</strong></span>`
    + `<button type="button" data-action="show-page" data-page="stats">Diary</button><button type="button" class="recap-prompt-close" aria-label="Dismiss">${icon('close')}</button>`;
  const dismiss = () => { card.style.animation = 'toast-out .3s forwards'; setTimeout(() => card.remove(), 300); };
  card.querySelector('.recap-prompt-close').addEventListener('click', () => card.remove());
  card.querySelector('[data-action="show-page"]').addEventListener('click', () => card.remove());
  zone.appendChild(card);
  setTimeout(() => { if (card.isConnected) dismiss(); }, 9000);
}

/** Recount the streak and announce a milestone reached today. Returns it, or null. */
export function checkStreakMilestone(now = Date.now()) {
  if (!state.user) return null;
  const days = diaryDays(diaryEvents({ watched: state.watched, episodeProgress: state.episodeProgress }));
  const streak = currentStreak(days, now);
  const announced = readAnnounced();
  const milestone = streakMilestoneToday(streak, announced);
  if (!milestone) return null;
  writeAnnounced([...announced, `${streak.start}:${milestone}`]);
  if (prefs.streakMilestones !== false) announce(milestone);
  return milestone;
}

export function initStreakMilestones() {
  let timer = 0;
  const later = () => { clearTimeout(timer); timer = setTimeout(() => checkStreakMilestone(), 1200); };
  // Your own ticks and marks only: a sync, a live update or a backfill is not you watching.
  document.addEventListener('cv:episode-progress', event => {
    const detail = event.detail || {};
    if (!detail.key || detail.merged || detail.live || detail.backfill) return;
    later();
  });
  document.addEventListener('cv:watched-toggled', later);
}
