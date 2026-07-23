/* eslint-disable @typescript-eslint/no-require-imports */
const { randomUUID } = require('node:crypto')
const net = require('node:net')
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

async function authenticateInBrowser(page, identity) {
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
}

async function loginInBrowser(page, identity) {
  await authenticateInBrowser(page, identity)
  await expect(page.locator('.baby-header-card__name')).toHaveText(identity.babyName)
}

async function startHangingServer() {
  const sockets = new Set()
  let connections = 0
  let receivedBytes = 0
  const server = net.createServer((socket) => {
    connections += 1
    sockets.add(socket)
    socket.on('data', (chunk) => { receivedBytes += chunk.length })
    socket.on('close', () => sockets.delete(socket))
    // Intentionally never write response headers or body. The client must end
    // this request through its own transport timeout.
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Hanging test server has no TCP port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    stats: () => ({ connections, receivedBytes }),
    close: async () => {
      sockets.forEach((socket) => socket.destroy())
      await new Promise((resolve) => server.close(resolve))
    },
  }
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

test('switching baby clears A data from home timeline and growth', async ({ page, request }) => {
  const { baby: babyA, identity, token } = await seedBaby(request, 'multi-baby-isolation')
  const headers = { authorization: `Bearer ${token}` }
  const babyBName = `${identity.babyName}-B`
  const babyBResponse = await request.post(`${apiBaseUrl}/babies`, {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: {
      name: babyBName,
      gender: 'unspecified',
      birthDate: '2025-01-01',
    },
  })
  expect(babyBResponse.ok()).toBeTruthy()

  const marker = `仅属于宝宝 A ${Date.now()}`
  const occurredAt = new Date().toISOString()
  const noteResponse = await request.post(`${apiBaseUrl}/babies/${babyA.id}/records`, {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: { type: 'note', occurredAt, content: marker, mediaIds: [] },
  })
  expect(noteResponse.ok()).toBeTruthy()
  const measurementResponse = await request.post(`${apiBaseUrl}/babies/${babyA.id}/records`, {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: {
      type: 'measurement',
      occurredAt,
      measurement: { heightCm: 88.88, weightKg: null },
      mediaIds: [],
    },
  })
  expect(measurementResponse.ok()).toBeTruthy()

  await authenticateInBrowser(page, identity)
  await expect(page.locator('.baby-header-card__name')).toBeVisible()
  await page.locator('.baby-header-card').click()
  await page.locator('.baby-switcher__item').filter({
    has: page.getByText(identity.babyName, { exact: true }),
  }).click()
  await expect(page.locator('.baby-header-card__name')).toHaveText(identity.babyName)
  await expect(page.getByText(marker, { exact: true })).toBeVisible()

  await page.getByText('时间轴', { exact: true }).click()
  const timelinePage = page.locator('.timeline-page:visible')
  await expect(timelinePage.locator('.timeline-baby__name')).toHaveText(`${identity.babyName}的成长时间轴`)
  await expect(timelinePage.getByText(marker, { exact: true })).toBeVisible()

  await page.getByText('成长', { exact: true }).click()
  const growthPage = page.locator('.growth-page:visible')
  await expect(growthPage.locator('.growth-baby__name')).toHaveText(`${identity.babyName}的成长数据`)
  await expect(growthPage.getByText('88.88 cm', { exact: true }).first()).toBeVisible()

  await growthPage.locator('.growth-baby').click()
  await growthPage.locator('.baby-switcher__item').filter({
    has: page.getByText(babyBName, { exact: true }),
  }).click()
  await expect(growthPage.locator('.growth-baby__name')).toHaveText(`${babyBName}的成长数据`)
  await expect(growthPage.getByText('88.88 cm', { exact: true })).toHaveCount(0)

  await page.getByText('时间轴', { exact: true }).click()
  await expect(timelinePage.locator('.timeline-baby__name')).toHaveText(`${babyBName}的成长时间轴`)
  await expect(timelinePage.getByText(marker, { exact: true })).toHaveCount(0)

  await page.getByText('首页', { exact: true }).click()
  await expect(page.locator('.baby-header-card__name:visible')).toHaveText(babyBName)
  await expect(page.locator('.home-recent-content:visible').getByText(marker, { exact: true })).toHaveCount(0)
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

test('a server that sends no bytes times out visibly and a user retry recovers', async ({ page, request }) => {
  const { baby, identity, token } = await seedBaby(request, 'server-timeout')
  const note = `真实超时后重试 ${Date.now()}`
  const hanging = await startHangingServer()
  let createAttempts = 0

  try {
    await loginInBrowser(page, identity)
    await button(page, '图文').click()
    await page.getByRole('textbox', { name: '写下这个成长瞬间…' }).fill(note)

    await page.route('**/api/v1/babies/*/records', async (route) => {
      const intercepted = route.request()
      if (intercepted.method() !== 'POST') {
        await route.fallback()
        return
      }
      createAttempts += 1
      if (createAttempts === 1) {
        const target = new URL(intercepted.url())
        await route.continue({ url: `${hanging.url}${target.pathname}${target.search}` })
        return
      }
      await route.continue()
    })

    await button(page, '保存记录').click()
    await expect(page.getByText('无法连接服务，请检查网络后重试', { exact: true }))
      .toBeVisible({ timeout: 20_000 })
    expect(hanging.stats().connections).toBeGreaterThanOrEqual(1)
    expect(hanging.stats().receivedBytes).toBeGreaterThan(0)
    expect(createAttempts).toBe(1)

    await button(page, '保存记录').click()
    await expect(page).toHaveURL(/#\/pages\/home\/index/)
    await expect(page.getByText(note, { exact: true })).toBeVisible()
    expect(createAttempts).toBe(2)

    const response = await request.get(`${apiBaseUrl}/babies/${baby.id}/records?limit=50`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.ok()).toBeTruthy()
    expect((await response.json()).data.filter((record) => record.content === note)).toHaveLength(1)
  } finally {
    await hanging.close()
  }
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

test('a selected PNG creates a pure-image record and appears on the record detail', async ({ page, request }) => {
  const { identity } = await seedBaby(request, 'png-upload-success')

  await loginInBrowser(page, identity)
  await button(page, '图文').click()
  await expect(page.getByRole('textbox', { name: '写下这个成长瞬间…' })).toHaveValue('')

  const imageBuffer = await sharp({
    create: {
      width: 4,
      height: 5,
      channels: 4,
      background: '#5a9bd5',
    },
  }).png().toBuffer()
  const chooserPromise = page.waitForEvent('filechooser')
  await page.locator('taro-button-core.media-picker__add').click()
  const chooser = await chooserPromise
  await chooser.setFiles({
    name: 'family-memory.png',
    mimeType: 'image/png',
    buffer: imageBuffer,
  })
  await expect(page.locator('.media-picker__count')).toHaveText('1/9')

  const uploadTicketRequest = page.waitForRequest((candidate) =>
    candidate.method() === 'POST' && candidate.url().includes('/media/uploads'),
  )
  const objectPutRequest = page.waitForRequest((candidate) => candidate.method() === 'PUT')
  const completionResponse = page.waitForResponse((candidate) =>
    candidate.request().method() === 'POST' && /\/api\/v1\/media\/[^/]+\/complete$/.test(candidate.url()),
  )
  const recordCreateResponse = page.waitForResponse((candidate) =>
    candidate.request().method() === 'POST' && /\/api\/v1\/babies\/[^/]+\/records$/.test(candidate.url()),
  )
  await button(page, '保存记录').click()
  const [ticketRequest, putRequest, completed, created] = await Promise.all([
    uploadTicketRequest,
    objectPutRequest,
    completionResponse,
    recordCreateResponse,
  ])

  expect(ticketRequest.postDataJSON()).toMatchObject({
    fileName: 'family-memory.png',
    mimeType: 'image/png',
    sizeBytes: imageBuffer.byteLength,
  })
  expect(putRequest.headers()['content-type']).toBe('image/png')
  expect(completed.ok()).toBeTruthy()
  expect(created.ok()).toBeTruthy()
  expect((await created.json()).data).toMatchObject({
    type: 'note',
    content: null,
    media: [{ sortOrder: 0 }],
  })

  await expect(page.getByText('一张成长照片', { exact: true })).toBeVisible()
  await page.getByText('一张成长照片', { exact: true }).click()
  await expect(page).toHaveURL(/#\/pages\/records\/detail/)
  const detailImage = page.locator('.record-detail__image')
  await expect(detailImage).toHaveCount(1)
  await expect(detailImage).toHaveAttribute('src', /^https?:\/\//)
})

test('record detail clears sensitive content when delete reports access loss', async ({ page, request }) => {
  const { baby, identity, token } = await seedBaby(request, 'detail-access-loss')
  const sensitiveText = `失权后不可残留 ${Date.now()}`
  const created = await request.post(`${apiBaseUrl}/babies/${baby.id}/records`, {
    headers: {
      authorization: `Bearer ${token}`,
      'idempotency-key': randomUUID(),
    },
    data: {
      type: 'note',
      occurredAt: new Date().toISOString(),
      content: sensitiveText,
      mediaIds: [],
    },
  })
  expect(created.ok()).toBeTruthy()
  const record = (await created.json()).data

  await loginInBrowser(page, identity)
  await page.goto(`/#/pages/records/detail?id=${record.id}`)
  await expect(page.getByText(sensitiveText, { exact: true })).toBeVisible()

  await page.route('**/api/v1/records/*', async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'RESOURCE_NOT_FOUND', message: '记录不存在或无权访问' },
      }),
    })
  })

  await button(page, '删除记录').click()
  await page.locator('.confirm-dialog__confirm').click()

  await expect(page.getByText('记录不可用', { exact: true })).toBeVisible()
  await expect(page.getByText(sensitiveText, { exact: true })).toHaveCount(0)
  await expect(page.locator('.record-detail__image')).toHaveCount(0)
  await expect(page.locator('.record-detail__actions')).toHaveCount(0)
})
