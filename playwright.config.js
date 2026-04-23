// Playwright configuration for si'se Dashboard E2E smoke tests
//
// 実行: npx playwright test
// 実行対象URL は環境変数 PLAYWRIGHT_BASE_URL で指定 (既定: http://localhost:3000)
// CI では Vercel preview URL を渡す想定: PLAYWRIGHT_BASE_URL=https://preview.vercel.app npx playwright test
//
// デフォルトは Chromium のみ (CI での高速化)。ローカルで full matrix を試したい時は
// --project=firefox / --project=webkit を追加指定する。

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
