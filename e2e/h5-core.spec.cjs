/* eslint-disable @typescript-eslint/no-require-imports */
const { randomUUID } = require('node:crypto')
const { expect, test } = require('@playwright/test')

const apiBaseUrl = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:3300/api/v1'
const babyName = 'CI 宝宝'

function button(page, label) {
  return page.locator('taro-button-core').filter({ hasText: new RegExp(`^${label}$`) }).first()
}

async function seedBaby(request) {
  const login = await request.post(`${apiBaseUrl}/auth/mock-login`, {
    data: { mockUserKey: 'parent-a', displayName: '测试妈妈' },
  })
  expect(login.ok()).toBeTruthy()
  const token = (await login.json()).data.accessToken
  const headers = { authorization: `Bearer ${token}` }
  const babiesResponse = await request.get(`${apiBaseUrl}/babies`, { headers })
  expect(babiesResponse.ok()).toBeTruthy()
  const babies = (await babiesResponse.json()).data
  const existing = babies.find((baby) => baby.name === babyName)
  if (existing) return { token, baby: existing }
  const created = await request.post(`${apiBaseUrl}/babies`, {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: {
      name: babyName,
      gender: 'unspecified',
      birthDate: '2025-01-01',
    },
  })
  expect(created.ok()).toBeTruthy()
  return { token, baby: (await created.json()).data }
}

async function addBackupAdmin(request, token, babyId) {
  const headers = { authorization: `Bearer ${token}` }
  const invited = await request.post(`${apiBaseUrl}/babies/${babyId}/invites`, {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: { role: 'editor', expiresInHours: 24 },
  })
  expect(invited.ok()).toBeTruthy()
  const inviteToken = (await invited.json()).data.token

  const backupLogin = await request.post(`${apiBaseUrl}/auth/mock-login`, {
    data: { mockUserKey: `e2e-backup-${randomUUID()}`, displayName: '测试备用管理员' },
  })
  expect(backupLogin.ok()).toBeTruthy()
  const backupSession = (await backupLogin.json()).data
  const accepted = await request.post(`${apiBaseUrl}/invites/accept`, {
    headers: {
      authorization: `Bearer ${backupSession.accessToken}`,
      'idempotency-key': randomUUID(),
    },
    data: { token: inviteToken },
  })
  expect(accepted.ok()).toBeTruthy()

  const membersResponse = await request.get(`${apiBaseUrl}/babies/${babyId}/members`, { headers })
  expect(membersResponse.ok()).toBeTruthy()
  const member = (await membersResponse.json()).data.find(
    (item) => item.user.id === backupSession.user.id,
  )
  expect(member).toBeTruthy()
  const promoted = await request.patch(`${apiBaseUrl}/babies/${babyId}/members/${member.id}`, {
    headers,
    data: { version: member.version, role: 'admin' },
  })
  expect(promoted.ok()).toBeTruthy()
}

test('parent completes the H5 MVP core journey', async ({ page, request }) => {
  const browserErrors = []
  const pendingConsoleErrors = []
  let journeyStep = 'startup'
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const step = journeyStep
    const messageText = message.text()
    // Immediate access loss intentionally produces a browser-visible 404 for
    // the stale resource request that triggered cache invalidation.
    if (step === 'leave-family' && messageText.includes('404 (Not Found)')) return
    pendingConsoleErrors.push(Promise.all(message.args().slice(1).map((argument) =>
      argument.evaluate((value) => value instanceof Node
        ? {
            nodeName: value.nodeName,
            id: value instanceof Element ? value.id : '',
            className: value instanceof Element ? value.className : '',
            parentNodeName: value.parentNode?.nodeName ?? null,
            isConnected: value.isConnected,
          }
        : { type: typeof value }).catch(() => ({ type: 'unavailable' })),
    )).then((details) => {
      browserErrors.push(`[${step}] ${messageText} ${JSON.stringify(details)}`)
    }))
  })
  page.on('pageerror', (error) => browserErrors.push(`[${journeyStep}] ${error.message}`))
  const { token, baby } = await seedBaby(request)
  const note = `E2E 成长瞬间 ${Date.now()}`

  await page.goto('/#/pages/auth/index')
  await expect(page.locator('.auth-brand__title')).toHaveText('宝宝成长记')
  await page.locator('input[type="checkbox"]').check()
  await button(page, '以测试用户登录').click()
  await expect(page.locator('.baby-header-card__name')).toHaveText(babyName)

  journeyStep = 'create-note-open'
  await button(page, '图文').click()
  journeyStep = 'create-note-fill'
  await page.getByRole('textbox', { name: '写下这个成长瞬间…' }).fill(note)
  journeyStep = 'create-note-save'
  await button(page, '保存记录').click()
  journeyStep = 'create-note-detail'
  await expect(page.getByText(note, { exact: true })).toBeVisible()

  journeyStep = 'timeline'
  await page.getByText('时间轴', { exact: true }).click()
  await expect(page.locator('.timeline-baby__name')).toHaveText(`${babyName}的成长时间轴`)
  await expect(page.getByText(note, { exact: true }).last()).toBeVisible()

  journeyStep = 'growth-open'
  await page.getByText('成长', { exact: true }).click()
  await expect(page.locator('.growth-baby__name')).toHaveText(`${babyName}的成长数据`)
  await page.locator('taro-button-core').filter({ hasText: /^(新增测量|＋ 新增)$/ }).first().click()
  journeyStep = 'growth-fill'
  await page.locator('input[placeholder="20–250"]').fill('80.5')
  await page.locator('input[placeholder="0.2–300"]').fill('10.2')
  journeyStep = 'growth-save'
  await button(page, '保存记录').click()
  journeyStep = 'growth-detail'
  await expect(page).toHaveURL(/#\/pages\/records\/detail/)
  await expect(page.locator('.record-detail__metric-value').filter({ hasText: '80.5' })).toBeVisible()
  journeyStep = 'growth-back'
  await page.goBack()
  await expect(page.locator('.growth-baby__name')).toHaveText(`${babyName}的成长数据`)
  await expect(page.getByText('80.5 cm', { exact: true }).first()).toBeVisible()

  journeyStep = 'family'
  await page.goto('/#/pages/profile/index')
  await expect(page).toHaveURL(/#\/pages\/profile\/index/)
  await page.getByText('家庭成员与权限', { exact: true }).click()
  await expect(page).toHaveURL(/#\/pages\/family\/members/)
  await button(page, '邀请成员').click()
  await button(page, '生成邀请').click()
  await expect(page.getByText('邀请已生成', { exact: true })).toBeVisible()

  journeyStep = 'export'
  await page.goto('/#/pages/profile/index')
  await page.getByText('数据导出', { exact: true }).click()
  await expect(page).toHaveURL(/#\/pages\/exports\/index/)
  await expect(page.locator('input[type="checkbox"]')).not.toBeChecked()
  await button(page, '创建 ZIP 导出').click()
  await button(page, '创建导出').click()
  await expect(page.getByText(/等待处理|正在生成|可下载/).last()).toBeVisible()
  await expect(page.getByText('照片').last()).toBeVisible()
  await expect(page.getByText('不包含', { exact: true })).toBeVisible()
  await expect(button(page, '获取下载地址并下载')).toBeVisible({ timeout: 60_000 })
  const downloadAuthorization = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    response.url().includes('/download-url'),
  )
  await button(page, '获取下载地址并下载').click()
  const authorizationResponse = await downloadAuthorization
  expect(authorizationResponse.ok()).toBeTruthy()
  const downloadUrl = (await authorizationResponse.json()).data.downloadUrl
  const archiveResponse = await request.get(downloadUrl)
  expect(archiveResponse.ok()).toBeTruthy()
  const archive = await archiveResponse.body()
  expect(archive.subarray(0, 2).toString('ascii')).toBe('PK')

  journeyStep = 'data-rights'
  await page.goto('/#/pages/profile/index')
  await page.getByText('数据处理与删除申请', { exact: true }).click()
  await expect(page.getByText('提交数据权利申请', { exact: true })).toBeVisible()
  await page.locator('input[type="checkbox"]').check()
  await button(page, '提交申请').click()
  await button(page, '确认提交').click()
  await expect(page.getByText('待人工核验', { exact: true }).first()).toBeVisible()
  await button(page, '取消申请').first().click()
  await button(page, '确认取消').click()
  await expect(page.getByText('已取消', { exact: true }).first()).toBeVisible()

  const activeScopedRequest = await request.post(`${apiBaseUrl}/me/data-rights-requests`, {
    headers: { authorization: `Bearer ${token}` },
    data: { type: 'correction', babyId: baby.id },
  })
  expect(activeScopedRequest.ok()).toBeTruthy()
  await addBackupAdmin(request, token, baby.id)

  journeyStep = 'leave-family'
  await page.goto(`/#/pages/family/members?babyId=${baby.id}`)
  await expect(page.getByText('测试备用管理员', { exact: false })).toBeVisible()
  await button(page, '退出这个家庭').click()
  await button(page, '确认退出').click()
  await expect(page).toHaveURL(/#\/pages\/babies\/create/)
  await expect(page.getByText(babyName, { exact: true })).toHaveCount(0)

  const replayAfterLeave = await request.post(`${apiBaseUrl}/me/data-rights-requests`, {
    headers: { authorization: `Bearer ${token}` },
    data: { type: 'correction', babyId: baby.id },
  })
  expect(replayAfterLeave.status()).toBe(404)
  await Promise.all(pendingConsoleErrors)
  expect(browserErrors).toEqual([])
})
