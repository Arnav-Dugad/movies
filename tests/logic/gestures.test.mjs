// Pick for me, swiping a Continue Watching card, pull to refresh, shake to
// reshuffle, the watched-today count and the Stats help cards.
import { check, summary } from './harness.mjs';

const SRC = new URL('../../js/', import.meta.url).href;
const pick = await import(SRC + 'pick-for-me.js');
const swipe = await import(SRC + 'continue-swipe.js');
const pull = await import(SRC + 'pull-refresh.js');
const shake = await import(SRC + 'shake.js');
const today = await import(SRC + 'watched-today.js');
const help = await import(SRC + 'stats-help.js');

// ---------- pick for me ----------
const reel = pick.spinSequence(6, 3);
check('the reel ends on the winner', reel.at(-1) === 3);
check('the reel is long enough to read as a spin', reel.length >= 12);
check('every frame is a real poster', reel.every(index => index >= 0 && index < 6));
check('consecutive frames differ, so the reel visibly moves', reel.every((value, i) => i === 0 || value !== reel[i - 1]));
check('a winner outside the row wraps into it', pick.spinSequence(4, 9).at(-1) === 1 && pick.spinSequence(4, -1).at(-1) === 3);
check('an empty row has no reel', pick.spinSequence(0, 0).length === 0);
check('frames slow down toward the end', pick.frameDelay(0, 15) < pick.frameDelay(7, 15) && pick.frameDelay(7, 15) < pick.frameDelay(14, 15));
check('the first frame is a flash and the last a beat', pick.frameDelay(0, 15) <= 50 && pick.frameDelay(14, 15) >= 200);
check('a single frame just rests', pick.frameDelay(0, 1) === 250);
const cards = [
  { dataset: { id: '1', type: 'movie', title: 'One', year: '2020' }, querySelector: () => ({ src: 'a.jpg' }) },
  { dataset: { id: '2', type: 'tv', title: 'Two' }, querySelector: () => ({ src: '' }) },
  { dataset: { type: 'movie', title: 'No id' }, querySelector: () => ({ src: 'c.jpg' }) },
];
const picks = pick.rowPicks(cards);
check('only cards with an id, a type and artwork can be picked', picks.length === 1 && picks[0].title === 'One' && picks[0].poster === 'a.jpg');

// ---------- continue swipe ----------
check('a short drag does nothing', swipe.swipeAction(-30) === '' && swipe.swipeAction(40) === '');
check('up marks the next episode, down hides the show', swipe.swipeAction(-70) === 'watch' && swipe.swipeAction(70) === 'hide');
check('a film, with no next episode, cannot be marked this way', swipe.swipeAction(-90, { canMark: false }) === '');
check('the card follows the finger up to the line', swipe.swipeOffset(-40) === -40 && swipe.swipeOffset(55) === 55);
check('past the line it resists', Math.abs(swipe.swipeOffset(-140)) < 140 && Math.abs(swipe.swipeOffset(-140)) > 62);
check('resistance is capped, so the card never leaves the rail', Math.abs(swipe.swipeOffset(900)) <= 62 * 1.6);

// ---------- pull to refresh ----------
check('no pull, no progress', pull.pullProgress(0) === 0 && pull.pullProgress(-40) === 0);
check('progress grows with the pull', pull.pullProgress(30) < pull.pullProgress(70) && pull.pullProgress(70) < pull.pullProgress(120));
check('progress never passes 1', pull.pullProgress(2000) === 1);
check('the pull stiffens past the arming point', pull.pullProgress(88 + 20) - pull.pullProgress(88) < pull.pullProgress(88) - pull.pullProgress(68));
check('releasing refreshes only past the line', !pull.pullArmed(80) && pull.pullArmed(88) && pull.pullArmed(200));

// ---------- shake ----------
const detect = shake.shakeDetector();
const gentle = { x: 3, y: 4, z: 2 }, hard = { x: 20, y: -12, z: 8 };
check('a still phone never shakes', [0, 1, 2, 3].every(i => !detect(gentle, 1000 + i * 100)));
check('one jolt is not a shake', !detect(hard, 2000));
check('two are not either', !detect(hard, 2200));
check('three inside the window are', detect(hard, 2400));
check('the same shake does not fire twice', !detect(hard, 2500) && !detect(hard, 2700) && !detect(hard, 2900));
check('after the cooldown it can fire again', (() => {
  const at = 2400 + 2600;
  return !detect(hard, at) && !detect(hard, at + 100) && detect(hard, at + 200);
})());
check('jolts spread far apart never add up', (() => {
  const slow = shake.shakeDetector();
  return [0, 2000, 4000, 6000].every(offset => !slow(hard, 10000 + offset));
})());

// ---------- watched today ----------
const day = '2026-09-18';
const at = (d, h) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`).getTime();
const events = [
  { at: at(day, 21), bulk: false }, { at: at(day, 22), bulk: false },
  { at: at(day, 23), bulk: true },
  { at: at('2026-09-17', 20), bulk: false },
];
check('today counts today only', today.watchedOn(day, events) === 2);
check('bookkeeping marks are not viewing', today.watchedOn(day, events.filter(e => e.bulk)) === 0);
check('a quiet day counts nothing', today.watchedOn('2026-09-16', events) === 0 && today.watchedOn(day, []) === 0);

// ---------- stats help ----------
check('each block gets its own scene', help.sceneFor('stats-panel watch-diary') === 'year' && help.sceneFor('stats-panel tv-tracker') === 'tv');
check('an unknown block still gets one', help.sceneFor('stats-panel something-new') === 'projector' && help.sceneFor('') === 'projector');

const art = await import(SRC + 'illustrations.js');
check('every scene named for a block is a real scene', Object.values(help.SCENES).every(name => art.ILLUSTRATIONS.includes(name)));

summary();
