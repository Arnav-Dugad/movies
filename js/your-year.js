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
import { state } from './state.js';
import { $, esc } from './ui.js';
import { icon } from './icons.js';
import { IMG, PH } from './config.js';
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

/** The page's two summaries for a requested year (0 = pick one). */
function summaries(requested) {
  const finished = shareableSeries();
  const years = yearChoices(state.watched, finished, { exclude: keyIsMature });
  const year = pickYear(requested, years);
  return {
    years, year,
    films: filmsYear(state.watched, year, { ratings: state.ratings, exclude: keyIsMature }),
    series: seriesYear(finished, year),
  };
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

function totalHTML(total) {
  const figures = [
    ['Films', total.films, total.viewings > total.films ? `${plural(total.viewings, 'viewing')} with rewatches` : 'watched'],
    ['Series', total.series, total.episodes ? `${plural(total.episodes, 'episode')} across those runs` : 'finished'],
    ['Watch time', total.minutes ? formatDuration(total.minutes) : '—', 'films + finished runs'],
    ['Busiest month', total.busiest.length ? total.busiest.map(index => SHORT[index]).join(' · ') : '—', total.busiestCount ? plural(total.busiestCount, 'viewing or finish', 'viewings and finishes') : 'nothing marked yet'],
  ];
  return `<section class="year-total" aria-labelledby="yearTotalHead">
    <div class="year-total-head">
      <div><span>Combined total</span><h2 id="yearTotalHead"><strong data-count="${total.titles}">${total.titles}</strong> ${total.titles === 1 ? 'title' : 'titles'} in ${total.year}</h2></div>
    </div>
    <div class="year-figures">${figures.map(([label, value, note]) => `<div class="year-figure"><span>${label}</span><strong>${esc(String(value))}</strong><small>${esc(note)}</small></div>`).join('')}</div>
    ${chartHTML(total, focusMonth)}
  </section>`;
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
function mountArt(host, build) {
  const wrap = host.querySelector('.year-canvas-wrap');
  const canvas = wrap?.querySelector('canvas');
  if (!canvas) return;
  const art = { alive: true, running: false, close: null };
  openArts.push(art);
  const reduced = () => document.documentElement.dataset.motion === 'reduced'
    || (document.documentElement.dataset.motion !== 'full' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const start = async () => {
    art.running = true;
    try {
      const { draw, plan, close } = await build();
      if (!art.alive) { close(); return; }
      art.close = close;
      const ctx = canvas.getContext('2d');
      wrap.classList.add('ready');
      if (reduced()) { draw(ctx, Infinity); close(); art.close = null; return; }
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
    } finally { art.running = false; }
  };
  if (!('IntersectionObserver' in window)) { start(); return; }
  watcher ||= new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      watcher.unobserve(entry.target);
      entry.target._yearStart?.();
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.2 });
  wrap._yearStart = start;
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
  const { years, year, films, series } = summaries(requested);
  const monthParam = Math.trunc(+query.get('month'));
  focusMonth = monthParam >= 1 && monthParam <= 12 ? monthParam - 1 : -1;
  const total = combineYear(films, series);
  const month = monthHTML(year, focusMonth, monthItems(state.watched, films, series, focusMonth));

  host.innerHTML = `<div class="year-page">
    ${heroHTML(year, years, total)}
    ${totalHTML(total)}
    ${month}
    <div class="year-sides">${sideHTML('films', films)}${sideHTML('series', series)}</div>
  </div>`;
  if (run !== generation) return;
  const sides = host.querySelectorAll('.year-side');
  if (films.count) mountArt(sides[0], () => filmsCardArt(films));
  if (series.count) mountArt(sides[1], () => seriesCardArt(series));
  if (focusMonth >= 0 && query.get('month')) requestAnimationFrame(() => host.querySelector('.year-month')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
}

export function initYear() {
  registerActions({
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
