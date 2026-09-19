// ===== DETAIL PAGE PARTS =====
// Every piece of a title's page that a viewer can switch off in Settings, down to
// a single fact card. One list, three readers: Settings draws its switches from
// it, prefs.js validates stored choices against it, and the detail template tags
// each element with `data-dp="<key>"` so a hidden part is removed by one rule.
//
// Hiding is presentation only: nothing here changes what is fetched or tracked,
// so switching a part back on is instant and loses nothing.
export const DETAIL_PART_GROUPS = [
  { id: 'header', title: 'Title header', parts: [
    ['tagline', 'Tagline'], ['rating', 'Community rating'], ['year', 'Year'], ['runtime', 'Runtime'],
    ['certificate', 'Age certificate'], ['genres', 'Genres'],
  ] },
  { id: 'actions', title: 'Actions', parts: [
    ['trailerButton', 'Play trailer'], ['listButton', 'Add to list'], ['watchedButton', 'Mark watched'],
    ['rateButton', 'Rate'], ['progressButton', 'Start watching (films)'], ['shareButton', 'Share'],
    ['rewatchStrip', 'Rewatch log'],
  ] },
  { id: 'panels', title: 'Panels', parts: [
    ['movieProgress', 'Film progress'], ['countdown', 'Release countdown'], ['collection', 'Franchise banner'],
    ['overview', 'Overview'], ['boxOffice', 'Box office'], ['whereToWatch', 'Where to watch'],
    ['episodes', 'Episode tracker'], ['seasonHeatmap', 'Season heatmap'], ['bingeForecast', 'Binge forecast'], ['pacingInsight', 'Viewing pattern'],
  ] },
  { id: 'facts', title: 'Facts', parts: [
    ['status', 'Status'], ['language', 'Original language'], ['votes', 'Vote count'], ['director', 'Director or creator'],
    ['seasons', 'Seasons'], ['episodeCount', 'Episode count'], ['networks', 'Networks'], ['studios', 'Studios'],
    ['originalTitle', 'Original title'], ['countries', 'Countries'], ['spokenLanguages', 'Spoken languages'],
    ['alsoKnownAs', 'Also known as'], ['website', 'Website'], ['links', 'External links'],
  ] },
  { id: 'sections', title: 'Sections', parts: [
    ['awards', 'Awards'], ['keywords', 'Keywords'], ['videos', 'Videos & trailers'], ['cast', 'Cast'],
    ['crew', 'Crew'], ['gallery', 'Gallery'], ['reviews', 'Reviews'], ['moreLikeThis', 'More like this'],
  ] },
];

export const DETAIL_PART_KEYS = new Set(DETAIL_PART_GROUPS.flatMap(group => group.parts.map(([key]) => key)));

// ===== THE ORDER OF A TITLE PAGE =====
// The blocks a viewer scrolls through, in the order CineVerse ships them. Each
// is one element in .detail-inner, so putting a page in someone's own order is
// a matter of moving those elements — nothing is re-fetched, nothing is lost,
// and a block switched off above simply is not there to move.
//
// The header (artwork, title, buttons) is not in this list: it is the page's
// anchor, and the countdown and film-progress panels belong with it.
export const DETAIL_BLOCKS = [
  ['collection', 'Franchise banner'],
  ['overview', 'Overview'],
  ['boxOffice', 'Box office'],
  ['whereToWatch', 'Where to watch'],
  ['facts', 'Fact cards'],
  ['awards', 'Awards'],
  ['keywords', 'Keywords'],
  ['videos', 'Videos & trailers'],
  ['cast', 'Cast'],
  ['crew', 'Crew'],
  ['gallery', 'Gallery'],
  ['episodes', 'Episodes & seasons'],
  ['reviews', 'Reviews'],
  ['moreLikeThis', 'More like this'],
];
export const DETAIL_BLOCK_KEYS = DETAIL_BLOCKS.map(([key]) => key);
const blockLabels = new Map(DETAIL_BLOCKS);
/** The name of one block, for a settings row or a live region. */
export const blockLabel = key => blockLabels.get(key) || key;

/**
 * Pure: a stored order cleaned — known keys, each once, in the order given,
 * with anything the stored list never mentioned appended where it shipped.
 * A build that adds a block therefore slots it in rather than dropping it.
 */
export function cleanDetailOrder(value) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    const key = String(raw);
    if (seen.has(key) || !DETAIL_BLOCK_KEYS.includes(key)) continue;
    seen.add(key); out.push(key);
  }
  for (const key of DETAIL_BLOCK_KEYS) if (!seen.has(key)) out.push(key);
  return out;
}

/** Pure: is this the order CineVerse ships? */
export const isDefaultOrder = value => cleanDetailOrder(value).join('|') === DETAIL_BLOCK_KEYS.join('|');

/**
 * Pure: one block moved by `delta` places. A move off either end is no move,
 * so the buttons at the ends are inert rather than wrapping the list around.
 */
export function moveDetailBlock(value, key, delta) {
  const order = cleanDetailOrder(value);
  const from = order.indexOf(key);
  const to = from + (+delta || 0);
  if (from < 0 || to < 0 || to >= order.length || !delta) return order;
  order.splice(to, 0, order.splice(from, 1)[0]);
  return order;
}

/** Pure: a block dropped onto another block's place. */
export function dropDetailBlock(value, key, beforeKey) {
  const order = cleanDetailOrder(value);
  const from = order.indexOf(key);
  if (from < 0 || key === beforeKey) return order;
  const [moved] = order.splice(from, 1);
  const at = beforeKey === null || beforeKey === undefined ? order.length : order.indexOf(beforeKey);
  order.splice(at < 0 ? order.length : at, 0, moved);
  return order;
}

// The fact cards are the one block with no data-dp of its own: they are the
// grid that holds them, each card carrying its own key.
const BLOCK_SELECTORS = { facts: ':scope > .stats-grid' };
const blockSelector = key => BLOCK_SELECTORS[key] || `:scope > [data-dp="${key}"]`;

/**
 * Put an open title page's blocks in the viewer's order.
 * Everything that is not a block — the header, the countdown, the film-progress
 * panel — keeps its place: the blocks are re-laid only across the span they
 * already occupied.
 * @returns {number} how many blocks were placed
 */
export function applyDetailOrder(root, value) {
  const inner = root?.querySelector?.('.detail-inner');
  if (!inner) return 0;
  const order = cleanDetailOrder(value);
  const found = new Map();
  for (const key of order) {
    const el = inner.querySelector(blockSelector(key));
    if (el && el.parentElement === inner) found.set(key, el);
  }
  if (found.size < 2) return 0;
  const nodes = new Set(found.values());
  const first = [...inner.children].find(child => nodes.has(child));
  if (!first) return 0;
  // A marker holds the run's starting place while each block is moved in front
  // of it, so the page never reflows against a moving target.
  const marker = inner.ownerDocument.createComment('cv-detail-order');
  inner.insertBefore(marker, first);
  for (const key of order) { const el = found.get(key); if (el) inner.insertBefore(el, marker); }
  marker.remove();
  return found.size;
}

/** Stored choices, cleaned: known keys only, each once, in catalogue order. */
export function cleanDetailHidden(value) {
  const wanted = new Set(Array.isArray(value) ? value : []);
  return [...DETAIL_PART_KEYS].filter(key => wanted.has(key));
}

/** The stylesheet that hides the chosen parts. Empty when nothing is hidden. */
export function detailHiddenCSS(hidden) {
  const keys = cleanDetailHidden(hidden);
  return keys.length ? `${keys.map(key => `#detailContent [data-dp="${key}"]`).join(',\n')} { display: none !important; }` : '';
}
