import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'
const output = process.env.E2E_ARTIFACTS
const route = new URL('/admin/dashboards', baseUrl).toString()
const draftPath = '/api/v1/admin/dashboards/city-operations/draft'
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })

async function capture(page, name, fullPage = false) {
  if (!output) return
  await mkdir(output, { recursive: true })
  await page.screenshot({ path: join(output, name), fullPage, animations: 'disabled' })
}

async function readDraft(page) {
  const reply = await page.request.get(draftPath)
  assert.equal(reply.status(), 200)
  return (await reply.json()).data
}

async function drag(page, handle, dx, dy = 0) {
  await handle.scrollIntoViewIfNeeded()
  const bounds = await handle.boundingBox()
  assert(bounds)
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 6 })
  await page.mouse.up()
}

try {
  const page = await browser.newPage({ baseURL: baseUrl, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const errors = []
  page.setDefaultTimeout(12_000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(route)
  await page.getByRole('heading', { name: '数据管理员核验' }).waitFor()
  assert.equal((await page.request.get(draftPath)).status(), 401)
  await page.getByRole('button', { name: '使用演示数据管理员' }).click()
  await page.getByRole('heading', { name: '大屏编排', exact: true }).waitFor()
  const stage = page.getByRole('region', { name: '画布', exact: true })
  await stage.waitFor()
  const original = await readDraft(page)
  assert(original.components.length > 0)
  const initial = original.components[0]

  const title = '编排验收指标 ' + Date.now().toString(36)
  await page.getByRole('button', { name: '组件 ' + initial.title, exact: true }).first().click()
  await page.getByLabel('组件标题').fill(title)
  await page.getByLabel('组件标题').press('Enter')
  const move = stage.getByRole('button', { name: '移动 ' + title, exact: true })
  let x = initial.geometry.x
  for (const zoom of ['0.5', '1', '1.5']) {
    await stage.getByLabel('画布缩放').selectOption(zoom)
    await drag(page, move, 30 * Number(zoom))
    x += 30
    assert.equal(await page.getByLabel('X 坐标').inputValue(), String(x), 'drag distance at zoom ' + zoom)
  }
  await stage.getByLabel('画布缩放').selectOption('0.5')
  const resize = stage.getByRole('button', { name: '调整大小 ' + title, exact: true })
  await drag(page, resize, 20, 10)
  assert.equal(await page.getByLabel('宽度', { exact: true }).inputValue(), String(initial.geometry.width + 40))
  assert.equal(await page.getByLabel('高度', { exact: true }).inputValue(), String(initial.geometry.height + 20))
  await stage.getByRole('button', { name: '撤销', exact: true }).click()
  assert.equal(await page.getByLabel('宽度', { exact: true }).inputValue(), String(initial.geometry.width))
  await stage.getByRole('button', { name: '重做', exact: true }).click()
  assert.equal(await page.getByLabel('宽度', { exact: true }).inputValue(), String(initial.geometry.width + 40))
  await move.press('Shift+ArrowDown')
  assert.equal(await page.getByLabel('Y 坐标').inputValue(), String(initial.geometry.y + 10))

  await page.getByRole('button', { name: '添加 受理事件', exact: true }).click()
  await page.getByLabel('绑定指标').selectOption('active-alerts')
  await stage.getByLabel('画布缩放').selectOption('fit')
  await capture(page, 'draft-editor-desktop.png')
  await page.getByRole('button', { name: '预览草稿', exact: true }).click()
  const preview = page.getByRole('region', { name: '草稿预览', exact: true })
  const card = preview.locator('.screen-component').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
  await card.waitFor()
  assert.match(await card.locator('.screen-metric strong').innerText(), /\d/)
  await preview.locator('.data-chart canvas').first().waitFor()
  await capture(page, 'draft-preview-desktop.png')
  await page.getByRole('button', { name: '返回编辑', exact: true }).click()

  const persisted = page.waitForResponse(reply => reply.request().method() === 'PUT' && reply.url().endsWith(draftPath))
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  assert.equal((await persisted).status(), 200)
  await page.getByRole('status').filter({ hasText: '草稿 v' + (original.revision + 1) }).waitFor()
  const saved = await readDraft(page)
  assert.equal(saved.revision, original.revision + 1)
  assert.equal(saved.components.length, original.components.length + 1)
  assert.equal(saved.components.find(component => component.title === title)?.geometry.x, x)

  await page.reload()
  await page.getByRole('button', { name: '组件 ' + title, exact: true }).click()
  assert.equal(await page.getByLabel('X 坐标').inputValue(), String(x))

  const csrfReply = await page.request.get('/api/v1/auth/csrf')
  assert.equal(csrfReply.status(), 200)
  const csrf = (await csrfReply.json()).data
  const serverTitle = title + ' 服务端'
  const serverUpdate = await page.request.put(draftPath, {
    headers: { [csrf.headerName]: csrf.token, 'If-Match': '"' + saved.revision + '"' },
    data: { components: saved.components.map(component =>
      component.title === title ? { ...component, title: serverTitle } : component) },
  })
  assert.equal(serverUpdate.status(), 200)
  const localTitle = title + ' 本地'
  await page.getByLabel('组件标题').fill(localTitle)
  await page.getByLabel('组件标题').press('Enter')
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '草稿版本有更新' }).waitFor()
  await page.getByRole('button', { name: '组件 ' + localTitle, exact: true }).waitFor()
  await page.getByRole('button', { name: '加载服务器草稿', exact: true }).click()
  await page.getByRole('dialog', { name: '加载服务器草稿' })
    .getByRole('button', { name: '放弃更改并加载', exact: true }).click()
  await page.getByRole('button', { name: '组件 ' + serverTitle, exact: true }).waitFor()

  const phone = await browser.newPage({
    baseURL: baseUrl, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true,
    storageState: await page.context().storageState(),
  })
  phone.on('pageerror', error => errors.push(error.message))
  await phone.goto(route)
  await phone.getByRole('region', { name: '画布', exact: true }).waitFor()
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await capture(phone, 'draft-editor-mobile.png', true)
  assert.deepEqual(errors, [])
  console.log('PASS P3 draft auth, zoom/drag, resize, keyboard, undo/redo, preview, save/reload, conflict recovery and mobile layout')
} finally {
  await browser.close()
}
