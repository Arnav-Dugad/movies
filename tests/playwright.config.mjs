import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './browser',
  timeout: 30_000,
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4173', headless: true, viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
  webServer: { command: 'node browser/server.mjs', url: 'http://127.0.0.1:4173/tests/browser/episode-fixture.html', reuseExistingServer: true, timeout: 15_000 },
  reporter: [['list']],
});
