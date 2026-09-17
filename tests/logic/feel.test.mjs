// How the site feels: haptic signatures and their weights, the posters' lean and
// scroll detents, the ticket stub's arc, the Continue Watching lift and the
// sticky bars' shelf.
import { check, summary } from './harness.mjs';

const SRC = new URL('../../js/', import.meta.url).href;
const haptics = await import(SRC + 'haptics.js');
const feel = await import(SRC + 'scroll-feel.js');
const stub = await import(SRC + 'ticket-stub.js');
const lift = await import(SRC + 'continue-lift.js');
const sticky = await import(SRC + 'sticky-bars.js');

// ---------- haptics ----------
const sig = action => haptics.signatureFor({ action });
check('marking watched decides its own buzz from the outcome', sig('toggle-watched') === '' && sig('ep-toggle') === '');
check('a destructive action warns', ['wl-delete-list', 'remove-friend', 'reset-movies', 'settings-reset-section', 'sign-out', 'continue-drop', 'dismiss-notification'].every(a => sig(a) === 'warning'));
check('"preset" is not a reset', sig('discover-preset') === 'select');
check('"removed-toggle" is a choice, not a removal', sig('club-removed-toggle') === 'select');
check('filters on Watched and My Lists are choices, not successes', ['watched-genre', 'watched-sort', 'toggle-watched-filters', 'wl-decade', 'studio-rating'].every(a => sig(a) === 'select'));
check('saving, sharing and exporting succeed', ['rate-submit', 'profile-save', 'share-list', 'copy-code', 'download-backup', 'import-run', 'read-all-notifications'].every(a => sig(a) === 'success'));
check('opening, choosing a file and closing only tap', ['open-rating', 'open-delete', 'choose-backup', 'choose-watched-import', 'close-import', 'close-spoiler-share', 'wl-list-cancel'].every(a => sig(a) === 'tap'));
check('navigation and toggles select', ['show-page', 'toggle-theme', 'settings-region', 'rate-pick', 'notification-sort'].every(a => sig(a) === 'select'));
check('a switch, a chip and the Filters button select', haptics.signatureFor({ checkbox: true }) === 'select' && haptics.signatureFor({ cls: 'chip on' }) === 'select' && haptics.signatureFor({ cls: 'filter-fold-toggle has-set' }) === 'select');
check('a plain control taps', haptics.signatureFor({ cls: 'btn-glass' }) === 'tap');
check('every signature has a pattern', ['detent', 'land', 'edge', 'swipe', 'tap', 'untick', 'tick', 'select', 'pin', 'peek', 'notify', 'drop', 'success', 'warning', 'celebrate'].every(k => haptics.PATTERNS[k] !== undefined));
check('scroll detents are the lightest buzz there is', haptics.PATTERNS.detent < haptics.PATTERNS.tap && haptics.PATTERNS.detent <= 5);
check('buzzes 45ms apart both play', haptics.shouldPlay('tap', 45, 3));
check('a lighter buzz inside 45ms is dropped', !haptics.shouldPlay('tap', 20, 2) && !haptics.shouldPlay('detent', 10, 0));
check('a weightier buzz inside 45ms replaces the one before', haptics.shouldPlay('success', 10, 1) && haptics.shouldPlay('celebrate', 5, 3));
check('an equal buzz inside 45ms is dropped', !haptics.shouldPlay('success', 10, 3));
check('unlessRecent skips a confirmation right after a press', !haptics.shouldPlay('success', 300, 1, 600) && haptics.shouldPlay('success', 700, 1, 600));

// ---------- lean and detents ----------
check('no speed, no lean', feel.tiltFor(0) === 0 && feel.tiltFor(NaN) === 0);
check('scrolling right leans back the other way', feel.tiltFor(.5) < 0 && feel.tiltFor(-.5) > 0);
check('lean grows with speed', Math.abs(feel.tiltFor(.8)) > Math.abs(feel.tiltFor(.2)));
check('a flick is capped at 9 degrees', feel.tiltFor(40) === -9 && feel.tiltFor(-40) === 9);
check('lean is rounded to a tenth of a degree', feel.tiltFor(.123) === -0.9);
check('settling waits 140ms at a normal frame rate', feel.settleAfter(16) === 140);
check('settling stretches with slow frames and is capped', feel.settleAfter(120) === 300 && feel.settleAfter(240) === 420 && feel.settleAfter(0) === 140 && feel.settleAfter(900) === 140);
check('the detent index counts posters passed', feel.detentIndex(0, 156) === 0 && feel.detentIndex(160, 156) === 1 && feel.detentIndex(470, 156) === 3);
check('no step, no detents', feel.detentIndex(400, 0) === 0 && feel.detentIndex(-20, 100) === 0);
check('edges: start, end, middle, and no room to scroll', feel.edgeOf(0, 900) === 'start' && feel.edgeOf(899.5, 900) === 'end' && feel.edgeOf(400, 900) === '' && feel.edgeOf(0, 0) === '');
const root = { top: 422, bottom: 844 };
check('a heading leaving the lower half over its top crossed the middle', feel.crossedMiddle({ isIntersecting: false, boundingClientRect: { top: 380, bottom: 421 }, rootBounds: root }));
check('a heading coming back over the middle crossed it', feel.crossedMiddle({ isIntersecting: true, boundingClientRect: { top: 400, bottom: 441 }, rootBounds: root }));
check('entering from the bottom of the screen is not a crossing', !feel.crossedMiddle({ isIntersecting: true, boundingClientRect: { top: 820, bottom: 861 }, rootBounds: root }));
check('leaving at the bottom of the screen is not a crossing', !feel.crossedMiddle({ isIntersecting: false, boundingClientRect: { top: 850, bottom: 891 }, rootBounds: root }));
check('without root bounds nothing crosses', !feel.crossedMiddle({ isIntersecting: true, boundingClientRect: { top: 0, bottom: 10 }, rootBounds: null }));

// ---------- ticket stub ----------
const frames = stub.stubKeyframes({ x: 200, y: 500 }, { x: 330, y: 820 });
const last = frames[frames.length - 1];
const move = f => f.transform.match(/translate\((-?\d+)px, (-?\d+)px\)/).slice(1).map(Number);
check('the stub starts where the poster is and fades in', frames[0].offset === 0 && frames[0].opacity === 0 && move(frames[0]).join() === '0,0');
check('it ends on the tab, small and gone', last.offset === 1 && last.opacity === 0 && move(last).join() === '130,320' && /scale\(\.32\)/.test(last.transform));
check('offsets climb from 0 to 1', frames.every((f, i) => i === 0 || f.offset > frames[i - 1].offset));
check('it arcs above both ends on the way', frames.some(f => move(f)[1] < 0));
const up = stub.stubKeyframes({ x: 900, y: 600 }, { x: 800, y: 30 });
check('to a tab above, it still rises over the tab before dropping in', Math.min(...up.map(f => move(f)[1])) < -570 && move(up[up.length - 1])[1] === -570);

// ---------- lift ----------
const centre = lift.liftFor(.5, .5);
check('a pointer in the middle does not lean the card', centre.rx === 0 && centre.ry === 0 && centre.gx === 50 && centre.gy === 50);
const corner = lift.liftFor(1, 0);
check('top right leans the card back and to the right', corner.rx === 4.5 && corner.ry === 5.5 && corner.gx === 100 && corner.gy === 0);
check('outside the art, the lean is clamped', JSON.stringify(lift.liftFor(3, -2)) === JSON.stringify(corner));

// ---------- sticky bars ----------
check('a bar at its sticky offset is stuck', sticky.isStuck(68, 68) && sticky.isStuck(68.3, 68));
check('a bar still scrolling toward it is not', !sticky.isStuck(90, 68) && !sticky.isStuck(20, 68));
check('an unparseable offset is never stuck', !sticky.isStuck(0, NaN));
check('every sticky bar with a gap is covered', ['.stats-index', '.settings-toolbar', '.discover-jumpbar', '.notification-toolbar', '.bo-page-tools', '.fp-toolbar'].every(s => sticky.STICKY_BARS.includes(s)));

summary();
