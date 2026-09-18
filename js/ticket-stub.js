// ===== TICKET STUB =====
// Marking a title watched tears a small ticket stub off its poster and sends it
// along an arc into your library tab (My List in the bar at the bottom of a
// phone or across the top of a desktop, otherwise your avatar). The tab takes
// it with a small bounce and a "+1", and a phone gives a light landing tap.
//
// Purely a flourish: it starts from where the poster WAS when you pressed, so a
// card that re-renders under the press does not matter, and it never runs under
// reduced motion or with the tab hidden.
import { haptic } from './haptics.js';
import { prefersReducedMotion } from './ui.js';

const TARGETS = ['.mob-item[data-page="watchlist"]', '.nav-link[data-page="watchlist"]', '#navAv'];
const SOURCES = '.card-img, .detail-poster, .cvp-media, .continue-art';

/** Pure: the arc's keyframes from one centre point to another. */
export function stubKeyframes(from, to, { lift = 90 } = {}) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const apexY = Math.min(0, dy) - lift;
  const at = (t, extra) => {
    // A quadratic curve through the apex, sampled.
    const x = dx * t;
    const y = 2 * (1 - t) * t * apexY + t * t * dy;
    return `translate(${Math.round(x)}px, ${Math.round(y)}px) ${extra}`;
  };
  return [
    { offset: 0, opacity: 0, transform: at(0, 'rotate(-10deg) scale(.55)') },
    { offset: .14, opacity: 1, transform: `translate(0px, -18px) rotate(-16deg) scale(1.08)` },
    { offset: .3, opacity: 1, transform: at(.22, 'rotate(-4deg) scale(1)') },
    { offset: .6, opacity: 1, transform: at(.6, 'rotate(10deg) scale(.82)') },
    { offset: .88, opacity: 1, transform: at(.93, 'rotate(18deg) scale(.5)') },
    { offset: 1, opacity: 0, transform: at(1, 'rotate(22deg) scale(.32)') },
  ];
}

const visible = el => {
  if (!el) return null;
  const box = el.getBoundingClientRect();
  if (box.width < 4 || box.height < 4) return null;
  if (box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) return null;
  const style = getComputedStyle(el);
  return style.visibility === 'hidden' || +style.opacity === 0 ? null : box;
};

/** Where a press on `el` should launch from: its poster if it has one, else itself. */
export function launchRect(el) {
  const scope = el?.closest?.('.card, .cvp, .detail-top, #detailPage, .continue-card');
  const poster = scope?.querySelector(SOURCES);
  return visible(poster) || visible(el);
}

let stubId = 0;
const stubSVG = id => `<svg viewBox="0 0 64 36" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4a55"/><stop offset="1" stop-color="#b00610"/></linearGradient></defs><path d="M6 2h52a4 4 0 0 1 4 4v7a5 5 0 0 0 0 10v7a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4v-7a5 5 0 0 0 0-10V6a4 4 0 0 1 4-4z" fill="url(#${id})"/><path d="M46 5v26" stroke="rgba(255,255,255,.55)" stroke-width="1.4" stroke-dasharray="2.2 2.4"/><path d="M13 12.5h24M13 18h18M13 23.5h21" stroke="rgba(255,255,255,.8)" stroke-width="2" stroke-linecap="round"/><path d="M52.5 13.5l2.4 2.4 4.1-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

let flying = 0;
export function flyTicket(from) {
  if (!from || document.hidden || prefersReducedMotion() || flying > 2) return false;
  const target = TARGETS.map(selector => document.querySelector(selector)).find(visible);
  const to = target && visible(target);
  if (!to) return false;
  const start = { x: from.left + from.width / 2, y: from.top + Math.min(from.height / 2, 120) };
  const end = { x: to.left + to.width / 2, y: to.top + to.height / 2 };
  const stub = document.createElement('div');
  stub.className = 'ticket-stub';
  stub.setAttribute('aria-hidden', 'true');
  stub.innerHTML = stubSVG(`cvStub${++stubId}`);
  stub.style.left = `${Math.round(start.x - 32)}px`;
  stub.style.top = `${Math.round(start.y - 18)}px`;
  document.body.appendChild(stub);
  flying++;
  const animation = stub.animate(stubKeyframes(start, end), { duration: 980, easing: 'cubic-bezier(.45, 0, .25, 1)', fill: 'forwards' });
  const done = () => {
    flying = Math.max(0, flying - 1);
    stub.remove();
    land(target);
  };
  animation.onfinish = done;
  animation.oncancel = () => { flying = Math.max(0, flying - 1); stub.remove(); };
  return true;
}

/**
 * The stub leaves again: from the library tab back to where the poster was,
 * for an undo. The same arc, walked backwards.
 */
export function flyTicketBack(to) {
  if (!to || document.hidden || prefersReducedMotion()) return false;
  const target = TARGETS.map(selector => document.querySelector(selector)).find(visible);
  const from = target && visible(target);
  if (!from) return false;
  const start = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
  const end = { x: to.left + to.width / 2, y: to.top + Math.min(to.height / 2, 120) };
  const stub = document.createElement('div');
  stub.className = 'ticket-stub';
  stub.setAttribute('aria-hidden', 'true');
  stub.innerHTML = stubSVG(`cvStub${++stubId}`);
  stub.style.left = `${Math.round(start.x - 32)}px`;
  stub.style.top = `${Math.round(start.y - 18)}px`;
  document.body.appendChild(stub);
  const animation = stub.animate(stubKeyframes(start, end, { lift: 70 }), { duration: 820, easing: 'cubic-bezier(.4, 0, .3, 1)', fill: 'forwards' });
  const clear = () => stub.remove();
  animation.onfinish = clear;
  animation.oncancel = clear;
  target.classList.remove('stub-landed');
  void target.getBoundingClientRect();
  target.classList.add('stub-landed');
  setTimeout(() => target.classList.remove('stub-landed'), 700);
  return true;
}

function land(target) {
  if (!target?.isConnected) return;
  haptic('land');
  target.classList.remove('stub-landed');
  void target.getBoundingClientRect();
  target.classList.add('stub-landed');
  const box = target.getBoundingClientRect();
  const plus = document.createElement('span');
  plus.className = 'ticket-stub-plus';
  plus.setAttribute('aria-hidden', 'true');
  plus.textContent = '+1';
  plus.style.left = `${Math.round(box.left + box.width / 2)}px`;
  plus.style.top = `${Math.round(box.top)}px`;
  document.body.appendChild(plus);
  setTimeout(() => plus.remove(), 900);
  setTimeout(() => target.classList.remove('stub-landed'), 700);
}
