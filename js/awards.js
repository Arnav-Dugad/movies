// ===== FREE AWARDS DATA (WIKIDATA) =====
// TMDB does not expose awards. Wikidata connects titles to awards using IMDb IDs
// and records both award received (P166) and nominated for (P1411), so no paid
// API key is needed.
import { esc, $ } from './ui.js';

const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const MAJOR = /academy award|oscar|golden globe|bafta|emmy|cannes|venice|sundance|berlin|critics.? choice|screen actors guild|grammy|palme d'or/i;

function cacheKey(imdbId) { return `cv_awards_${imdbId}`; }
function readCache(imdbId) {
  try { const value = JSON.parse(localStorage.getItem(cacheKey(imdbId)) || 'null'); return value && Date.now() - value.ts < CACHE_MS ? value.items : null; }
  catch (_) { return null; }
}
function writeCache(imdbId, items) { try { localStorage.setItem(cacheKey(imdbId), JSON.stringify({ ts: Date.now(), items })); } catch (_) {} }

const AWARD_ART = {
  statue: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="5.5" r="3" fill="currentColor"/><path d="M13 10h6l1.8 8.5-2.7 4.3h-4.2l-2.7-4.3L13 10Z" fill="currentColor"/><path d="M10.5 27h11M13 23h6v4h-6Z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  globe: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="16" cy="13" r="8"/><path d="M8 13h16M16 5c3 2.2 4.2 5 4.2 8S19 18.8 16 21c-3-2.2-4.2-5-4.2-8S13 7.2 16 5ZM16 21v5M11 27h10"/></svg>',
  mask: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 7c6 2 14 2 20 0v8c0 7-4 11-10 12-6-1-10-5-10-12V7Z"/><path d="M10 13c1-1 2-1 3 0M19 13c1-1 2-1 3 0M11 20c3 2 7 2 10 0" stroke-linecap="round"/></svg>',
  wing: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m16 7 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7L16 7Z"/><path d="M10 9 4 5c.4 7 2.8 11 7.5 13M22 9l6-4c-.4 7-2.8 11-7.5 13M16 19v7M12 27h8" stroke-linecap="round"/></svg>',
  palm: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M16 27V9M15.8 12C12 7 8 5 4 5c2 4 5 7 11.8 9M16.2 12C20 7 24 5 28 5c-2 4-5 7-11.8 9M15.7 17C11 13 7 12 4 13c2 3 5 5 11.7 6M16.3 17c4.7-4 8.7-5 11.7-4-2 3-5 5-11.7 6"/></svg>',
  music: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 8v15M12 10l11-3v13"/><ellipse cx="8.5" cy="24" rx="3.5" ry="2.5"/><ellipse cx="19.5" cy="21" rx="3.5" ry="2.5"/></svg>',
  trophy: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 5h12v6c0 5-2.5 8-6 8s-6-3-6-8V5Z"/><path d="M10 8H5c0 5 2 7 6 7M22 8h5c0 5-2 7-6 7M16 19v5M11 27h10M13 24h6" stroke-linecap="round"/></svg>',
  medal: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m10 4 6 9 6-9M16 13a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z"/><path d="m16 17 1.4 2.8 3.1.5-2.2 2.2.5 3-2.8-1.5-2.8 1.5.5-3-2.2-2.2 3.1-.5L16 17Z"/></svg>',
};

function awardArt(item) {
  const label = item.label || '';
  let kind = item.kind === 'win' ? 'trophy' : 'medal';
  if (/academy award|oscar/i.test(label)) kind = 'statue';
  else if (/golden globe/i.test(label)) kind = 'globe';
  else if (/bafta/i.test(label)) kind = 'mask';
  else if (/emmy/i.test(label)) kind = 'wing';
  else if (/cannes|palme d'or|venice|sundance|berlin/i.test(label)) kind = 'palm';
  else if (/grammy/i.test(label)) kind = 'music';
  return `<span class="award-icon award-icon-${kind}" aria-hidden="true">${AWARD_ART[kind]}</span>`;
}

async function fetchAwards(imdbId) {
  const query = `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
  PREFIX wikibase: <http://wikiba.se/ontology#>
  PREFIX bd: <http://www.bigdata.com/rdf#>
  SELECT DISTINCT ?kind ?honor ?honorLabel WHERE {
    ?work wdt:P345 "${imdbId}".
    { ?work wdt:P166 ?honor. BIND("win" AS ?kind) }
    UNION
    { ?work wdt:P1411 ?honor. BIND("nomination" AS ?kind) }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } LIMIT 80`;
  const url = `https://query.wikidata.org/sparql?format=json&origin=*&query=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { Accept: 'application/sparql-results+json' } });
  if (!response.ok) throw new Error(`Wikidata ${response.status}`);
  const data = await response.json();
  return (data.results?.bindings || []).map(row => ({
    kind: row.kind?.value || '', label: row.honorLabel?.value || '', url: row.honor?.value || ''
  })).filter(item => item.label && item.kind);
}

function awardPill(item) {
  const major = MAJOR.test(item.label);
  return `<a class="award-pill${major ? ' major' : ''}" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${awardArt(item)}<div><strong>${esc(item.label)}</strong><small>${major ? 'Major award' : item.kind === 'win' ? 'Winner' : 'Nominee'}</small></div></a>`;
}

function renderAwards(scope, items) {
  const unique = [...new Map(items.map(item => [`${item.kind}|${item.label}`, item])).values()];
  const wins = unique.filter(x => x.kind === 'win');
  const wonLabels = new Set(wins.map(x => x.label));
  const nominations = unique.filter(x => x.kind === 'nomination' && !wonLabels.has(x.label));
  const featured = [...wins, ...nominations].sort((a, b) => Number(MAJOR.test(b.label)) - Number(MAJOR.test(a.label)) || a.label.localeCompare(b.label)).slice(0, 14);
  if (!featured.length) { scope.remove(); return; }
  scope.hidden = false;
  scope.innerHTML = `<div class="d-sec-title awards-title">${awardArt({ label: '', kind: 'win' })}<span>Awards &amp; Recognition</span></div>
    <div class="awards-summary"><div><strong>${wins.length}</strong><span>Recorded wins</span></div><div><strong>${nominations.length}</strong><span>Recorded nominations</span></div><div><strong>${featured.filter(x => MAJOR.test(x.label)).length}</strong><span>Major honours</span></div></div>
    <div class="awards-list">${featured.map(awardPill).join('')}</div>
    <p class="awards-source">Free community data from <a href="https://www.wikidata.org/" target="_blank" rel="noopener noreferrer">Wikidata</a>. Records may vary by title.</p>`;
}

export async function loadAwardsSection(imdbId, scopeId) {
  const scope = $(scopeId);
  if (!scope || !/^tt\d+$/.test(imdbId || '')) { if (scope) scope.remove(); return; }
  try {
    let items = readCache(imdbId);
    if (!items) { items = await fetchAwards(imdbId); writeCache(imdbId, items); }
    if (scope.isConnected) renderAwards(scope, items);
  } catch (error) {
    console.warn('Awards unavailable', error);
    if (scope.isConnected) scope.remove();
  }
}
