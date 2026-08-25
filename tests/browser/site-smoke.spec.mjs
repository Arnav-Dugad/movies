import { test, expect } from '@playwright/test';

async function bootGuest(page) {
  // The stub below is installed before the page runs, but index.html then loads
  // the real Firebase compat SDK from gstatic, which replaces window.firebase —
  // so the app was talking to real Firestore, every write was denied, and
  // __cvWrites stayed empty no matter what the test did. Blocking the CDN keeps
  // the stub in place, which is the only way an assertion about what CineVerse
  // writes can mean anything.
  await page.route('https://www.gstatic.com/firebasejs/**', route =>
    route.fulfill({ contentType: 'application/javascript', body: '/* stubbed for tests */' }));
  await page.addInitScript(() => {
    window.__cvWrites = [];
    localStorage.setItem('cv_onboarding_guest_v1', JSON.stringify({ done: true, region: 'IN', seedGenres: [] }));
    const snapshot = { exists: false, empty: true, docs: [], data: () => ({}), forEach() {} };
    const ref = {
      collection: () => ref, doc: () => ref, where: () => ref, orderBy: () => ref, limit: () => ref,
      get: async () => snapshot, set: async value => { window.__cvWrites.push(value); }, update: async value => { window.__cvWrites.push(value); }, add: async () => ref, delete: async () => {},
      onSnapshot: callback => { callback(snapshot); return () => {}; },
    };
    const authInstance = { onAuthStateChanged: callback => { queueMicrotask(() => callback(null)); return () => {}; }, signOut: async () => {} };
    const auth = () => authInstance;
    auth.GoogleAuthProvider = class {};
    auth.EmailAuthProvider = { credential: () => ({}) };
    const firestore = () => ({ collection: () => ref, batch: () => ({ set() {}, update() {}, delete() {}, commit: async () => {} }), runTransaction: async worker => worker({ get: ref2 => ref2.get(), set: (ref2, value, options) => ref2.set(value, options), update: (ref2, value) => ref2.update(value), delete: ref2 => ref2.delete() }) });
    firestore.FieldValue = { serverTimestamp: () => Date.now(), increment: value => value, arrayUnion: (...values) => values, arrayRemove: (...values) => values, delete: () => null };
    window.firebase = { initializeApp() {}, auth, firestore };
  });
}

test('highest-grossing rail and dedicated page expose reported money', async ({ page }) => {
  await bootGuest(page);
  await page.route('https://api.themoviedb.org/3/discover/movie**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('sort_by') !== 'revenue.desc') return route.continue();
    await route.fulfill({ json: { page: 1, total_pages: 1, results: [{
      id: 19995, title: 'Avatar', poster_path: '/avatar.jpg', backdrop_path: '/avatar-back.jpg',
      release_date: '2009-12-16', vote_average: 7.6, vote_count: 30000, genre_ids: [28, 878],
    }] } });
  });
  await page.route('https://api.themoviedb.org/3/movie/19995**', route => {
    if (new URL(route.request().url()).pathname.endsWith('/credits')) return route.fulfill({ json: { cast: [], crew: [{ id: 2710, name: 'James Cameron', job: 'Director', profile_path: '/cameron.jpg' }] } });
    return route.fulfill({ json: {
      id: 19995, title: 'Avatar', poster_path: '/avatar.jpg', backdrop_path: '/avatar-back.jpg',
      release_date: '2009-12-16', runtime: 162, revenue: 2923706026, budget: 237000000,
      vote_average: 7.6, vote_count: 30000, genres: [{ id: 878, name: 'Science Fiction' }],
      belongs_to_collection: { id: 87096, name: 'Avatar Collection', poster_path: '/avatar-collection.jpg' },
    } });
  });
  await page.route('https://api.themoviedb.org/3/collection/87096**', route => route.fulfill({ json: {
    id: 87096, name: 'Avatar Collection', poster_path: '/avatar-collection.jpg', parts: [{ id: 19995, title: 'Avatar', poster_path: '/avatar.jpg', release_date: '2009-12-16' }],
  } }));
  await page.route('https://api.themoviedb.org/3/person/2710/movie_credits**', route => route.fulfill({ json: {
    crew: [
      { id: 19995, title: 'Avatar', job: 'Director', department: 'Directing', release_date: '2009-12-16', vote_average: 7.6, vote_count: 30000, genre_ids: [878] },
      { id: 1, title: 'Aliens', job: 'Director', department: 'Directing', release_date: '1986-07-18', vote_average: 7.9, vote_count: 10000, genre_ids: [28, 878] },
      { id: 2, title: 'Terminator 2', job: 'Director', department: 'Directing', release_date: '1991-07-03', vote_average: 8.1, vote_count: 12000, genre_ids: [28, 878] },
      { id: 3, title: 'Titanic', job: 'Director', department: 'Directing', release_date: '1997-12-19', vote_average: 7.9, vote_count: 25000, genre_ids: [18] },
      { id: 4, title: 'The Abyss', job: 'Director', department: 'Directing', release_date: '1989-08-09', vote_average: 7.3, vote_count: 3000, genre_ids: [878] },
    ], cast: [],
  } }));
  await page.route('https://query.wikidata.org/sparql**', route => route.fulfill({ json: { results: { bindings: [
    { tmdbId: { value: '2710' }, gross: { value: '4000000000' }, films: { value: '5' } },
  ] } } }));

  await page.goto('/index.html');
  await page.waitForFunction(() => window.__cvBooted === true, null, { timeout: 12_000 });
  await expect(page.locator('#streamingArrivalRows')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Highest Grossing Movies Ever' })).toBeVisible({ timeout: 12_000 });
  await expect(page.locator('.bo-home-card')).toContainText('Avatar');
  await expect(page.locator('.bo-home-card')).toContainText('$2.92B');

  await page.getByRole('link', { name: 'Full chart' }).click();
  await expect(page.getByRole('heading', { name: 'Box Office' })).toBeVisible();
  await expect(page).toHaveURL(/\/box-office$/);
  await expect(page.locator('.bo-chart-row')).toContainText('Avatar');
  await expect(page.locator('.bo-chart-row')).toContainText('$2,923,706,026');
  await expect(page.locator('.bo-page-summary')).toContainText('revenue coverage');
  await expect(page.locator('.bo-page-summary')).toContainText('Fresh');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Box Office' })).toBeVisible();
  await expect(page.locator('.bo-chart-row')).toContainText('$2,923,706,026');

  await page.getByLabel('Box-office rankings').getByRole('button', { name: 'Franchises' }).click();
  await expect(page.locator('.bo-league-row')).toContainText('Avatar Collection');
  await expect(page.locator('.bo-league-row')).toContainText('$2,923,706,026');
  await expect(page.locator('.bo-league-row')).toContainText('100% coverage');
  await expect(page.locator('.bo-mini-timeline i')).toHaveCount(1);

  await page.getByLabel('Box-office rankings').getByRole('button', { name: 'Directors' }).click();
  await expect(page.locator('.bo-league-row')).toContainText('James Cameron');
  await expect(page.locator('.bo-league-row')).toContainText('$4,000,000,000');
  await expect(page.locator('.bo-league-row')).toContainText('Reported career gross');
  await expect(page.locator('.bo-league-row')).toContainText('100% hit rate');
  await expect(page.locator('.bo-director-eras')).toContainText('Career');
  await expect(page.locator('.bo-director-consistency')).toContainText('5 films');
  await expect(page.locator('.bo-director-consistency')).not.toContainText('Limited data');
  const alignment = await page.evaluate(() => {
    const hero = document.querySelector('.bo-page-hero')?.getBoundingClientRect();
    const league = document.querySelector('.bo-league')?.getBoundingClientRect();
    return { left: Math.abs((hero?.left || 0) - (league?.left || 0)), right: Math.abs((hero?.right || 0) - (league?.right || 0)) };
  });
  expect(alignment.left).toBeLessThanOrEqual(2);
  expect(alignment.right).toBeLessThanOrEqual(2);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.bo-league-row')).toBeVisible();
  await expect(page.locator('.bo-director-consistency')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test('franchise page switches watch order and exposes gaps, timeline, coverage, and freshness', async ({ page }) => {
  await bootGuest(page);
  await page.route('https://api.themoviedb.org/3/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/3', '');
    if (path === '/collection/10') return route.fulfill({ json: {
      id: 10, name: 'Star Wars Collection', poster_path: '/collection.jpg', backdrop_path: '/back.jpg',
      parts: [
        { id: 11, title: 'A New Hope', poster_path: '/11.jpg', release_date: '1977-05-25' },
        { id: 1891, title: 'The Empire Strikes Back', poster_path: '/1891.jpg', release_date: '1980-05-20' },
        { id: 1893, title: 'The Phantom Menace', poster_path: '/1893.jpg', release_date: '1999-05-19' },
      ],
    } });
    const id = +(path.match(/^\/movie\/(\d+)$/)?.[1] || 0);
    if (id) return route.fulfill({ json: {
      id, title: id === 11 ? 'A New Hope' : id === 1891 ? 'The Empire Strikes Back' : 'The Phantom Menace',
      poster_path: `/${id}.jpg`, release_date: id === 11 ? '1977-05-25' : id === 1891 ? '1980-05-20' : '1999-05-19',
      status: 'Released', revenue: id === 11 ? 100000000 : id === 1891 ? 200000000 : 0, budget: id === 11 ? 50000000 : 70000000,
    } });
    return route.fulfill({ json: { page: 1, total_pages: 1, results: [] } });
  });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__cvBooted === true, null, { timeout: 12_000 });
  await page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    const common = { type: 'movie', poster: '/p.jpg', genres: [12], keywords: [{ id: 1, name: 'space' }], runtime: 120, year: '1977', releaseDate: '1977-05-25', language: 'en', collectionId: 10, collectionName: 'Star Wars Collection', collectionPoster: '/collection.jpg', collectionChecked: true, metaV: 8, repairV: 2, directorId: 1, cast: [{ id: 1, name: 'Actor' }] };
    state.user = { uid: 'franchise-test' };
    state.franchisePrefs = { dismissed: [], orderMode: 'release', storyOrders: {} };
    state.watched = { movie_1893: { ...common, tmdbId: 1893, title: 'The Phantom Menace' }, movie_1891: { ...common, tmdbId: 1891, title: 'The Empire Strikes Back' } };
    const pageModule = await import('/js/franchise-page.js');
    pageModule.invalidateFranchisePage();
    await pageModule.renderFranchisePage();
    document.querySelectorAll('.page-container').forEach(node => { node.style.display = 'none'; });
    document.getElementById('franchisesPage').style.display = 'block';
  });
  await page.locator('.fp-row-head').click();
  await expect(page.locator('.fp-part')).toHaveCount(3);
  await expect(page.locator('.fp-part.gap')).toHaveCount(1);
  expect(await page.locator('.fp-part-body b').allTextContents()).toEqual(['A New Hope', 'The Empire Strikes Back', 'The Phantom Menace']);
  await page.getByRole('button', { name: 'Story', exact: true }).click();
  expect(await page.locator('.fp-part-body b').allTextContents()).toEqual(['The Phantom Menace', 'A New Hope', 'The Empire Strikes Back']);
  await page.getByRole('button', { name: 'Move The Phantom Menace later' }).click();
  expect(await page.locator('.fp-part-body b').allTextContents()).toEqual(['A New Hope', 'The Phantom Menace', 'The Empire Strikes Back']);
  await expect(page.locator('.fp-revenue-head')).toContainText('67% coverage');
  await expect(page.locator('.fp-revenue-head')).toContainText('Fresh');
  await expect(page.locator('.fp-revenue-bars a')).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
});

test('movie progress accepts an optional exact stop time and survives reload', async ({ page }) => {
  await bootGuest(page);
  await page.route('https://api.themoviedb.org/3/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/3', '');
    if (path === '/movie/7') return route.fulfill({ json: {
      id: 7, title: 'Progress Movie', overview: 'A movie progress fixture.', status: 'Released',
      release_date: '2020-01-01', runtime: 132, poster_path: '/seven.jpg', backdrop_path: '/seven-back.jpg',
      vote_average: 8, vote_count: 1000, budget: 50000000, revenue: 200000000,
      genres: [{ id: 18, name: 'Drama' }], original_language: 'hi',
      production_countries: [{ iso_3166_1: 'IN', name: 'India' }], spoken_languages: [], production_companies: [],
      images: { logos: [], backdrops: [], posters: [] }, recommendations: { results: [] }, keywords: { keywords: [] },
      external_ids: {}, release_dates: { results: [] }, alternative_titles: { titles: [] }, 'watch/providers': { results: {} },
    } });
    if (path === '/movie/7/credits') return route.fulfill({ json: { cast: [], crew: [] } });
    return route.fulfill({ json: { page: 1, total_pages: 1, results: [] } });
  });
  const open = async ({ reload = false } = {}) => {
    if (reload) await page.reload(); else await page.goto('/index.html');
    await page.waitForFunction(() => window.__cvBooted === true, null, { timeout: 12_000 });
    await page.evaluate(async () => {
      const { state } = await import('/js/state.js');
      const movie = await import('/js/movie-progress.js');
      state.user = { uid: 'movie-progress-browser' };
      await movie.loadMovieProgress();
      document.dispatchEvent(new CustomEvent('cv:go', { detail: '/movie/7' }));
    });
    await expect(page.getByRole('heading', { name: 'Progress Movie' })).toBeVisible();
  };
  await open();
  await expect(page.locator('.detail-accordion.box-office .detail-accordion-toggle')).toContainText(/₹.*crore/);
  await page.locator('.detail-accordion.box-office .detail-accordion-toggle').click();
  await expect(page.locator('.detail-accordion.box-office .bo3-note')).toContainText('Approximate INR crores');
  await page.getByRole('button', { name: 'Start watching this movie' }).click();
  await expect(page.locator('.movie-progress-panel')).toContainText('Currently watching');
  await page.getByLabel(/Where you stopped/).fill('01:12:30');
  await page.locator('.movie-progress-save').click();
  await expect(page.locator('.movie-progress-panel')).toContainText('Resume at 01:12:30');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cv_movie_progress_movie-progress-browser')).movie_7.position)).toBe(4350);
  await open({ reload: true });
  await expect(page.locator('.movie-progress-panel')).toContainText('Resume at 01:12:30');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
});

test('homepage poster controls apply independently and sync one Firebase snapshot', async ({ page }) => {
  await bootGuest(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__cvBooted === true, null, { timeout: 12_000 });
  await page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    state.user = { uid: 'poster-settings-browser' };
    document.dispatchEvent(new CustomEvent('cv:go', { detail: '/settings' }));
    const card = document.createElement('article'); card.className = 'card';
    card.innerHTML = '<div class="card-img"><span class="card-rating">8.8</span><button class="card-wl">+</button></div>';
    document.getElementById('homePage').appendChild(card);
  });
  await expect(page.getByRole('heading', { name: 'Poster controls' })).toBeVisible();
  await expect(page.locator('.poster-controls input')).toHaveCount(10);
  await expect(page.locator('input[data-pref="haptics"]')).toBeChecked();
  await page.locator('label:has(input[data-pref="haptics"])').click();
  expect(await page.evaluate(() => document.documentElement.dataset.haptics)).toBe('off');
  await page.locator('label:has(input[data-pref="cleanHomePosters"])').click();
  await expect(page.locator('input[data-pref="cleanHomePosters"]')).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.dataset.cleanHomePosters)).toBe('on');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#homePage .card-rating')).display)).toBe('none');
  await page.locator('label:has(input[data-pref="cleanHomePosters"])').click();
  await page.locator('label:has(input[data-pref="posterCommunityRating"])').click();
  await page.locator('label:has(input[data-pref="posterPreview"])').click();
  expect(await page.evaluate(() => ({ rating: document.documentElement.dataset.posterCommunityRating, preview: document.documentElement.dataset.posterPreview }))).toEqual({ rating: 'hide', preview: 'hide' });
  await expect.poll(() => page.evaluate(() => window.__cvWrites.some(value => value.experiencePrefs?.posterCommunityRating === false && value.experiencePrefs?.posterPreview === false && value.experiencePrefs?.haptics === false))).toBe(true);
  await page.evaluate(async () => { const { togglePinned } = await import('/js/continue-prefs.js'); togglePinned('tv_55'); });
  await expect.poll(() => page.evaluate(() => window.__cvWrites.some(value => value.continueWatching?.pinned?.includes('tv_55')))).toBe(true);
});
