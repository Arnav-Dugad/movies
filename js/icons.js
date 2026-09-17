// ===== ICON SET =====
// Every symbol in CineVerse is drawn here instead of borrowed from the system
// emoji font. Emoji render differently on every platform (a flat Windows glyph,
// a glossy Apple one, a missing box on older Android), ignore the page's colour
// and theme, and cannot be restyled. These are one family: a 24px grid, round
// caps and joins, a 1.75 stroke, and a faint duotone fill on the shapes that
// carry weight, so they read as the same hand drew them and take on whatever
// colour their container sets.
//
// icon(name) returns an inline <svg> string, sized 1em so it follows the
// container's font-size exactly as the emoji did. Unknown names fall back to a
// neutral spark rather than rendering nothing.
const D = 'fill="currentColor" fill-opacity=".16" stroke="none"';

export const ICONS = {
  sparkles: `<path ${D} d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9z"/><path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9z"/><path d="M18.5 15.2l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/><path d="M5.6 16.4l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z"/>`,
  spark: `<path ${D} d="M12 3c.8 4.3 2.5 6.2 7 9-4.5 2.8-6.2 4.7-7 9-.8-4.3-2.5-6.2-7-9 4.5-2.8 6.2-4.7 7-9z"/><path d="M12 3c.8 4.3 2.5 6.2 7 9-4.5 2.8-6.2 4.7-7 9-.8-4.3-2.5-6.2-7-9 4.5-2.8 6.2-4.7 7-9z"/>`,
  tv: `<rect ${D} x="3" y="6.5" width="18" height="12.5" rx="2.5"/><rect x="3" y="6.5" width="18" height="12.5" rx="2.5"/><path d="M8.5 3l3.5 3.5L15.5 3M9 21.5h6"/>`,
  popcorn: `<path ${D} d="M5.5 10h13l-1.6 10.1a1.5 1.5 0 0 1-1.5 1.3H8.6a1.5 1.5 0 0 1-1.5-1.3z"/><path d="M5.5 10h13l-1.6 10.1a1.5 1.5 0 0 1-1.5 1.3H8.6a1.5 1.5 0 0 1-1.5-1.3z"/><path d="M10 10.5l.5 10.8M14 10.5l-.5 10.8"/><path d="M6.4 10a2.3 2.3 0 0 1 1.7-3.9 2.8 2.8 0 0 1 4.6-2 2.8 2.8 0 0 1 4.9 1.2A2.3 2.3 0 0 1 17.6 10"/>`,
  star: `<path ${D} d="M12 3.2l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.5l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/><path d="M12 3.2l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.5l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>`,
  starSolid: `<path fill="currentColor" stroke-width="1.2" d="M12 3.2l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.5l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>`,
  starBurst:`<path ${D} d="M12 6.5l1.8 3.6 4 .6-2.9 2.8.7 4L12 15.6l-3.6 1.9.7-4-2.9-2.8 4-.6z"/><path d="M12 6.5l1.8 3.6 4 .6-2.9 2.8.7 4L12 15.6l-3.6 1.9.7-4-2.9-2.8 4-.6z"/><path d="M12 2.5v1.6M4.2 5.4l1.2 1.1M19.8 5.4l-1.2 1.1M3 14.5h1.6M19.4 14.5H21"/>`,
  camera: `<rect ${D} x="3" y="9" width="12.5" height="10" rx="2.2"/><rect x="3" y="9" width="12.5" height="10" rx="2.2"/><path d="M15.5 12.4l5-2.8v8.8l-5-2.8"/><circle cx="6.8" cy="5.5" r="2.2"/><circle cx="12" cy="5.5" r="2.2"/>`,
  clapper: `<path ${D} d="M4 10.5h16v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5z"/><path d="M4 10.5h16v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5z"/><path d="M4 10.5l-.6-2.8a1.5 1.5 0 0 1 1.1-1.8l12.3-2.6a1.5 1.5 0 0 1 1.8 1.2l.6 2.8L4 10.5"/><path d="M8.4 5.2l2.3 3.6M13.1 4.2l2.3 3.6"/>`,
  flame: `<path ${D} d="M12 21.5c3.6 0 6.5-2.6 6.5-6.4 0-3.3-2.2-5.5-3.8-7.6-.5 1.9-1.4 3-2.7 3.6.4-3-1-5.8-3.5-7.6.2 2.8-.8 4.6-2.4 6.3-1.4 1.5-.6 3.2-.6 5.3 0 3.8 2.9 6.4 6.5 6.4z"/><path d="M12 21.5c3.6 0 6.5-2.6 6.5-6.4 0-3.3-2.2-5.5-3.8-7.6-.5 1.9-1.4 3-2.7 3.6.4-3-1-5.8-3.5-7.6.2 2.8-.8 4.6-2.4 6.3C4.7 11.3 5.5 13 5.5 15.1c0 3.8 2.9 6.4 6.5 6.4z"/><path d="M12 21.5c-1.7 0-3-1.3-3-3.1 0-2 1.6-2.9 2.4-4.4.9 1.2 3.6 2.2 3.6 4.4 0 1.8-1.3 3.1-3 3.1z"/>`,
  trophy: `<path ${D} d="M8 4h8v5.5a4 4 0 0 1-8 0z"/><path d="M8 4h8v5.5a4 4 0 0 1-8 0z"/><path d="M8 5.5H5.5a2.5 2.5 0 0 0 2.6 4M16 5.5h2.5a2.5 2.5 0 0 1-2.6 4"/><path d="M12 13.5v3.4M8.5 20.5h7M9.6 20.5l.5-3.6h3.8l.5 3.6"/>`,
  film: `<rect ${D} x="4" y="3" width="16" height="18" rx="2.5"/><rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 3v18M16 3v18M4 7.5h4M4 12h4M4 16.5h4M16 7.5h4M16 12h4M16 16.5h4"/>`,
  masks: `<path ${D} d="M3.5 5.2c2.9-1.3 6-1.3 9 0v5.3c0 3-2 5.3-4.5 5.3S3.5 13.5 3.5 10.5z"/><path d="M3.5 5.2c2.9-1.3 6-1.3 9 0v5.3c0 3-2 5.3-4.5 5.3S3.5 13.5 3.5 10.5z"/><path d="M6.1 9h.01M9.9 9h.01M6.3 12c1.1.9 2.3.9 3.4 0"/><path d="M14.4 8.9c2-.6 4-.5 6.1.3v5c0 3-2 5.3-4.5 5.3-1.4 0-2.7-.8-3.5-2"/><path d="M15.7 12.8h.01M18.9 12.8h.01M15.6 16.4c.9-.7 2-.7 2.9 0"/>`,
  gem: `<path ${D} d="M6.5 4h11L21 9l-9 11L3 9z"/><path d="M6.5 4h11L21 9l-9 11L3 9z"/><path d="M3 9h18M9.5 4L8 9l4 11 4-11-1.5-5"/>`,
  calendar: `<rect ${D} x="3.5" y="5" width="17" height="15.5" rx="2.5"/><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/>`,
  ghost: `<path ${D} d="M5.5 20.5V10a6.5 6.5 0 0 1 13 0v10.5l-2.2-1.6-2.1 1.6-2.2-1.6-2.2 1.6-2.1-1.6z"/><path d="M5.5 20.5V10a6.5 6.5 0 0 1 13 0v10.5l-2.2-1.6-2.1 1.6-2.2-1.6-2.2 1.6-2.1-1.6z"/><path d="M9.5 10h.01M14.5 10h.01"/><ellipse cx="12" cy="14" rx="1.3" ry="1.7"/>`,
  laugh: `<circle ${D} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M8 9.8c.6-.8 1.6-.8 2.2 0M13.8 9.8c.6-.8 1.6-.8 2.2 0"/><path d="M7.6 13.4h8.8a4.4 4.4 0 0 1-8.8 0z"/>`,
  palette: `<path ${D} d="M12 3.5a8.5 8.5 0 0 0 0 17c1.3 0 2-.9 2-1.9 0-1.3-1-1.6-1-2.9 0-1 .8-1.7 1.8-1.7h2.2a3.5 3.5 0 0 0 3.5-3.5c0-3.9-3.8-7-8.5-7z"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.3 0 2-.9 2-1.9 0-1.3-1-1.6-1-2.9 0-1 .8-1.7 1.8-1.7h2.2a3.5 3.5 0 0 0 3.5-3.5c0-3.9-3.8-7-8.5-7z"/><path d="M7.5 11h.01M9.5 7.3h.01M14 6.8h.01"/>`,
  broadcast: `<circle ${D} cx="12" cy="11" r="2.2"/><circle cx="12" cy="11" r="2.2"/><path d="M8.2 7.2a5.4 5.4 0 0 0 0 7.6M15.8 7.2a5.4 5.4 0 0 1 0 7.6M5.4 4.4a9.3 9.3 0 0 0 0 13.2M18.6 4.4a9.3 9.3 0 0 1 0 13.2M12 13.2v8"/>`,
  globe: `<circle ${D} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.3 3.5 5.2 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.2-3.5-8.5S9.7 5.8 12 3.5z"/>`,
  trendUp: `<path d="M3.5 17.5L9 12l4 4 7.5-7.5"/><path d="M15 8.5h5.5V14"/>`,
  refresh: `<path d="M19.8 13.5A8 8 0 0 1 6.3 17.6M4.2 10.5A8 8 0 0 1 17.7 6.4"/><path d="M17.7 3v3.4h-3.4M6.3 21v-3.4h3.4"/>`,
  rotate: `<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4.5h-4.5"/>`,
  skull: `<path ${D} d="M12 3.5c-4.4 0-7.5 3-7.5 7.1 0 2.3 1 3.9 2.5 5v2.4a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5v-2.4c1.5-1.1 2.5-2.7 2.5-5 0-4.1-3.1-7.1-7.5-7.1z"/><path d="M12 3.5c-4.4 0-7.5 3-7.5 7.1 0 2.3 1 3.9 2.5 5v2.4a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5v-2.4c1.5-1.1 2.5-2.7 2.5-5 0-4.1-3.1-7.1-7.5-7.1z"/><circle cx="9" cy="11.3" r="1.6"/><circle cx="15" cy="11.3" r="1.6"/><path d="M12 13.8l-.9 1.7h1.8zM10.3 19.5v-2.2M13.7 19.5v-2.2"/>`,
  heart: `<path ${D} d="M12 20s-7.5-4.4-7.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7.5 3c0 5.6-7.5 10-7.5 10z"/><path d="M12 20s-7.5-4.4-7.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7.5 3c0 5.6-7.5 10-7.5 10z"/>`,
  rocket: `<path ${D} d="M13.1 15.8L8.2 10.9c2.1-4.3 5.8-7.2 12.3-7.3-.1 6.5-3 10.2-7.4 12.2z"/><path d="M13.1 15.8L8.2 10.9c2.1-4.3 5.8-7.2 12.3-7.3-.1 6.5-3 10.2-7.4 12.2z"/><circle cx="15.3" cy="8.7" r="1.6"/><path d="M8.2 10.9L4.8 10.5l3-3.3h4M13.1 15.8l.4 3.4 3.3-3v-4M6 15.3c-1.3.9-1.9 2.8-2.1 4.9 2.1-.2 4-.8 4.9-2.1"/>`,
  brain: `<path ${D} d="M9 4.5a2.8 2.8 0 0 0-2.8 2.4A3 3 0 0 0 4.5 12a3 3 0 0 0 1.7 4.9A2.9 2.9 0 0 0 9 19.5c1.6 0 3-1.2 3-2.8V7.2C12 5.7 10.6 4.5 9 4.5zM15 4.5a2.8 2.8 0 0 1 2.8 2.4 3 3 0 0 1 1.7 5.1 3 3 0 0 1-1.7 4.9 2.9 2.9 0 0 1-2.8 2.6c-1.6 0-3-1.2-3-2.8V7.2c0-1.5 1.4-2.7 3-2.7z"/><path d="M9 4.5a2.8 2.8 0 0 0-2.8 2.4A3 3 0 0 0 4.5 12a3 3 0 0 0 1.7 4.9A2.9 2.9 0 0 0 9 19.5c1.6 0 3-1.2 3-2.8V7.2C12 5.7 10.6 4.5 9 4.5z"/><path d="M15 4.5a2.8 2.8 0 0 1 2.8 2.4A3 3 0 0 1 19.5 12a3 3 0 0 1-1.7 4.9A2.9 2.9 0 0 1 15 19.5c-1.6 0-3-1.2-3-2.8"/><path d="M12 7.2c0-1.5 1.4-2.7 3-2.7M8.6 10.5c1 0 1.8.6 2 1.5M15.4 10.5c-1 0-1.8.6-2 1.5"/>`,
  book: `<path ${D} d="M12 6.5c-1.8-1.4-4.6-2-8-2v13c3.4 0 6.2.6 8 2 1.8-1.4 4.6-2 8-2v-13c-3.4 0-6.2.6-8 2z"/><path d="M12 6.5c-1.8-1.4-4.6-2-8-2v13c3.4 0 6.2.6 8 2 1.8-1.4 4.6-2 8-2v-13c-3.4 0-6.2.6-8 2zM12 6.5v13"/>`,
  family: `<circle cx="8" cy="7" r="2.5"/><circle cx="16" cy="7" r="2.5"/><circle cx="12" cy="12.6" r="1.9"/><path d="M3.5 19.5v-1.3a3.7 3.7 0 0 1 3.7-3.7h1.4M20.5 19.5v-1.3a3.7 3.7 0 0 0-3.7-3.7h-1.4M8.8 20.5v-.8a3.2 3.2 0 0 1 6.4 0v.8"/>`,
  tear: `<circle ${D} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M8.6 10h.01M15.4 10h.01M9 16.3a4.2 4.2 0 0 1 6 0"/><path d="M16.8 12.6c.8 1.1 1.2 1.9 1.2 2.4a1.2 1.2 0 0 1-2.4 0c0-.5.4-1.3 1.2-2.4z"/>`,
  crystal: `<circle ${D} cx="12" cy="10.5" r="6.5"/><circle cx="12" cy="10.5" r="6.5"/><path d="M7 20.5h10M8.4 16.1L7.2 20.5M15.6 16.1l1.2 4.4M9.3 8.4a3.3 3.3 0 0 1 2.3-1.9"/>`,
  medal: `<circle ${D} cx="12" cy="14.5" r="5.5"/><circle cx="12" cy="14.5" r="5.5"/><path d="M8.5 3.5h7L13 9.2M8.5 3.5l2.5 5.7"/><path d="M12 12.2l.8 1.6 1.8.3-1.3 1.2.3 1.8-1.6-.9-1.6.9.3-1.8-1.3-1.2 1.8-.3z"/>`,
  columns: `<path ${D} d="M3.5 9.5L12 4l8.5 5.5z"/><path d="M3.5 9.5L12 4l8.5 5.5zM5.5 10v8M9.8 10v8M14.2 10v8M18.5 10v8M3.5 20.5h17M4.5 18h15"/>`,
  hourglass: `<path ${D} d="M7.5 20.5c0-4 1.5-5.6 4.5-8.5 3 2.9 4.5 4.5 4.5 8.5z"/><path d="M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 4 1.5 5.6 4.5 8.5 3-2.9 4.5-4.5 4.5-8.5M7.5 20.5c0-4 1.5-5.6 4.5-8.5 3 2.9 4.5 4.5 4.5 8.5"/>`,
  clock: `<circle ${D} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`,
  stopwatch: `<circle ${D} cx="12" cy="13.5" r="7"/><circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V10M10 2.5h4M12 2.5v4M18.3 6.9l1.3-1.3"/>`,
  runner: `<circle cx="14.6" cy="4.6" r="1.9"/><path d="M8.2 20.5l3.1-5.8 3.1 2.6v3.2M11.3 14.7l1.3-5.1-3.3 1-1.8 2.8M12.6 9.6l2.4 2.5 3.4.6"/>`,
  eye: `<path ${D} d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>`,
  scales: `<path d="M12 4v16.5M7 20.5h10M5.5 7h13"/><path ${D} d="M2.5 13a3 3 0 0 0 6 0zM15.5 13a3 3 0 0 0 6 0z"/><path d="M5.5 7l-3 6a3 3 0 0 0 6 0zM18.5 7l-3 6a3 3 0 0 0 6 0z"/>`,
  perfect: `<rect ${D} x="3.5" y="4.5" width="17" height="15" rx="3"/><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M8 9.4l1.6-1v7.2"/><rect x="12.6" y="8.4" width="4.2" height="7.2" rx="2.1"/>`,
  compass: `<circle ${D} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>`,
  cassette: `<rect ${D} x="2.5" y="5.5" width="19" height="13" rx="2.5"/><rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><circle cx="8" cy="11" r="1.8"/><circle cx="16" cy="11" r="1.8"/><path d="M9.8 11h4.4M6.5 18.5l1.5-3h8l1.5 3"/>`,
  clipboard: `<rect ${D} x="5" y="4.5" width="14" height="16.5" rx="2.5"/><rect x="5" y="4.5" width="14" height="16.5" rx="2.5"/><path d="M9 4.5v-.7a1.3 1.3 0 0 1 1.3-1.3h3.4A1.3 1.3 0 0 1 15 3.8v.7M8.5 10h7M8.5 13.5h7M8.5 17h4"/>`,
  checkCircle: `<circle ${D} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.2l2.5 2.5 5-5.2"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  close: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`,
  plus: `<path d="M12 5.5v13M5.5 12h13"/>`,
  bookmark: `<path ${D} d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/><path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/>`,
  folder: `<path ${D} d="M3.5 7.2A2.2 2.2 0 0 1 5.7 5h3.9l2 2.2h6.7a2.2 2.2 0 0 1 2.2 2.2v8.4a2.2 2.2 0 0 1-2.2 2.2H5.7a2.2 2.2 0 0 1-2.2-2.2z"/><path d="M3.5 7.2A2.2 2.2 0 0 1 5.7 5h3.9l2 2.2h6.7a2.2 2.2 0 0 1 2.2 2.2v8.4a2.2 2.2 0 0 1-2.2 2.2H5.7a2.2 2.2 0 0 1-2.2-2.2z"/>`,
  lock: `<rect ${D} x="5" y="10.5" width="14" height="10" rx="2.5"/><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5v-3a4 4 0 0 1 8 0v3M12 14.5v2"/>`,
  target: `<circle cx="12" cy="12" r="8.5"/><circle ${D} cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>`,
  users: `<circle ${D} cx="9" cy="8" r="3.2"/><circle cx="9" cy="8" r="3.2"/><path d="M3 20v-.8A5.2 5.2 0 0 1 8.2 14h1.6a5.2 5.2 0 0 1 5.2 5.2v.8M15.5 4.9a3.2 3.2 0 0 1 0 6.2M17.5 14.2a5.2 5.2 0 0 1 3.5 4.9v.9"/>`,
  grid: `<rect ${D} x="3.5" y="3.5" width="17" height="17" rx="2.5"/><rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M3.5 9.2h17M3.5 14.8h17M9.2 3.5v17M14.8 3.5v17"/>`,
  command: `<path d="M9 9V6.5A2.5 2.5 0 1 0 6.5 9zM15 9V6.5A2.5 2.5 0 1 1 17.5 9zM9 15v2.5A2.5 2.5 0 1 1 6.5 15zM15 15v2.5a2.5 2.5 0 1 0 2.5-2.5zM9 9h6v6H9z"/>`,
  share: `<circle ${D} cx="17.5" cy="5.5" r="2.5"/><circle cx="17.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="M8.7 10.7l6.6-3.9M8.7 13.3l6.6 3.9"/>`,
  external: `<path d="M14 4.5h5.5V10M19.5 4.5L11 13"/><path d="M17 13.5v4.2a1.8 1.8 0 0 1-1.8 1.8H6.3a1.8 1.8 0 0 1-1.8-1.8V8.8A1.8 1.8 0 0 1 6.3 7h4.2"/>`,
  person: `<circle ${D} cx="12" cy="8" r="3.6"/><circle cx="12" cy="8" r="3.6"/><path d="M4.8 20.5a7.2 7.2 0 0 1 14.4 0"/>`,
  arrowRight: `<path d="M4.5 12h14.5M13.5 6.5L19 12l-5.5 5.5"/>`,
  chevronDown: `<path d="M6.5 9.5L12 15l5.5-5.5"/>`,
  chevronRight: `<path d="M9.5 6.5L15 12l-5.5 5.5"/>`,
  trendDown: `<path d="M12 18.5l-6-7h3.8V5.5h4.4v6H18z"/>`,
  trendUpSolid: `<path d="M12 5.5l6 7h-3.8v6H9.8v-6H6z"/>`,
  backspace: `<path ${D} d="M9 5.5h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-6-6.5z"/><path d="M9 5.5h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-6-6.5z"/><path d="M11.5 9.5l5 5M16.5 9.5l-5 5"/>`,
  pin: `<path ${D} d="M9 3.5h6l-1 5.5 3.5 3.5h-11L10 9z"/><path d="M9 3.5h6l-1 5.5 3.5 3.5h-11L10 9zM12 12.5v8"/>`,
  layers: `<path ${D} d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8zM3.5 12l8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5"/>`,
};

/** An inline SVG for `name`, sized 1em. `cls` adds classes; `label` makes it an image with that name. */
export function icon(name, { cls = '', label = '' } = {}) {
  const body = ICONS[name] || ICONS.spark;
  const a11y = label ? `role="img" aria-label="${String(label).replace(/"/g, '&quot;')}"` : 'aria-hidden="true" focusable="false"';
  return `<svg class="cv-icon${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${body}</svg>`;
}

// Lists created before this icon set store an emoji as their icon (in
// Firestore, so they cannot simply be rewritten). Both old emoji and new names
// resolve to a drawn icon; anything unrecognised gets the list's default.
const LEGACY = {
  '📋': 'clipboard', '❤️': 'heart', '❤': 'heart', '🕒': 'clock', '🎬': 'clapper', '📁': 'folder',
  '🍿': 'popcorn', '🔒': 'lock', '⭐': 'star', '🎞️': 'film', '🎞': 'film', '📺': 'tv', '🎥': 'camera',
};
const LIST_DEFAULTS = { watchlist: 'bookmark', favorites: 'heart', watchlater: 'clock' };

/** Icon name for a stored list icon value, with the list id deciding the default. */
export function listIconName(value, listId = '') {
  const raw = String(value || '').trim();
  if (ICONS[raw]) return raw;
  if (LIST_DEFAULTS[listId]) return LIST_DEFAULTS[listId];
  return LEGACY[raw] || 'folder';
}

export const listIcon = (value, listId = '', options = {}) => icon(listIconName(value, listId), options);
