// ===== PROVIDER HISTORY CHARTS =====
// Answers one question: which subscription services are gaining or losing titles
// from YOUR library. Every number here is a diff between two CineVerse scans of
// the same region — nothing is modelled, predicted, or back-filled.
//
// Colour: a diverging pair (gains / losses) validated for colour-vision
// deficiency — cyan-600 vs orange-600 rather than the usual green/red, which is
// indistinguishable to deuteranopes. Direction, sign, and direct labels carry the
// meaning as well, so the charts never depend on hue alone.
import { IMG, regionLabel } from './config.js';
import { esc } from './ui.js';
import { state } from './state.js';
import { getProviderStats, getCatalogSeries, getProviderLedger } from './provider-history.js';

export const GAIN = '#0891b2';
export const LOSS = '#ea580c';
const TREND = '#a78bfa';
const GRID = 'rgba(255,255,255,.07)';
const INK3 = '#6b7280';

let resizeObserver = null, tooltipEl = null, boundRoot = null, currentRange = 90, tableOpen = false;

const dayLabel = day => {
  const date = new Date(`${day}T12:00:00`);
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const signed = value => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}`;
const logoImg = row => row.logo ? `<img src="${IMG}w92${row.logo}" alt="" loading="lazy">` : '<i class="provider-chip-blank" aria-hidden="true"></i>';

// ---------- stat tiles ----------
function statTiles(stats, series) {
  const ledger = getProviderLedger();
  const tracked = Object.values(ledger.snapshots).filter(snapshot => (snapshot.providers || []).length).length;
  const gained = stats.reduce((sum, row) => sum + row.gained, 0);
  const lost = stats.reduce((sum, row) => sum + row.lost, 0);
  const net = gained - lost;
  const first = series[0]?.total ?? tracked, last = series.at(-1)?.total ?? tracked;
  const tile = (label, value, note, tone = '') => `<div class="pi-tile${tone ? ` ${tone}` : ''}"><span>${esc(label)}</span><strong>${esc(String(value))}</strong><small>${note}</small></div>`;
  return `<div class="pi-tiles">
    ${tile('Titles tracked', tracked, `${esc(regionLabel(state.region))} catalog`)}
    ${tile('Services detected', stats.length, 'across your saved titles')}
    ${tile('Catalog additions', gained, `in the last ${currentRange} days`, gained ? 'gain' : '')}
    ${tile('Catalog removals', lost, `in the last ${currentRange} days`, lost ? 'loss' : '')}
    ${tile('Net movement', signed(net), series.length > 1 ? `${first} → ${last} titles streaming` : 'one scan recorded so far', net > 0 ? 'gain' : net < 0 ? 'loss' : '')}
  </div>`;
}

// ---------- diverging (butterfly) bar chart ----------
// Losses grow left of the shared baseline, gains grow right. Two series, so a
// legend is always present and every bar carries its own value label.
function netChart(stats) {
  const rows = stats.filter(row => row.gained || row.lost).slice(0, 8);
  if (!rows.length) return `<div class="pi-empty"><i aria-hidden="true">◷</i><p>No catalog movement recorded yet. CineVerse compares each scan with the previous one, so the first change appears after a service adds or drops one of your saved titles.</p></div>`;
  const max = Math.max(1, ...rows.map(row => Math.max(row.gained, row.lost)));
  const pct = value => `${(value / max) * 100}%`;
  const body = rows.map(row => `<div class="pi-bar-row" data-tip="${esc(`${row.name}: ${row.gained} added · ${row.lost} removed · net ${signed(row.net)}`)}">
      <div class="pi-bar-name">${logoImg(row)}<span>${esc(row.name)}</span></div>
      <div class="pi-bar-track">
        <div class="pi-bar-side loss">${row.lost ? `<b style="width:${pct(row.lost)}"></b><em>${row.lost}</em>` : ''}</div>
        <i class="pi-bar-axis" aria-hidden="true"></i>
        <div class="pi-bar-side gain">${row.gained ? `<b style="width:${pct(row.gained)}"></b><em>${row.gained}</em>` : ''}</div>
      </div>
      <div class="pi-bar-net ${row.net > 0 ? 'gain' : row.net < 0 ? 'loss' : ''}">${signed(row.net)}</div>
    </div>`).join('');
  return `<div class="pi-legend"><span><i style="background:${LOSS}"></i>Titles removed</span><span><i style="background:${GAIN}"></i>Titles added</span><b>Bars scale to ${max} title${max === 1 ? '' : 's'}</b></div>
    <div class="pi-bars">${body}</div>`;
}

// ---------- catalog trend (single series area + line) ----------
function trendChart(series, width) {
  if (series.length < 2) return `<div class="pi-empty"><i aria-hidden="true">◷</i><p>The trend line needs at least two scans on different days. Open Notifications again tomorrow and this chart starts drawing itself.</p></div>`;
  const W = Math.max(320, Math.round(width || 720)), H = 210;
  const padL = 34, padR = 16, padT = 16, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const values = series.map(point => point.total);
  const top = Math.max(1, Math.ceil(Math.max(...values) * 1.15));
  const x = index => padL + (series.length === 1 ? innerW / 2 : (index / (series.length - 1)) * innerW);
  const y = value => padT + innerH - (value / top) * innerH;
  const line = series.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(point.total).toFixed(1)}`).join(' ');
  const area = `${line} L${x(series.length - 1).toFixed(1)} ${(padT + innerH).toFixed(1)} L${x(0).toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;
  const ticks = [0, Math.round(top / 2), top].filter((value, index, list) => list.indexOf(value) === index);
  const grid = ticks.map(value => `<line x1="${padL}" x2="${W - padR}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}" stroke="${GRID}" stroke-width="1"/><text x="${padL - 8}" y="${(y(value) + 3.5).toFixed(1)}" text-anchor="end" fill="${INK3}" font-size="10">${value}</text>`).join('');
  const step = Math.max(1, Math.ceil(series.length / (W < 460 ? 3 : 6)));
  const xLabels = series.map((point, index) => (index % step === 0 || index === series.length - 1)
    ? `<text x="${x(index).toFixed(1)}" y="${H - 7}" text-anchor="middle" fill="${INK3}" font-size="10">${esc(dayLabel(point.day))}</text>` : '').join('');
  // Hit bands are clamped to the plot area: the SVG paints with overflow visible
  // (so the endpoint label is never clipped), and an unclamped band would push a
  // transparent rect past the card and give the whole page a horizontal scroll.
  const band = Math.max(10, innerW / Math.max(1, series.length - 1));
  const hit = series.map((point, index) => {
    const left = Math.max(padL, x(index) - band / 2);
    const right = Math.min(W - padR, x(index) + band / 2);
    return `<rect class="pi-hit" x="${left.toFixed(1)}" y="${padT}" width="${Math.max(6, right - left).toFixed(1)}" height="${innerH}" fill="transparent" data-x="${x(index).toFixed(1)}" data-y="${y(point.total).toFixed(1)}" data-tip="${esc(`${dayLabel(point.day)} · ${point.total} title${point.total === 1 ? '' : 's'} streaming`)}"></rect>`;
  }).join('');
  const lastX = x(series.length - 1), lastY = y(values.at(-1));
  return `<svg class="pi-trend" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Titles from your library detected on subscription streaming over time">
    <defs><linearGradient id="piTrendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${TREND}" stop-opacity=".22"/><stop offset="1" stop-color="${TREND}" stop-opacity="0"/></linearGradient></defs>
    ${grid}${xLabels}
    <path d="${area}" fill="url(#piTrendFill)"/>
    <path d="${line}" fill="none" stroke="${TREND}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <line class="pi-cross" x1="0" x2="0" y1="${padT}" y2="${padT + innerH}" stroke="${TREND}" stroke-width="1" opacity="0"/>
    <circle class="pi-dot" r="4.5" fill="${TREND}" stroke="#0d0e14" stroke-width="2" opacity="0"/>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4.5" fill="${TREND}" stroke="#0d0e14" stroke-width="2"/>
    <text x="${Math.min(W - padR, lastX + 8).toFixed(1)}" y="${Math.max(padT + 10, lastY - 9).toFixed(1)}" text-anchor="${lastX > W - 70 ? 'end' : 'start'}" fill="#e5e7eb" font-size="11" font-weight="700">${values.at(-1)}</text>
    ${hit}
  </svg>`;
}

// ---------- sparkline for the table ----------
function sparkline(points) {
  const values = points.map(point => point.value);
  if (values.length < 2) return '<span class="pi-spark-empty">—</span>';
  const max = Math.max(1, ...values), W = 62, H = 18;
  const path = values.map((value, index) => `${index ? 'L' : 'M'}${((index / (values.length - 1)) * W).toFixed(1)} ${(H - (value / max) * (H - 3) - 1.5).toFixed(1)}`).join(' ');
  return `<svg class="pi-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${path}" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${W}" cy="${(H - (values.at(-1) / max) * (H - 3) - 1.5).toFixed(1)}" r="2.4" fill="${TREND}"/></svg>`;
}

function statsTable(stats) {
  if (!stats.length) return '';
  const rows = stats.map(row => `<tr>
    <th scope="row"><span class="pi-cell-name">${logoImg(row)}${esc(row.name)}</span></th>
    <td>${row.current}</td><td class="gain">${row.gained || '—'}</td><td class="loss">${row.lost || '—'}</td>
    <td class="${row.net > 0 ? 'gain' : row.net < 0 ? 'loss' : ''}">${signed(row.net)}</td>
    <td>${sparkline(row.series)}</td>
    <td>${row.lastChangeAt ? esc(new Date(row.lastChangeAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) : '—'}</td>
  </tr>`).join('');
  return `<div class="pi-table-wrap"${tableOpen ? '' : ' hidden'}><table class="pi-table"><caption>Every subscription service detected in your ${esc(regionLabel(state.region))} catalog</caption>
    <thead><tr><th scope="col">Service</th><th scope="col">Now</th><th scope="col">Added</th><th scope="col">Removed</th><th scope="col">Net</th><th scope="col">Trend</th><th scope="col">Last change</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

// ---------- public ----------
export function providerIntelHTML({ width = 720 } = {}) {
  const stats = getProviderStats({ days: currentRange });
  const series = getCatalogSeries({ days: currentRange });
  const ranges = [30, 90, 180].map(value => `<button class="${value === currentRange ? 'active' : ''}" data-action="provider-chart-range" data-range="${value}" aria-pressed="${value === currentRange}">${value}d</button>`).join('');
  if (!stats.length) {
    return `<section class="provider-intel" id="providerIntel"><div class="pi-head"><div><span>Provider intelligence</span><h2>Provider History Charts</h2><p>Which subscription services are gaining or losing the titles you care about.</p></div></div>
      <div class="pi-empty"><i aria-hidden="true">◷</i><p>Save a few movies or shows and refresh Notifications. CineVerse records each region scan and starts charting the moment a service adds or drops one of them.</p></div></section>`;
  }
  return `<section class="provider-intel" id="providerIntel">
    <div class="pi-head">
      <div><span>Provider intelligence</span><h2>Provider History Charts</h2><p>Which subscription services gained or lost the most titles from your library — measured by comparing CineVerse scans of the ${esc(regionLabel(state.region))} catalog.</p></div>
      <div class="pi-head-tools"><div class="pi-range" role="group" aria-label="Chart time range">${ranges}</div><button class="pi-table-toggle" data-action="provider-chart-table" aria-expanded="${tableOpen}">${tableOpen ? 'Hide table' : 'View as table'}</button></div>
    </div>
    ${statTiles(stats, series)}
    <div class="pi-grid">
      <figure class="pi-card"><figcaption><strong>Gains and losses by service</strong><span>Last ${currentRange} days · bars grow from the centre line</span></figcaption>${netChart(stats)}</figure>
      <figure class="pi-card"><figcaption><strong>Your streamable catalog over time</strong><span>Saved titles detected on any subscription service</span></figcaption><div class="pi-trend-wrap" data-chart="trend">${trendChart(series, width)}</div></figure>
    </div>
    ${statsTable(stats)}
    <p class="pi-note">Detected by CineVerse from the ${esc(regionLabel(state.region))} subscription catalog. Availability data by <a href="https://www.justwatch.com" target="_blank" rel="noopener">JustWatch</a> via TMDB. Rent and buy offers are never counted.</p>
  </section>`;
}

export function setProviderChartRange(days) { currentRange = [30, 90, 180].includes(+days) ? +days : 90; }
export function toggleProviderChartTable() { tableOpen = !tableOpen; return tableOpen; }
export function isProviderChartTableOpen() { return tableOpen; }

// Re-draws only the trend SVG at the container's real pixel width, so axis labels
// never shrink with a scaled viewBox.
function redrawTrend(root) {
  const host = root.querySelector('[data-chart="trend"]'); if (!host) return;
  const width = Math.round(host.clientWidth || 720);
  if (+host.dataset.width === width) return;
  host.dataset.width = String(width);
  host.innerHTML = trendChart(getCatalogSeries({ days: currentRange }), width);
}

function ensureTooltip(root) {
  if (tooltipEl && root.contains(tooltipEl)) return tooltipEl;
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'pi-tooltip';
  tooltipEl.setAttribute('role', 'status');
  root.appendChild(tooltipEl);
  return tooltipEl;
}

function showTip(root, text, clientX, clientY) {
  const tip = ensureTooltip(root), box = root.getBoundingClientRect();
  tip.textContent = text;
  tip.classList.add('show');
  const left = Math.min(Math.max(clientX - box.left, 60), Math.max(60, box.width - 60));
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(6, clientY - box.top - 44)}px`;
}
function hideTip() { tooltipEl?.classList.remove('show'); }

export function mountProviderIntel() {
  const root = document.getElementById('providerIntel');
  if (!root) { resizeObserver?.disconnect(); resizeObserver = null; boundRoot = null; return; }
  redrawTrend(root);

  if (boundRoot !== root) {
    boundRoot = root;
    tooltipEl = null;
    root.addEventListener('pointermove', event => {
      const target = event.target.closest('[data-tip]');
      if (!target) { hideTip(); toggleCrosshair(root, null); return; }
      showTip(root, target.dataset.tip, event.clientX, event.clientY);
      toggleCrosshair(root, target);
    });
    root.addEventListener('pointerleave', () => { hideTip(); toggleCrosshair(root, null); });
    root.addEventListener('focusin', event => {
      const target = event.target.closest('[data-tip]'); if (!target) return;
      const box = target.getBoundingClientRect();
      showTip(root, target.dataset.tip, box.left + box.width / 2, box.top + 10);
    });
    root.addEventListener('focusout', hideTip);
  }

  resizeObserver?.disconnect();
  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(() => redrawTrend(root));
    const host = root.querySelector('[data-chart="trend"]');
    if (host) resizeObserver.observe(host);
  }
}

function toggleCrosshair(root, target) {
  const svg = root.querySelector('.pi-trend'); if (!svg) return;
  const cross = svg.querySelector('.pi-cross'), dot = svg.querySelector('.pi-dot');
  if (!cross || !dot) return;
  if (!target || !target.classList.contains('pi-hit')) { cross.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); return; }
  cross.setAttribute('x1', target.dataset.x); cross.setAttribute('x2', target.dataset.x); cross.setAttribute('opacity', '.35');
  dot.setAttribute('cx', target.dataset.x); dot.setAttribute('cy', target.dataset.y); dot.setAttribute('opacity', '1');
}
