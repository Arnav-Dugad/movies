// ===== WATCHING MOOD =====
// "Because you're watching" used to follow the whole show: TMDB's
// recommendations for Severance, whatever episode you were on. This reads the
// episodes you actually just watched and follows their mood instead.
//
// TMDB has no keywords for episodes (the endpoint does not exist), and an
// episode's overview is a sentence or two. So the mood is read from text:
//
//   1. The last few episodes you marked — their overviews, the most recent
//      weighted highest — plus the overview of the season they are in. Episode
//      TITLES are not read: they are often metaphors ("Trojan's Horse", "Kiss of
//      Death") and misread as moods.
//   2. A lexicon of moods, each a set of phrases that clearly signal it
//      ("betrays", "cover-up", "on the run") and the TMDB keyword ids that
//      catalogue it. Every id was checked against TMDB for an exact name and a
//      real body of titles; ambiguous words ("loss", "team") are left out.
//   3. The show's own TMDB keywords corroborate a mood (a bonus when the show
//      is catalogued with it) and can be moods themselves when their name
//      appears in what you just watched.
//
// Only moods the recent episodes actually mention are used, at most three. When
// nothing is detected the rail keeps its old behaviour and says so — it never
// claims a mood it did not find.
import { tmdb } from './api.js';

// label, phrase pattern (matched on lower-case text), TMDB keyword ids
export const MOODS = [
  ['murder', /\bmurder|\bkill(s|ed|er|ers|ing)?\b|\bslain\b|\bhomicide/, [9826]],
  ['serial killers', /\bserial killer/, [10714]],
  ['revenge', /\brevenge|\bvengeance|\bretaliat|\bpayback/, [9748]],
  ['betrayal', /\bbetray|\bdouble[- ]cross|\btraitor/, [10085]],
  ['conspiracy', /\bconspir|\bcover[- ]?ups?\b|\bcovers? up\b|\bhidden agenda/, [10410, 9665]],
  ['heists', /\bheist|\brobbery|\brob(s|bing)? (a|the)\b|\bsteal(s|ing)?\b|\bstolen\b/, [10051]],
  ['escape', /\bescap(e|es|ed|ing)\b|\bbreak(s|ing)? out\b|\bon the run\b|\bflee(s|ing)?\b|\bfled\b/, [10685, 10718]],
  ['grief', /\bgrie(f|ve|ves|ving)\b|\bmourn|\bfuneral/, [9872]],
  ['romance', /\bromanc|\bromantic|\bfall(s|ing)? in love|\bfell in love|\bfirst date\b|\bkiss(es|ed)?\b/, [9840]],
  ['weddings', /\bwedding|\bmarr(y|ies|ied|iage)\b|\bengage(d|ment)\b|\bpropos(e|es|al)\b/, [13027]],
  ['war', /\bwars?\b|\bbattlefield|\bsoldiers?\b/, [273967]],
  ['survival',/\bsurviv(e|es|al|ing)\b|\bstranded\b/, [10349]],
  ['kidnapping', /\bkidnap|\babduct|\bhostage|\bransom\b/, [1930, 1562]],
  ['investigation', /\binvestigat|\bdetective|\binterrogat|\bprime suspect|\bthe case\b/, [5340]],
  ['disappearances', /\bmissing\b|\bdisappear|\bvanish/, [156091, 10941]],
  ['hauntings', /\bghost|\bhaunt|\bpossess(ed|ion)\b/, [162846, 3358]],
  ['time travel', /\btime travel|\btime loop|\bback in time\b/, [4379]],
  ['prison', /\bprison|\bjail|\binmate|\bbehind bars\b/, [378]],
  ['double lives', /\bundercover|\bdouble life|\bsecret identity|\binfiltrat/, [1568, 848]],
  ['espionage', /\bspy\b|\bspies\b|\bespionage|\bcia\b|\bmi6\b|\bkgb\b/, [470]],
  ['addiction', /\baddict|\boverdose|\brelapse|\brehab\b/, [6782]],
  ['rebellion', /\brebel|\brevolution|\buprising\b/, [11196]],
  ['power struggles', /\bpower struggle|\bthrone\b|\bsuccession\b|\bseize (power|control)|\bcoup\b/, [188277]],
  ['corruption', /\bcorrupt|\bbrib(e|es|ery)\b/, [417]],
  ['family conflict', /\bfamily (feud|conflict|tensions?|rift)|\bestranged\b|\bsibling rivalry/, [155294, 380]],
  ['friendship', /\bfriendship|\bbest friends?\b/, [6054]],
  ['courtroom drama', /\btrial\b|\bcourtroom|\bjury\b|\bverdict|\blawsuit|\bin court\b/, [33519]],
  ['manipulation', /\bmanipulat|\bgaslight|\bblackmail/, [2887, 1936]],
  ['paranoia', /\bparanoi|\bsurveillance\b/, [2340]],
  ['memory', /\bmemor(y|ies)\b|\bamnesia|\bforgotten past\b/, [10937, 1453]],
  ['identity', /\bidentity\b|\bwho (he|she|they) really (is|are)\b/, [1284]],
  ['dystopia', /\bdystopi|\btotalitarian|\bauthoritarian regime/, [4565]],
  ['infidelity', /\baffair\b|\bcheat(s|ed|ing)? on\b|\binfidel|\bjealous/, [1326, 931]],
  ['assassination', /\bassassin/, [441]],
  ['rivalry', /\brival/, [9823]],
  ['obsession', /\bobsess/, [1523]],
  ['coming of age', /\bcoming of age|\bgrow(s|ing)? up\b|\bteenage/, [10683]],
  ['loneliness', /\blonel(y|iness)|\bisolation\b/, [9957]],
  ['cults', /\bcults?\b/, [6158]],
  ['terrorism', /\bterroris|\bbomb(s|ing|er)?\b/, [13015]],
  ['trauma', /\btrauma|\bptsd\b|\bbreakdown\b|\bmental (health|illness)|\btherap(y|ist)\b/, [2754, 41329]],
  ['pregnancy', /\bpregnan/, [3725]],
  ['divorce', /\bdivorc/, [15160]],
  ['ambition', /\bambitio|\bgreed/, [3734, 5332]],
  ['workplace', /\bworkplace|\bcoworkers?\b|\bco-workers?\b|\bcolleagues?\b|\boffice\b/, [6282]],
];

// Keywords too broad to be a mood: they restate a genre or a format.
const GENERIC_KEYWORD = /^(drama|thriller|comedy|mystery|horror|crime|romance|action|adventure|fantasy|science fiction|sci-fi|based on (novel|comic|book|true story).*|miniseries|sitcom|anime|tv series|television series|remake|sequel|woman director|duringcreditsstinger|aftercreditsstinger)$/;

const tokens = name => String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 3);

/**
 * Pure: detect moods from recent episodes.
 * @param {{episodes: {name?: string, overview?: string, weight?: number}[], seasonOverview?: string, showKeywords?: {id:number,name:string}[]}} input
 * @returns {{label: string, ids: number[], score: number}[]} strongest first, at most three
 */
export function detectMoods({ episodes = [], seasonOverview = '', showKeywords = [] } = {}) {
  const texts = [
    ...episodes.map(episode => ({ text: String(episode.overview || '').toLowerCase(), weight: +episode.weight || 1 })),
    { text: String(seasonOverview || '').toLowerCase(), weight: 1 },
  ].filter(item => item.text.trim().length > 2);
  const showIds = new Set(showKeywords.map(keyword => +keyword.id));
  const found = new Map();
  const add = (label, ids, score) => {
    const held = found.get(label) || { label, ids, score: 0 };
    held.score += score;
    found.set(label, held);
  };

  for (const [label, pattern, ids] of MOODS) {
    let score = 0;
    for (const { text, weight } of texts) if (pattern.test(text)) score += weight;
    if (!score) continue;
    // The show being catalogued with the mood makes the reading more certain.
    if (ids.some(id => showIds.has(id))) score += 1.5;
    add(label, ids, score);
  }

  // The show's own specific keywords, when what you just watched names them.
  const moodIds = new Set(MOODS.flatMap(([, , ids]) => ids));
  for (const keyword of showKeywords) {
    const name = String(keyword.name || '').toLowerCase();
    if (!keyword.id || moodIds.has(+keyword.id) || GENERIC_KEYWORD.test(name)) continue;
    const words = tokens(name);
    if (!words.length) continue;
    let score = 0;
    for (const { text, weight } of texts) {
      // Whole words, a plural allowed: "king" must not match "kingdom".
      const hits = words.filter(word => new RegExp(`\\b${word}(s|es)?\\b`).test(text)).length;
      if (hits === words.length) score += weight;
    }
    if (score) add(name, [+keyword.id], score);
  }

  // A mood must come from the episodes, not the season blurb alone, unless the
  // show itself corroborates it.
  return [...found.values()]
    .filter(mood => mood.score >= 1.5)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 3);
}

/** The last few episodes marked, newest first, with falling weights. */
export function recentEpisodes(entry, count = 3) {
  const rows = (Array.isArray(entry?.log) ? entry.log : [])
    .filter(row => Array.isArray(row) && +row[2] > 0)
    .map(row => ({ season: +row[0], episode: +row[1], at: +row[2] }))
    .sort((a, b) => b.at - a.at || b.season - a.season || b.episode - a.episode);
  const seen = new Set(), out = [];
  for (const row of rows) {
    const key = `${row.season}_${row.episode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length === count) break;
  }
  if (!out.length && entry?.lastWatched?.season) out.push({ season: +entry.lastWatched.season, episode: +entry.lastWatched.episode, at: +entry.lastWatched.at || 0 });
  return out.map((row, index) => ({ ...row, weight: [3, 2, 1][index] || 1 }));
}

/** "S2 E5", "S2 E4–E5", or "S1 E9 – S2 E1" — the episodes a mood was read from. */
export function episodesLabel(episodes) {
  if (!episodes.length) return '';
  const sorted = [...episodes].sort((a, b) => a.season - b.season || a.episode - b.episode);
  const first = sorted[0], last = sorted[sorted.length - 1];
  if (first.season === last.season && first.episode === last.episode) return `S${first.season} E${first.episode}`;
  if (first.season === last.season) return `S${first.season} E${first.episode}–E${last.episode}`;
  return `S${first.season} E${first.episode} – S${last.season} E${last.episode}`;
}

// TV genres that have a film counterpart, for finding films in the same mood.
const MOVIE_GENRES_FOR_TV = { 10759: [28, 12], 10765: [878, 14], 10768: [10752], 18: [18], 80: [80], 9648: [9648], 35: [35], 37: [37], 99: [99], 16: [16], 10751: [10751] };
export const movieGenresFor = tvGenres => [...new Set((tvGenres || []).flatMap(id => MOVIE_GENRES_FOR_TV[id] || []))];

/**
 * Read the mood of a show's recent episodes (network: the show's keywords and
 * the season(s) of those episodes, both cached by tmdb()). Resolves to
 * { moods, ids, episodes, label } or null when nothing could be read.
 */
export async function loadWatchingMood(showId, entry) {
  const episodes = recentEpisodes(entry);
  if (!showId || !episodes.length) return null;
  const seasons = [...new Set(episodes.map(episode => episode.season))];
  const [keywords, ...seasonData] = await Promise.all([
    tmdb(`/tv/${showId}/keywords`).catch(() => null),
    ...seasons.map(season => tmdb(`/tv/${showId}/season/${season}`).catch(() => null)),
  ]);
  const bySeason = new Map(seasons.map((season, index) => [season, seasonData[index]]));
  const detailed = episodes.map(episode => {
    const match = (bySeason.get(episode.season)?.episodes || []).find(item => +item.episode_number === episode.episode);
    return { ...episode, name: match?.name || '', overview: match?.overview || '' };
  });
  const latestSeason = bySeason.get(episodes[0].season);
  const moods = detectMoods({ episodes: detailed, seasonOverview: latestSeason?.overview || '', showKeywords: keywords?.results || [] });
  return {
    moods,
    ids: [...new Set(moods.flatMap(mood => mood.ids))],
    episodes: detailed,
    label: episodesLabel(episodes),
  };
}
