// ===== FREE AWARDS DATA (WIKIDATA + WIKIMEDIA COMMONS) =====
// TMDB has no awards feed. Wikidata supplies the records and Commons supplies
// real programme artwork. The UI never invents a trophy or an imitation logo.
import { esc, $ } from './ui.js';
import { registerActions } from './events.js';

const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const MAJOR = /academy award|oscar|golden globe|bafta|emmy|cannes|venice|sundance|berlin|critics.? choice|screen actors guild|grammy|palme d'or|tony award|filmfare|national film award|iifa|independent spirit|gotham|c[eé]sar|goya|saturn award|naacp image/i;
const PROGRAMS = [
  ['oscars', /academy award|oscar/i, 'Academy Awards', 'Academy Awards logo'],
  ['golden-globes', /golden globe/i, 'Golden Globes', 'Golden Globe Awards logo'],
  ['bafta', /bafta|british academy film/i, 'BAFTA', 'BAFTA logo'],
  ['emmys', /emmy/i, 'Emmy Awards', 'Emmy Awards logo'],
  ['cannes', /cannes|palme d.or/i, 'Festival de Cannes', 'Festival de Cannes logo'],
  ['venice', /venice film festival/i, 'Venice Film Festival', 'Venice Film Festival logo'],
  ['sundance', /sundance/i, 'Sundance', 'Sundance Film Festival logo'],
  ['berlin', /berlin international|berlinale|golden bear|silver bear/i, 'Berlinale', 'Berlin International Film Festival logo'],
  ['filmfare', /filmfare/i, 'Filmfare Awards', 'Filmfare Awards logo'],
  ['iifa', /iifa/i, 'IIFA Awards', 'IIFA Awards logo'],
  ['national-film', /national film award/i, 'National Film Awards', 'National Film Awards India logo'],
  ['sag', /screen actors guild/i, 'SAG Awards', 'Screen Actors Guild Awards logo'],
  ['critics-choice', /critics.? choice/i, 'Critics Choice Awards', 'Critics Choice Awards logo'],
  ['independent-spirit', /independent spirit/i, 'Independent Spirit Awards', 'Independent Spirit Awards logo'],
  ['grammys', /grammy/i, 'Grammy Awards', 'Grammy Awards logo'],
  ['tonys', /tony award/i, 'Tony Awards', 'Tony Awards logo'],
  ['cesar', /c[eé]sar/i, 'César Awards', 'Cesar Awards logo'],
  ['goya', /goya/i, 'Goya Awards', 'Goya Awards logo'],
  ['saturn', /saturn award/i, 'Saturn Awards', 'Saturn Awards logo'],
  ['gotham', /gotham/i, 'Gotham Awards', 'Gotham Awards logo'],
  ['naacp', /naacp image/i, 'NAACP Image Awards', 'NAACP Image Awards logo'],
];

const cacheKey = imdbId => `cv_awards_v8_${imdbId}`;
function readCache(imdbId) {
  try { const value = JSON.parse(localStorage.getItem(cacheKey(imdbId)) || 'null'); return value && Date.now() - value.ts < CACHE_MS ? value.items : null; }
  catch (_) { return null; }
}
function writeCache(imdbId, items) { try { localStorage.setItem(cacheKey(imdbId), JSON.stringify({ ts: Date.now(), items })); } catch (_) {} }

function commonsArt(value) {
  const url = String(value || '').replace(/^http:\/\//, 'https://');
  return /^https:\/\/(commons|upload)\.wikimedia\.org\//i.test(url) ? url : '';
}

function programmeFor(item) {
  const match = PROGRAMS.find(([, pattern]) => pattern.test(item.label || ''));
  if (match) return { id: match[0], label: match[2], query: match[3], major: true };
  const raw = String(item.label || 'Award');
  const label = raw.split(/:\s|\s+for\s+best\s+/i)[0].trim();
  return { id: `other-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 45)}`, label, query: `${label} award logo`, major: MAJOR.test(raw) };
}

function categoryFor(label, programme) {
  let value = String(label || '').replace(/^(?:academy award|golden globe award|bafta award|primetime emmy award|emmy award|filmfare award|national film award|iifa award)\s*(?:for\s+)?/i, '').trim();
  if (value.toLowerCase().startsWith(programme.label.toLowerCase())) value = value.slice(programme.label.length).replace(/^\s*[:–—-]?\s*/, '');
  value = value.replace(/^award\s*(?:for\s+)?/i, '').trim();
  return value && value.toLowerCase() !== programme.label.toLowerCase() ? value : '';
}

async function commonsLogo(programme) {
  const key = `cv_award_logo_v3_${programme.id}`;
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null');
    if (cached && Date.now() - cached.ts < 30 * CACHE_MS) return cached.url || '';
  } catch (_) {}
  try {
    const params = new URLSearchParams({ action: 'query', format: 'json', origin: '*', generator: 'search', gsrnamespace: '6', gsrlimit: '18', gsrsearch: programme.query, prop: 'imageinfo', iiprop: 'url', iiurlwidth: '512' });
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
    if (!response.ok) throw new Error(response.status);
    const pages = Object.values((await response.json()).query?.pages || {});
    const programmeWords = programme.label.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 3 && !/award|festival/.test(word));
    const score = page => {
      const title = String(page.title || '').toLowerCase();
      let value = programmeWords.reduce((sum, word) => sum + (title.includes(word) ? 4 : 0), 0);
      if (/logo|wordmark/i.test(title)) value += 14;
      if (/emblem|mark|identity/i.test(title)) value += 6;
      if (/official/i.test(title)) value += 3;
      if (/\.svg$/i.test(title)) value += 5;
      if (/\b(19|20)\d{2}\b|ceremony|red.?carpet|winner|arrival|poster|photograph|trophy presentation/i.test(title)) value -= 18;
      return value;
    };
    const suitable = pages.filter(page => /\.(svg|png|webp|jpe?g)$/i.test(page.title || '')).sort((a, b) => score(b) - score(a));
    const winner = suitable.find(page => score(page) >= 10);
    const info = winner?.imageinfo?.[0];
    const url = commonsArt(info?.thumburl || info?.url || '');
    try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), url })); } catch (_) {}
    return url;
  } catch (_) { return ''; }
}

async function fetchAwards(imdbId) {
  const query = `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
  PREFIX p: <http://www.wikidata.org/prop/>
  PREFIX ps: <http://www.wikidata.org/prop/statement/>
  PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
  PREFIX wikibase: <http://wikiba.se/ontology#>
  PREFIX bd: <http://www.bigdata.com/rdf#>
  SELECT DISTINCT ?kind ?honor ?honorLabel ?date ?logo ?image ?parentLogo ?parentImage ?grandLogo ?grandImage ?issuerLogo ?issuerImage WHERE {
    ?work wdt:P345 "${imdbId}".
    { ?work p:P166 ?statement. ?statement ps:P166 ?honor. BIND("win" AS ?kind) }
    UNION { ?work p:P1411 ?statement. ?statement ps:P1411 ?honor. BIND("nomination" AS ?kind) }
    OPTIONAL { ?statement pq:P585 ?statementDate. }
    OPTIONAL { ?honor wdt:P585 ?honorDate. }
    OPTIONAL { ?honor wdt:P154 ?logo. } OPTIONAL { ?honor wdt:P18 ?image. }
    OPTIONAL { ?honor wdt:P361 ?parent. OPTIONAL { ?parent wdt:P154 ?parentLogo. } OPTIONAL { ?parent wdt:P18 ?parentImage. } OPTIONAL { ?parent wdt:P585 ?parentDate. }
      OPTIONAL { ?parent wdt:P361 ?grandParent. OPTIONAL { ?grandParent wdt:P154 ?grandLogo. } OPTIONAL { ?grandParent wdt:P18 ?grandImage. } OPTIONAL { ?grandParent wdt:P585 ?grandDate. } } }
    OPTIONAL { ?honor wdt:P1027 ?issuer. OPTIONAL { ?issuer wdt:P154 ?issuerLogo. } OPTIONAL { ?issuer wdt:P18 ?issuerImage. } }
    BIND(COALESCE(?statementDate, ?honorDate, ?parentDate, ?grandDate) AS ?date)
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } LIMIT 160`;
  const response = await fetch(`https://query.wikidata.org/sparql?format=json&origin=*&query=${encodeURIComponent(query)}`, { headers: { Accept: 'application/sparql-results+json' } });
  if (!response.ok) throw new Error(`Wikidata ${response.status}`);
  const data = await response.json();
  return (data.results?.bindings || []).map(row => ({
    kind: row.kind?.value || '', label: row.honorLabel?.value || '', url: row.honor?.value || '',
    date: row.date?.value || '',
    logoArt: row.logo?.value || row.parentLogo?.value || row.grandLogo?.value || row.issuerLogo?.value || '',
    imageArt: row.image?.value || row.parentImage?.value || row.grandImage?.value || row.issuerImage?.value || '',
  })).filter(item => item.label && item.kind);
}

function uniqueAwards(items) {
  const deduped = new Map();
  items.forEach(item => {
    const key = `${item.kind}|${item.label}`, old = deduped.get(key);
    if (!old || (!old.logoArt && item.logoArt)) deduped.set(key, item);
  });
  const wonLabels = new Set([...deduped.values()].filter(item => item.kind === 'win').map(item => item.label));
  return [...deduped.values()].filter(item => item.kind !== 'nomination' || !wonLabels.has(item.label));
}

async function groupAwards(items) {
  const unique = uniqueAwards(items);
  const groups = new Map();
  unique.forEach(item => {
    const programme = programmeFor(item);
    if (!groups.has(programme.id)) groups.set(programme.id, { ...programme, items: [], wins: 0, nominations: 0, art: '' });
    const group = groups.get(programme.id);
    group.items.push(item); group[item.kind === 'win' ? 'wins' : 'nominations']++;
    if (!group.art) group.art = commonsArt(item.logoArt);
  });
  const rows = [...groups.values()].sort((a, b) => Number(b.major) - Number(a.major) || b.wins - a.wins || b.items.length - a.items.length || a.label.localeCompare(b.label)).slice(0, 12);
  await Promise.all(rows.map(async row => { row.art = await commonsLogo(row) || row.art; }));
  return rows;
}

function awardTimeline(items) {
  const years = new Map();
  uniqueAwards(items).forEach(item => {
    const match = String(item.date || item.label || '').match(/\b(19|20)\d{2}\b/);
    const key = match ? match[0] : 'Undated';
    if (!years.has(key)) years.set(key, { key, wins: 0, nominations: 0 });
    years.get(key)[item.kind === 'win' ? 'wins' : 'nominations']++;
  });
  const rows = [...years.values()].sort((a, b) => a.key === 'Undated' ? 1 : b.key === 'Undated' ? -1 : +a.key - +b.key);
  if (!rows.length) return '';
  return `<div class="award-timeline" aria-label="Awards timeline">${rows.map(row => `<div><time>${row.key}</time><span>${row.wins ? `<b>${row.wins}</b> win${row.wins === 1 ? '' : 's'}` : ''}${row.wins && row.nominations ? '<i>·</i>' : ''}${row.nominations ? `<em>${row.nominations} nom${row.nominations === 1 ? '' : 's'}</em>` : ''}</span></div>`).join('')}</div>`;
}

function programmeMark(group, compact = false) {
  if (group.art) return `<span class="award-programme-mark${compact ? ' compact' : ''}"><img src="${esc(group.art)}" alt="${esc(group.label)} logo" loading="lazy" referrerpolicy="no-referrer" data-award-logo><span>${esc(group.label)}</span></span>`;
  return `<span class="award-programme-mark wordmark${compact ? ' compact' : ''}"><span>${esc(group.label)}</span></span>`;
}

function programmeCard(group) {
  const categories = [...new Set(group.items.map(item => categoryFor(item.label, group)).filter(Boolean))].slice(0, 5);
  return `<article class="award-programme-card${group.major ? ' major' : ''}">
    ${programmeMark(group)}
    <div class="award-programme-copy"><h3>${esc(group.label)}</h3><p>${group.wins ? `<b>${group.wins} win${group.wins === 1 ? '' : 's'}</b>` : ''}${group.wins && group.nominations ? '<i>·</i>' : ''}${group.nominations ? `<span>${group.nominations} nomination${group.nominations === 1 ? '' : 's'}</span>` : ''}</p>${categories.length ? `<div class="award-categories">${categories.map(category => `<span>${esc(category)}</span>`).join('')}</div>` : ''}</div>
  </article>`;
}

async function renderAwards(scope, items) {
  const groups = await groupAwards(items);
  if (!groups.length || !scope.isConnected) { scope.remove(); return; }
  const wins = groups.reduce((sum, group) => sum + group.wins, 0);
  const nominations = groups.reduce((sum, group) => sum + group.nominations, 0);
  scope.hidden = false;
  scope.innerHTML = `<button class="awards-toggle" data-action="toggle-awards" aria-expanded="false">
      <span class="awards-logo-stack">${groups.slice(0, 3).map(group => programmeMark(group, true)).join('')}</span>
      <span class="awards-toggle-copy"><strong>Awards</strong><em>${wins} wins · ${nominations} nominations</em></span>
      <span class="awards-toggle-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></span>
    </button>
    <div class="awards-body" hidden>${awardTimeline(items)}<div class="awards-list">${groups.map(programmeCard).join('')}</div><a class="awards-source" href="https://www.wikidata.org/" target="_blank" rel="noopener noreferrer">Wikidata</a></div>`;
  scope.querySelectorAll('img[data-award-logo]').forEach(image => image.addEventListener('error', () => {
    const mark = image.closest('.award-programme-mark'); if (!mark) return;
    mark.classList.add('wordmark'); mark.innerHTML = `<span>${esc(image.alt.replace(/ logo$/i, ''))}</span>`;
  }, { once: true }));
}

export async function loadAwardsSection(imdbId, scopeId) {
  const scope = $(scopeId);
  if (!scope || !/^tt\d+$/.test(imdbId || '')) { if (scope) scope.remove(); return; }
  try {
    let items = readCache(imdbId);
    if (!items) { items = await fetchAwards(imdbId); writeCache(imdbId, items); }
    if (scope.isConnected) await renderAwards(scope, items);
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
      element.setAttribute('aria-expanded', String(expanded));
      section.classList.toggle('expanded', expanded); body.hidden = !expanded;
    },
  });
}
