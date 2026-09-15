// ===== VIEWING PATTERNS =====
// "You watch Severance on weeknights, The Bear on weekends" — read from when
// episodes were marked. A mark is the only clock CineVerse has, so it stands in
// for when an episode was watched; bookkeeping marks (a whole season at once, a
// back-filled history) are excluded through viewingLog, and a batch counts once,
// as one sitting, so a single "Up to here" cannot outvote a month of evenings.
//
// A pattern is only claimed when there is one: at least five sittings on at
// least three different days, and a clear lean — most sittings on weekends, or
// nearly all on weekdays, and/or most of them in one part of the day. Otherwise
// no sentence is produced.
import { viewingLog } from './episodes.js';

const HOUR = 3600000;
export const MIN_SITTINGS = 5;
const MIN_DAYS = 3;

const partOfDay = hour => (hour >= 5 && hour < 12 ? 'morning' : hour < 17 && hour >= 12 ? 'afternoon' : hour >= 17 && hour < 22 ? 'evening' : 'late');

const PHRASES = {
  weekdays: { evening: 'on weeknights', late: 'late on weeknights', morning: 'on weekday mornings', afternoon: 'on weekday afternoons', '': 'on weekdays' },
  weekends: { evening: 'on weekend evenings', late: 'late on weekends', morning: 'on weekend mornings', afternoon: 'on weekend afternoons', '': 'on weekends' },
  week: { evening: 'in the evenings', late: 'late at night', morning: 'in the mornings', afternoon: 'in the afternoons', '': '' },
};

/** Pattern from sitting timestamps (ms), or null when there is no clear one. */
export function pacingProfile(stamps) {
  const sittings = [...new Set((stamps || []).filter(value => Number.isFinite(value) && value > 0))];
  if (sittings.length < MIN_SITTINGS) return null;
  const days = new Set();
  let weekend = 0;
  const parts = { morning: 0, afternoon: 0, evening: 0, late: 0 };
  for (const at of sittings) {
    const moment = new Date(at);
    // Past midnight still belongs to the night before: 1 a.m. on Saturday is a
    // Friday night, not a weekend morning.
    const night = moment.getHours() < 5 ? new Date(at - 5 * HOUR) : moment;
    days.add(`${night.getFullYear()}-${night.getMonth()}-${night.getDate()}`);
    if (night.getDay() === 0 || night.getDay() === 6) weekend++;
    parts[partOfDay(moment.getHours())]++;
  }
  if (days.size < MIN_DAYS) return null;
  const weekendShare = weekend / sittings.length;
  const when = weekendShare >= 0.6 ? 'weekends' : weekendShare <= 0.2 ? 'weekdays' : 'week';
  const [topPart, topCount] = Object.entries(parts).sort((a, b) => b[1] - a[1])[0];
  const time = topCount / sittings.length >= 0.5 ? topPart : '';
  const phrase = PHRASES[when][time];
  if (!phrase) return null;
  return { phrase, when, time, weekendShare, sittings: sittings.length, days: days.size };
}

/** Sitting timestamps for one show: viewing rows only, a batch counted once. */
export const sittingStamps = entry => viewingLog(entry).filter(row => row.viewing).map(row => row.at);

export function showPacing(entry) {
  return pacingProfile(sittingStamps(entry));
}

export const pacingSentence = (title, profile) => (profile ? `You watch ${title} ${profile.phrase}` : '');

/**
 * One sentence across shows, contrasting their patterns:
 * "You watch Severance on weeknights, The Bear on weekends". Uses shows watched
 * in the last `recentDays`, most sittings first, one show per distinct pattern.
 */
export function pacingInsight(entries, { now = Date.now(), recentDays = 90, limit = 3 } = {}) {
  const since = now - recentDays * 24 * HOUR;
  const shows = (entries || [])
    .filter(entry => entry?.tmdbId && !entry.dropped)
    .map(entry => {
      const stamps = sittingStamps(entry);
      return { entry, stamps, recent: stamps.filter(at => at >= since).length, profile: pacingProfile(stamps) };
    })
    .filter(show => show.profile && show.recent)
    .sort((a, b) => b.recent - a.recent || b.stamps.length - a.stamps.length);
  const picked = [], phrases = new Set();
  for (const show of shows) {
    if (phrases.has(show.profile.phrase)) continue;
    phrases.add(show.profile.phrase);
    picked.push(show);
    if (picked.length === limit) break;
  }
  if (!picked.length) return '';
  return `You watch ${picked.map(show => `${show.entry.title || 'a show'} ${show.profile.phrase}`).join(', ')}`;
}
