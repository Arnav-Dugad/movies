// ===== FILTER STATE IN THE URL =====
// Movies, TV and Discover kept every filter in the DOM alone, so a reload reset
// them and a copied link opened the unfiltered page. Each page now describes its
// filters as `fields` — [param, elementId, defaultValue] — and this module moves
// them between the controls and the query string.
//
// The rules that keep it honest:
//   - Only non-default values are written, so an untouched page keeps a clean
//     URL (/movies, not /movies?sort=popularity.desc&year=).
//   - The URL is rewritten with replaceState, never pushed: changing a filter is
//     not a navigation, and Back should leave the page, not undo a dropdown.
//   - A URL that names ANY of a page's filters is authoritative for all of them:
//     a shared link must show exactly what was shared, not that plus whatever
//     this device happened to have selected. A URL naming none leaves the
//     controls as they are, which is what keeps filters across in-app visits.
//   - A value no option matches (an old link, a genre only offered while mature
//     content is on) falls back to the default instead of selecting nothing.

export const queryParams = () => new URLSearchParams(location.search);

const samePage = pathname => location.pathname.replace(/\/+$/, '') === pathname;

/** Does the current URL name any of these fields (or extra keys)? */
export function urlNamesFilters(fields, extraKeys = [], params = queryParams()) {
  return fields.some(([key]) => params.has(key)) || extraKeys.some(key => params.has(key));
}

/** A control's value, whether it is a select, an input, or a checkbox. */
const valueOf = el => (el?.type === 'checkbox' ? (el.checked ? '1' : '0') : (el?.value ?? ''));

/**
 * Put these controls into the query string of `pathname` — only while that page
 * is the one open. `extra` is { param: value } for state that is not a control;
 * an empty value removes the param. Other params already in the URL are kept,
 * so two sections of one page can each own theirs.
 */
export function writeFilterQuery(pathname, fields, extra = {}) {
  if (!samePage(pathname)) return;
  const params = queryParams();
  fields.forEach(([key, id, fallback = '']) => {
    const el = document.getElementById(id);
    if (!el) return;
    const value = valueOf(el);
    if (value && value !== String(fallback)) params.set(key, value); else params.delete(key);
  });
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== '' && value != null) params.set(key, String(value)); else params.delete(key);
  });
  const search = params.toString();
  const next = `${location.pathname}${search ? `?${search}` : ''}`;
  if (next !== `${location.pathname}${location.search}`) {
    try { history.replaceState(history.state, '', next); } catch (_) { /* sandboxed frames */ }
  }
}

/**
 * Apply the query string to these controls: every field takes the URL's value
 * or its default. `skip` names params the caller applies itself (a select whose
 * options load asynchronously). Returns how many URL values were accepted.
 */
export function applyFilterQuery(fields, { params = queryParams(), skip = [] } = {}) {
  let accepted = 0;
  fields.forEach(([key, id, fallback = '']) => {
    if (skip.includes(key)) return;
    const el = document.getElementById(id);
    if (!el) return;
    const wanted = params.has(key) ? params.get(key) : String(fallback);
    if (el.type === 'checkbox') {
      el.checked = wanted === '1' || (wanted !== '0' && String(fallback) === '1');
      if (params.has(key)) accepted++;
      return;
    }
    el.value = wanted;
    if (el.value !== wanted) el.value = String(fallback);
    else if (params.has(key)) accepted++;
  });
  return accepted;
}
