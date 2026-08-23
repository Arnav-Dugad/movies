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

test('episode search finds title, season number, episode number, and description', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => { cvTest.setVersion(3); return cvTest.open(); });
  const search = page.getByRole('searchbox', { name: 'Search episodes by title, number, or description' });

  await search.fill('S2E3');
  await expect(page.locator('.ep-card')).toHaveCount(1);
  await expect(page.locator('.ep-card')).toHaveAttribute('data-ep', '2-3');

  await search.fill('Fixture episode 1-2');
  await expect(page.locator('.ep-card')).toHaveCount(1);
  await expect(page.locator('.ep-card')).toHaveAttribute('data-ep', '1-2');

  await search.fill('Season 1 Episode 3');
  await expect(page.locator('.ep-card')).toHaveCount(1);
  await expect(page.locator('.ep-card')).toHaveAttribute('data-ep', '1-3');

  await search.fill('not in this show');
  await expect(page.locator('.episode-empty')).toHaveText('No episodes found');
});

test('desktop episodes use a visible bounded scroller and both season rails navigate horizontally', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => cvTest.open());
  await page.evaluate(() => {
    const tabs = document.querySelector('.season-tabs'), cards = document.querySelector('.season-scroll');
    for (let season = 3; season <= 18; season++) {
      const tab = tabs.firstElementChild.cloneNode(true);
      tab.dataset.sn = season; tab.classList.remove('active'); tab.textContent = `Long season name ${season}`; tabs.appendChild(tab);
      const card = cards.firstElementChild.cloneNode(true);
      card.dataset.sn = season; card.classList.remove('active'); card.querySelector('.season-nm').textContent = `Season ${season}`; cards.appendChild(card);
    }
    const list = document.querySelector('.ep-list'), episode = list.querySelector('.ep-card');
    for (let copy = 0; copy < 20; copy++) list.appendChild(episode.cloneNode(true));
  });
  await expect(page.locator('.hs-wrap:has(> .season-tabs) .hs-next')).toBeVisible();
  const tabs = page.locator('.season-tabs');
  expect(await tabs.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.locator('.hs-wrap:has(> .season-tabs) .hs-next').click();
  await expect.poll(() => tabs.evaluate(element => element.scrollLeft)).toBeGreaterThan(20);
  await expect(page.locator('.hs-wrap:has(> .season-scroll) .hs-next')).toBeVisible();
  const episodeList = page.locator('.ep-list');
  const listStyle = await episodeList.evaluate(element => ({ maxHeight: getComputedStyle(element).maxHeight, overflowY: getComputedStyle(element).overflowY, scrollable: element.scrollHeight > element.clientHeight, tabIndex: element.tabIndex }));
  expect(listStyle.maxHeight).not.toBe('none');
  expect(listStyle.overflowY).toBe('auto');
  expect(listStyle.scrollable).toBe(true);
  expect(listStyle.tabIndex).toBe(0);
  await episodeList.evaluate(element => { element.scrollTop = 500; });
  await expect.poll(() => episodeList.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(episodeList).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
});

test('poster trailers preview silently on desktop and never mount on mobile', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    document.documentElement.dataset.motion = 'full';
    const row = document.createElement('div'); row.className = 'row'; row.style.width = '1100px';
    const card = document.createElement('a');
    card.className = 'card'; card.dataset.id = '42'; card.dataset.type = 'movie'; card.dataset.yt = 'previewKey';
    card.dataset.title = 'Preview title'; card.dataset.backdrop = '/landscape.jpg'; card.dataset.year = '2026'; card.dataset.rating = '8.4';
    card.innerHTML = '<div class="card-img"><img alt="Preview title"></div><div class="card-info">Preview title</div>';
    const sibling = document.createElement('a'); sibling.className = 'card'; sibling.innerHTML = '<div class="card-img"></div>';
    row.append(card, sibling); document.body.appendChild(row);
  });
  const card = page.locator('.card[data-id="42"]');
  const sourceWidth = await card.evaluate(element => element.getBoundingClientRect().width);
  const siblingLeft = await page.locator('.row>.card').nth(1).evaluate(element => element.getBoundingClientRect().left);
  await card.hover();
  const frame = card.locator('iframe.ambient-video-clean');
  await expect(frame).toHaveCount(1, { timeout: 2_500 });
  await expect(frame).toHaveAttribute('src', /autoplay=1.*mute=1.*controls=0/);
  await expect(card).toHaveClass(/card-preview-expanded/);
  const geometry = await card.evaluate(element => {
    const media = element.querySelector('.card-img').getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return { width: box.width, ratio: media.width / media.height };
  });
  expect(geometry.width).toBeGreaterThan(sourceWidth * 1.8);
  expect(Math.abs(geometry.ratio - 16 / 9)).toBeLessThan(.04);
  await expect.poll(() => page.locator('.row>.card').nth(1).evaluate(element => element.getBoundingClientRect().left)).toBeGreaterThan(siblingLeft + 100);
  await card.getByRole('button', { name: 'Unmute preview' }).click();
  await expect(card.getByRole('button', { name: 'Mute preview' })).toBeVisible();
  await expect(page.locator('.card-hover-preview')).toHaveCount(0);
  await page.mouse.move(1200, 850);
  await expect(frame).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await card.hover();
  await page.waitForTimeout(700);
  await expect(card.locator('iframe')).toHaveCount(0);
});

test('details without videos or images retain a complete aligned hero', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => cvTest.open());
  await expect(page.locator('.detail-back-empty')).toBeVisible();
  await expect(page.locator('.detail-poster-empty')).toBeVisible();
  await expect(page.locator('.detail-title')).toContainText('Tracker Fixture');
  await expect(page.getByRole('button', { name: 'Play Trailer' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.detail-poster-empty')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
});

test('awards stay collapsed and use real remote programme artwork without generated seals', async ({ page }) => {
  await page.route('https://upload.wikimedia.org/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }));
  await fixture(page);
  await page.evaluate(async () => {
    const original = window.fetch;
    window.fetch = async input => {
      const url = String(input);
      if (url.includes('query.wikidata.org')) return new Response(JSON.stringify({ results: { bindings: [
        { kind: { value: 'win' }, honor: { value: 'https://www.wikidata.org/wiki/Q1' }, honorLabel: { value: 'Academy Award for Best Picture' }, date: { value: '2024-03-10T00:00:00Z' } },
        { kind: { value: 'win' }, honor: { value: 'https://www.wikidata.org/wiki/Q2' }, honorLabel: { value: 'Academy Award for Best Director' }, date: { value: '2024-03-10T00:00:00Z' } },
        { kind: { value: 'nomination' }, honor: { value: 'https://www.wikidata.org/wiki/Q3' }, honorLabel: { value: 'Golden Globe Award for Best Motion Picture' }, date: { value: '2023-12-12T00:00:00Z' } },
      ] } }), { headers: { 'content-type': 'application/json' } });
      if (url.includes('commons.wikimedia.org/w/api.php')) return new Response(JSON.stringify({ query: { pages: { 1: { title: 'File:Official Academy Awards Golden Globes logo.svg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/wikipedia/commons/6/6a/JavaScript-logo.png' }] } } } }), { headers: { 'content-type': 'application/json' } });
      return original(input);
    };
    const section = document.createElement('section'); section.id = 'awardFixture'; section.className = 'awards-section'; section.hidden = true;
    document.body.appendChild(section);
    const { loadAwardsSection, initAwards } = await import('/js/awards.js');
    initAwards();
    await loadAwardsSection('tt7654321', 'awardFixture');
  });
  const section = page.locator('#awardFixture');
  await expect(section.locator('.awards-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(section.locator('.awards-body')).toBeHidden();
  await expect(section.locator('.award-programme-card')).toHaveCount(2);
  await expect(section.locator('img[data-award-logo]')).toHaveCount(4);
  await expect(section.locator('.award-seal')).toHaveCount(0);
  await section.locator('.awards-toggle').click();
  await expect(section.locator('.awards-body')).toBeVisible();
  await expect(section.locator('.award-timeline time')).toHaveText(['2023', '2024']);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
});
