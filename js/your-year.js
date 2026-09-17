// ===== YOUR YEAR (/year, /year/2026, /year/2026?month=8) =====
// The film card and the series card side by side, each drawing itself when it
// scrolls into view, above a combined total: every film you watched and every
// series you finished that year, the hours across both, and one month chart
// that stacks the two. A month can be opened (the monthly recap notification
// links straight to one) to list exactly what made it up.
//
// The page reuses the cards' own summaries and drawing (js/films-year.js,
// js/series-year.js), so its numbers always match the cards you share. The
// combined hours say what they are: this year's film viewings plus the whole
// runs of the series finished this year. Adult titles never appear.
//
// Beyond the cards: the totals count up the first time they come into view,
// each says how it compares with the year before, and a highlights row picks
// out the year's moments (first and latest watch, top rated, biggest run) and
// the genres of its films.
import { state } from './state.js';
import { $, esc } from './ui.js';
import { icon } from './icons.js';
import { IMG, PH, genreMap } from './config.js';
import { registerActions } from './events.js';
import { formatDuration } from './season-recap.js';
import { keyIsMature } from './recommend.js';
import { completedSeries } from './profile.js';
import { filmsYear, filmYears, filmsCardArt, viewingDates } from './films-year.js';
import { seriesYear, finishYears, seriesCardArt } from './series-year.js';
import { busiestMonths } from './year-card.js';
import { illustration } from './illustrations.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map(name => name.slice(0, 3));
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

let generation = 0;
let watcher = null;
let openArts = [];
let focusMonth = -1;     // 0–11 while a month is open
const countedYears = new Set();   // totals already counted up this visit
const drawnCards = new Set();     // cards already animated this visit (redrawn still)

/** Completed shelf rows that may appear on a shared card. */
export const shareableSeries = (rows = completedSeries()) => rows.filter(show => !keyIsMature(`tv_${show.id}`));

/** Pure: every year with a film viewing or a finished series, newest first. */
export function yearChoices(watched, finished, { exclude = () => false } = {}) {
  return [...new Set([...filmYears(watched, { exclude }), ...finishYears(finished)])].sort((a, b) => b - a);
}

/** Pure: which year to show when the address names none (or a year with nothing in it). */
export function pickYear(requested, years, now = new Date()) {
  if (requested) return +requested;
  const current = now.getFullYear();
  return years.includes(current) || !years.length ? current : years[0];
}

/** Pure: the combined total for a film summary and a series summary of the same year. */
export function combineYear(films, series) {
  const byMonth = films.byMonth.map((count, index) => count + series.byMonth[index]);
  const busiest = busiestMonths(byMonth);
  return {
    year: films.year,
    titles: films.count + series.count,
    films: films.count, series: series.count,
    viewings: films.plays, episodes: series.episodes,
    minutes: films.minutes + series.minutes,
    byMonth, filmMonths: films.byMonth, seriesMonths: series.byMonth,
    busiest, busiestCount: busiest.length ? byMonth[busiest[0]] : 0,
  };
}

/**
 * Pure: what one month of a year was made of. `month` is 0–11.
 * Films carry their viewings in that month; series are the ones finished in it.
 */
export function monthItems(watched, films, series, month) {
  const inMonth = at => { const date = new Date(at); return date.getFullYear() === films.year && date.getMonth() === month; };
  return {
    films: films.films
      .map(film => ({ kind: 'movie', id: film.id, title: film.title, poster: film.poster, rating: film.rating, plays: viewingDates(watched?.[film.key]).filter(inMonth).length }))
      .filter(item => item.plays),
    series: series.shows
      .filter(show => inMonth(show.finishedAt))
      .map(show => ({ kind: 'tv', id: show.id, title: show.title, poster: show.poster, episodes: show.episodes })),
  };
}

/**
 * Pure: how a year compares with the one before, per figure: { films, series, minutes }
 * each { diff, label, dir } where dir is 'up', 'down' or 'same'; null with no earlier data.
 */
export function yearDelta(current, previous) {
  if (!previous?.titles) return null;
  const one = (now, before, format) => {
    const diff = now - before;
    return { diff, dir: diff > 0 ? 'up' : diff < 0 ? 'down' : 'same', label: diff ? `${diff > 0 ? '+' : '−'}${format(Math.abs(diff))} vs ${previous.year}` : `same as ${previous.year}` };
  };
  return {
    films: one(current.films, previous.films, String),
    series: one(current.series, previous.series, String),
    minutes: one(current.minutes, previous.minutes, value => formatDuration(value) || '0m'),
  };
}

/** Pure: the year's moments, each { label, note, kind, id, title, poster }. */
export function yearHighlights(watched, films, series) {
  const inYear = at => new Date(at).getFullYear() === films.year;
  const dated = [
    ...films.films.flatMap(film => viewingDates(watched?.[film.key]).filter(inYear).map(at => ({ kind: 'movie', id: film.id, title: film.title, poster: film.poster, at }))),
    ...series.shows.map(show => ({ kind: 'tv', id: show.id, title: show.title, poster: show.poster, at: show.finishedAt })),
  ].sort((a, b) => a.at - b.at);
  const day = at => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const out = [];
  if (dated.length) out.push({ label: 'First of the year', note: day(dated[0].at), ...dated[0] });
  if (dated.length > 1) out.push({ label: 'Most recent', note: day(dated.at(-1).at), ...dated.at(-1) });
  if (films.topRated) out.push({ label: 'Top rated', note: `${films.topRated.rating}/10`, kind: 'movie', id: films.topRated.id, title: films.topRated.title, poster: films.topRated.poster });
  if (series.biggest) out.push({ label: 'Biggest run', note: plural(series.biggest.episodes, 'episode'), kind: 'tv', id: series.biggest.id, title: series.biggest.title, poster: series.biggest.poster });
  if (films.rewatched) out.push({ label: 'Most rewatched', note: plural(films.rewatched.plays, 'viewing'), kind: 'movie', id: films.rewatched.id, title: films.rewatched.title, poster: films.rewatched.poster });
  else if (series.fastest) out.push({ label: 'Fastest finish', note: plural(series.fastest.spanDays, 'day'), kind: 'tv', id: series.fastest.id, title: series.fastest.title, poster: series.fastest.poster });
  return out.map(({ at, ...moment }) => moment);
}

/** Pure: the year's films by genre, most first: [{ name, count, share }]. */
export function topGenres(films, limit = 5) {
  const counts = new Map();
  for (const film of films.films) for (const id of new Set(film.genres)) if (genreMap[id]) counts.set(genreMap[id], (counts.get(genreMap[id]) || 0) + 1);
  const list = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
  const top = list[0]?.[1] || 1;
  return list.map(([name, count]) => ({ name, count, share: count / top }));
}

/** The page's two summaries for a requested year (0 = pick one). */
function summaries(requested) {
  const finished = shareableSeries();
  const years = yearChoices(state.watched, finished, { exclude: keyIsMature });
  const year = pickYear(requested, years);
  const summary = y => ({ films: filmsYear(state.watched, y, { ratings: state.ratings, exclude: keyIsMature }), series: seriesYear(finished, y) });
  const now = summary(year), before = summary(year - 1);
  return { years, year, ...now, previous: combineYear(before.films, before.series) };
}

function releaseArts() {
  watcher?.disconnect(); watcher = null;
  for (const art of openArts) { art.alive = false; if (!art.running) art.close?.(); }
  openArts = [];
}

// ---------- markup ----------
function heroHTML(year, years, total) {
  const chips = years.length > 1 || (years.length && years[0] !== year)
    ? `<nav class="year-chips" aria-label="Choose a year">${[...new Set([...years, year])].sort((a, b) => b - a).map(value => `<a href="/year/${value}" data-action="year-pick" data-year="${value}"${value === year ? ' aria-current="page" class="on"' : ''}>${value}</a>`).join('')}</nav>`
    : '';
  const summary = total.titles
    ? `${plural(total.films, 'film')} and ${total.series} finished series, month by month.`
    : 'Nothing marked for this year yet. Films you watch and series you finish will gather here.';
  return `<header class="year-hero">
    <div class="year-hero-copy">
      <span class="year-eyebrow">${icon('calendar')} Your year</span>
      <h1><em>${year}</em> on CineVerse</h1>
      <p>${esc(summary)}</p>
      ${chips}
    </div>
    <div class="year-hero-art">${illustration('year')}</div>
  </header>`;
}

function chartHTML(total, focus) {
  const top = Math.max(1, ...total.byMonth);
  const busiest = new Set(total.busiest);
  const bars = total.byMonth.map((count, index) => {
    const films = total.filmMonths[index], series = total.seriesMonths[index];
    const label = `${MONTHS[index]}: ${plural(films, 'film viewing')}, ${series} series finished`;
    return `<button type="button" class="year-bar${busiest.has(index) ? ' busiest' : ''}${focus === index ? ' on' : ''}" data-action="year-month" data-month="${index + 1}" aria-label="${esc(label)}" aria-pressed="${focus === index}"${count ? '' : ' disabled'} style="--i:${index}">
      <span class="year-bar-stack" style="--h:${(count / top * 100).toFixed(2)}%">
        ${series ? `<i class="series" style="flex-grow:${series}"></i>` : ''}${films ? `<i class="films" style="flex-grow:${films}"></i>` : ''}
      </span>
      <b>${count || ''}</b><small>${SHORT[index]}</small>
    </button>`;
  }).join('');
  return `<div class="year-chart" role="group" aria-label="Films and finished series by month">
    <div class="year-legend"><span><i class="films"></i>Film viewings</span><span><i class="series"></i>Series finished</span></div>
    <div class="year-bars">${bars}</div>
  </div>`;
}

// A number that counts up renders as 0 and carries its final value; one that
// does not (seen already, or reduced motion) renders final.
const countAttr = (value, kind, counting) => (counting && value ? ` data-count="${value}" data-count-kind="${kind}"` : '');
const countText = (value, kind, counting) => (counting && value ? (kind === 'minutes' ? '0m' : '0') : kind === 'minutes' ? (formatDuration(value) || '—') : String(value));

function totalHTML(total, delta, counting) {
  const chip = change => (change ? `<em class="year-delta ${change.dir}">${esc(change.label)}</em>` : '');
  const figures = [
    ['Films', total.films, 'count', total.viewings > total.films ? `${plural(total.viewings, 'viewing')} with rewatches` : 'watched', delta?.films],
    ['Series', total.series, 'count', total.episodes ? `${plural(total.episodes, 'episode')} across those runs` : 'finished', delta?.series],
    ['Watch time', total.minutes, 'minutes', 'films + finished runs', delta?.minutes],
  ];
  const busiest = total.busiest.length ? total.busiest.map(index => SHORT[index]).join(' · ') : '—';
  const heading = `${total.titles} ${total.titles === 1 ? 'title' : 'titles'} in ${total.year}`;
  return `<section class="year-total" aria-labelledby="yearTotalHead">
    <div class="year-total-head">
      <div><span>Combined total</span><h2 id="yearTotalHead" aria-label="${esc(heading)}"><strong${countAttr(total.titles, 'count', counting)}>${countText(total.titles, 'count', counting)}</strong> ${total.titles === 1 ? 'title' : 'titles'} in ${total.year}</h2></div>
    </div>
    <div class="year-figures">${figures.map(([label, value, kind, note, change]) => `<div class="year-figure"><span>${label}</span><strong${countAttr(value, kind, counting)}>${esc(countText(value, kind, counting))}</strong><small>${esc(note)}</small>${chip(change)}</div>`).join('')}<div class="year-figure"><span>Busiest month</span><strong>${esc(busiest)}</strong><small>${esc(total.busiestCount ? plural(total.busiestCount, 'viewing or finish', 'viewings and finishes') : 'nothing marked yet')}</small></div></div>
    ${chartHTML(total, focusMonth)}
  </section>`;
}

function highlightsHTML(moments, genres, year) {
  if (!moments.length) return '';
  const momentList = moments.map((moment, index) => `<li style="--i:${index}"><a href="/${moment.kind}/${moment.id}" data-action="open-detail" data-id="${moment.id}" data-type="${moment.kind}">
      <img src="${moment.poster ? `${IMG}w185${moment.poster}` : PH}" alt="" loading="lazy" data-ph="${PH}">
      <span><em>${esc(moment.label)}</em><b>${esc(moment.title)}</b><small>${esc(moment.note)}</small></span></a></li>`).join('');
  const genreList = genres.map((genre, index) => `<li style="--i:${index}"><span>${esc(genre.name)}</span><i aria-hidden="true"><b style="--w:${Math.round(genre.share * 100)}%"></b></i><strong>${genre.count}</strong></li>`).join('');
  return `<section class="year-highlights${genres.length ? '' : ' solo'}">
    <div class="year-moments">
      <header><span>Highlights</span><h2>${year} in moments</h2></header>
      <ol class="year-moment-list">${momentList}</ol>
    </div>
    ${genres.length ? `<div class="year-genres">
      <header><span>Films by genre</span><h2>Your genres</h2></header>
      <ol class="year-genre-list" aria-label="Films watched per genre">${genreList}</ol>
    </div>` : ''}
  </section>`;
}

function reducedMotion() {
  const root = document.documentElement;
  return root.dataset.motion === 'reduced' || (root.dataset.motion !== 'full' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

// Counts every [data-count] in the totals from 0 once they scroll into view.
function countUp(section) {
  const numbers = [...section.querySelectorAll('[data-count]')];
  if (!numbers.length) return;
  const run = () => numbers.forEach((el, index) => {
    const target = +el.dataset.count, minutes = el.dataset.countKind === 'minutes';
    // Writing the text node's data (not textContent) changes no child list, so
    // DOM observers elsewhere are not woken on every frame.
    if (!el.firstChild) el.textContent = '0';
    const show = value => { el.firstChild.data = minutes ? (formatDuration(value) || '0m') : String(value); };
    const delay = index * 90, duration = 1100 + Math.min(600, target * 8);
    let start = 0;
    const frame = now => {
      if (!el.isConnected) return;
      if (!start) start = now + delay;
      const t = Math.max(0, Math.min(1, (now - start) / duration));
      show(Math.round(target * easeOutCubic(t)));
      if (t < 1) requestAnimationFrame(frame);
      else el.classList.add('counted');
    };
    requestAnimationFrame(frame);
  });
  if (!('IntersectionObserver' in window)) { run(); return; }
  const seen = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    seen.disconnect();
    run();
  }, { threshold: 0.35 });
  seen.observe(section);
}

function sideHTML(kind, summary) {
  const films = kind === 'films';
  const noun = films ? 'films' : 'series';
  const head = `<header class="year-side-head">
      <span class="year-side-icon">${icon(films ? 'film' : 'tv')}</span>
      <div><span>${films ? 'Year in films' : 'Year in series'}</span><h2>${summary.count} ${films ? (summary.count === 1 ? 'film' : 'films') : 'series'}</h2></div>
      ${summary.count ? `<button type="button" class="year-share" data-action="${films ? 'films-year' : 'series-year'}" data-year="${summary.year}">${icon('share')} Share</button>` : ''}
    </header>`;
  if (!summary.count) {
    return `<article class="year-side ${noun} empty">${head}
      <div class="year-side-empty">${illustration(films ? 'clapper' : 'tv')}<h3>No ${noun} ${films ? 'watched' : 'finished'} in ${summary.year}</h3>
      <p>${films ? 'Mark a film watched and it lands on this card, in the month you saw it.' : 'Finish the last episode of a show and it joins this card.'}</p>
      <button type="button" class="btn-glass" data-action="show-page" data-page="${films ? 'movies' : 'tv'}">Browse ${films ? 'movies' : 'TV'}</button></div>
    </article>`;
  }
  return `<article class="year-side ${noun}">${head}
    <div class="year-canvas-wrap" data-art="${kind}">
      <button type="button" class="year-replay" data-action="year-replay" aria-label="${esc(`Replay the ${noun} card`)}" data-tip="Replay">${icon('rotate')}</button>
      <canvas class="year-canvas" width="1200" height="1500" role="img" aria-label="${esc(`${summary.year} in ${noun}: ${summary.count} ${noun}`)}"></canvas>
      <div class="year-canvas-wait">${illustration(films ? 'projector' : 'tv')}<span>Drawing your card…</span></div>
    </div>
  </article>`;
}

function monthHTML(year, month, { films, series }) {
  if (month < 0) return '';
  const list = [...films.map(item => ({ ...item, note: item.plays > 1 ? `${item.plays} viewings` : item.rating ? `${item.rating}/10` : 'Film' })),
    ...series.map(item => ({ ...item, note: `Finished · ${plural(item.episodes, 'episode')}` }))];
  const body = list.length
    ? `<ul class="year-month-list">${list.map((item, index) => `<li style="--i:${index}"><a href="/${item.kind}/${item.id}" data-action="open-detail" data-id="${item.id}" data-type="${item.kind}">
        <img src="${item.poster ? `${IMG}w185${item.poster}` : PH}" alt="" loading="lazy" data-ph="${PH}">
        <b>${esc(item.title)}</b><small>${esc(item.note)}</small></a></li>`).join('')}</ul>`
    : `<p class="year-month-none">Nothing watched or finished in ${MONTHS[month]}.</p>`;
  return `<section class="year-month" aria-labelledby="yearMonthHead">
    <header><div><span>Month recap</span><h2 id="yearMonthHead">${MONTHS[month]} ${year}</h2></div>
    <p>${plural(films.length, 'film')} · ${series.length} finished series</p>
    <button type="button" class="year-month-close" data-action="year-month" data-month="0" aria-label="Close ${MONTHS[month]}">${icon('close')}</button></header>
    ${body}
  </section>`;
}

// ---------- drawing ----------
// A card animates the first time it is seen on a visit; a data refresh that
// rebuilds the page redraws it finished instead of playing it again. Replay
// always plays.
function mountArt(host, build, key) {
  const wrap = host.querySelector('.year-canvas-wrap');
  const canvas = wrap?.querySelector('canvas');
  if (!canvas) return;
  const art = { alive: true, running: false, close: null };
  openArts.push(art);
  const start = async ({ replay = false } = {}) => {
    if (art.running) return;
    art.running = true;
    wrap.classList.add('busy');
    try {
      const { draw, plan, close } = await build();
      if (!art.alive) { close(); return; }
      art.close = close;
      const ctx = canvas.getContext('2d');
      const still = reducedMotion() || (!replay && drawnCards.has(key));
      drawnCards.add(key);
      if (still) { draw(ctx, Infinity); wrap.classList.add('ready', 'still'); close(); art.close = null; return; }
      wrap.classList.remove('still');
      wrap.classList.add('ready');
      let began = 0;
      await new Promise(resolve => {
        const frame = now => {
          if (!began) began = now;
          const time = now - began;
          if (!art.alive || !canvas.isConnected || time >= plan.end) { draw(ctx, Infinity); resolve(); return; }
          draw(ctx, time);
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      close(); art.close = null;
    } catch (error) {
      console.warn('year card', error);
      wrap.classList.add('failed');
      const wait = wrap.querySelector('.year-canvas-wait span');
      if (wait) wait.textContent = 'Could not draw this card. Try again in a moment.';
    } finally { art.running = false; wrap.classList.remove('busy'); }
  };
  wrap._yearStart = start;
  if (!('IntersectionObserver' in window)) { start(); return; }
  watcher ||= new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      watcher.unobserve(entry.target);
      entry.target._yearStart?.();
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.2 });
  watcher.observe(wrap);
}

// ---------- page ----------
export function renderYear(requested = 0, query = new URLSearchParams(location.search)) {
  const host = $('yearContent');
  if (!host) return;
  const run = ++generation;
  releaseArts();
  if (!state.user) {
    host.innerHTML = `<div class="wl-empty year-signin">${illustration('year')}<h3>Sign in to see your year</h3><p>Your films and finished series, side by side, with a combined total.</p><br><button class="btn-primary" data-action="open-auth">Sign In</button></div>`;
    return;
  }
  const { years, year, films, series, previous } = summaries(requested);
  const monthParam = Math.trunc(+query.get('month'));
  focusMonth = monthParam >= 1 && monthParam <= 12 ? monthParam - 1 : -1;
  const total = combineYear(films, series);
  const month = monthHTML(year, focusMonth, monthItems(state.watched, films, series, focusMonth));
  const counting = !countedYears.has(year) && !reducedMotion() && total.titles > 0;
  countedYears.add(year);

  host.innerHTML = `<div class="year-page">
    ${heroHTML(year, years, total)}
    ${totalHTML(total, yearDelta(total, previous), counting)}
    ${month}
    ${highlightsHTML(yearHighlights(state.watched, films, series), topGenres(films), year)}
    <div class="year-sides">${sideHTML('films', films)}${sideHTML('series', series)}</div>
  </div>`;
  if (run !== generation) return;
  if (counting) countUp(host.querySelector('.year-total'));
  const sides = host.querySelectorAll('.year-side');
  if (films.count) mountArt(sides[0], () => filmsCardArt(films), `films:${year}:${films.count}:${films.plays}:${films.minutes}`);
  if (series.count) mountArt(sides[1], () => seriesCardArt(series), `series:${year}:${series.count}:${series.episodes}`);
  if (focusMonth >= 0 && query.get('month')) requestAnimationFrame(() => host.querySelector('.year-month')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
}

export function initYear() {
  // The month bars are one row: arrow keys, Home and End move between the months that have something.
  document.addEventListener('keydown', event => {
    const bar = event.target.closest?.('.year-bar');
    if (!bar || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const bars = [...bar.parentElement.querySelectorAll('.year-bar:not(:disabled)')];
    const index = bars.indexOf(bar);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? bars.length - 1 : Math.max(0, Math.min(bars.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)));
    event.preventDefault();
    bars[next]?.focus();
  });
  registerActions({
    'year-replay': el => el.closest('.year-canvas-wrap')?._yearStart?.({ replay: true }),
    'year-pick': el => document.dispatchEvent(new CustomEvent('cv:go', { detail: `/year/${+el.dataset.year}` })),
    'year-month': el => {
      const match = location.pathname.match(/^\/year(?:\/(\d{4}))?/);
      const year = match?.[1] || '';
      const month = +el.dataset.month;
      const next = month && month - 1 !== focusMonth ? month : 0;
      const path = `/year${year ? `/${year}` : ''}${next ? `?month=${next}` : ''}`;
      history.replaceState({ ...(history.state || {}), path: location.pathname }, '', path);
      // Toggling a month keeps the cards: only the month panel and bars change.
      const page = $('yearContent')?.querySelector('.year-page');
      if (!page) return;
      renderMonthOnly(page, year ? +year : 0, next ? next - 1 : -1);
    },
  });
}

function renderMonthOnly(page, requested, month) {
  const { year, films, series } = summaries(requested);
  focusMonth = month;
  page.querySelector('.year-month')?.remove();
  page.querySelectorAll('.year-bar').forEach((bar, index) => {
    bar.classList.toggle('on', index === month);
    bar.setAttribute('aria-pressed', String(index === month));
  });
  if (month < 0) return;
  page.querySelector('.year-total')?.insertAdjacentHTML('afterend', monthHTML(year, month, monthItems(state.watched, films, series, month)));
  page.querySelector('.year-month')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
