// ===== PERSON PAGE =====
// The old page showed 14 "Known For" cards and 10 directing credits and stopped
// there, which hid most of a working career. This one keeps the whole
// filmography: every department the person is credited in becomes a tab, each
// tab sorts and filters independently, and nothing is truncated beyond a
// show-more page size.
import { tmdb } from './api.js';
import { IMG, PH, genreMap } from './config.js';
import { esc, $ } from './ui.js';
import { buildCard } from './cards.js';
import { registerActions } from './events.js';
import { observeReveals } from './effects.js';
import { state } from './state.js';

let reqGen = 0;              // bumped on every openPerson(); guards a stale fetch
let person = null;           // the last successfully loaded person payload
let credits = { cast: [], crew: [] };
let view = { dept: 'Acting', sort: 'newest', type: 'all', shown: 24 };

const PAGE_SIZE = 24;
const DEPARTMENT_ORDER = ['Acting', 'Directing', 'Writing', 'Production', 'Camera', 'Editing', 'Sound', 'Art', 'Costume & Make-Up', 'Visual Effects', 'Crew'];

const yearOf = credit => +String(credit.release_date || credit.first_air_date || '').slice(0, 4) || 0;
const titleOf = credit => credit.title || credit.name || 'Untitled';
const creditKey = credit => `${credit.media_type || 'movie'}_${credit.id}`;

// One entry per title per department. A person credited three times on the same
// film (writer, producer, director) should appear once per department, not once
// per credit line — otherwise the filmography count is meaningless.
function groupCredits(raw) {
  const groups = new Map();
  const add = (department, credit, role) => {
    if (!credit?.id) return;
    if (!groups.has(department)) groups.set(department, new Map());
    const bucket = groups.get(department);
    const key = creditKey(credit);
    const existing = bucket.get(key);
    if (existing) {
      if (role && !existing.__roles.includes(role)) existing.__roles.push(role);
      return;
    }
    bucket.set(key, { ...credit, __roles: role ? [role] : [] });
  };
  (raw.cast || []).forEach(credit => add('Acting', credit, credit.character));
  (raw.crew || []).forEach(credit => add(credit.department || 'Crew', credit, credit.job));
  return groups;
}

function sortCredits(list, sort) {
  const copy = [...list];
  if (sort === 'newest') return copy.sort((a, b) => (yearOf(b) || -Infinity) - (yearOf(a) || -Infinity));
  if (sort === 'oldest') return copy.sort((a, b) => (yearOf(a) || Infinity) - (yearOf(b) || Infinity));
  if (sort === 'rating') return copy.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
  if (sort === 'title') return copy.sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
  return copy.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
}

function activeCredits(groups) {
  const bucket = groups.get(view.dept);
  let list = bucket ? [...bucket.values()] : [];
  if (view.type !== 'all') list = list.filter(credit => (credit.media_type || 'movie') === view.type);
  return sortCredits(list, view.sort);
}

// A single archive-footage or awards-show credit from decades before the career
// started stretches any time axis over mostly-empty years — TMDB has Nolan at
// the 1953 Oscars, and DiCaprio's record reaches back to 1944. Both charts trim
// to the 2nd-98th percentile of actual credits and say how many fell outside.
// @param {number[]} years  one entry per credit, not per distinct year
// @returns {{first:number,last:number,trimmed:number}|null}
const YEAR_GAP = 8;          // an empty stretch this long is not a working period
function trimmedYearRange(years) {
  const timeline = [...years].filter(Boolean).sort((a, b) => a - b);
  if (!timeline.length) return null;
  let first = timeline[Math.floor(timeline.length * 0.02)];
  let last = timeline[Math.max(0, Math.ceil(timeline.length * 0.98) - 1)];

  // A percentile cannot help a short filmography: at 37 credits the 2nd
  // percentile is still the very first one, so Nolan's 1953 Oscars appearance
  // survived and stretched the axis over forty empty years. Also cut a long
  // empty gap when only a handful of credits sit outside it — a real career has
  // no eight-year hole at its very start or end.
  const inner = timeline.filter(year => year >= first && year <= last);
  const maxCut = Math.max(1, Math.floor(inner.length * 0.1));
  for (let index = 1; index <= maxCut && index < inner.length; index++) {
    if (inner[index] - inner[index - 1] >= YEAR_GAP) first = inner[index];
  }
  for (let step = 1; step <= maxCut && inner.length - 1 - step >= 0; step++) {
    const index = inner.length - step;
    if (inner[index] - inner[index - 1] >= YEAR_GAP) last = inner[index - 1];
  }

  if (!first || !last || last <= first || last - first > 120) return null;
  return { first, last, trimmed: timeline.filter(year => year < first || year > last).length };
}

// ---------- career chart ----------
// One series (titles released per year), so no legend: the caption names it.
// Sequential single hue, hairline baseline, and only the extremes are labelled.
function careerChart(groups) {
  const years = new Map();
  for (const bucket of groups.values()) {
    for (const credit of bucket.values()) {
      const year = yearOf(credit);
      if (year) years.set(year, (years.get(year) || 0) + 1);
    }
  }
  if (years.size < 3) return '';
  const timeline = [];
  for (const [year, count] of years) for (let index = 0; index < count; index++) timeline.push(year);
  const range = trimmedYearRange(timeline);
  if (!range) return '';
  const { first, last, trimmed } = range;
  const span = Array.from({ length: last - first + 1 }, (_, index) => ({ year: first + index, count: years.get(first + index) || 0 }));
  const max = Math.max(...span.map(point => point.count));
  const busiest = span.reduce((best, point) => (point.count > best.count ? point : best), span[0]);
  const bars = span.map(point => `<div class="career-bar${point.count === max ? ' peak' : ''}" style="--career-h:${point.count ? Math.max(8, Math.round(point.count / max * 100)) : 2}%" data-tip="${point.year}: ${point.count} title${point.count === 1 ? '' : 's'}" tabindex="0" role="img" aria-label="${point.year}, ${point.count} title${point.count === 1 ? '' : 's'}"></div>`).join('');
  return `<section class="person-career">
    <div class="person-section-head"><div><span>Career shape</span><h2>Titles per year</h2></div><b>${first} – ${last}</b></div>
    <div class="career-chart" role="group" aria-label="Titles released per year">${bars}</div>
    <div class="career-axis"><span>${first}</span><span class="career-peak">Busiest year ${busiest.year} · ${busiest.count} titles${trimmed ? ` · ${trimmed} archival credit${trimmed === 1 ? '' : 's'} outside this range` : ''}</span><span>${last}</span></div>
  </section>`;
}

// ---------- career arc ----------
// The bar chart above answers "how much did they work". This answers the
// question a deep-dive is actually for: how the work was RECEIVED, and how that
// moved over a career. Every rated title is a point — year across, score up,
// area proportional to how many people voted — over a vote-weighted three-year
// trend line. Titles already in the viewer's library are filled in, so their own
// history reads against the career rather than beside it.
const ARC = { w: 1000, h: 300, padL: 34, padR: 14, padT: 16, padB: 26 };

function arcPoints(groups) {
  const seen = new Map();
  for (const bucket of groups.values()) {
    for (const credit of bucket.values()) {
      const year = yearOf(credit);
      // 50 votes is where TMDB's average stops being one person's opinion.
      if (!year || !(credit.vote_average > 0) || !(credit.vote_count >= 50)) continue;
      const key = creditKey(credit);
      if (!seen.has(key)) seen.set(key, { key, year, score: credit.vote_average, votes: credit.vote_count,
        title: titleOf(credit), id: credit.id, type: credit.media_type || 'movie' });
    }
  }
  return [...seen.values()].sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
}

/** Vote-weighted mean per year, then smoothed over a three-year window. */
function arcTrend(points) {
  const byYear = new Map();
  for (const point of points) {
    const bucket = byYear.get(point.year) || { weight: 0, total: 0 };
    bucket.weight += point.votes; bucket.total += point.score * point.votes;
    byYear.set(point.year, bucket);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  return years.map(year => {
    let weight = 0, total = 0;
    for (const offset of [-1, 0, 1]) {
      const bucket = byYear.get(year + offset);
      if (bucket) { weight += bucket.weight; total += bucket.total; }
    }
    return { year, score: weight ? total / weight : 0 };
  });
}

function careerArc(groups) {
  const all = arcPoints(groups);
  if (all.length < 6) return '';
  const range = trimmedYearRange(all.map(point => point.year));
  if (!range) return '';
  const points = all.filter(point => point.year >= range.first && point.year <= range.last);
  if (points.length < 6) return '';
  const firstYear = range.first, lastYear = range.last;
  if (lastYear <= firstYear) return '';
  const outside = all.length - points.length;
  const scores = points.map(point => point.score);
  const low = Math.max(0, Math.floor(Math.min(...scores) - 0.4));
  const high = Math.min(10, Math.ceil(Math.max(...scores) + 0.4));
  if (high <= low) return '';

  const plotW = ARC.w - ARC.padL - ARC.padR, plotH = ARC.h - ARC.padT - ARC.padB;
  const x = year => ARC.padL + ((year - firstYear) / (lastYear - firstYear)) * plotW;
  const y = score => ARC.padT + (1 - (score - low) / (high - low)) * plotH;
  // Area, not radius, tracks the vote count — a radius scale would exaggerate a
  // blockbuster into ten times the ink it deserves.
  const maxVotes = Math.max(...points.map(point => point.votes));
  const r = votes => 3.2 + Math.sqrt(votes / maxVotes) * 8.5;

  const inLibrary = key => !!(state.watched?.[key] || (state.watchlist || []).some(item => item.id === key));
  const trend = arcTrend(points);
  const line = trend.length > 1
    ? `<polyline class="arc-trend" points="${trend.map(point => `${x(point.year).toFixed(1)},${y(point.score).toFixed(1)}`).join(' ')}" />`
    : '';

  const best = points.reduce((top, point) => (point.score > top.score ? point : top), points[0]);
  const biggest = points.reduce((top, point) => (point.votes > top.votes ? point : top), points[0]);
  const half = Math.floor(points.length / 2);
  const meanOf = list => list.reduce((sum, point) => sum + point.score, 0) / (list.length || 1);
  const early = meanOf(points.slice(0, half)), late = meanOf(points.slice(-half));
  const shift = late - early;
  const direction = Math.abs(shift) < 0.15 ? 'held steady'
    : shift > 0 ? `rose ${shift.toFixed(1)} points` : `fell ${Math.abs(shift).toFixed(1)} points`;
  const mine = points.filter(point => inLibrary(`${point.type}_${point.id}`));

  const gridlines = [];
  for (let score = Math.ceil(low); score <= high; score++) {
    gridlines.push(`<line class="arc-grid" x1="${ARC.padL}" y1="${y(score).toFixed(1)}" x2="${ARC.w - ARC.padR}" y2="${y(score).toFixed(1)}" />`);
    gridlines.push(`<text class="arc-tick" x="${ARC.padL - 7}" y="${(y(score) + 3.4).toFixed(1)}" text-anchor="end">${score}</text>`);
  }

  const dots = points.map(point => {
    const own = inLibrary(`${point.type}_${point.id}`);
    return `<circle class="arc-dot${own ? ' mine' : ''}" cx="${x(point.year).toFixed(1)}" cy="${y(point.score).toFixed(1)}" r="${r(point.votes).toFixed(1)}"
      data-action="open-detail" data-id="${point.id}" data-type="${point.type}" role="button" tabindex="0"
      data-tip="${esc(point.title)} · ${point.year} · ${point.score.toFixed(1)}"
      aria-label="${esc(point.title)}, ${point.year}, scored ${point.score.toFixed(1)} from ${point.votes.toLocaleString()} votes${own ? ', in your library' : ''}"><title>${esc(point.title)} (${point.year}) — ${point.score.toFixed(1)}</title></circle>`;
  }).join('');

  return `<section class="person-arc">
    <div class="person-section-head"><div><span>Career arc</span><h2>How the work landed</h2></div><b>${points.length} rated titles</b></div>
    <div class="arc-plot">
      <svg viewBox="0 0 ${ARC.w} ${ARC.h}" preserveAspectRatio="none" role="img"
        aria-label="Score against year for ${points.length} titles between ${firstYear} and ${lastYear}. The vote-weighted average ${direction} across the career.">
        ${gridlines.join('')}${line}${dots}
      </svg>
    </div>
    <div class="arc-axis"><span>${firstYear}</span>${outside ? `<span class="arc-trimmed">${outside} credit${outside === 1 ? '' : 's'} outside this range</span>` : ''}<span>${lastYear}</span></div>
    <ul class="arc-facts">
      <li><span>Trend</span><strong>${esc(direction)}</strong><small>${early.toFixed(1)} early · ${late.toFixed(1)} late</small></li>
      <li><span>Best received</span><strong>${esc(best.title)}</strong><small>${best.score.toFixed(1)} · ${best.year}</small></li>
      <li><span>Widest reach</span><strong>${esc(biggest.title)}</strong><small>${biggest.votes.toLocaleString()} votes · ${biggest.year}</small></li>
      <li><span>In your library</span><strong>${mine.length} of ${points.length}</strong><small>${mine.length ? `avg ${meanOf(mine).toFixed(1)}` : 'nothing saved yet'}</small></li>
    </ul>
  </section>`;
}

// ---------- header pieces ----------
function externalLinks(ids, homepage) {
  const links = [
    ids?.imdb_id ? ['IMDb', `https://www.imdb.com/name/${ids.imdb_id}/`] : null,
    ids?.instagram_id ? ['Instagram', `https://instagram.com/${ids.instagram_id}`] : null,
    ids?.twitter_id ? ['X', `https://x.com/${ids.twitter_id}`] : null,
    ids?.facebook_id ? ['Facebook', `https://facebook.com/${ids.facebook_id}`] : null,
    homepage ? ['Website', homepage] : null,
  ].filter(Boolean);
  if (!links.length) return '';
  return `<div class="person-links">${links.map(([label, href]) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}<i>↗</i></a>`).join('')}</div>`;
}

function vitalStats(p, groups) {
  const all = [...groups.values()].flatMap(bucket => [...bucket.values()]);
  const rated = all.filter(credit => credit.vote_average > 0 && credit.vote_count > 20);
  const average = rated.length ? rated.reduce((sum, credit) => sum + credit.vote_average, 0) / rated.length : 0;
  const years = all.map(yearOf).filter(Boolean);
  const genres = new Map();
  all.forEach(credit => (credit.genre_ids || []).forEach(id => { if (genreMap[id]) genres.set(genreMap[id], (genres.get(genreMap[id]) || 0) + 1); }));
  const topGenre = [...genres.entries()].sort((a, b) => b[1] - a[1])[0];
  const tiles = [
    ['Credits', String(all.length), `${groups.size} department${groups.size === 1 ? '' : 's'}`],
    years.length ? ['Active', `${Math.min(...years)}–${Math.max(...years)}`, `${new Set(years).size} working years`] : null,
    average ? ['Average score', average.toFixed(1), `across ${rated.length} rated titles`] : null,
    topGenre ? ['Signature genre', topGenre[0], `${topGenre[1]} titles`] : null,
  ].filter(Boolean);
  return `<div class="person-tiles">${tiles.map(([label, value, note]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join('')}</div>`;
}

function photoStrip(images) {
  const profiles = (images?.profiles || []).slice(0, 18);
  if (profiles.length < 2) return '';
  const paths = esc(JSON.stringify(profiles.map(image => image.file_path)));
  return `<section class="person-photos">
    <div class="person-section-head"><div><span>Gallery</span><h2>Photos</h2></div><b>${profiles.length}</b></div>
    <div class="person-photo-row">${profiles.map((image, index) => `<button class="person-photo-item" data-action="open-lightbox" data-paths="${paths}" data-idx="${index}" aria-label="Photo ${index + 1} of ${profiles.length}"><img src="${IMG}w185${image.file_path}" alt="" loading="lazy"></button>`).join('')}</div>
  </section>`;
}

// ---------- filmography ----------
function filmographyHTML(groups) {
  const departments = [...groups.keys()].sort((a, b) => {
    const rankA = DEPARTMENT_ORDER.indexOf(a), rankB = DEPARTMENT_ORDER.indexOf(b);
    return (rankA < 0 ? 99 : rankA) - (rankB < 0 ? 99 : rankB) || a.localeCompare(b);
  });
  if (!departments.length) return '';
  if (!groups.has(view.dept)) view.dept = departments[0];

  const list = activeCredits(groups);
  const visible = list.slice(0, view.shown);
  const tabs = departments.map(department => `<button class="${department === view.dept ? 'active' : ''}" data-action="person-dept" data-dept="${esc(department)}">${esc(department)}<b>${groups.get(department).size}</b></button>`).join('');
  const option = (value, label, current) => `<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`;

  return `<section class="person-filmography" id="personFilmography">
    <div class="person-section-head"><div><span>Complete filmography</span><h2>Every credit</h2><p>Grouped by department, straight from TMDB — nothing is trimmed.</p></div></div>
    <div class="person-tabs" role="tablist" aria-label="Departments">${tabs}</div>
    <div class="person-filters">
      <label><span>Type</span><select data-action="person-type">${option('all', 'Movies + TV', view.type)}${option('movie', 'Movies', view.type)}${option('tv', 'TV', view.type)}</select></label>
      <label><span>Sort</span><select data-action="person-sort">${option('newest', 'Newest first', view.sort)}${option('oldest', 'Oldest first', view.sort)}${option('rating', 'Highest rated', view.sort)}${option('popularity', 'Most popular', view.sort)}${option('title', 'Title A–Z', view.sort)}</select></label>
      <b>${list.length} credit${list.length === 1 ? '' : 's'}</b>
    </div>
    ${visible.length ? `<div class="person-credit-grid">${visible.map(creditCard).join('')}</div>` : '<p class="person-empty">No credits match this filter.</p>'}
    ${list.length > view.shown ? `<div class="person-more"><button class="btn-glass" data-action="person-more">Show ${Math.min(PAGE_SIZE, list.length - view.shown)} more of ${list.length - view.shown}</button></div>` : ''}
  </section>`;
}

function creditCard(credit) {
  const type = credit.media_type || 'movie';
  const role = credit.__roles.filter(Boolean).slice(0, 2).join(' · ');
  return `<div class="person-credit">${buildCard(credit, type)}${role ? `<span class="person-role" title="${esc(credit.__roles.join(' · '))}">${esc(role)}</span>` : ''}</div>`;
}

// ---------- page ----------
// Two different jobs, deliberately kept apart.
//
// "Show more" APPENDS: replacing the whole section made the browser drop its
// scroll anchor and land the reader at the bottom of a freshly rebuilt list,
// which is exactly the wrong reaction to asking for twenty-four more cards.
//
// A department/sort/type change is a genuinely new list, so that one rebuilds —
// and pins the section header to the top, because the reader's place in the old
// list means nothing in the new one.
function appendFilmography() {
  const grid = document.querySelector('.person-credit-grid');
  const groups = groupCredits(credits);
  const list = activeCredits(groups);
  const previous = view.shown;
  view.shown = Math.min(list.length, previous + PAGE_SIZE);
  if (!grid) return renderFilmography();
  const added = list.slice(previous, view.shown);
  grid.insertAdjacentHTML('beforeend', added.map(creditCard).join(''));
  observeReveals(grid);
  const wrap = document.querySelector('.person-more');
  const remaining = list.length - view.shown;
  if (!remaining) { wrap?.remove(); return; }
  const button = wrap?.querySelector('button');
  if (button) button.textContent = `Show ${Math.min(PAGE_SIZE, remaining)} more of ${remaining}`;
}

function renderFilmography({ keepPlace = false } = {}) {
  const host = $('personFilmography');
  if (!host || !person) return;
  const groups = groupCredits(credits);
  host.outerHTML = filmographyHTML(groups);
  const fresh = $('personFilmography');
  observeReveals(fresh);
  if (!keepPlace) requestAnimationFrame(() => fresh?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
}

export async function openPerson(id) {
  const gen = ++reqGen;
  const ct = $('personContent');
  ct.innerHTML = '<div style="text-align:center;padding:100px"><div class="loader-text">Loading...</div></div>';
  document.title = 'Loading… — CineVerse';
  view = { dept: 'Acting', sort: 'newest', type: 'all', shown: PAGE_SIZE };
  try {
    const p = await tmdb(`/person/${id}`, { append_to_response: 'combined_credits,images,external_ids' });
    if (gen !== reqGen) return;
    person = p;
    credits = p.combined_credits || { cast: [], crew: [] };
    document.title = `${p.name} — CineVerse`;

    const groups = groupCredits(credits);
    if (!groups.has(view.dept)) view.dept = [...groups.keys()][0] || 'Acting';

    const photo = p.profile_path ? `${IMG}w342${p.profile_path}` : PH;
    const age = p.birthday ? Math.floor(((p.deathday ? new Date(p.deathday) : new Date()) - new Date(p.birthday)) / (365.25 * 24 * 60 * 60 * 1000)) : '';
    const knownFor = [...groups.values()].flatMap(bucket => [...bucket.values()])
      .filter(credit => credit.poster_path)
      .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
      .filter((credit, index, list) => list.findIndex(other => creditKey(other) === creditKey(credit)) === index)
      .slice(0, 16);

    ct.innerHTML = `
      <div class="person-top">
        <div class="person-photo"><img src="${photo}" alt="${esc(p.name)}" data-ph="${PH}"></div>
        <div class="person-head">
          <h1 class="person-name">${esc(p.name)}</h1>
          <div class="person-dept">${esc(p.known_for_department || '')}${p.place_of_birth ? ` · ${esc(p.place_of_birth)}` : ''}</div>
          <div class="person-stats">
            ${p.birthday ? `<div class="person-stat"><strong>Born</strong> ${new Date(p.birthday).toLocaleDateString()}${age && !p.deathday ? ` (${age})` : ''}</div>` : ''}
            ${p.deathday ? `<div class="person-stat"><strong>Died</strong> ${new Date(p.deathday).toLocaleDateString()}${age ? ` (aged ${age})` : ''}</div>` : ''}
          </div>
          ${externalLinks(p.external_ids, p.homepage)}
          ${p.biography ? `<p class="person-bio" id="personBio">${esc(p.biography)}</p><span class="detail-overview-toggle" id="personBioToggle" data-action="toggle-bio" hidden>Read more</span>` : ''}
        </div>
      </div>
      ${vitalStats(p, groups)}
      ${knownFor.length ? `<section class="person-known"><div class="person-section-head"><div><span>Most seen</span><h2>Known for</h2></div></div><div class="similar-row">${knownFor.map(credit => buildCard(credit, credit.media_type || 'movie')).join('')}</div></section>` : ''}
      ${careerChart(groups)}
      ${careerArc(groups)}
      ${filmographyHTML(groups)}
      ${photoStrip(p.images)}`;

    observeReveals(ct);
    requestAnimationFrame(() => {
      ct.querySelectorAll('.career-bar').forEach(bar => { bar.style.height = bar.style.getPropertyValue('--career-h'); });
      syncBio();
    });
    if (document.fonts?.ready) document.fonts.ready.then(() => requestAnimationFrame(syncBio)).catch(() => {});
  } catch (e) {
    console.error('openPerson', e);
    if (gen !== reqGen) return;
    ct.innerHTML = '<div style="text-align:center;padding:100px 20px"><p style="color:var(--text3)">Failed to load</p><br><button class="btn-primary" data-action="back">Back</button></div>';
  }
}

function syncBio() {
  const bio = $('personBio'), toggle = $('personBioToggle');
  if (!bio || !toggle) return;
  toggle.hidden = !(bio.scrollHeight > bio.clientHeight + 4);
}

export function initPerson() {
  registerActions({
    'open-person': (el, e) => { if (e) e.stopPropagation(); document.dispatchEvent(new CustomEvent('cv:go', { detail: `/person/${+el.dataset.id}` })); },
    'toggle-bio': (el) => {
      const bio = $('personBio'); if (!bio) return;
      const clamped = bio.style.webkitLineClamp !== 'unset';
      bio.style.webkitLineClamp = clamped ? 'unset' : '8';
      el.textContent = clamped ? 'Show less' : 'Read more';
    },
    // Changing any filmography control resets paging: keeping the old offset
    // would drop the reader into the middle of a list they have not seen.
    'person-dept': el => { view.dept = el.dataset.dept; view.shown = PAGE_SIZE; renderFilmography(); },
    'person-sort': el => { view.sort = el.value; view.shown = PAGE_SIZE; renderFilmography(); },
    'person-type': el => { view.type = el.value; view.shown = PAGE_SIZE; renderFilmography(); },
    'person-more': () => appendFilmography(),
  });
}
