import { test, expect } from '@playwright/test';

test('highest-grossing rail and dedicated page expose reported money', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cv_onboarding_guest_v1', JSON.stringify({ done: true, region: 'IN', seedGenres: [] })));
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
  await expect(page.locator('.bo-league-row')).toContainText('$2,923,706,026');
  await expect(page.locator('.bo-league-row')).toContainText('100% hit rate');
  await expect(page.locator('.bo-director-eras')).toContainText('Career');
  const alignment = await page.evaluate(() => {
    const hero = document.querySelector('.bo-page-hero')?.getBoundingClientRect();
    const league = document.querySelector('.bo-league')?.getBoundingClientRect();
    return { left: Math.abs((hero?.left || 0) - (league?.left || 0)), right: Math.abs((hero?.right || 0) - (league?.right || 0)) };
  });
  expect(alignment.left).toBeLessThanOrEqual(2);
  expect(alignment.right).toBeLessThanOrEqual(2);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.bo-league-row')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test('franchise page switches watch order and exposes gaps, timeline, coverage, and freshness', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cv_onboarding_guest_v1', JSON.stringify({ done: true, region: 'IN', seedGenres: [] })));
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
