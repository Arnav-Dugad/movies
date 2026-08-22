// ===== FIRST-RUN ONBOARDING =====
// A new account landed on a home page personalised from nothing: empty rails,
// recommendations with no signal to rank on, and streaming availability for
// whatever region the browser happened to imply. Three questions fix all three,
// and they are questions with real consequences — the region is the one used for
// every provider lookup from that moment, and the genres are folded into the
// taste profile (js/recommend.js) with a weight small enough that real viewing
// history overtakes them within a handful of titles.
//
// It shows once, for anyone with nothing in their library — including a visitor
// who has not signed up, because that is exactly who is looking at the emptiest
// version of the app. Their answers are kept on the device and adopted by the
// account the moment they create one, so nobody is asked the same three questions
// twice. Skipping counts as answering.
import { db, firebase } from './firebase.js';
import { state } from './state.js';
import { $, esc, toast, trapFocus, lockScroll, unlockScroll } from './ui.js';
import { registerActions } from './events.js';
import { REGIONS, mGenreList, regionLabel } from './config.js';

const MIN_GENRES = 2;
const MAX_GENRES = 6;
const STEPS = 3;
const GUEST_KEY = 'cv_onboarding_guest_v1';

let flow = null;         // { step, genres:Set, region } while open
let releaseFocus = null;
let checked = false;     // one attempt per page load

const overlay = () => $('onboardOverlay');

/** Nothing in the library — the only state this flow makes sense for. */
const libraryIsEmpty = () =>
  !state.watchlist.length &&
  !Object.keys(state.watched).length &&
  !Object.keys(state.ratings).length;

function readGuest() {
  try {
    const raw = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    return {
      done: !!raw.done,
      region: typeof raw.region === 'string' ? raw.region : '',
      seedGenres: Array.isArray(raw.seedGenres) ? raw.seedGenres.map(Number).filter(Number.isFinite).slice(0, MAX_GENRES) : [],
    };
  } catch (_) { return null; }
}

function writeGuest(value) {
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(value)); } catch (_) {}
}

export function shouldOnboard() {
  if (!libraryIsEmpty()) return false;
  if (state.user) return !state.profile?.onboarded;
  // A signed-out visitor who has already answered, or who has clearly been
  // browsing for a while, is not a first run.
  return !readGuest()?.done && (state.recentlyViewed || []).length === 0;
}

/**
 * Put a guest's answers into the running state so recommendations and provider
 * lookups use them before there is any account to store them on. Called on boot.
 */
export function hydrateGuestOnboarding() {
  const guest = readGuest();
  if (!guest) return;
  if (guest.seedGenres.length) state.profile = { ...state.profile, seedGenres: guest.seedGenres };
  if (guest.region && REGIONS.some(([code]) => code === guest.region)) state.region = guest.region;
}

/**
 * Hand a guest's answers to the account they just created. Only ever fills a gap:
 * an account that already answered keeps its own, and the guest copy is dropped
 * either way so a shared device cannot leak one person's answers into the next
 * account signed in on it.
 */
export async function adoptGuestOnboarding() {
  const guest = readGuest();
  if (!state.user || !guest?.done) return;
  try { localStorage.removeItem(GUEST_KEY); } catch (_) {}
  if (state.profile?.onboarded) return;
  state.profile.onboarded = true;
  state.profile.seedGenres = guest.seedGenres;
  try {
    await db.collection('users').doc(state.user.uid).set({
      onboarded: true,
      onboardedAt: firebase.firestore.FieldValue.serverTimestamp(),
      seedGenres: guest.seedGenres,
      ...(guest.region ? { experiencePrefs: { region: guest.region } } : {}),
    }, { merge: true });
  } catch (error) { console.warn('adopt onboarding', error); }
}

export function maybeStartOnboarding() {
  if (checked || !shouldOnboard()) return;
  checked = true;
  // Let the page finish its first paint — arriving on top of a half-drawn home
  // screen reads as an error, not a welcome.
  setTimeout(() => { if (shouldOnboard()) openOnboarding(); }, 900);
}

export function openOnboarding() {
  const host = overlay();
  if (!host || flow) return;
  flow = { step: 1, genres: new Set(), region: state.region || 'IN', trigger: document.activeElement };
  paint();
  host.classList.add('active');
  lockScroll();
  releaseFocus = trapFocus(host, flow.trigger);
  host.querySelector('.ob-primary')?.focus();
}

function closeOnboarding() {
  const host = overlay();
  flow = null;
  if (host) { host.classList.remove('active'); host.innerHTML = ''; }
  unlockScroll();
  if (releaseFocus) { releaseFocus(); releaseFocus = null; }
}

// ---------- steps ----------
function regionStep() {
  const options = REGIONS.map(([code]) =>
    `<option value="${code}"${code === flow.region ? ' selected' : ''}>${esc(regionLabel(code))}</option>`).join('');
  return `
    <h2>Where do you watch?</h2>
    <p class="ob-lede">This sets which country's streaming catalogue CineVerse checks. Every "available on" answer, every departure warning, and the provider stats all follow it.</p>
    <label class="ob-field"><span>Streaming region</span>
      <select class="ob-select" data-action="ob-region" aria-label="Streaming region">${options}</select>
    </label>
    <p class="ob-note">You can change this any time from Settings, or from the picker on any title.</p>`;
}

function genreStep() {
  const picked = flow.genres.size;
  const chips = mGenreList.map(g =>
    `<button type="button" class="ob-chip${flow.genres.has(g.id) ? ' on' : ''}" data-action="ob-genre" data-id="${g.id}" aria-pressed="${flow.genres.has(g.id)}">${esc(g.n)}</button>`).join('');
  return `
    <h2>What do you actually like?</h2>
    <p class="ob-lede">Pick ${MIN_GENRES}–${MAX_GENRES} to start with. This is a seed, not a setting: once you have watched and rated a few things, what you do outweighs what you picked here.</p>
    <div class="ob-chips">${chips}</div>
    <p class="ob-note" aria-live="polite">${picked ? `${picked} selected${picked < MIN_GENRES ? ` · pick ${MIN_GENRES - picked} more` : ''}` : `Choose at least ${MIN_GENRES}`}</p>`;
}

function finishStep() {
  const names = mGenreList.filter(g => flow.genres.has(g.id)).map(g => g.n);
  const lede = names.length
    ? `Recommendations will start from <b>${esc(names.join(', '))}</b> in ${esc(regionLabel(flow.region))}.`
    : `Recommendations will start from what you watch, in ${esc(regionLabel(flow.region))}.`;
  // A visitor with no account gets the honest version: nothing they mark can be
  // kept until there is somewhere to keep it.
  const paths = state.user
    ? `<button type="button" class="ob-path" data-action="ob-finish" data-go="import">
        <b>I already track films elsewhere</b>
        <small>Import a Letterboxd, Trakt, or IMDb CSV — watched titles and ratings come across, nothing is overwritten.</small>
      </button>
      <button type="button" class="ob-path" data-action="ob-finish" data-go="home">
        <b>Start from scratch</b>
        <small>Browse, and mark things watched as you go. The rails fill in from the first title.</small>
      </button>`
    : `<button type="button" class="ob-path" data-action="ob-finish" data-go="signup">
        <b>Create an account</b>
        <small>Needed to keep a watchlist, ratings, or episode progress. These answers come with you.</small>
      </button>
      <button type="button" class="ob-path" data-action="ob-finish" data-go="home">
        <b>Just look around first</b>
        <small>Browse and search freely. Your picks are remembered on this device until you sign up.</small>
      </button>`;
  return `
    <h2>${state.user ? "You're set up" : "Ready when you are"}</h2>
    <p class="ob-lede">${lede}</p>
    <div class="ob-paths">${paths}</div>`;
}

function paint() {
  const host = overlay();
  if (!host || !flow) return;
  const body = flow.step === 1 ? regionStep() : flow.step === 2 ? genreStep() : finishStep();
  const canAdvance = flow.step !== 2 || flow.genres.size >= MIN_GENRES;
  host.innerHTML = `
    <div class="ob-modal" role="document">
      <div class="ob-progress" aria-hidden="true">${Array.from({ length: STEPS }, (_, i) =>
        `<i class="${i + 1 < flow.step ? 'done' : i + 1 === flow.step ? 'on' : ''}"></i>`).join('')}</div>
      <div class="ob-head">
        <span class="ob-step">Step ${flow.step} of ${STEPS}</span>
        <button type="button" class="ob-skip" data-action="ob-skip">Skip setup</button>
      </div>
      <div class="ob-body">${body}</div>
      ${flow.step < STEPS ? `<div class="ob-foot">
        ${flow.step > 1 ? '<button type="button" class="btn-glass" data-action="ob-back">Back</button>' : '<span></span>'}
        <button type="button" class="btn-primary ob-primary" data-action="ob-next"${canAdvance ? '' : ' disabled'}>Continue</button>
      </div>` : ''}
    </div>`;
}

// ---------- persistence ----------
// One write, merged, and only ever additive: the flag and the seed. A failure
// here must not trap someone in the flow, so the modal closes either way and the
// worst case is being asked once more on the next sign-in.
async function persist(seedGenres) {
  const region = flow?.region || state.region;
  if (!state.user) {
    // No account to write to. Keep the answers on the device and use them now —
    // they are adopted by the first account created here (adoptGuestOnboarding).
    writeGuest({ done: true, region, seedGenres });
    state.profile = { ...state.profile, seedGenres };
    return;
  }
  const payload = {
    onboarded: true,
    onboardedAt: firebase.firestore.FieldValue.serverTimestamp(),
    seedGenres,
    experiencePrefs: { region },
  };
  state.profile.onboarded = true;
  state.profile.seedGenres = seedGenres;
  try {
    await db.collection('users').doc(state.user.uid).set(payload, { merge: true });
  } catch (error) {
    console.warn('onboarding save', error);
  }
}

function applyRegion(code) {
  if (!REGIONS.some(([value]) => value === code) || state.region === code) return;
  state.region = code;
  try { localStorage.setItem('cv_region', code); } catch (_) {}
  document.dispatchEvent(new Event('cv:region'));
}

export function initOnboarding() {
  registerActions({
    'ob-region': (el) => { if (flow) flow.region = el.value; },
    'ob-genre': (el) => {
      if (!flow) return;
      const id = +el.dataset.id;
      if (flow.genres.has(id)) flow.genres.delete(id);
      else if (flow.genres.size >= MAX_GENRES) { toast(`Pick up to ${MAX_GENRES} — you can refine later`, 'info'); return; }
      else flow.genres.add(id);
      paint();
      // Repainting moves focus to the top of the modal, which is jarring
      // mid-selection. Put it back on the chip that was just pressed.
      overlay()?.querySelector(`.ob-chip[data-id="${id}"]`)?.focus();
    },
    'ob-back': () => { if (flow && flow.step > 1) { flow.step--; paint(); overlay()?.querySelector('.ob-primary')?.focus(); } },
    'ob-next': () => {
      if (!flow) return;
      if (flow.step === 1) applyRegion(flow.region);
      if (flow.step === 2 && flow.genres.size < MIN_GENRES) return;
      flow.step = Math.min(STEPS, flow.step + 1);
      paint();
      overlay()?.querySelector('.ob-modal')?.focus?.();
    },
    'ob-finish': (el) => {
      const go = el.dataset.go;
      const seed = [...(flow?.genres || [])];
      applyRegion(flow?.region || state.region);
      persist(seed);
      closeOnboarding();
      if (go === 'import') document.dispatchEvent(new CustomEvent('cv:go', { detail: '/settings' }));
      else if (go === 'signup') document.dispatchEvent(new Event('cv:open-auth'));
      toast('Welcome to CineVerse', 'success');
    },
    'ob-skip': () => {
      // Skipping is an answer. Whatever was chosen so far still counts — there is
      // no reason to throw away a region the user already picked.
      applyRegion(flow?.region || state.region);
      persist([...(flow?.genres || [])]);
      closeOnboarding();
    },
  });

  hydrateGuestOnboarding();
  document.addEventListener('cv:auth', async () => {
    // A brand-new account inherits whatever the visitor answered before signing up.
    if (state.user) await adoptGuestOnboarding();
    checked = false;
    maybeStartOnboarding();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && flow) { e.preventDefault(); persist([...flow.genres]); closeOnboarding(); }
  });
}
