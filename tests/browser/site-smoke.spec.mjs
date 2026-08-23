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

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Box Office' })).toBeVisible();
  await expect(page.locator('.bo-chart-row')).toContainText('$2,923,706,026');

  await page.getByLabel('Box-office rankings').getByRole('button', { name: 'Franchises' }).click();
  await expect(page.locator('.bo-league-row')).toContainText('Avatar Collection');
  await expect(page.locator('.bo-league-row')).toContainText('$2,923,706,026');

  await page.getByLabel('Box-office rankings').getByRole('button', { name: 'Directors' }).click();
  await expect(page.locator('.bo-league-row')).toContainText('James Cameron');
  await expect(page.locator('.bo-league-row')).toContainText('$2,923,706,026');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.bo-league-row')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});
