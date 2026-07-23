/* eslint-disable @typescript-eslint/no-require-imports */
const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: ['h5-core.spec.cjs', 'h5-resilience.spec.cjs'],
  timeout: 90_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  // This journey intentionally creates durable export and data-rights state.
  // Retrying against the same database can mask the original failure or hit
  // the single-active-export invariant, so failures must remain deterministic.
  retries: 0,
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: 'output/playwright/report', open: 'never' }]]
    : 'line',
  outputDir: 'output/playwright/results',
  use: {
    baseURL: process.env.H5_BASE_URL || 'http://127.0.0.1:10086',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 390, height: 844 },
    screenshot: 'only-on-failure',
    // Playwright traces retain network bodies and could capture short-lived
    // test tokens. Screenshots/video are sufficient low-sensitivity diagnostics.
    trace: 'off',
    video: 'retain-on-failure',
  },
})
