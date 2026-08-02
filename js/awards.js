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
  return `<a class="award-pill${major ? ' major' : ''}" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"><span>${item.kind === 'win' ? '★' : '◆'}</span><div><strong>${esc(item.label)}</strong><small>${major ? 'Major award' : item.kind === 'win' ? 'Winner' : 'Nominee'}</small></div></a>`;
}

function renderAwards(scope, items) {
  const unique = [...new Map(items.map(item => [`${item.kind}|${item.label}`, item])).values()];
  const wins = unique.filter(x => x.kind === 'win');
  const wonLabels = new Set(wins.map(x => x.label));
  const nominations = unique.filter(x => x.kind === 'nomination' && !wonLabels.has(x.label));
  const featured = [...wins, ...nominations].sort((a, b) => Number(MAJOR.test(b.label)) - Number(MAJOR.test(a.label)) || a.label.localeCompare(b.label)).slice(0, 14);
  if (!featured.length) { scope.remove(); return; }
  scope.hidden = false;
  scope.innerHTML = `<div class="d-sec-title"><span>🏆</span> Awards &amp; Recognition</div>
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
