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
    ['episodes', 'Episode tracker'], ['bingeForecast', 'Binge forecast'],
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
