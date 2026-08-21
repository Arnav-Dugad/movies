// ===== VOICE SEARCH & COMMANDS =====
//
// Why the desktop microphone used to fail
// ---------------------------------------
// The old flow awaited navigator.mediaDevices.getUserMedia() *before* calling
// SpeechRecognition.start(). On desktop Chrome that is actively harmful:
//
//   1. The await ends the user-activation window, and start() then runs from a
//      task the browser no longer treats as user-initiated.
//   2. Opening a capture stream and stopping its tracks a millisecond later
//      leaves the device mid-teardown; the recognition engine claims it while the
//      OS still has it open and reports `audio-capture`, or silently never fires
//      onstart at all.
//
// The fix is to let SpeechRecognition own the microphone. start() is called
// synchronously inside the click handler, and getUserMedia is used only as a
// *recovery* path when recognition reports a permission or capture failure — at
// which point a real prompt (or a real error name) is exactly what we want. A
// watchdog covers Chrome's silent-no-start failure by recovering the same way.
import { tmdb } from './api.js';
import { state } from './state.js';
import { $, esc, toast, debounce } from './ui.js';
import { registerActions } from './events.js';
import { addToList, removeFromAllLists } from './lists.js';
import { toggleWatched } from './watchlist.js';
import { playTrailer } from './media.js';
import { openRating } from './ratings.js';
import { adultFlag } from './prefs.js';

const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const START_TIMEOUT = 2600;
const MAX_SILENT_RESTARTS = 3;

let session = null;              // the live SpeechRecognition instance
let phase = 'idle';              // idle | starting | listening | working
let wantListening = false;       // user intent — survives Chrome's automatic onend
let handsFree = false;
let recovered = false;           // the getUserMedia recovery has already been tried
let silentRestarts = 0;
let startWatchdog = null;
let generation = 0;
let lastFinal = '';
let energyTimer = null, energy = 0;

const HINTS = [
  'Search for Christopher Nolan',
  'Add Dune to my watchlist',
  'Mark Interstellar as watched',
  'Play the trailer for Oppenheimer',
  'Rate Arrival 9 out of 10',
  'Go to my watchlist',
];

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
// Keys are the output of normalizePage(), so "my Watch List" and "watchlist"
// both resolve here without a separate alias for every spoken variant.
const PAGES = {
  home: 'home', homepage: 'home',
  watchlist: 'watchlist', list: 'watchlist',
  watched: 'watched',
  stats: 'stats', statistics: 'stats',
  discover: 'discover', search: 'search',
  notifications: 'notifications', releases: 'reminders', reminders: 'reminders', 'release reminders': 'reminders',
  profile: 'profile', settings: 'settings', friends: 'friends', 'watch party': 'party', party: 'party',
};

// Ordered: the most specific patterns first, so "play the trailer for X" never
// falls through to the generic "play X".
const GRAMMAR = [
  { id: 'stop', label: 'Stop listening', re: /^(?:stop|cancel|quit|exit|never\s*mind)(?:\s+listening)?$/i },
  { id: 'help', label: 'Show commands', re: /^(?:help|what can i say|show (?:me )?commands?)$/i },
  { id: 'clear', label: 'Clear search', re: /^(?:clear|reset)(?:\s+(?:the\s+)?search)?$/i },
  { id: 'navigate', label: 'Open page', re: /^(?:go|take me|navigate|open|show)\s+(?:me\s+)?(?:to\s+)?(?:my\s+)?(home|homepage|the homepage|watch\s*list|my watch\s*list|my list|list|watched|my watched|stats|statistics|my stats|discover|search|notifications|releases|reminders|release reminders|profile|settings|friends|watch party|party)$/i },
  { id: 'trailer', label: 'Play trailer', re: /^(?:play|show|watch|start)\s+(?:the\s+)?trailer\s+(?:for|of)\s+(.+)$/i },
  { id: 'rate', label: 'Rate title', re: /^(?:rate|give)\s+(.+?)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*(?:out of|\/)\s*10)?$/i },
  { id: 'add', label: 'Add to list', re: /^(?:please\s+)?(?:add|save|put)\s+(.+?)\s+(?:to|in|on|into)\s+(?:my\s+)?(?:watch\s*list|list)$/i },
  { id: 'remove', label: 'Remove from list', re: /^(?:please\s+)?(?:remove|delete|drop)\s+(.+?)\s+(?:from|off|out of)\s+(?:my\s+)?(?:watch\s*list|list)$/i },
  { id: 'watched', label: 'Mark watched', re: /^(?:please\s+)?mark\s+(.+?)\s+(?:as\s+)?watched$/i },
  { id: 'watched', label: 'Mark watched', re: /^i(?:'ve| have)?\s+(?:just\s+)?(?:already\s+)?watched\s+(.+)$/i },
  { id: 'open', label: 'Open title', re: /^(?:open|go to|pull up)\s+(?:the\s+)?(?:movie|film|show|series)?\s*(.+)$/i },
  { id: 'search', label: 'Search', re: /^(?:search|find|look)\s+(?:for\s+|up\s+)?(.+)$/i },
  { id: 'search', label: 'Search', re: /^show me\s+(.+)$/i },
];

// "my Watch List" / "watchlist" / "the homepage" all have to land on one key.
function normalizePage(value) {
  return String(value || '').toLowerCase().replace(/watch\s*list/g, 'watchlist').replace(/\s+/g, ' ').replace(/^(?:the|my)\s+/, '').trim();
}
export function voicePageFor(subject) { return PAGES[normalizePage(subject)] || ''; }

export function matchVoiceCommand(text) {
  const phrase = String(text || '').trim().replace(/[.!?,]+$/, '');
  if (!phrase) return null;
  for (const rule of GRAMMAR) {
    const hit = phrase.match(rule.re);
    if (hit) return { id: rule.id, label: rule.label, subject: (hit[1] || '').trim(), value: hit[2] || '', phrase };
  }
  return { id: 'search', label: 'Search', subject: phrase, value: '', phrase };
}

// ---------- console UI ----------
const console_ = () => $('voiceConsole');

function setState(text, tone = '') {
  const node = $('voiceState');
  if (node) { node.textContent = text; node.dataset.tone = tone; }
  const status = $('voiceSearchStatus');
  if (status) { status.textContent = text; status.classList.toggle('show', !!text); status.classList.toggle('listening', phase === 'listening'); }
}

function setTranscript(text, final) {
  const node = $('voiceTranscript'); if (!node) return;
  node.textContent = text || '';
  node.classList.toggle('final', !!final);
  node.classList.toggle('empty', !text);
}

function setIntent(command) {
  const node = $('voiceIntent'); if (!node) return;
  if (!command || command.id === 'search') { node.hidden = true; node.textContent = ''; return; }
  node.hidden = false;
  node.textContent = command.subject ? `${command.label} · ${command.subject}` : command.label;
}

function renderHints() {
  const node = $('voiceHints'); if (!node || node.dataset.filled) return;
  node.innerHTML = HINTS.map(hint => `<button type="button" data-action="voice-hint" data-phrase="${esc(hint)}">${esc(hint)}</button>`).join('');
  node.dataset.filled = '1';
}

function openConsole() {
  const host = console_(); if (!host) return;
  renderHints();
  host.classList.add('active');
  host.setAttribute('aria-hidden', 'false');
  const toggle = $('voiceHandsFree'); if (toggle) toggle.checked = handsFree;
  startEnergyLoop();
}

function closeConsole() {
  const host = console_();
  host?.classList.remove('active');
  host?.setAttribute('aria-hidden', 'true');
  stopEnergyLoop();
}

// The bars are driven by the recognizer's own sound/speech events rather than a
// second getUserMedia stream — a parallel capture is exactly what breaks the
// microphone on desktop, which is the bug this file exists to fix.
function startEnergyLoop() {
  stopEnergyLoop();
  const bars = [...(console_()?.querySelectorAll('.voice-orb span') || [])];
  if (!bars.length) return;
  let tick = 0;
  energyTimer = setInterval(() => {
    tick++;
    energy = Math.max(0.08, energy * 0.9);
    bars.forEach((bar, index) => {
      const wave = 0.5 + 0.5 * Math.sin((tick / 4) + index * 0.8);
      const height = 12 + wave * (12 + energy * 62);
      bar.style.height = `${Math.round(height)}%`;
      bar.style.opacity = String(0.45 + energy * 0.55);
    });
  }, 70);
}
function stopEnergyLoop() { clearInterval(energyTimer); energyTimer = null; energy = 0; }
const pulse = (amount = 1) => { energy = Math.min(1, energy + amount); };

function paintButton() {
  const button = $('searchVoice');
  const active = phase !== 'idle';
  if (!button) return;
  button.classList.toggle('listening', active);
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', active ? 'Stop voice search' : 'Search by voice');
}

function setPhase(next) { phase = next; paintButton(); }

// ---------- microphone recovery ----------
async function describeMicrophone() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return '';
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some(device => device.kind === 'audioinput') ? '' : 'No microphone is connected to this computer.';
  } catch (_) { return ''; }
}

const GUM_MESSAGES = {
  NotAllowedError: 'Microphone access is blocked. Click the padlock in the address bar and allow the microphone for this site.',
  SecurityError: 'Microphone access is blocked. Click the padlock in the address bar and allow the microphone for this site.',
  NotFoundError: 'No microphone was found on this computer.',
  OverconstrainedError: 'No microphone was found on this computer.',
  NotReadableError: 'Your microphone is in use by another app. Close it and try again.',
  AbortError: 'The microphone could not be opened. Try again.',
};

// Runs only after recognition has already failed. Requesting the stream here
// surfaces the browser's real permission prompt (or its real error name), then
// releases the device and gives the OS a moment before recognition retries.
async function unblockMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, message: 'This browser cannot open a microphone.' };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    stream.getTracks().forEach(track => track.stop());
    await new Promise(resolve => setTimeout(resolve, 320));
    return { ok: true, message: '' };
  } catch (error) {
    const detail = await describeMicrophone();
    return { ok: false, message: detail || GUM_MESSAGES[error?.name] || 'The desktop microphone could not be opened.' };
  }
}

// ---------- lifecycle ----------
function clearWatchdog() { clearTimeout(startWatchdog); startWatchdog = null; }

function teardown({ silent = false } = {}) {
  clearWatchdog();
  wantListening = false;
  const dying = session;
  session = null;
  if (dying) {
    dying.onstart = dying.onresult = dying.onerror = dying.onend = null;
    dying.onsoundstart = dying.onspeechstart = dying.onspeechend = dying.onaudioend = null;
    try { dying.abort(); } catch (_) {}
  }
  setPhase('idle');
  if (!silent) closeConsole();
}

export function stopVoiceSearch() {
  generation++;
  teardown();
  setTranscript('', false);
  setState('');
}

export function isVoiceListening() { return phase !== 'idle' || wantListening; }

function fail(message, { toastIt = true } = {}) {
  clearWatchdog();
  wantListening = false;
  setPhase('idle');
  setState(message, 'error');
  stopEnergyLoop();
  if (toastIt) toast(message, 'info');
  // Leave the explanation on screen long enough to read, then get out of the way.
  setTimeout(() => { if (phase === 'idle' && !wantListening) closeConsole(); }, 7000);
}

// Chrome ends a session while an action is still awaiting the network. If the
// user has not stopped, bring the microphone back rather than leaving the panel
// claiming to listen with no live recogniser behind it.
function resumeOrIdle() {
  if (wantListening && !session) { launch({ isRetry: true }); return; }
  setPhase(session ? 'listening' : 'idle');
}

async function recover(reason) {
  if (recovered) { fail(reason); return; }
  recovered = true;
  setState('Asking your browser for microphone access…');
  const result = await unblockMicrophone();
  if (!result.ok) { fail(result.message); return; }
  setState('Microphone ready. Listening again…');
  launch({ isRetry: true });
}

function launch({ isRetry = false } = {}) {
  const request = ++generation;
  wantListening = true;
  setPhase('starting');
  openConsole();
  if (!isRetry) { setTranscript('', false); setIntent(null); }
  setState(isRetry ? 'Reconnecting your microphone…' : 'Starting the microphone…');

  const recognition = new Recognition();
  session = recognition;
  recognition.lang = navigator.language || document.documentElement.lang || 'en-US';
  recognition.interimResults = true;
  // Continuous keeps the stream open through natural pauses, which is what makes
  // a spoken sentence feel fluid instead of clipped after the first phrase.
  recognition.continuous = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    if (request !== generation) return;
    clearWatchdog();
    silentRestarts = 0;
    setPhase('listening');
    setState(handsFree ? 'Listening — hands-free is on' : 'Listening…');
    try { navigator.vibrate?.(24); } catch (_) {}
  };
  recognition.onsoundstart = () => pulse(0.5);
  recognition.onspeechstart = () => { pulse(1); setState('Listening…'); };
  recognition.onspeechend = () => setState('Processing…');

  recognition.onresult = event => {
    if (request !== generation) return;
    pulse(0.6);
    let interim = '', final = '';
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index];
      if (result.isFinal) final += result[0].transcript;
      else interim += result[0].transcript;
    }
    const live = (final || interim).trim();
    if (!live) return;
    setTranscript(live, !!final);
    const command = matchVoiceCommand(live);
    setIntent(command);
    document.dispatchEvent(new CustomEvent('cv:voice-transcript', { detail: { text: live, final: !!final } }));
    if (final.trim()) runPhrase(final.trim(), request);
  };

  recognition.onerror = event => {
    if (request !== generation) return;
    clearWatchdog();
    if (event.error === 'aborted') return;
    if (event.error === 'no-speech') { setState('No speech heard yet — keep talking.'); return; }
    if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
      session = null;
      recover(event.error === 'audio-capture'
        ? 'The microphone could not be opened. Check that no other app is using it.'
        : 'Microphone access was blocked. Allow it for this site and try again.');
      return;
    }
    const messages = {
      network: 'Speech recognition needs an internet connection.',
      'language-not-supported': 'This browser has no speech model for your language.',
      'bad-grammar': 'Voice search could not interpret that. Try again.',
    };
    fail(messages[event.error] || 'Voice search stopped. Please try again.');
  };

  recognition.onend = () => {
    if (request !== generation) return;
    clearWatchdog();
    session = null;
    // Chrome ends the session on its own after a pause. Restart while the user
    // still wants to talk, with a cap so a dead microphone cannot spin forever.
    if (wantListening && phase !== 'working' && silentRestarts < MAX_SILENT_RESTARTS) {
      silentRestarts++;
      setTimeout(() => { if (wantListening && request === generation && !session) launch({ isRetry: true }); }, 220);
      return;
    }
    if (wantListening && phase !== 'working') { wantListening = false; setPhase('idle'); setState('Tap the microphone to talk again.'); }
    else if (!wantListening) setPhase('idle');
  };

  try {
    recognition.start();
  } catch (error) {
    // start() on an instance that is already running throws InvalidStateError.
    session = null;
    if (error?.name === 'InvalidStateError') { setTimeout(() => { if (wantListening) launch({ isRetry: true }); }, 260); return; }
    recover('Voice search could not start. Please try again.');
    return;
  }

  // Chrome desktop can accept start() and then never fire onstart or onerror when
  // the capture device is wedged. Treat that silence as a failure.
  clearWatchdog();
  startWatchdog = setTimeout(() => {
    if (request !== generation || phase !== 'starting') return;
    try { session?.abort(); } catch (_) {}
    session = null;
    recover('The microphone did not respond. Check your system microphone settings.');
  }, START_TIMEOUT);
}

export function startVoiceSearch() {
  if (isVoiceListening()) { stopVoiceSearch(); return; }   // the mic button toggles
  if (!Recognition) {
    fail('Voice search is not supported by this browser. Chrome, Edge, or Safari work best.');
    return;
  }
  if (!window.isSecureContext) {
    fail('Microphone access needs a secure HTTPS connection. Open CineVerse over https:// and try again.');
    return;
  }
  recovered = false;
  silentRestarts = 0;
  lastFinal = '';
  launch();
}

// ---------- command execution ----------
async function resolveTitle(title) {
  const data = await tmdb('/search/multi', { query: title, include_adult: adultFlag(), page: 1 });
  const candidates = (data.results || []).filter(item => ['movie', 'tv'].includes(item.media_type));
  const normal = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return candidates.find(item => normal(item.title || item.name) === normal(title)) || candidates[0] || null;
}

const go = path => document.dispatchEvent(new CustomEvent('cv:go', { detail: path }));

function requireAccount() {
  if (state.user) return true;
  setState('Sign in to use voice actions.');
  toast('Sign in to use voice actions', 'info');
  document.dispatchEvent(new Event('cv:open-auth'));
  return false;
}

async function detailFor(item, type) {
  const detail = await tmdb(`/${type}/${item.id}`).catch(() => item);
  return {
    poster: detail.poster_path || item.poster_path || '',
    year: (detail.release_date || detail.first_air_date || '').slice(0, 4),
    genres: (detail.genres || []).map(genre => genre.id),
    runtime: detail.runtime || (detail.episode_run_time || [])[0] || 0,
    language: detail.original_language || '',
    releaseDate: detail.release_date || detail.first_air_date || '',
    tmdbRating: detail.vote_average || 0,
    voteCount: detail.vote_count || 0,
  };
}

async function runPhrase(text, request) {
  if (request !== generation || text === lastFinal) return;
  lastFinal = text;
  const command = matchVoiceCommand(text);
  setIntent(command);

  if (command.id === 'stop') { setState('Stopped listening.'); teardown(); setTimeout(closeConsole, 700); return; }
  if (command.id === 'help') { setState('Try one of these phrases.'); return; }
  if (command.id === 'clear') {
    document.dispatchEvent(new CustomEvent('cv:voice-command', { detail: { id: 'clear' } }));
    setState('Search cleared.'); finish(); return;
  }
  if (command.id === 'navigate') {
    const page = voicePageFor(command.subject);
    if (!page) { setState(`I do not know the page “${command.subject}”.`); return; }
    setState(`Opening ${command.subject}…`);
    finish();
    go(page === 'home' ? '/' : `/${page}`);
    return;
  }
  if (command.id === 'search') {
    setState(`Searching for “${command.subject}”…`);
    document.dispatchEvent(new CustomEvent('cv:voice-command', { detail: { id: 'search', query: command.subject } }));
    finish();
    return;
  }

  // Everything below needs a resolved TMDB title.
  setPhase('working');
  setState(`Finding “${command.subject}”…`);
  try {
    const item = await resolveTitle(command.subject);
    if (!item) { resumeOrIdle(); setState(`I could not find “${command.subject}”.`); return; }
    const type = item.media_type, title = item.title || item.name, key = `${type}_${item.id}`;

    if (command.id === 'open') { setState(`Opening ${title}…`); finish(); go(`/${type}/${item.id}`); return; }

    if (command.id === 'trailer') {
      const videos = await tmdb(`/${type}/${item.id}/videos`).catch(() => null);
      const trailer = (videos?.results || []).find(video => video.site === 'YouTube' && /trailer/i.test(video.type)) || (videos?.results || []).find(video => video.site === 'YouTube');
      if (!trailer) { resumeOrIdle(); setState(`No trailer is available for ${title}.`); return; }
      setState(`Playing the ${title} trailer.`);
      finish();
      playTrailer(trailer.key);
      return;
    }

    if (!requireAccount()) { teardown(); return; }

    if (command.id === 'add') {
      if (state.watchlist.some(entry => entry.id === key)) { resumeOrIdle(); setState(`${title} is already in your lists.`); return; }
      await addToList(item, type, 'watchlist');
      setState(`Added ${title} to your watchlist.`); finish(); return;
    }
    if (command.id === 'remove') {
      if (!state.watchlist.some(entry => entry.id === key)) { resumeOrIdle(); setState(`${title} is not in your lists.`); return; }
      await removeFromAllLists(item, type);
      setState(`Removed ${title} from your lists.`); finish(); return;
    }
    if (command.id === 'watched') {
      if (state.watched[key]) { resumeOrIdle(); setState(`${title} is already marked watched.`); return; }
      await toggleWatched(item.id, type, title, await detailFor(item, type));
      setState(`Marked ${title} as watched.`); finish(); return;
    }
    if (command.id === 'rate') {
      const raw = String(command.value).toLowerCase();
      const score = Math.round(NUMBER_WORDS[raw] ?? +raw);
      if (!Number.isFinite(score) || score < 1 || score > 10) { resumeOrIdle(); setState('Ratings run from 1 to 10.'); return; }
      setState(`${score}/10 is ready for ${title} — confirm to save it.`);
      finish();
      // The score is pre-selected but never auto-submitted: a misheard number must
      // still be confirmed, so voice can't silently write a wrong rating.
      openRating(item.id, type, title, score);
      return;
    }
    resumeOrIdle();
  } catch (error) {
    console.error('voice command', error);
    resumeOrIdle();
    setState('That voice action could not be completed. Try again.');
  }
}

// After a successful action: stop unless the user asked to stay hands-free.
function finish() {
  if (handsFree) {
    lastFinal = '';
    setPhase('listening');
    setTranscript('', false);
    return;
  }
  teardown({ silent: true });
  setTimeout(() => { if (!isVoiceListening()) closeConsole(); }, 1400);
}

// ---------- init ----------
export function initVoice() {
  registerActions({
    'voice-search': () => startVoiceSearch(),
    'voice-stop': () => { setState('Stopped listening.'); teardown(); },
    'voice-cancel': () => stopVoiceSearch(),
    'voice-handsfree': element => {
      handsFree = !!element.checked;
      setState(phase === 'listening' ? (handsFree ? 'Listening — hands-free is on' : 'Listening…') : handsFree ? 'Hands-free is on' : 'Hands-free is off');
    },
    'voice-hint': element => {
      const phrase = element.dataset.phrase || '';
      setTranscript(phrase, true);
      setIntent(matchVoiceCommand(phrase));
      runPhrase(phrase, generation);
    },
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isVoiceListening()) { event.preventDefault(); stopVoiceSearch(); }
  });

  // A backgrounded tab loses the capture device on most desktop browsers; end the
  // session cleanly instead of leaving a dead "Listening…" state on screen.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && isVoiceListening()) { setState('Voice search paused.'); teardown(); }
  });

  // Keep the console reachable but out of the way once the phrase is handled.
  const settle = debounce(() => { if (!isVoiceListening() && !handsFree) closeConsole(); }, 4200);
  document.addEventListener('cv:voice-transcript', settle);
}
