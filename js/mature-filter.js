// ===== ADULT FILTER =====
// One definition of "adult" for every filter bar in the app, so Movies, TV,
// Discover, Search, My List, Watched, a person's filmography and a studio page
// can never disagree about the same title.
//
// A title is adult when TMDB flags it `adult`, or when it carries one of the
// verified mature keywords the After Dark collections are built from
// (MATURE_KEYWORDS in config.js). TMDB has no adult genre, so the keywords ARE
// the category.
//
// It is offered as a GENRE, not as a filter of its own: every genre dropdown gains
// "Adult · 18+", every exclude-genre dropdown gains "No Adult", and a genre
// dropdown with no exclude partner gains both, grouped under "Mature". Those
// options exist only while the preference is on, and every read goes through
// adultMode(), which answers "no filter" while it is off — a value left behind
// in a control can never keep filtering.
//
// Two ways to apply it:
//   - Pages that ask TMDB /discover (Movies, TV, Discover Studio, studios) pass
//     it as request parameters, which is exact and costs nothing.
//   - Pages that filter titles they already hold (Search, My List, Watched,
//     filmographies) classify each title. Stored keywords answer most of them;
//     the rest are looked up once and remembered on the device.
import { tmdb, pool } from './api.js';
import { MATURE_KEYWORDS } from './config.js';
import { prefs } from './prefs.js';

export const MATURE_KEYWORD_IDS = new Set(MATURE_KEYWORDS.map(keyword => keyword.id));
// Pipe-separated: TMDB reads `with_keywords` with pipes as OR, and excludes a
// title carrying ANY of the ids in `without_keywords`.
export const MATURE_KEYWORD_QUERY = [...MATURE_KEYWORD_IDS].join('|');

// Watched and saved documents keep only the first 15 keywords a title has
// (watched-meta.js, detail.js). A full slice with no mature keyword therefore
// cannot prove the title has none — the 16th might be one.
export const STORED_KEYWORD_LIMIT = 15;

// The option values a genre dropdown can hold besides real genre ids and names.
// Neither can collide with a TMDB genre id or a genre name.
export const ADULT_GENRE = 'adult';          // "Adult · 18+"  (or "No Adult" in an exclude list)
export const NOT_ADULT_GENRE = 'not-adult';  // "Everything but adult", where no exclude list exists

/** '' (no filter), 'only' or 'hide'. Always '' while mature content is off. */
export function adultMode(value) {
  return prefs.mature && (value === 'only' || value === 'hide') ? value : '';
}

/** A genre dropdown's value with the adult choices removed — what TMDB/genre matching sees. */
export const realGenre = value => (value === ADULT_GENRE || value === NOT_ADULT_GENRE ? '' : (value ?? ''));

/**
 * The adult mode a genre dropdown (and its exclude partner, if any) asks for.
 * Choosing Adult as the genre wins over "No Adult" in the exclude list: the
 * genre is the positive choice, and the pair would otherwise match nothing.
 */
export function adultFromGenre(genre, exclude = '') {
  if (genre === ADULT_GENRE) return adultMode('only');
  if (genre === NOT_ADULT_GENRE || exclude === ADULT_GENRE) return adultMode('hide');
  return '';
}

/**
 * The adult choices to append to a genre dropdown. `kind`:
 *   'genre'   — "Adult · 18+" (the page has a separate exclude dropdown)
 *   'exclude' — "No Adult"
 *   'both'    — both choices under a "Mature" group, for a lone genre dropdown
 */
export function adultGenreOptionsHTML(kind = 'genre', selected = '') {
  if (!prefs.mature) return '';
  const opt = (value, label) => `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`;
  if (kind === 'exclude') return opt(ADULT_GENRE, 'No Adult');
  if (kind === 'both') return `<optgroup label="Mature">${opt(ADULT_GENRE, 'Adult · 18+')}${opt(NOT_ADULT_GENRE, 'Everything but adult')}</optgroup>`;
  return opt(ADULT_GENRE, 'Adult · 18+');
}

/**
 * Add or remove the adult choices on a dropdown that is built once and kept
 * (Movies, TV, Search). Returns true when the selected value had to change —
 * the adult choice was selected and mature content was switched off.
 */
export function syncAdultGenreOptions(select, kind = 'genre') {
  if (!select) return false;
  const present = [...select.querySelectorAll(`option[value="${ADULT_GENRE}"], option[value="${NOT_ADULT_GENRE}"]`)];
  if (prefs.mature) {
    if (!present.length) select.insertAdjacentHTML('beforeend', adultGenreOptionsHTML(kind));
    return false;
  }
  if (!present.length) return false;
  const wasAdult = present.some(option => option.selected);
  select.querySelectorAll('optgroup[label="Mature"]').forEach(group => group.remove());
  present.forEach(option => option.remove());
  if (wasAdult) select.value = '';
  return wasAdult;
}

// ---------- server side: /discover parameters ----------

/**
 * Narrow a /discover request. For callers that set no keyword filter of their
 * own: TMDB cannot express "(these keywords) AND (those keywords)" in one
 * parameter, so a page that already filters by keyword classifies instead.
 */
export function applyAdultParams(params, value) {
  const mode = adultMode(value);
  if (mode === 'only') {
    params.include_adult = true;
    params.with_keywords = MATURE_KEYWORD_QUERY;
  } else if (mode === 'hide') {
    params.include_adult = false;
    params.without_keywords = params.without_keywords
      ? `${params.without_keywords}|${MATURE_KEYWORD_QUERY}`
      : MATURE_KEYWORD_QUERY;
  }
  return params;
}

// ---------- client side: classifying titles ----------

const VERDICTS_KEY = 'cv_mature_titles_v1';
const VERDICTS_LIMIT = 5000;
let verdicts = null;            // Map<"movie_123", 0 | 1>, loaded on first use
const attempted = new Set();    // looked up this page load, whatever the outcome
const inflight = new Map();     // key -> the lookup currently fetching it
let verdictVersion = 0;         // bumps whenever lookups learn something

/** Changes whenever a lookup learns a verdict — part of a cache signature. */
export const matureVerdictVersion = () => verdictVersion;

const titleKey = (type, id) => ((type === 'movie' || type === 'tv') && +id > 0 ? `${type}_${+id}` : '');
const keywordId = keyword => +(keyword && typeof keyword === 'object' ? keyword.id : keyword) || 0;

function store() {
  if (verdicts) return verdicts;
  verdicts = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(VERDICTS_KEY) || '{}');
    if (raw && typeof raw === 'object') {
      Object.entries(raw).forEach(([key, value]) => {
        if (/^(movie|tv)_\d+$/.test(key) && (value === 0 || value === 1)) verdicts.set(key, value);
      });
    }
  } catch (_) { /* unreadable: start empty, it refills */ }
  return verdicts;
}

function persist() {
  const map = store();
  // Oldest verdicts go first; a Map iterates in insertion order.
  while (map.size > VERDICTS_LIMIT) map.delete(map.keys().next().value);
  try { localStorage.setItem(VERDICTS_KEY, JSON.stringify(Object.fromEntries(map))); } catch (_) {}
}

/** Test seam: forget every verdict and every lookup. */
export function resetMatureVerdicts() {
  verdicts = new Map();
  attempted.clear();
  inflight.clear();
  try { localStorage.removeItem(VERDICTS_KEY); } catch (_) {}
}

/**
 * What a stored keyword list proves: true, false, or null for "cannot tell" —
 * no keywords at all, or a list cut at the storage limit without a match.
 */
export function matureFromKeywords(keywords, { complete = false } = {}) {
  if (!Array.isArray(keywords)) return null;
  if (keywords.some(keyword => MATURE_KEYWORD_IDS.has(keywordId(keyword)))) return true;
  if (complete) return false;
  if (!keywords.length) return null;
  return keywords.length >= STORED_KEYWORD_LIMIT ? null : false;
}

/** true (adult), false (not adult) or null (not known yet). */
export function matureStatus(type, id, { adult = false, keywords = null } = {}) {
  const key = titleKey(type, id);
  if (!key) return null;
  if (adult === true) return true;
  const fromKeywords = matureFromKeywords(keywords);
  if (fromKeywords !== null) return fromKeywords;
  const known = store().get(key);
  return known === undefined ? null : known === 1;
}

/** Does a title with this status belong in the results for this mode? */
export function adultPass(status, mode) {
  if (mode === 'only') return status === true;
  // An unclassified title is held back rather than shown: letting it through
  // could put an adult title on a page that asked for none.
  if (mode === 'hide') return status === false;
  return true;
}

// `items` are { type, id, adult?, keywords? }.
const unknownOf = items => {
  const seen = new Set();
  return items.filter(item => {
    const key = titleKey(item?.type, item?.id);
    if (!key || seen.has(key) || matureStatus(item.type, item.id, item) !== null) return false;
    seen.add(key);
    return true;
  });
};

/** Unknown titles nobody has started looking up yet — what to hand resolveMature. */
export const pendingMature = items => unknownOf(items).filter(item => !attempted.has(titleKey(item.type, item.id)));

/** Unknown titles that are waiting to be looked up or being looked up right now. */
export const checkingMature = items => unknownOf(items).filter(item => {
  const key = titleKey(item.type, item.id);
  return !attempted.has(key) || inflight.has(key);
});

/** Titles still unknown after every lookup this page load has made (e.g. offline). */
export const unresolvedMature = items => unknownOf(items).filter(item => attempted.has(titleKey(item.type, item.id)) && !inflight.has(titleKey(item.type, item.id)));

/**
 * Look up every unknown title once, and settle when the answer for all of them
 * is in — including titles another page is already fetching, so two surfaces
 * asking about the same titles never double the requests or return early.
 * Resolves to the number of verdicts learned. Never rejects.
 */
export async function resolveMature(items, { concurrency = 5 } = {}) {
  const unknown = unknownOf(items || []);
  const waiting = [...new Set(unknown.map(item => inflight.get(titleKey(item.type, item.id))).filter(Boolean))];
  const fresh = unknown.filter(item => {
    const key = titleKey(item.type, item.id);
    return !attempted.has(key) && !inflight.has(key);
  });
  let learned = 0;
  if (fresh.length) {
    fresh.forEach(item => attempted.add(titleKey(item.type, item.id)));
    const run = pool(fresh, async item => {
      const data = await tmdb(`/${item.type}/${+item.id}/keywords`, {}, { cache: false });
      const list = data?.keywords || data?.results;
      if (!Array.isArray(list)) return;
      store().set(titleKey(item.type, item.id), matureFromKeywords(list, { complete: true }) ? 1 : 0);
      learned++;
    }, concurrency).finally(() => {
      fresh.forEach(item => inflight.delete(titleKey(item.type, item.id)));
      if (learned) {
        persist();
        verdictVersion++;
        // Recommendations and the friend-visible taste summary exclude adult
        // titles, so newly classified ones change what those may use.
        document.dispatchEvent(new Event('cv:mature-verdicts'));
      }
    });
    fresh.forEach(item => inflight.set(titleKey(item.type, item.id), run));
    waiting.push(run);
  }
  await Promise.all(waiting.map(promise => promise.catch(() => {})));
  return learned;
}

// ---------- change signals ----------

/**
 * Run `fn(on)` when mature content is switched on or off — not when only the
 * artwork blur changes, which `cv:mature` also announces.
 */
export function onMatureToggle(fn) {
  let last = !!prefs.mature;
  document.addEventListener('cv:mature', () => {
    const now = !!prefs.mature;
    if (now === last) return;
    last = now;
    fn(now);
  });
}
