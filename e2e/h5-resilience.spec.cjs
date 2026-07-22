/* eslint-disable @typescript-eslint/no-require-imports */
const { randomUUID } = require('node:crypto')
const { expect, test } = require('@playwright/test')
const sharp = require('../apps/api/node_modules/sharp')

const apiBaseUrl = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:3300/api/v1'
const runId = randomUUID()

test.use({ screenshot: 'off', trace: 'off', video: 'off' })

function button(page, label) {
  return page.locator('taro-button-core').filter({ hasText: new RegExp(`^${label}$`) }).first()
}

function scenarioIdentity(scenario) {
  return {
    mockUserKey: `e2e-resilience-${scenario}-${runId}`,
    displayName: '韧性测试家长',
    babyName: `韧性测试宝宝-${scenario}`,
  }
}

async function seedBaby(request, scenario) {
  const identity = scenarioIdentity(scenario)
  const login = await request.post(`${apiBaseUrl}/auth/mock-login`, {
    data: {
      mockUserKey: identity.mockUserKey,
      displayName: identity.displayName,
    },
  })
  expect(login.ok()).toBeTruthy()
  const session = (await login.json()).data
  const headers = { authorization: `Bearer ${session.accessToken}` }
  const babiesResponse = await request.get(`${apiBaseUrl}/babies`, { headers })
  expect(babiesResponse.ok()).toBeTruthy()
  const babies = (await babiesResponse.json()).data
  const existing = babies.find((baby) => baby.name === identity.babyName)
  if (existing) return { baby: existing, identity, token: session.accessToken }

  const created = await request.post(`${apiBaseUrl}/babies`, {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: {
      name: identity.babyName,
      gender: 'unspecified',
      birthDate: '2025-01-01',
    },
  })
  expect(created.ok()).toBeTruthy()
  return { baby: (await created.json()).data, identity, token: session.accessToken }
}

async function loginInBrowser(page, identity) {
  await page.route('**/api/v1/auth/mock-login', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST') {
      await route.fallback()
      return
    }
    await route.continue({
      headers: { ...request.headers(), 'content-type': 'application/json' },
      postData: JSON.stringify({
        mockUserKey: identity.mockUserKey,
        displayName: identity.displayName,
      }),
    })
  })

  await page.goto('/#/pages/auth/index')
  await page.locator('input[type="checkbox"]').check()
  await button(page, '以测试用户登录').click()
  await expect(page.locator('.baby-header-card__name')).toHaveText(identity.babyName)
}

test('a transient GET failure is retried and the protected page recovers', async ({ page, request }) => {
  const { identity } = await seedBaby(request, 'get-retry')
  let babyListAttempts = 0
  let injectedFailures = 0

  await page.route('**/api/v1/babies', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    babyListAttempts += 1
    if (injectedFailures === 0) {
      injectedFailures += 1
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'SERVICE_UNAVAILABLE', message: 'temporary test outage' },
        }),
      })
      return
    }
    await route.continue()
  })

  await loginInBrowser(page, identity)

  expect(injectedFailures).toBe(1)
  expect(babyListAttempts).toBeGreaterThanOrEqual(2)
  await expect(page.getByText('最近记录', { exact: true })).toBeVisible()
})

test('rapid repeated save clicks create only one record', async ({ page, request }) => {
  const { baby, identity, token } = await seedBaby(request, 'duplicate-save')
  const idempotencyKeys = []
  let createAttempts = 0

  await loginInBrowser(page, identity)
  await button(page, '测量').click()
  await page.locator('input[placeholder="20–250"]').fill('81.23')

  await page.route('**/api/v1/babies/*/records', async (route) => {
    const intercepted = route.request()
    if (intercepted.method() === 'POST') {
      createAttempts += 1
      idempotencyKeys.push(intercepted.headers()['idempotency-key'])
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    await route.continue()
  })

  const save = button(page, '保存记录')
  await save.evaluate((element) => {
    element.click()
    element.click()
  })
  await expect(page).toHaveURL(/#\/pages\/home\/index/)

  expect(createAttempts).toBeGreaterThanOrEqual(1)
  expect(idempotencyKeys.every(Boolean)).toBe(true)
  expect(new Set(idempotencyKeys).size).toBe(1)
  await expect.poll(async () => {
    const response = await request.get(
      `${apiBaseUrl}/babies/${baby.id}/records?limit=50`,
      { headers: { authorization: `Bearer ${token}` } },
    )
    if (!response.ok()) return -1
    return (await response.json()).data.filter(
      (record) => Number(record.measurement?.heightCm) === 81.23,
    ).length
  }).toBe(1)
})

test('an invalid session clears scoped state and returns to login', async ({ page, request }) => {
  const { identity } = await seedBaby(request, 'session-expiry')
  let refreshAttempts = 0

  await loginInBrowser(page, identity)
  await page.route('**/api/v1/auth/refresh', async (route) => {
    refreshAttempts += 1
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'session expired' } }),
    })
  })
  await page.route('**/api/v1/babies', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'session expired' } }),
    })
  })

  await page.reload()

  await expect(page).toHaveURL(/#\/pages\/auth\/index/)
  await expect(page.locator('.auth-brand__title')).toHaveText('宝宝成长记')
  await expect(page.getByText(identity.babyName, { exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => ({
    hasBabyContext: localStorage.getItem('baby-mp.current-baby-id.v1') !== null,
    hasSession: localStorage.getItem('baby-mp.session.v1') !== null,
  }))).toEqual({ hasBabyContext: false, hasSession: false })
  expect(refreshAttempts).toBeGreaterThanOrEqual(1)
})

test('an interrupted image upload preserves the draft and exposes retry', async ({ page, request }) => {
  const { identity } = await seedBaby(request, 'upload-interruption')
  let interruptedUploads = 0

  await loginInBrowser(page, identity)
  await button(page, '图文').click()
  const editor = page.getByRole('textbox', { name: '写下这个成长瞬间…' })
  await editor.fill('上传中断后仍保留的草稿')
  const imageBuffer = await sharp({
    create: {
      width: 2,
      height: 3,
      channels: 4,
      background: '#78b4dc',
    },
  }).png().toBuffer()

  const chooserPromise = page.waitForEvent('filechooser')
  await page.locator('taro-button-core.media-picker__add').click()
  const chooser = await chooserPromise
  await chooser.setFiles({
    name: 'synthetic.png',
    mimeType: 'image/png',
    buffer: imageBuffer,
  })
  await expect(page.locator('.media-picker__count')).toHaveText('1/9')

  await page.route('**/*', async (route) => {
    if (route.request().method() === 'PUT') {
      interruptedUploads += 1
      await route.abort('connectionreset')
      return
    }
    await route.fallback()
  })

  await button(page, '保存记录').click()

  await expect(page.getByText('上传失败', { exact: true })).toBeVisible()
  await expect(button(page, '重试')).toBeVisible()
  await expect(editor).toHaveValue('上传中断后仍保留的草稿')
  await expect(page.locator('.media-picker__item')).toHaveCount(1)
  expect(interruptedUploads).toBeGreaterThanOrEqual(1)
})
