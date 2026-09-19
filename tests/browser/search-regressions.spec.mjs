import { test, expect } from '@playwright/test';
import { bootGuest } from './guest.mjs';

const title = (id, name = `Film ${id}`) => ({ id, title: name, media_type: 'movie', poster_path: '/fixture.jpg', backdrop_path: '/backdrop.jpg', release_date: '2020-01-01', genre_ids: [18], vote_average: 7, vote_count: 500 });
const results = items => ({ page: 1, total_pages: 1, results: items, total_results: items.length });

test.beforeEach(async ({ page }) => {
  await bootGuest(page);
  await page.route('https://api.themoviedb.org/3/**', route => route.fulfill({ json: results([]) }));
  await page.route('https://image.tmdb.org/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#28354a"/></svg>' }));
  await page.route('https://query.wikidata.org/**', route => route.fulfill({ json: { results: { bindings: [] } } }));
});

async function open(page, path = '/search') {
  await page.goto(path);
  await page.waitForFunction(() => window.__cvBooted === true);
}

test('IMDb sorting fetches ratings for raw results and orders them', async ({ page }) => {
  await page.route('**/3/search/multi**', route => route.fulfill({ json: results([title(1), title(2)]) }));
  await page.route('**/3/movie/*/external_ids**', route => route.fulfill({ json: { imdb_id: new URL(route.request().url()).pathname.includes('/1/') ? 'tt0000001' : 'tt0000002' } }));
  await page.route('https://v3-cinemeta.strem.io/**', route => route.fulfill({ json: { meta: { imdbRating: route.request().url().includes('tt0000001') ? '6.0' : '9.0' } } }));
  await open(page, '/search?q=fixture');
  await expect(page.locator('#searchGrid .card')).toHaveCount(2);
  await page.locator('#searchFilters .filter-fold-toggle').click();
  await page.locator('#fltSort').selectOption('imdb');
  await expect(page.locator('#searchGrid .card').first()).toHaveAttribute('data-id', '2');
  await page.locator('#fltSort').selectOption('imdb_asc');
  await expect(page.locator('#searchGrid .card').first()).toHaveAttribute('data-id', '1');
});

test('clearing a search invalidates pending keyword work and removes the URL query', async ({ page }) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let started = false;
  await page.route('**/3/search/keyword**', async route => {
    started = true;
    await pending;
    await route.fulfill({ json: results([]) });
  });
  await open(page, '/search?q=fixture');
  await expect.poll(() => started).toBe(true);
  await page.locator('#searchClear').click();
  release();
  await page.waitForTimeout(250);
  await expect(page.locator('#searchDefault')).toBeVisible();
  await expect(page.locator('#searchResultsWrap')).toBeHidden();
  await expect(page).toHaveURL(/\/search$/);
});

test('navigating away during keyword lookup cannot rewrite the destination URL', async ({ page }) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let started = false;
  await page.route('**/3/search/keyword**', async route => {
    started = true; await pending; await route.fulfill({ json: results([]) });
  });
  await open(page, '/search?q=fixture');
  await expect.poll(() => started).toBe(true);
  await page.locator('.nav-link[data-page="movies"]').click();
  await expect(page.locator('#moviesPage')).toBeVisible();
  release();
  await page.waitForTimeout(250);
  await expect(page).toHaveURL(/\/movies$/);
});

test('late suggestions stay closed after clearing and do not steal submitted results', async ({ page }) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let started = false;
  await page.route('**/3/search/multi**', async route => {
    started = true; await pending; await route.fulfill({ json: results([title(1)]) });
  });
  await open(page);
  await page.locator('#searchIn').fill('fixture');
  await expect.poll(() => started).toBe(true);
  await page.locator('#searchClear').click();
  release();
  await page.waitForTimeout(250);
  await expect(page.locator('#searchSuggest')).not.toHaveClass(/open/);
  await expect(page.locator('#searchIn')).toHaveAttribute('aria-expanded', 'false');
});

test('typing a new suggestion query does not change the submitted pagination query', async ({ page }) => {
  const requests = [];
  await page.route('**/3/search/multi**', route => {
    const params = new URL(route.request().url()).searchParams;
    requests.push([params.get('query'), params.get('page')]);
    return route.fulfill({ json: { ...results([title(params.get('page') === '2' ? 2 : 1)]), total_pages: 2 } });
  });
  await open(page, '/search?q=original');
  await expect(page.locator('#searchGrid .card')).toHaveCount(1);
  await page.locator('#searchIn').fill('different');
  await expect.poll(() => requests.some(([q]) => q === 'different')).toBe(true);
  await page.locator('#searchIn').press('Escape');
  await page.locator('#searchMore').click();
  await expect(page.locator('#searchGrid .card')).toHaveCount(2);
  expect(requests).toContainEqual(['original', '2']);
  await expect(page.locator('#searchResultsHead')).toContainText('original');
});

test('search keyboard selection exposes its active option and clears it on escape', async ({ page }) => {
  await page.route('**/3/search/multi**', route => route.fulfill({ json: results([title(1, 'Rock & Roll'), title(2)]) }));
  await open(page);
  const input = page.locator('#searchIn');
  await input.fill('Rock &');
  await expect(page.locator('#searchSuggest')).toHaveClass(/open/);
  await expect(page.locator('.sx-title').first()).toHaveText('Rock & Roll');
  await input.press('ArrowDown');
  const active = await input.getAttribute('aria-activedescendant');
  expect(active).toBeTruthy();
  await expect(page.locator(`[id="${active}"]`)).toHaveAttribute('aria-selected', 'true');
  await input.press('Escape');
  await expect(input).not.toHaveAttribute('aria-activedescendant');
});

test('only the visible hero slide is available to keyboard and screen readers', async ({ page }) => {
  await page.route('**/3/trending/all/day**', route => route.fulfill({ json: results([title(1), title(2), title(3)]) }));
  await open(page, '/index.html');
  await expect(page.locator('#heroWrap .hero-slide')).toHaveCount(3);
  await expect(page.locator('#heroWrap .hero-slide:not(.active):not([inert])')).toHaveCount(0);
  await page.locator('#heroWrap [data-idx="1"][data-action="hero-go"]').click();
  await expect(page.locator('#heroWrap .hero-slide.active')).toHaveAttribute('data-idx', '1');
  await expect(page.locator('#heroWrap .hero-slide.active')).not.toHaveAttribute('inert');
  await expect(page.locator('#heroWrap .hero-slide:not(.active):not([inert])')).toHaveCount(0);
});

test('a forced tag search survives reload with its intent intact', async ({ page }) => {
  await page.route('**/3/search/keyword**', route => route.fulfill({ json: results([{ id: 42, name: 'space travel' }]) }));
  await page.route('**/3/discover/movie**', route => route.fulfill({ json: results([title(1)]) }));
  await open(page, '/search?q=space&tag=1');
  await expect(page.locator('#searchResultsHead')).toContainText('tagged');
  expect(new URL(page.url()).searchParams.get('tag')).toBe('1');
  await page.reload();
  await expect(page.locator('#searchResultsHead')).toContainText('space travel');
  expect(new URL(page.url()).searchParams.get('tag')).toBe('1');
});

test('search exposes a recoverable error after transient retries are exhausted', async ({ page }) => {
  let calls = 0;
  await page.route('**/3/search/multi**', route => ++calls <= 2
    ? route.fulfill({ status: 503, json: { status_message: 'Temporarily unavailable' } })
    : route.fulfill({ json: results([title(1)]) }));
  await open(page, '/search?q=fixture');
  await expect(page.locator('#searchError')).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('#searchGrid .card')).toHaveCount(1);
  await expect(page.locator('#searchError')).toBeHidden();
  expect(calls).toBe(3);
});

test('trailing-slash routes keep navigation and account refreshes working', async ({ page }) => {
  await open(page, '/watchlist/');
  await expect(page).toHaveURL(/\/watchlist$/);
  await expect(page.locator('.nav-link[data-page="watchlist"]')).toHaveClass(/active/);
  await expect(page.locator('#wlPage')).toContainText('Sign in to see your lists');
  await page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    state.user = { uid: 'route-test' };
    document.dispatchEvent(new CustomEvent('cv:auth'));
  });
  await expect(page.locator('#wlPage')).not.toContainText('Sign in to see your lists');
  await expect(page.locator('#wlControls')).toBeVisible();
});

test('main pages render without exceptions or horizontal overflow on desktop and phone', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.evaluate(async () => { const { updatePref } = await import('/js/prefs.js'); updatePref('motion', 'reduced'); });
  const routes = { '/': 'homePage', '/movies': 'moviesPage', '/tv': 'tvPage', '/discover': 'discoverPage', '/reminders': 'remindersPage', '/franchises': 'franchisesPage', '/box-office': 'boxOfficePage', '/watchlist': 'wlPage', '/watched': 'watchedPage', '/stats': 'statsPage', '/search': 'searchPage', '/friends': 'friendsPage', '/party': 'partyPage', '/profile': 'profilePage', '/year': 'yearPage', '/settings': 'settingsPage', '/notifications': 'notificationsPage' };
  for (const [width, theme, signedIn] of [[1280, 'dark', false], [390, 'dark', false], [1280, 'light', true], [390, 'light', true]]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(async ({ theme, signedIn }) => {
      const { updatePref } = await import('/js/prefs.js'); updatePref('theme', theme);
      const { state } = await import('/js/state.js'); state.user = signedIn ? { uid: 'layout-test', displayName: 'Test viewer' } : null;
    }, { theme, signedIn });
    for (const [route, id] of Object.entries(routes)) {
      await page.evaluate(async path => { const { navigate } = await import('/js/router.js'); navigate(path); }, route);
      await expect(page.locator(`#${id}`)).toBeVisible();
      await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.page-container')].filter(el => el.style.display === 'block').length)).toBe(1);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${route} at ${width}px`).toBeLessThanOrEqual(2);
    }
    await page.evaluate(async () => { const { navigate } = await import('/js/router.js'); navigate('/search'); });
    await expect(page.locator('#searchPage')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`search-${width}-${theme}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});
