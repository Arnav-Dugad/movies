import { test, expect } from '@playwright/test';

const baseEntry = ({ version = 2, second = [] } = {}) => ({
  tmdbId: 1, title: 'Tracker Fixture', status: 'Returning Series', episodeRuntime: 45,
  structure: { '1': 3, '2': 3 }, aired: { season: 2, episode: version },
  seasons: { '1': [1, 2, 3], ...(second.length ? { '2': second } : {}) }, removed: {}, log: [], seasonPlays: {}, updatedAt: Date.now(),
});

async function fixture(page) {
  await page.goto('/tests/browser/episode-fixture.html');
  await page.waitForFunction(() => window.cvTest?.ready);
}

test('opens the true next season instead of always season one', async ({ page }) => {
  await fixture(page);
  await page.evaluate(entry => { cvTest.setVersion(2); cvTest.seedLocal('alice', entry); }, baseEntry({ version: 2, second: [1] }));
  await page.reload();
  await page.waitForFunction(() => window.cvTest?.ready);
  await page.evaluate(() => cvTest.open());
  await expect(page.locator('.s-tab[data-sn="2"]')).toHaveClass(/active/);
  await expect(page.locator('.ep-card[data-ep="2-2"] .ep-title')).toHaveText('Season 2 Episode 2');
});

test('a caught-up show opens its latest season', async ({ page }) => {
  await fixture(page);
  const entry = { ...baseEntry({ version: 2, second: [1, 2] }), lastWatched: { season: 2, episode: 2, at: Date.now() } };
  await page.evaluate(value => { cvTest.setVersion(2); cvTest.seedLocal('alice', value); }, entry);
  await page.reload(); await page.waitForFunction(() => window.cvTest?.ready); await page.evaluate(() => cvTest.open());
  await expect(page.locator('.s-tab[data-sn="2"]')).toHaveClass(/active/);
});

test('next-episode action advances after each real click', async ({ page }) => {
  await fixture(page);
  await page.evaluate(entry => { cvTest.setVersion(3); cvTest.seedLocal('alice', entry); }, baseEntry({ version: 3 }));
  await page.reload(); await page.waitForFunction(() => window.cvTest?.ready); await page.evaluate(() => cvTest.open());
  const action = page.locator('.show-progress-actions [data-action="ep-toggle"]');
  await expect(action).toHaveAttribute('data-en', '1');
  await action.click();
  await expect(page.locator('.show-progress-actions [data-action="ep-toggle"]')).toHaveAttribute('data-en', '2');
  await page.locator('.show-progress-actions [data-action="ep-toggle"]').click();
  const seasons = await page.evaluate(() => cvTest.entry().seasons);
  expect(seasons['2']).toEqual([1, 2]);
});

test('click progress survives a full reload', async ({ page }) => {
  await fixture(page); await page.evaluate(() => { cvTest.setVersion(3); return cvTest.open(); });
  await page.locator('.s-tab[data-sn="1"]').click();
  await page.locator('.ep-card[data-ep="1-1"] .ep-check').click();
  await page.waitForTimeout(750);
  await page.reload(); await page.waitForFunction(() => window.cvTest?.ready); await page.evaluate(() => cvTest.open());
  await expect(page.locator('.ep-card[data-ep="1-1"]')).toHaveClass(/watched/);
});

test('account switching never leaks one profile into another', async ({ page }) => {
  await fixture(page); await page.evaluate(() => { cvTest.setVersion(3); return cvTest.open(); });
  await page.locator('.s-tab[data-sn="1"]').click();
  await page.locator('.ep-card[data-ep="1-1"] .ep-check').click();
  await page.waitForTimeout(750);
  await page.evaluate(() => cvTest.signIn('bob')); await page.evaluate(() => cvTest.open()); await page.locator('.s-tab[data-sn="1"]').click();
  await expect(page.locator('.ep-card[data-ep="1-1"]')).not.toHaveClass(/watched/);
  await page.evaluate(() => cvTest.signIn('alice')); await page.evaluate(() => cvTest.open()); await page.locator('.s-tab[data-sn="1"]').click();
  await expect(page.locator('.ep-card[data-ep="1-1"]')).toHaveClass(/watched/);
});

test('offline click is retained and reconciled when the network returns', async ({ page }) => {
  await fixture(page); await page.evaluate(() => { cvTest.setVersion(3); cvTest.setOffline(true); return cvTest.open(); });
  await page.locator('.s-tab[data-sn="1"]').click();
  await page.locator('.ep-card[data-ep="1-1"] .ep-check').click();
  await page.waitForTimeout(750);
  await page.reload(); await page.waitForFunction(() => window.cvTest?.ready);
  expect(await page.evaluate(() => cvTest.entry().seasons['1'])).toContain(1);
  await page.evaluate(() => { cvTest.setOffline(false); return cvTest.load(); });
  await expect.poll(() => page.evaluate(() => cvTest.server('alice')?.seasons?.['1'] || [])).toContain(1);
});

test('a daily refresh discovers a newly arrived episode', async ({ page }) => {
  await fixture(page);
  const entry = baseEntry({ version: 2, second: [1, 2] });
  await page.evaluate(value => { cvTest.setVersion(2); cvTest.seedLocal('alice', value); cvTest.seedServer('alice', value); }, entry);
  await page.reload(); await page.waitForFunction(() => window.cvTest?.ready);
  expect(await page.evaluate(() => cvTest.progress().caughtUp)).toBe(true);
  await page.evaluate(() => { cvTest.setVersion(3); return cvTest.refresh(); });
  expect(await page.evaluate(() => cvTest.next())).toEqual({ season: 2, episode: 3 });
  expect(await page.evaluate(() => cvTest.progress().caughtUp)).toBe(false);
});
