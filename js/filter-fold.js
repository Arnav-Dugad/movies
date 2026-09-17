// ============================================
// FOLDED FILTERS
// Every filter bar on the site starts folded to one "Filters" button (plus the
// few controls you reach for every time, like a search box), with a count of
// the filters that are set and a short summary of them. One tap opens the bar.
//
// The bars are rendered by many modules, some once in index.html and some on
// every repaint, so nothing here touches their markup at the source: a registry
// names each bar and what stays visible, and a mutation pass enhances a bar
// whenever it (or its toggle) is missing. Open bars stay open for the visit.
// ============================================
import { prefersReducedMotion } from './ui.js';

/**
 * host:    the bar whose direct children fold away
 * keep:    direct children that stay visible while folded
 * extra:   elements outside the bar that also hide while folded
 * dynamic: the bar is re-rendered from state, so its `selected`/`checked`
 *          attributes mirror the current values and the first option (or
 *          unchecked) is the default instead
 * pressed: toggle buttons whose aria-pressed="true" counts as a set filter
 */
export const FOLDS = [
  { id: 'movies', host: '#moviesPage .browse-filters' },
  { id: 'tv', host: '#tvPage .browse-filters' },
  { id: 'list', host: '#wlControls', keep: '.watched-search' },
  { id: 'watched', host: '#watchedControls > .watched-controls', keep: '.watched-search, [data-action="watched-random"]', extra: '#watchedAdvanced' },
  { id: 'releases', host: '.release-tools', keep: '.release-search, .release-pref-btn' },
  { id: 'discover', host: '.discover-filter-grid', keep: '.discover-build-btn' },
  { id: 'search', host: '#searchFilters' },
  { id: 'notifications', host: '.notification-tools', keep: 'label, [data-action="toggle-notification-preferences"], [data-action="refresh-notifications"], [data-action="read-all-notifications"]', dynamic: true, pressed: '[data-action="notification-unread-only"]' },
  { id: 'box-office', host: '.bo-page-tools', keep: '.watched-search', dynamic: true },
  // The watch-order switch is a view, like the Movies/TV tabs, so it stays out.
  { id: 'franchises', host: '.fp-toolbar', keep: '.watched-search, .fp-order-switch', dynamic: true },
  { id: 'studio', host: '.studio-filters', dynamic: true },
  { id: 'person', host: '.person-filters', keep: 'b', dynamic: true },
  { id: 'mature', host: '#adToolbar', keep: '.ad-seg', dynamic: true },
];

// ---------- pure ----------

/**
 * Pure: is one control set away from its default?
 * control: { tag, type, selectedIndex, defaultIndex, checked, defaultChecked, value, keep }
 */
export function isSet(control, dynamic = false) {
  if (control.tag === 'SELECT') {
    const fallback = dynamic ? 0 : Math.max(0, control.defaultIndex ?? 0);
    return control.selectedIndex >= 0 && control.selectedIndex !== fallback;
  }
  if (control.tag === 'INPUT' && (control.type === 'checkbox' || control.type === 'radio')) {
    return !!control.checked !== (dynamic ? false : !!control.defaultChecked);
  }
  if (control.tag === 'INPUT') return !control.keep && String(control.value || '').trim() !== '';
  return false;
}

/** Pure: the button's summary, the set filters' labels joined, capped at `max`. */
export function summaryOf(labels, max = 3) {
  const clean = labels.map(label => String(label || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (clean.length <= max) return clean.join(' · ');
  return `${clean.slice(0, max).join(' · ')} +${clean.length - max}`;
}

// ---------- DOM ----------

const open = new Set();          // bar ids opened this visit
const hosts = new Map();         // host element -> fold definition

function describe(el, dynamic, keepEl) {
  if (el.tagName === 'SELECT') {
    const defaultIndex = [...el.options].findIndex(option => option.defaultSelected);
    return { tag: 'SELECT', selectedIndex: el.selectedIndex, defaultIndex };
  }
  return { tag: el.tagName, type: el.type, checked: el.checked, defaultChecked: el.defaultChecked, value: el.value, keep: !!keepEl };
}

function labelFor(el) {
  if (el.tagName === 'SELECT') return el.options[el.selectedIndex]?.textContent || '';
  if (el.type === 'checkbox') {
    const label = el.closest('label');
    const text = label?.querySelector('strong, span:not(:first-child)')?.textContent || label?.textContent || '';
    return el.checked ? text : `Not ${text.trim().toLowerCase()}`;
  }
  return el.value;
}

/** The set filters of one bar: their labels (count is the length). */
export function setFilters(host, fold) {
  const labels = [];
  const scope = [host, ...(fold.extra ? document.querySelectorAll(fold.extra) : [])];
  for (const root of scope) {
    for (const el of root.querySelectorAll('select, input')) {
      if (el.closest('.filter-fold-toggle')) continue;
      const keepEl = root === host && fold.keep ? el.closest(fold.keep) : null;
      if (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio' && keepEl) continue;
      if (isSet(describe(el, fold.dynamic, keepEl), fold.dynamic)) labels.push(labelFor(el));
    }
    if (fold.pressed) root.querySelectorAll(fold.pressed).forEach(button => { if (button.getAttribute('aria-pressed') === 'true') labels.push(button.textContent); });
  }
  return labels;
}

const SLIDERS = '<svg class="filter-fold-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path class="ff-line a" d="M4 7h16"/><path class="ff-line b" d="M4 17h16"/><circle class="ff-knob a" cx="9" cy="7" r="2.4"/><circle class="ff-knob b" cx="15" cy="17" r="2.4"/></svg>';
const CHEVRON = '<svg class="filter-fold-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

let uid = 0;
function toggleOf(host) { return [...host.children].find(child => child.classList.contains('filter-fold-toggle')) || null; }

function enhance(host, fold) {
  hosts.set(host, fold);
  if (!host.id) host.id = `filterFold${++uid}`;
  host.classList.add('filter-fold');
  host.dataset.fold = fold.id;
  const keep = fold.keep ? new Set([...host.children].filter(child => child.matches(fold.keep))) : new Set();
  let first = null;
  for (const child of host.children) {
    if (child.classList.contains('filter-fold-toggle')) continue;
    const kept = keep.has(child);
    child.classList.toggle('fold-keep', kept);
    if (!kept && !first) first = child;
  }
  let toggle = toggleOf(host);
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'filter-fold-toggle';
    toggle.setAttribute('aria-controls', host.id);
    toggle.innerHTML = `${SLIDERS}<span class="filter-fold-label">Filters</span><b class="filter-fold-count" hidden></b><span class="filter-fold-summary"></span>${CHEVRON}`;
    host.insertBefore(toggle, first);
  }
  setOpen(host, fold, open.has(fold.id), false);
}

function setOpen(host, fold, isOpen, animate) {
  host.classList.toggle('is-folded', !isOpen);
  const toggle = toggleOf(host);
  if (toggle) toggle.setAttribute('aria-expanded', String(isOpen));
  if (fold.extra) document.querySelectorAll(fold.extra).forEach(el => el.classList.toggle('fold-away', !isOpen));
  if (isOpen) open.add(fold.id); else open.delete(fold.id);
  host.classList.remove('fold-opening');
  if (isOpen && animate && !prefersReducedMotion()) {
    let i = 0;
    for (const child of host.children) {
      if (child.classList.contains('fold-keep') || child.classList.contains('filter-fold-toggle')) continue;
      child.style.setProperty('--fold-i', String(Math.min(i++, 14)));
    }
    void host.offsetWidth;
    host.classList.add('fold-opening');
    clearTimeout(host._foldTimer);
    host._foldTimer = setTimeout(() => host.classList.remove('fold-opening'), 900);
  }
  paint(host, fold);
}

function paint(host, fold) {
  const toggle = toggleOf(host);
  if (!toggle) return;
  const labels = setFilters(host, fold);
  const count = toggle.querySelector('.filter-fold-count');
  const summary = toggle.querySelector('.filter-fold-summary');
  const text = String(labels.length);
  if (count.textContent !== text) {
    count.textContent = text;
    if (labels.length && !count.hidden) { count.classList.remove('bump'); void count.offsetWidth; count.classList.add('bump'); }
  }
  count.hidden = !labels.length;
  const words = host.classList.contains('is-folded') ? summaryOf(labels) : '';
  if (summary.textContent !== words) summary.textContent = words;
  summary.hidden = !words;
  toggle.classList.toggle('has-set', labels.length > 0);
  const state = host.classList.contains('is-folded') ? 'Show' : 'Hide';
  toggle.setAttribute('aria-label', `${state} filters${labels.length ? `, ${labels.length} set: ${summaryOf(labels, 9)}` : ''}`);
}

function scan() {
  for (const fold of FOLDS) {
    document.querySelectorAll(fold.host).forEach(host => {
      const known = hosts.get(host);
      const keepMarked = !fold.keep || [...host.children].every(child => child.classList.contains('filter-fold-toggle') || child.classList.contains('fold-keep') === child.matches(fold.keep));
      if (!known || !toggleOf(host) || !keepMarked || !host.classList.contains('filter-fold')) enhance(host, fold);
      else paint(host, fold);
    });
  }
  for (const host of hosts.keys()) if (!host.isConnected) hosts.delete(host);
}

let queued = false;
function queueScan() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; scan(); });
}

export function initFilterFold() {
  scan();
  new MutationObserver(records => {
    // The toggle's own repaint (count, summary) must not schedule another pass.
    if (records.every(record => record.target.closest?.('.filter-fold-toggle'))) return;
    queueScan();
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', e => {
    const toggle = e.target.closest('.filter-fold-toggle');
    if (toggle) {
      const host = toggle.parentElement, fold = hosts.get(host);
      if (!fold) return;
      const opening = host.classList.contains('is-folded');
      setOpen(host, fold, opening, true);
      return;
    }
    // Resets and toggle buttons change values without a change event.
    if (e.target.closest('.filter-fold, .fold-away')) { setTimeout(queueScan, 0); setTimeout(queueScan, 300); }
  });
  const recount = e => { if (e.target.closest?.('.filter-fold, .fold-away')) setTimeout(queueScan, 0); };
  document.addEventListener('change', recount);
  document.addEventListener('input', recount);
  // A folded bar never keeps focus on a control it just hid.
  document.addEventListener('focusin', e => {
    const host = e.target.closest?.('.filter-fold.is-folded');
    if (host && !e.target.closest('.fold-keep, .filter-fold-toggle')) toggleOf(host)?.focus();
  });
}
