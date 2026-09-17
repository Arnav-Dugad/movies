// ===== SETTINGS PAGE (/settings) =====
import { state } from './state.js';
import { icon } from './icons.js';
import { $, toast, esc } from './ui.js';
import { illustration } from './illustrations.js';
import { registerActions } from './events.js';
import { REGIONS, regionLabel } from './config.js';
import { prefs, updatePref, resetPrefs, preferencePayload, DEFAULT_PREFS } from './prefs.js';
import { setTheme } from './theme-toggle.js';
import { DETAIL_PART_GROUPS } from './detail-parts.js';
import { db } from './firebase.js';
import { clearLibraryCache, flushLibraryVersion, libraryCacheDisabled } from './library-cache.js';
import { loadWatchlist, loadWatched } from './watchlist.js';
import { loadRatings } from './ratings.js';
import { loadLists } from './lists.js';
import { loadEpisodeProgress, repairEpisodeProgress } from './episodes.js';
import { loadMovieProgress } from './movie-progress.js';

let cloudSyncTimer = null;
let lastSearch = '';

function queueCloudSettings() {
  if (!state.user) return;
  const uid = state.user.uid;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(async () => {
    if (!state.user || state.user.uid !== uid) return;
    try {
      await db.collection('users').doc(uid).set({ experiencePrefs: preferencePayload({ region: state.region }) }, { merge: true });
    } catch (error) { console.warn('settings sync', error); }
  }, 1200);
}

// ---------- live previews ----------
// A switch that changes how something looks carries a small drawing of that
// thing, which follows the switch: turn it on and the drawing shows the effect.
// Pure CSS (css/refinements.css, "Settings previews"), keyed by .is-on on the row.
const THUMBS = {
  lightDrift: '<i class="st-light a"></i><i class="st-light b"></i>',
  castMilestones: '<i class="st-toast"><b></b><em></em></i>',
  streakMilestones: '<i class="st-toast flame"><b></b><em></em></i>',
  ambientColour: '<i class="st-glow"></i><i class="st-poster"></i><i class="st-bar"></i>',
  highContrast: '<i class="st-line one"></i><i class="st-line two"></i><i class="st-line three"></i>',
  compactNav: '<i class="st-nav"><b></b><b></b><b></b></i><i class="st-body"></i>',
  hidePosterCaptions: '<i class="st-poster small"></i><i class="st-caption"></i><i class="st-caption short"></i>',
  cleanHomePosters: '<i class="st-poster wide"><b class="st-badge l"></b><b class="st-badge r"></b><b class="st-badge btn"></b></i>',
  posterPreview: '<i class="st-expand"></i>',
  autoplay: '<i class="st-hero"><b></b><b></b><b></b><b></b></i>',
  backdropArt: '<i class="st-hero art"></i>',
  posterTilt: '<i class="st-poster tilt"></i>',
  haptics: '<i class="st-phone"></i><i class="st-buzz l"></i><i class="st-buzz r"></i>',
  showRatings: '<i class="st-poster wide"><b class="st-star"></b></i>',
  showWatched: '<i class="st-poster wide"><b class="st-tick"></b></i>',
  spoilerShield: '<i class="st-line one"></i><i class="st-line two blur"></i><i class="st-line three blur"></i>',
};
const toggle = (key, title, sub, checked) => `<label class="settings-switch-row${THUMBS[key] ? ' has-thumb' : ''}${checked ? ' is-on' : ''}">${THUMBS[key] ? `<span class="sp-thumb sp-${key}" aria-hidden="true">${THUMBS[key]}</span>` : ''}<span><strong>${title}</strong><small>${sub}</small></span><input type="checkbox" data-action="settings-toggle" data-pref="${key}" ${checked ? 'checked' : ''}><i></i></label>`;

// A choice between looks is a row of previews, like Glass effects: each draws
// the site the way that choice would. A radio group: arrow keys move the choice.
// `action` is what a pick does (the theme animates its own switch).
function previewPicker(key, title, sub, choices, value, action = 'settings-choice') {
  return `<div class="settings-glass-row"><span><strong id="pp-${key}-label">${title}</strong><small>${sub}</small></span>
    <div class="glass-previews pp-group${choices.length > 2 ? ' three' : ''}" role="radiogroup" aria-labelledby="pp-${key}-label" data-pref="${key}">${choices.map(([choice, label, note, stage]) => {
      const on = value === choice;
      return `<button type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" class="glass-preview pp-choice${on ? ' on' : ''}" data-action="${action}" data-pref="${key}" data-value="${choice}" value="${choice}">
        <span class="gp-stage pp-stage pp-${key}-${choice}" aria-hidden="true">${stage}</span>
        <span class="gp-copy"><strong>${label}</strong><small>${note}</small></span>
        <span class="gp-check" aria-hidden="true">${icon('check')}</span>
      </button>`;
    }).join('')}</div></div>`;
}

const page = (tone) => `<span class="pp-page ${tone}"><i class="pp-nav"><b></b><b></b><b></b></i><i class="pp-hero"></i><span class="pp-row"><u></u><u></u><u></u></span></span>`;
const THEME_CHOICES = [
  ['dark', 'Dark', 'Cinema black, lit posters', page('pp-dark')],
  ['light', 'Light', 'Warm paper, deep ink', page('pp-light')],
  ['system', 'Match device', 'Follows your system', `${page('pp-dark')}${page('pp-light pp-half')}`],
];
const DENSITY_CHOICES = [
  ['comfortable', 'Comfortable', 'Bigger posters, more air', '<span class="pp-grid roomy"><u></u><u></u><u></u></span>'],
  ['compact', 'Compact', 'More titles on screen', '<span class="pp-grid tight"><u></u><u></u><u></u><u></u><u></u></span>'],
];
const TEXT_CHOICES = [
  ['standard', 'Standard', 'The default reading size', '<span class="pp-type"><b>Aa</b><i></i><i class="short"></i></span>'],
  ['large', 'Large', 'Larger interface text', '<span class="pp-type large"><b>Aa</b><i></i><i class="short"></i></span>'],
];
const MOTION_CHOICES = [
  ['system', 'Use system setting', 'Follows your device', '<span class="pp-motion calm"><u></u></span>'],
  ['full', 'Full cinematic motion', 'Every transition plays', '<span class="pp-motion full"><u></u><i></i><i></i></span>'],
  ['reduced', 'Reduced motion', 'Still, instant changes', '<span class="pp-motion still"><u></u></span>'],
];

// Poster controls: one poster drawn with every badge the switches below allow.
function posterPreview() {
  return `<div class="poster-preview" id="posterPreview" aria-hidden="true">
    <span class="pv-card">
      <span class="pv-art"><i class="pv-sky"></i><i class="pv-moon"></i><i class="pv-hills"></i>
        <b class="pv-provider"><i></i><i></i></b><b class="pv-match">94% match</b><b class="pv-myrating">★ 9</b><b class="pv-tick">${icon('check')}</b>
        <b class="pv-rating">★ 8.4</b><b class="pv-dismiss">${icon('close')}</b><b class="pv-rate">★</b><b class="pv-list">+</b>
      </span>
      <span class="pv-caption"><b>Midnight Premiere</b><small>2026 · Movie</small></span>
    </span>
    <p>Every change below shows here first.</p>
  </div>`;
}
const POSTER_KEYS = ['hidePosterCaptions', 'cleanHomePosters', 'posterCommunityRating', 'posterPersonalRating', 'posterWatchedMark', 'posterListButton', 'posterRateButton', 'posterMatchBadge', 'posterProviderLogo', 'posterDismissButton'];
function syncPosterPreview() {
  const preview = document.getElementById('posterPreview');
  if (!preview) return;
  POSTER_KEYS.forEach(key => preview.classList.toggle(`pv-${key}`, !!prefs[key]));
}

// ---------- sections ----------
// Every panel has an animated picture, a one-line explanation, a place in the
// jump bar, and (where it holds preferences) a Reset that returns just that
// section to its defaults, with a count of what differs.
const SECTIONS = [
  { id: 'appearance', kicker: 'Appearance', title: 'Cinematic interface', chip: 'Look', icon: 'palette', scene: 'palette', blurb: 'Theme, density, text size, glass and the small celebrations.', keys: ['theme', 'density', 'textSize', 'glass', 'lightDrift', 'castMilestones', 'streakMilestones', 'ambientColour', 'highContrast', 'compactNav'] },
  { id: 'posters', kicker: 'Every poster', title: 'Poster controls', chip: 'Posters', icon: 'film', scene: 'posterstack', blurb: 'What sits on and under every poster across CineVerse.', keys: ['hidePosterCaptions', 'cleanHomePosters', 'posterCommunityRating', 'posterPersonalRating', 'posterWatchedMark', 'posterListButton', 'posterRateButton', 'posterMatchBadge', 'posterProviderLogo', 'posterDismissButton', 'posterPreview'] },
  { id: 'atmosphere', kicker: 'Motion & playback', title: 'Atmosphere', chip: 'Motion', icon: 'clapper', scene: 'projector', blurb: 'How much moves, plays and answers your touch.', keys: ['motion', 'autoplay', 'backdropArt', 'posterTilt', 'haptics'] },
  { id: 'discovery', kicker: 'Discovery', title: 'Signals and spoilers', chip: 'Discovery', icon: 'compass', scene: 'compass', blurb: 'Scores, watched marks and protection from spoilers.', keys: ['showRatings', 'showWatched', 'spoilerShield'] },
  { id: 'maturity', kicker: 'Content', title: 'Maturity', chip: 'Maturity', icon: 'eye', scene: 'shield', blurb: 'Adult titles stay out of everything unless you let them in.', keys: ['mature', 'matureInRecs', 'matureBlur'] },
  { id: 'details', kicker: 'Detail pages', title: 'Section defaults', chip: 'Title pages', icon: 'layers', scene: 'layers', blurb: 'Which panels on a title page open by themselves.', keys: ['detailBoxOfficeExpanded', 'detailGalleryExpanded', 'detailReviewsExpanded'] },
  { id: 'parts', kicker: 'Detail pages', title: 'What appears', chip: 'Page parts', icon: 'grid', scene: 'layers', blurb: 'Switch off any part of a title page, down to a single fact.' },
  { id: 'privacy', kicker: 'Privacy', title: 'Your visibility, your choice', chip: 'Privacy', icon: 'lock', scene: 'lock', blurb: 'What stays on this device and what friends can see.', keys: ['rememberSearch', 'rememberViewed', 'discoverable', 'shareMilestones', 'shareTaste'] },
  { id: 'region', kicker: 'Region', title: 'Streaming home', chip: 'Region', icon: 'globe', scene: 'globe', blurb: 'The country whose streaming services CineVerse checks.' },
  { id: 'vault', kicker: 'Collection vault', title: 'Backup & restore', chip: 'Backup', icon: 'folder', scene: 'vault', blurb: 'Your whole collection in one file, and back again.' },
  { id: 'maintenance', kicker: 'Device data', title: 'Maintenance', chip: 'Maintenance', icon: 'refresh', scene: 'gears', blurb: 'Repairs, refreshes and clearing what this device remembers.' },
];
const sectionById = id => SECTIONS.find(section => section.id === id);
// The country's name alone: the code sits beside it in its own badge.
const regionName = code => REGIONS.find(([value]) => value === code)?.[1] || code;
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Pure: the keys of a section that differ from their defaults. */
export const changedKeys = (keys, current, defaults) => (keys || []).filter(key => !sameValue(current[key], defaults[key]));

function panelHead(id) {
  const section = sectionById(id);
  const changed = changedKeys(section.keys, prefs, DEFAULT_PREFS).length;
  const reset = section.keys ? `<button type="button" class="settings-reset" data-action="settings-reset-section" data-section="${id}"${changed ? '' : ' disabled'} aria-label="${esc(changed ? `Reset ${section.title} to defaults, ${changed} changed` : `${section.title} is at its defaults`)}">${icon('rotate')}<em>${changed ? 'Reset' : 'Defaults'}</em><b class="settings-reset-count"${changed ? '' : ' hidden'}>${changed}</b></button>` : '';
  return `<div class="settings-panel-head has-art"><i class="settings-head-art" aria-hidden="true">${illustration(section.scene)}</i><div><span>${esc(section.kicker)}</span><h2>${esc(section.title)}</h2><p class="settings-head-blurb">${esc(section.blurb)}</p></div>${reset}</div>`;
}

function toolbarHTML() {
  return `<div class="settings-toolbar">
    <label class="settings-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/></svg>
      <input type="search" id="settingsSearch" placeholder="Search settings, like “poster” or “motion”" autocomplete="off" spellcheck="false" aria-label="Search settings" aria-describedby="settingsSearchCount">
      <b id="settingsSearchCount" aria-live="polite"></b>
    </label>
    <nav class="settings-jump" aria-label="Settings sections">${SECTIONS.map(section => `<button type="button" data-action="settings-jump" data-section="${section.id}">${icon(section.icon)}<span>${esc(section.chip)}</span><i class="settings-jump-dot" hidden></i></button>`).join('')}</nav>
    <p class="settings-legend"><i></i>Changed from the default</p>
  </div>
  <div class="settings-search-empty" id="settingsSearchEmpty" hidden>${illustration('search', { cls: 'empty-art' })}<h3>No settings match</h3><p>Try another word, like “poster”, “motion”, “privacy” or “backup”.</p></div>`;
}

// Privacy, at a glance: what friends can see follows the switches below it.
function privacyMapHTML() {
  const item = (key, text) => `<li data-if="${key}">${icon('check', { cls: 'yes' })}${icon('lock', { cls: 'no' })}<span>${text}</span></li>`;
  return `<div class="privacy-map">
    <div><strong>Friends can see</strong><ul>${item('discoverable', 'Your name when they search')}${item('shareMilestones', 'Your hours-club badges')}${item('shareTaste', 'A summary of your taste')}</ul></div>
    <div class="never"><strong>Never shared</strong><ul><li>${icon('lock', { cls: 'no' })}<span>Your ratings</span></li><li>${icon('lock', { cls: 'no' })}<span>Your watched history</span></li><li>${icon('lock', { cls: 'no' })}<span>Private and locked lists</span></li></ul></div>
  </div>`;
}

const VAULT_STEPS = `<ol class="vault-steps" aria-label="How backups work">
    <li>${icon('folder')}<b>Download</b><small>One readable JSON file</small></li>
    <li>${icon('lock')}<b>Keep it safe</b><small>On your device or drive</small></li>
    <li>${icon('refresh')}<b>Restore</b><small>Merges, never deletes newer</small></li>
  </ol>`;

// Scroll spy for the jump bar: the section in view is marked current.
let spy = null, spyPausedUntil = 0;
function markCurrent(id) {
  document.querySelectorAll('.settings-jump button').forEach(button => {
    const on = button.dataset.section === id;
    if (on) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    if (on && button.parentElement.scrollWidth > button.parentElement.clientWidth) {
      const bar = button.parentElement;
      const target = button.offsetLeft - (bar.clientWidth - button.offsetWidth) / 2;
      if (Math.abs(bar.scrollLeft - target) > 40) bar.scrollTo({ left: target, behavior: 'smooth' });
    }
  });
}
function watchSections() {
  spy?.disconnect();
  const panels = [...document.querySelectorAll('#settingsContent [data-section-panel]')];
  if (!panels.length || !('IntersectionObserver' in window)) return;
  const visible = new Map();
  spy = new IntersectionObserver(entries => {
    entries.forEach(entry => visible.set(entry.target.dataset.sectionPanel, entry.isIntersecting ? entry.boundingClientRect.top : null));
    const current = [...visible.entries()].filter(([, top]) => top !== null).sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]))[0]?.[0];
    // A jump sets the current section itself; the scroll it causes does not overrule it.
    if (!current || Date.now() < spyPausedUntil) return;
    markCurrent(current);
  }, { rootMargin: '-35% 0px -55% 0px' });
  panels.forEach(panel => spy.observe(panel));
}

// ---------- search ----------
const SEARCH_ROWS = '.settings-switch-row, .settings-select-row, .settings-glass-row, .settings-part, .settings-maintenance > button, .settings-vault-actions > button';
function unmark(root) {
  root.querySelectorAll('[data-plain]').forEach(el => { el.textContent = el.dataset.plain; delete el.dataset.plain; });
}
function mark(el, terms) {
  if (!el || el.children.length || !terms.length) return;
  const text = el.textContent;
  const lower = text.toLowerCase();
  const ranges = [];
  terms.forEach(term => { let at = lower.indexOf(term); while (at >= 0) { ranges.push([at, at + term.length]); at = lower.indexOf(term, at + term.length); } });
  if (!ranges.length) return;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  ranges.forEach(range => { const last = merged.at(-1); if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]); else merged.push([...range]); });
  let html = '', cursor = 0;
  merged.forEach(([from, to]) => { html += esc(text.slice(cursor, from)) + `<mark>${esc(text.slice(from, to))}</mark>`; cursor = to; });
  el.dataset.plain = text;
  el.innerHTML = html + esc(text.slice(cursor));
}

/** Filter Settings to rows matching every word; returns how many matched. */
function searchSettings(raw) {
  const root = $('settingsContent');
  if (!root) return 0;
  unmark(root);
  root.querySelectorAll('.search-hide').forEach(el => el.classList.remove('search-hide'));
  // A disclosure opened by an earlier search closes again; one you opened stays open.
  root.querySelectorAll('details[data-search-opened]').forEach(details => { details.open = false; delete details.dataset.searchOpened; });
  root.classList.toggle('is-searching', !!raw.trim());
  const terms = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const empty = $('settingsSearchEmpty'), count = $('settingsSearchCount');
  if (!terms.length) { if (empty) empty.hidden = true; if (count) count.textContent = ''; return 0; }
  const has = text => terms.every(term => text.includes(term));
  // A match is a row whose own words contain every term, or a section whose
  // heading does (which then shows all of its rows).
  let matches = 0;
  root.querySelectorAll('.settings-panel').forEach(panel => {
    const headEl = panel.querySelector('.settings-panel-head') || panel;
    const headText = (panel.classList.contains('settings-danger') ? panel.textContent : headEl.textContent).toLowerCase();
    const rows = [...panel.querySelectorAll(SEARCH_ROWS)];
    const headMatch = has(headText);
    let shown = 0;
    rows.forEach(row => {
      const hit = has(row.textContent.toLowerCase());
      if (headMatch || hit) { shown++; if (hit) { matches++; row.querySelectorAll('strong, small, .settings-part span, button > span').forEach(el => mark(el, terms)); } }
      else row.classList.add('search-hide');
    });
    if (headMatch) { if (!rows.some(row => has(row.textContent.toLowerCase()))) matches++; mark(panel.querySelector('.settings-panel-head h2'), terms); }
    if (!headMatch && !shown) panel.classList.add('search-hide');
    const details = panel.querySelector('details');
    if (details && !details.open && rows.some(row => !row.classList.contains('search-hide') && details.contains(row))) { details.open = true; details.dataset.searchOpened = '1'; }
    // The group headings of the detail-parts list follow their parts.
    panel.querySelectorAll('.settings-parts-group').forEach(group => {
      if (!headMatch && !group.querySelector('.settings-part:not(.search-hide)')) group.classList.add('search-hide');
    });
  });
  const visiblePanels = root.querySelectorAll('.settings-panel:not(.search-hide)').length;
  if (count) count.textContent = matches ? `${matches} match${matches === 1 ? '' : 'es'}` : 'No matches';
  if (empty) empty.hidden = !!visiblePanels;
  return matches;
}

/** Keep every preview group and switch drawing in step with the saved preferences. */
function syncPreviews() {
  document.querySelectorAll('.pp-group[data-pref]').forEach(group => {
    const value = group.dataset.pref === 'theme' ? prefs.theme : prefs[group.dataset.pref];
    group.querySelectorAll('.pp-choice').forEach(button => {
      const on = button.dataset.value === value;
      button.classList.toggle('on', on); button.setAttribute('aria-checked', String(on)); button.tabIndex = on ? 0 : -1;
    });
  });
  document.querySelectorAll('.settings-switch-row input[data-pref]').forEach(input => {
    const key = input.dataset.pref, on = !!prefs[key];
    if (input.checked !== on) input.checked = on;
    const row = input.closest('.settings-switch-row');
    row?.classList.toggle('is-on', on);
    if (key in DEFAULT_PREFS) row?.classList.toggle('is-changed', !sameValue(prefs[key], DEFAULT_PREFS[key]));
  });
  document.querySelectorAll('.pp-group[data-pref]').forEach(group => {
    group.closest('.settings-glass-row')?.classList.toggle('is-changed', !sameValue(prefs[group.dataset.pref], DEFAULT_PREFS[group.dataset.pref]));
  });
  document.querySelector('.glass-previews[data-group="glass"]')?.closest('.settings-glass-row')?.classList.toggle('is-changed', prefs.glass !== DEFAULT_PREFS.glass);
  document.querySelectorAll('.settings-reset[data-section]').forEach(button => {
    const section = sectionById(button.dataset.section);
    const changed = changedKeys(section?.keys, prefs, DEFAULT_PREFS).length;
    button.disabled = !changed;
    button.querySelector('em').textContent = changed ? 'Reset' : 'Defaults';
    const badge = button.querySelector('.settings-reset-count');
    badge.hidden = !changed; badge.textContent = String(changed);
    button.setAttribute('aria-label', changed ? `Reset ${section.title} to defaults, ${changed} changed` : `${section.title} is at its defaults`);
    const dot = document.querySelector(`.settings-jump [data-section="${button.dataset.section}"] .settings-jump-dot`);
    if (dot) dot.hidden = !changed;
  });
  document.querySelectorAll('.privacy-map li[data-if]').forEach(item => item.classList.toggle('off', !prefs[item.dataset.if]));
  syncPosterPreview();
}

// Glass effects as two live previews: each shows a small lit stage with a panel
// over it, drawn the way that setting draws the site, so the choice is seen
// before it is made. A radio group: arrow keys move between them.
const GLASS_CHOICES = [
  ['rich', 'Rich cinema glass', 'Lit stage, glass panels, moving sheen'],
  ['quiet', 'Quiet and focused', 'Flat, solid surfaces, no motion'],
];
function glassPicker() {
  return `<div class="settings-glass-row"><span><strong id="glassPickerLabel">Glass effects</strong><small>See each look before you choose it.</small></span>
    <div class="glass-previews" role="radiogroup" aria-labelledby="glassPickerLabel" data-group="glass">${GLASS_CHOICES.map(([value, label, note]) => {
      const on = prefs.glass === value;
      return `<button type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" class="glass-preview ${value}${on ? ' on' : ''}" data-action="settings-glass" data-value="${value}">
        <span class="gp-stage" aria-hidden="true"><i class="gp-light a"></i><i class="gp-light b"></i><i class="gp-light c"></i><span class="gp-panel"><i class="gp-sheen"></i><b></b><em></em><em></em><span class="gp-chips"><u></u><u></u></span></span></span>
        <span class="gp-copy"><strong>${label}</strong><small>${note}</small></span>
        <span class="gp-check" aria-hidden="true">${icon('check')}</span>
      </button>`;
    }).join('')}</div></div>`;
}

// Every part of a title's page, grouped, each with its own switch.
function detailPartsPanel() {
  const hidden = new Set(prefs.detailHidden || []);
  const shownCount = DETAIL_PART_GROUPS.reduce((sum, group) => sum + group.parts.filter(([key]) => !hidden.has(key)).length, 0);
  const total = DETAIL_PART_GROUPS.reduce((sum, group) => sum + group.parts.length, 0);
  const groups = DETAIL_PART_GROUPS.map(group => {
    const allShown = group.parts.every(([key]) => !hidden.has(key));
    const parts = group.parts.map(([key, label]) => `<label class="settings-part"><input type="checkbox" data-action="settings-detail-part" data-part="${key}"${hidden.has(key) ? '' : ' checked'}><i aria-hidden="true"></i><span>${esc(label)}</span></label>`).join('');
    return `<div class="settings-parts-group"><div class="settings-parts-head"><b>${esc(group.title)}</b><button data-action="settings-detail-group" data-group="${group.id}" data-show="${allShown ? '0' : '1'}">${allShown ? 'Hide all' : 'Show all'}</button></div><div class="settings-parts-grid">${parts}</div></div>`;
  }).join('');
  return `<section class="settings-panel settings-detail-parts" id="settings-parts" data-section-panel="parts">${panelHead('parts')}
    <div class="settings-parts-summary"><p>Switch off anything you never look at, down to a single fact. Hiding changes only what is shown — nothing about a title is lost.</p><span id="detailPartsCount">${shownCount} of ${total} shown</span>${hidden.size ? '<button data-action="settings-detail-reset">Show everything</button>' : ''}</div>
    ${groups}
  </section>`;
}

export function renderSettings() {
  const ct = $('settingsContent'); if (!ct) return;
  if (!state.user) {
    ct.innerHTML = `<div class="wl-empty" style="padding:40px 20px">${illustration('ticket', { cls: 'empty-art' })}<h3>Sign in to change settings</h3><p>Your experience controls and collection vault live here.</p><br><button class="btn-primary" data-action="open-auth">Sign In</button></div>`;
    return;
  }
  const regionOpts = [...REGIONS].sort((a, b) => a[1].localeCompare(b[1]))
    .map(([code]) => `<option value="${code}" ${code === state.region ? 'selected' : ''}>${esc(regionLabel(code))}</option>`).join('');
  ct.innerHTML = `<div class="settings-shell">
    <section class="settings-premium-hero"><div><span>Experience control</span><h2>Make the universe yours.</h2><p>Fine-tune the look, motion, discovery signals and privacy of CineVerse. Changes apply instantly and sync efficiently to your account.</p></div><b class="settings-hero-art">${illustration('gears')}</b></section>
    ${toolbarHTML()}
    <div class="settings-layout">
      <main>
        <section class="settings-panel" id="settings-appearance" data-section-panel="appearance">${panelHead('appearance')}
          ${previewPicker('theme', 'Theme', 'Cinema dark, paper light, or follow your device. Also in the profile menu.', THEME_CHOICES, prefs.theme, 'settings-theme')}
          ${previewPicker('density', 'Content density', 'Choose roomy cards or fit more on screen.', DENSITY_CHOICES, prefs.density)}
          ${previewPicker('textSize', 'Text size', 'Increase interface text without zooming the page.', TEXT_CHOICES, prefs.textSize)}
          ${glassPicker()}
          ${toggle('lightDrift', 'Moving lights', 'The background lights drift toward where you tap and the way you scroll.', prefs.lightDrift)}
          ${toggle('castMilestones', 'Cast milestones', 'Celebrate when an episode takes you past 10, 20, 30 hours and more with an actor.', prefs.castMilestones)}
          ${toggle('streakMilestones', 'Streak milestones', 'Celebrate 7, 30 and 100 days in a row with something watched, on the day you reach them.', prefs.streakMilestones)}
          ${toggle('ambientColour', 'Title colour', 'Tint each title page’s glow, buttons and progress bars with a colour from its poster.', prefs.ambientColour)}
          ${toggle('highContrast', 'High-contrast type', 'Brighten supporting text and borders for easier reading.', prefs.highContrast)}
          ${toggle('compactNav', 'Compact navigation', 'Use a tighter desktop navigation bar with more breathing room below.', prefs.compactNav)}
        </section>
        <section class="settings-panel poster-controls" id="settings-posters" data-section-panel="posters">${panelHead('posters')}
          ${posterPreview()}
          ${toggle('hidePosterCaptions', 'Hide titles under posters', 'Remove the name, year, and movie or TV label beneath every poster across CineVerse, for a pure artwork wall.', prefs.hidePosterCaptions)}
          ${toggle('cleanHomePosters', 'Clean posters', 'Hide every badge and action from poster artwork, everywhere in CineVerse.', prefs.cleanHomePosters)}
          ${toggle('posterCommunityRating', 'Community rating', 'Show the TMDB score on homepage posters.', prefs.posterCommunityRating)}
          ${toggle('posterPersonalRating', 'Your rating', 'Show your own score on homepage posters.', prefs.posterPersonalRating)}
          ${toggle('posterWatchedMark', 'Watched mark', 'Show the watched check on homepage posters.', prefs.posterWatchedMark)}
          ${toggle('posterListButton', 'Add to list', 'Show the list button when a homepage poster is hovered.', prefs.posterListButton)}
          ${toggle('posterRateButton', 'Quick rating', 'Show the quick-rate button for watched titles.', prefs.posterRateButton)}
          ${toggle('posterMatchBadge', 'Match badge', 'Show personalized match percentages.', prefs.posterMatchBadge)}
          ${toggle('posterProviderLogo', 'Streaming logo', 'Show subscription provider logos.', prefs.posterProviderLogo)}
          ${toggle('posterDismissButton', 'Not interested', 'Show the recommendation dismissal button.', prefs.posterDismissButton)}
          ${toggle('posterPreview', 'Hover previews', 'Expand a poster into a muted landscape trailer when the pointer rests on it. Desktop only.', prefs.posterPreview)}
        </section>
        <section class="settings-panel" id="settings-atmosphere" data-section-panel="atmosphere">${panelHead('atmosphere')}
          ${previewPicker('motion', 'Interface motion', 'Respect your system, force full motion, or reduce it.', MOTION_CHOICES, prefs.motion)}
          ${toggle('autoplay', 'Ambient hero previews', 'Play muted trailer backgrounds where available.', prefs.autoplay)}
          ${toggle('backdropArt', 'Decorative backdrop art', 'Show cinematic artwork behind heroes and profile identity.', prefs.backdropArt)}
          ${toggle('posterTilt', 'Poster depth effect', 'Let posters respond with a subtle premium hover tilt.', prefs.posterTilt)}
          ${toggle('haptics', 'Mobile haptics', 'Use subtle touch feedback for navigation, choices, and completed actions.', prefs.haptics)}
        </section>
        <section class="settings-panel" id="settings-discovery" data-section-panel="discovery">${panelHead('discovery')}
          ${toggle('showRatings', 'Community ratings', 'Show TMDB scores on posters and hero slides.', prefs.showRatings)}
          ${toggle('showWatched', 'Watched artwork marks', 'Show the green watched treatment on posters.', prefs.showWatched)}
          ${toggle('spoilerShield', 'Spoiler shield', 'Blur long summaries until you hover or focus them.', prefs.spoilerShield)}
        </section>
        <section class="settings-panel settings-mature" id="settings-maturity" data-section-panel="maturity">${panelHead('maturity')}
          <details class="settings-mature-disclosure"${prefs.mature ? ' open' : ''}>
            <summary>Mature content${prefs.mature ? ' <b>On</b>' : ''}</summary>
            <div class="settings-mature-body">
              <p>Off by default. While it is off, adult titles are excluded from every search and Discover request and nothing about this appears anywhere in the app.</p>
              ${toggle('mature', 'Show mature content', 'Adds the After Dark hub to Discover, an Adult choice to every genre filter, and includes adult results in search.', prefs.mature)}
              ${prefs.mature ? toggle('matureInRecs', 'Let mature titles shape recommendations', 'Off by default. While it is off, adult titles you save, watch, rate, or open never steer Home, never head a Because-you rail, and are never recommended back. Friends never see them either way.', prefs.matureInRecs) : ''}
              ${prefs.mature ? toggle('matureBlur', 'Blur mature artwork', 'Artwork in After Dark, and in any results filtered to the Adult genre, stays blurred until you hover or focus it.', prefs.matureBlur) : ''}
              <small>Collections are built from TMDB keywords, not a genre — TMDB has no erotic genre. Titles you save can be kept in a PIN-locked list from the + button on any poster.</small>
            </div>
          </details>
        </section>
        <section class="settings-panel" id="settings-details" data-section-panel="details">${panelHead('details')}
          ${toggle('detailBoxOfficeExpanded', 'Open Box Office', 'Show the financial intelligence panel expanded by default.', prefs.detailBoxOfficeExpanded)}
          ${toggle('detailGalleryExpanded', 'Open Gallery', 'Show backdrop and poster artwork expanded by default.', prefs.detailGalleryExpanded)}
          ${toggle('detailReviewsExpanded', 'Open Reviews', 'Show community reviews expanded by default.', prefs.detailReviewsExpanded)}
        </section>
        ${detailPartsPanel()}
        <section class="settings-panel settings-privacy" id="settings-privacy" data-section-panel="privacy">${panelHead('privacy')}
          ${privacyMapHTML()}
          ${toggle('rememberSearch', 'Remember searches', 'Keep recent searches only on this device.', prefs.rememberSearch)}
          ${toggle('rememberViewed', 'Remember recently viewed', 'Save recently opened titles only on this device.', prefs.rememberViewed)}
          ${toggle('discoverable', 'Find me by name', 'Allow signed-in people to find your public profile by name.', prefs.discoverable)}
          ${toggle('shareMilestones', 'Share hours clubs', 'Let friends see your hours-club badges, like 100 hours with an actor. Never which episodes.', prefs.shareMilestones)}
          ${toggle('shareTaste', 'Friend taste matching', 'Let friends compare a derived taste summary, never raw history.', prefs.shareTaste)}
          <div class="settings-privacy-note">Raw ratings, watched history and private lists are never published to friends.</div>
        </section>
      </main>
      <aside>
        <section class="settings-panel settings-region" id="settings-region" data-section-panel="region">${panelHead('region')}<div class="region-now" id="regionNow"><b>${esc(state.region)}</b><span>${esc(regionName(state.region))}</span></div><label class="settings-select-row stacked"><span><strong>Where to Watch region</strong><small>Controls provider availability across details, notifications, and provider intelligence. ${REGIONS.length} countries, from JustWatch via TMDB.</small></span><select id="settingsRegion" class="watched-select" data-action="settings-region">${regionOpts}</select></label></section>
        <section class="settings-panel settings-vault" id="settings-vault" data-section-panel="vault">${panelHead('vault')}${VAULT_STEPS}<p>Download lists, memberships, watched history, ratings and profile showcase data in one readable JSON file.</p><div class="settings-vault-actions"><button class="btn-primary" data-action="download-backup">Download backup</button><button class="btn-glass" data-action="choose-backup">Restore backup</button></div><div class="settings-vault-actions"><button class="btn-glass" data-action="download-watched">Export watched only</button><button class="btn-glass" data-action="choose-watched-import">Import watched only</button></div><div class="settings-vault-actions"><button class="btn-glass" data-action="open-import">Import from Letterboxd, Trakt or IMDb</button></div><small>Every restore safely merges data and never deletes newer cloud records.</small></section>
        <section class="settings-panel settings-maintenance" id="settings-maintenance" data-section-panel="maintenance">${panelHead('maintenance')}<button class="episode-repair-action" data-action="repair-episode-progress"><span><strong>Episode Progress Repair</strong><small data-repair-status>Rebuild old history and refresh tracked shows.</small></span><b>Repair</b></button><button data-action="clear-search-history"><span>Clear search history</span><b>Clear</b></button><button data-action="clear-recent-history"><span>Clear recently viewed</span><b>Clear</b></button><button data-action="refresh-library"><span>Refresh library from cloud</span><b>Refresh</b></button><button data-action="reset-experience"><span>Reset experience settings</span><b>Reset</b></button><button data-action="sign-out"><span>Sign out on this device</span><b>Sign out</b></button></section>
        <section class="settings-panel settings-danger"><span>Danger zone</span><h2>Delete account</h2><p>Permanently remove the account and its private collection.</p><button class="del-confirm" data-action="open-delete">Delete account</button></section>
      </aside>
    </div>
  </div>`;
  syncPreviews();
  watchSections();
  // A redraw (a section reset, the mature switch) keeps an active search applied.
  if (lastSearch) { const input = $('settingsSearch'); if (input) { input.value = lastSearch; searchSettings(lastSearch); } }
}

function clearSearchHistory() {
  state.searchHistory = [];
  if (state.user) { try { localStorage.removeItem('cv_history_' + state.user.uid); } catch (_) {} }
}

export function initSettings() {
  // Search: filters as you type; Enter jumps to the first match, Escape clears.
  document.addEventListener('input', event => {
    if (event.target.id !== 'settingsSearch') return;
    lastSearch = event.target.value;
    searchSettings(lastSearch);
  });
  document.addEventListener('keydown', event => {
    if (event.target.id !== 'settingsSearch') return;
    if (event.key === 'Escape' && event.target.value) { event.preventDefault(); event.stopPropagation(); event.target.value = ''; lastSearch = ''; searchSettings(''); return; }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const first = $('settingsContent')?.querySelector(`.settings-panel:not(.search-hide) :is(${SEARCH_ROWS}):not(.search-hide)`) || $('settingsContent')?.querySelector('.settings-panel:not(.search-hide)');
    if (!first) return;
    first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    first.classList.remove('search-hit'); void first.offsetWidth; first.classList.add('search-hit');
  });
  // The glass previews are a radio group: arrow keys move the choice.
  document.addEventListener('keydown', event => {
    const current = event.target.closest?.('.glass-preview');
    if (!current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const options = [...current.parentElement.querySelectorAll('.glass-preview')];
    const index = options.indexOf(current);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + options.length) % options.length;
    event.preventDefault();
    options[next].click();
  });
  registerActions({
    'settings-region': el => { const now = $('regionNow'); if (now) now.innerHTML = `<b>${esc(el.value)}</b><span>${esc(regionName(el.value))}</span>`; state.region = el.value; try { localStorage.setItem('cv_region', state.region); } catch (_) {} queueCloudSettings(); document.dispatchEvent(new Event('cv:region')); toast('Streaming region updated', 'success'); },
    'settings-toggle': el => {
      const key = el.dataset.pref;
      el.closest('.settings-switch-row')?.classList.toggle('is-on', !!el.checked);
      updatePref(key, !!el.checked);
      if (key === 'rememberSearch' && !el.checked) clearSearchHistory();
      // The panel itself changes shape (the blur option only exists while mature
      // is on). updatePref has already announced `cv:mature`, which is what adds
      // or removes After Dark and the adult filters everywhere else.
      if (key === 'mature' || key === 'matureBlur') {
        if (key === 'mature') { renderSettings(); toast(el.checked ? 'Mature content is on' : 'Mature content is hidden', el.checked ? 'success' : 'info'); }
        else toast(el.checked ? 'Mature artwork blurred' : 'Mature artwork visible', 'info');
        return;
      }
      if (key === 'rememberViewed' && !el.checked) {
        state.recentlyViewed = [];
        try { localStorage.removeItem(`cv_recent_${state.user?.uid || 'guest'}`); } catch (_) {}
      }
      if (key === 'discoverable' || key === 'shareTaste') document.dispatchEvent(new Event('cv:privacy'));
      toast('Preference saved', 'success');
    },
    'settings-detail-part': el => {
      const hidden = new Set(prefs.detailHidden || []);
      if (el.checked) hidden.delete(el.dataset.part); else hidden.add(el.dataset.part);
      updatePref('detailHidden', [...hidden]);
      renderSettings();
      // The panel is redrawn; keep keyboard focus on the switch just used.
      document.querySelector(`[data-action="settings-detail-part"][data-part="${el.dataset.part}"]`)?.focus({ preventScroll: true });
    },
    'settings-detail-group': el => {
      const group = DETAIL_PART_GROUPS.find(entry => entry.id === el.dataset.group);
      if (!group) return;
      const hidden = new Set(prefs.detailHidden || []);
      group.parts.forEach(([key]) => { if (el.dataset.show === '1') hidden.delete(key); else hidden.add(key); });
      updatePref('detailHidden', [...hidden]);
      renderSettings();
      toast(el.dataset.show === '1' ? `${group.title}: all shown` : `${group.title}: all hidden`, 'info');
    },
    'settings-detail-reset': () => { updatePref('detailHidden', []); renderSettings(); toast('Every detail-page part is shown again', 'success'); },
    'settings-glass': el => {
      el.focus();
      const value = el.dataset.value === 'quiet' ? 'quiet' : 'rich';
      if (prefs.glass !== value) updatePref('glass', value);
      el.parentElement.querySelectorAll('.glass-preview').forEach(button => {
        const on = button.dataset.value === value;
        button.classList.toggle('on', on); button.setAttribute('aria-checked', String(on)); button.tabIndex = on ? 0 : -1;
      });
    },
    'settings-pref': el => { updatePref(el.dataset.pref, el.value); toast('Preference saved', 'success'); },
    'settings-jump': el => {
      const panel = document.getElementById(`settings-${el.dataset.section}`);
      if (!panel) return;
      if (panel.classList.contains('search-hide')) { const input = $('settingsSearch'); if (input) input.value = ''; lastSearch = ''; searchSettings(''); }
      spyPausedUntil = Date.now() + 1500;
      markCurrent(el.dataset.section);
      panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
      const art = panel.querySelector('.settings-panel-head');
      art?.classList.remove('search-hit'); void art?.offsetWidth; art?.classList.add('search-hit');
    },
    'settings-reset-section': el => {
      const section = sectionById(el.dataset.section);
      const keys = changedKeys(section?.keys, prefs, DEFAULT_PREFS);
      if (!keys.length) return;
      const privacy = keys.some(key => key === 'discoverable' || key === 'shareTaste');
      const reshape = keys.includes('mature');
      keys.filter(key => key !== 'theme').forEach(key => updatePref(key, DEFAULT_PREFS[key]));
      if (keys.includes('theme')) setTheme(DEFAULT_PREFS.theme, (() => { const box = el.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })());
      if (privacy) document.dispatchEvent(new Event('cv:privacy'));
      if (reshape) renderSettings(); else syncPreviews();
      document.querySelector(`.settings-reset[data-section="${section.id}"]`)?.closest('.settings-panel')?.querySelector('.settings-panel-head')?.focus?.();
      toast(`${section.title}: ${keys.length} setting${keys.length === 1 ? '' : 's'} back to default`, 'success');
    },
    'settings-choice': el => {
      el.focus();
      const key = el.dataset.pref, value = el.dataset.value;
      if (prefs[key] === value) return;
      updatePref(key, value);
      syncPreviews();
      toast('Preference saved', 'success');
    },
    'clear-search-history': () => { clearSearchHistory(); toast('Search history cleared', 'info'); },
    'clear-recent-history': () => { state.recentlyViewed = []; try { localStorage.removeItem(`cv_recent_${state.user?.uid || 'guest'}`); } catch (_) {} toast('Recently viewed cleared', 'info'); },
    'reset-experience': () => { resetPrefs(); document.dispatchEvent(new Event('cv:privacy')); renderSettings(); toast('Experience settings reset', 'success'); },
    'repair-episode-progress': async el => {
      if (!state.user || el.disabled) return;
      const label = el.querySelector('b'), status = el.querySelector('[data-repair-status]');
      el.disabled = true;
      if (label) label.textContent = 'Working…';
      try {
        const result = await repairEpisodeProgress({ onProgress: progress => {
          if (!status || !el.isConnected) return;
          status.textContent = progress.phase === 'refresh'
            ? `Refreshing shows ${progress.completed}/${progress.total}`
            : `Rebuilding history ${progress.completed}/${progress.total}`;
        } });
        if (status) status.textContent = `${result.repaired} histories rebuilt · ${result.refreshed} shows refreshed`;
        document.dispatchEvent(new Event('cv:wl-changed'));
        toast(result.failed ? `Repair finished with ${result.failed} item${result.failed === 1 ? '' : 's'} to retry` : 'Episode progress repaired', result.failed ? 'info' : 'success');
      } catch (error) {
        console.error('episode progress repair', error);
        if (status) status.textContent = 'Could not finish. Your existing progress is safe.';
        toast('Episode repair could not finish — try again', 'error');
      } finally {
        el.disabled = false;
        if (label) label.textContent = 'Repair';
      }
    },
    // The escape hatch for the sign-in cache (js/library-cache.js). Signing in
    // normally skips the collection reads when the version says nothing changed;
    // this drops that snapshot so the next load reads everything again. Kept for
    // the one case a version counter cannot cover — a doubt about it.
    'refresh-library': async (el) => {
      if (!state.user) return;
      const label = el.querySelector('b');
      const before = label ? label.textContent : '';
      if (label) label.textContent = 'Refreshing…';
      el.disabled = true;
      flushLibraryVersion();
      clearLibraryCache(state.user.uid);
      try {
        await Promise.all([loadWatchlist(), loadRatings(), loadWatched(), loadLists(), loadEpisodeProgress(), loadMovieProgress()]);
        document.dispatchEvent(new Event('cv:wl-changed'));
        toast(libraryCacheDisabled() ? 'Library reloaded' : 'Library reloaded from the cloud', 'success');
      } catch (error) {
        console.error('refresh-library', error);
        toast('Could not reach the cloud — try again', 'error');
      } finally {
        el.disabled = false;
        if (label) label.textContent = before;
      }
    },
  });
  document.addEventListener('cv:prefs', event => {
    if (!event.detail?.cloud) queueCloudSettings();
    // A preference changed anywhere (the profile menu's theme switch, another
    // device) moves the matching preview on an open Settings page.
    if (location.pathname === '/settings') syncPreviews();
  });
}
