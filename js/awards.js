// ===== FREE AWARDS DATA (WIKIDATA) =====
// TMDB does not expose awards. Wikidata connects titles to awards using IMDb IDs
// and records both award received (P166) and nominated for (P1411), so no paid
// API key is needed.
import { esc, $ } from './ui.js';
import { registerActions } from './events.js';

const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const MAJOR = /academy award|oscar|golden globe|bafta|emmy|cannes|venice|sundance|berlin|critics.? choice|screen actors guild|grammy|palme d'or|tony award|filmfare|national film award|iifa|independent spirit|gotham|c[eé]sar|goya|saturn award|naacp image/i;

// v4 refreshes all entries for the larger, high-resolution mark treatment.
function cacheKey(imdbId) { return `cv_awards_v4_${imdbId}`; }
function readCache(imdbId) {
  try { const value = JSON.parse(localStorage.getItem(cacheKey(imdbId)) || 'null'); return value && Date.now() - value.ts < CACHE_MS ? value.items : null; }
  catch (_) { return null; }
}
function writeCache(imdbId, items) { try { localStorage.setItem(cacheKey(imdbId), JSON.stringify({ ts: Date.now(), items })); } catch (_) {} }

function awardKind(item) {
  const label = item.label || '';
  let kind = item.kind === 'win' ? 'trophy' : 'medal';
  if (/academy award|oscar/i.test(label)) kind = 'statue';
  else if (/golden globe/i.test(label)) kind = 'globe';
  else if (/bafta/i.test(label)) kind = 'mask';
  else if (/emmy/i.test(label)) kind = 'wing';
  else if (/cannes|palme d'or|venice|sundance|berlin/i.test(label)) kind = 'palm';
  else if (/grammy/i.test(label)) kind = 'music';
  else if (/tony award|theatre|theater/i.test(label)) kind = 'stage';
  else if (/screen actors guild|directors guild|writers guild|producers guild/i.test(label)) kind = 'guild';
  else if (/filmfare|iifa|national film award|critics.? choice|independent spirit|gotham|c[eé]sar|goya|saturn award|naacp image/i.test(label)) kind = 'film';
  else if (/festival|jury|audience award|grand prix/i.test(label)) kind = 'laurel';
  return kind;
}

function commonsArt(value) {
  const url = String(value || '').replace(/^http:\/\//, 'https://');
  return /^https:\/\/(commons|upload)\.wikimedia\.org\//i.test(url) ? url : '';
}

function awardMonogram(label = '') {
  const known = [
    [/academy award|oscar/i, 'OSC'], [/golden globe/i, 'GG'], [/bafta/i, 'BAFTA'], [/emmy/i, 'EMMY'],
    [/cannes|palme d'or/i, 'CANNES'], [/venice/i, 'VENICE'], [/sundance/i, 'SUNDANCE'], [/berlin/i, 'BERLIN'],
    [/grammy/i, 'GRAMMY'], [/tony/i, 'TONY'], [/filmfare/i, 'FILMFARE'], [/iifa/i, 'IIFA'],
    [/national film award/i, 'NFA'], [/screen actors guild/i, 'SAG'], [/critics.? choice/i, 'CCA'],
    [/c[eé]sar/i, 'CÉSAR'], [/goya/i, 'GOYA'], [/saturn/i, 'SATURN'], [/gotham/i, 'GOTHAM'],
  ].find(([pattern]) => pattern.test(label));
  if (known) return known[1];
  const initials = label.split(/\s+/).filter(word => word && !/^(the|award|awards|for|best|in|of)$/i.test(word)).slice(0, 3).map(word => word[0]).join('').toUpperCase();
  return initials || 'CV';
}

function awardSeal(item, kind = awardKind(item)) {
  return `<span class="award-seal seal-${kind}" aria-hidden="true"><strong>${esc(awardMonogram(item.label))}</strong><small>HONOUR</small></span>`;
}

function awardArt(item) {
  const kind = awardKind(item), real = commonsArt(item.art);
  if (real) return `<span class="award-icon award-icon-${kind} award-icon-real" data-award-kind="${kind}" aria-hidden="true"><img src="${esc(real)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-award-real></span>`;
  return `<span class="award-icon award-icon-${kind}" data-award-kind="${kind}" aria-hidden="true">${awardSeal(item, kind)}</span>`;
}

async function fetchAwards(imdbId) {
  const query = `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
  PREFIX wikibase: <http://wikiba.se/ontology#>
  PREFIX bd: <http://www.bigdata.com/rdf#>
  SELECT DISTINCT ?kind ?honor ?honorLabel ?logo ?image ?parentLogo ?parentImage ?grandLogo ?grandImage ?issuerLogo ?issuerImage WHERE {
    ?work wdt:P345 "${imdbId}".
    { ?work wdt:P166 ?honor. BIND("win" AS ?kind) }
    UNION
    { ?work wdt:P1411 ?honor. BIND("nomination" AS ?kind) }
    OPTIONAL { ?honor wdt:P154 ?logo. }
    OPTIONAL { ?honor wdt:P18 ?image. }
    OPTIONAL {
      ?honor wdt:P361 ?parent.
      OPTIONAL { ?parent wdt:P154 ?parentLogo. }
      OPTIONAL { ?parent wdt:P18 ?parentImage. }
      OPTIONAL {
        ?parent wdt:P361 ?grandParent.
        OPTIONAL { ?grandParent wdt:P154 ?grandLogo. }
        OPTIONAL { ?grandParent wdt:P18 ?grandImage. }
      }
    }
    OPTIONAL {
      ?honor wdt:P1027 ?issuer.
      OPTIONAL { ?issuer wdt:P154 ?issuerLogo. }
      OPTIONAL { ?issuer wdt:P18 ?issuerImage. }
    }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } LIMIT 120`;
  const url = `https://query.wikidata.org/sparql?format=json&origin=*&query=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { Accept: 'application/sparql-results+json' } });
  if (!response.ok) throw new Error(`Wikidata ${response.status}`);
  const data = await response.json();
  return (data.results?.bindings || []).map(row => ({
    kind: row.kind?.value || '', label: row.honorLabel?.value || '', url: row.honor?.value || '',
    art: row.logo?.value || row.parentLogo?.value || row.grandLogo?.value || row.issuerLogo?.value || row.image?.value || row.parentImage?.value || row.grandImage?.value || row.issuerImage?.value || '',
  })).filter(item => item.label && item.kind);
}

function awardPill(item) {
  const major = MAJOR.test(item.label);
  const real = !!commonsArt(item.art);
  return `<a class="award-pill${major ? ' major' : ''}${real ? ' official-art' : ''}" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${awardArt(item)}<div><strong>${esc(item.label)}</strong><small>${real ? 'Official artwork · ' : ''}${major ? 'Major honour' : item.kind === 'win' ? 'Winner' : 'Nominee'}</small></div></a>`;
}

function renderAwards(scope, items) {
  const byHonor = new Map();
  items.forEach(item => {
    const key = `${item.kind}|${item.label}`, current = byHonor.get(key);
    if (!current || (!current.art && item.art)) byHonor.set(key, item);
  });
  const unique = [...byHonor.values()];
  const wins = unique.filter(x => x.kind === 'win');
  const wonLabels = new Set(wins.map(x => x.label));
  const nominations = unique.filter(x => x.kind === 'nomination' && !wonLabels.has(x.label));
  const featured = [...wins, ...nominations].sort((a, b) => Number(MAJOR.test(b.label)) - Number(MAJOR.test(a.label)) || a.label.localeCompare(b.label)).slice(0, 14);
  if (!featured.length) { scope.remove(); return; }
  scope.hidden = false;
  scope.innerHTML = `<button class="awards-toggle" data-action="toggle-awards" aria-expanded="false">
      <span class="awards-toggle-art">${awardArt({ label: 'CineVerse Honours', kind: 'win' })}</span>
      <span class="awards-toggle-copy"><small>Honours archive</small><strong>Awards &amp; Recognition</strong><em>${wins.length} wins · ${nominations.length} nominations · ${featured.filter(x => MAJOR.test(x.label)).length} major</em></span>
      <span class="awards-toggle-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></span>
    </button>
    <div class="awards-body" hidden>
      <div class="awards-summary"><div><strong>${wins.length}</strong><span>Recorded wins</span></div><div><strong>${nominations.length}</strong><span>Recorded nominations</span></div><div><strong>${featured.filter(x => MAJOR.test(x.label)).length}</strong><span>Major honours</span></div></div>
      <div class="awards-list">${featured.map(awardPill).join('')}</div>
      <p class="awards-source">Free community data from <a href="https://www.wikidata.org/" target="_blank" rel="noopener noreferrer">Wikidata</a>. Records may vary by title.</p>
    </div>`;
  // Real marks never share a layer with generated icons. On a remote-image error,
  // replace the image with one clean fallback instead of revealing artwork below it.
  scope.querySelectorAll('img[data-award-real]').forEach(image => image.addEventListener('error', () => {
    const host = image.closest('.award-icon'); if (!host) return;
    const kind = host.dataset.awardKind || 'trophy', pill = host.closest('.award-pill');
    host.classList.remove('award-icon-real'); host.innerHTML = awardSeal({ label: pill?.querySelector('strong')?.textContent || 'Award' }, kind);
  }, { once: true }));
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

export function initAwards() {
  registerActions({
    'toggle-awards': element => {
      const section = element.closest('.awards-section'), body = section?.querySelector('.awards-body');
      if (!section || !body) return;
      const expanded = element.getAttribute('aria-expanded') !== 'true';
      element.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      section.classList.toggle('expanded', expanded);
      body.hidden = !expanded;
    },
  });
}
