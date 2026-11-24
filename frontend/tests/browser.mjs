import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { pageLayout } from './layout-check.mjs'

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'
const browserPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
const evidence = process.env.E2E_ARTIFACTS
const mapLayoutAnchors = ['.map-panel']
const browser = await chromium.launch({
  executablePath: browserPath,
  args: process.env.E2E_FORCE_WEBGL === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
})

async function capture(page, filename) {
  if (!evidence) return
  await mkdir(evidence, { recursive: true })
  await page.screenshot({ path: join(evidence, filename), fullPage: true, animations: 'disabled' })
}

async function assertNoHorizontalOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
}

async function mapLayout(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const { height, anchors } = await pageLayout(page, mapLayoutAnchors)
  return { height, anchors }
}

async function waitForArea(page, name) {
  const area = page.getByRole('navigation', { name: '区域层级' })
  await area.locator('[aria-current="page"]').filter({ hasText: name }).waitFor()
  await page.getByRole('heading', { name: name + '模型' }).waitFor()
  const route = new URL(page.url()).pathname
  const areaId = route === '/' ? 'mentougou' : decodeURIComponent(route.split('/').at(-1))
  await page.locator(`.district-local-model[data-model-ready="ready"][data-model-scope=${JSON.stringify(areaId)}] canvas`).waitFor()
}

async function verifyLocalModel(page) {
  const model = page.locator('.district-local-model[data-model-ready="ready"]')
  const initialLayout = await mapLayout(page)
  await model.getByRole('link', { name: '查看全区人口专题' }).waitFor()

  const markerGeometry = () => {
    const read = selector => {
      const rect = document.querySelector(selector)?.getBoundingClientRect()
      return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null
    }
    const population = read('.model-population')
    const town = read('.model-place[data-place="datai"]')
    return population && town && {
      ...population, separation: Math.hypot(population.x - town.x, population.y - town.y),
    }
  }
  for (const view of ['2D', '3D']) {
    await model.getByRole('button', { name: view, exact: true }).click()
    assert.equal(await model.getAttribute('data-view'), view.toLowerCase())
    await model.getByRole('button', { name: '复位视角', exact: true }).click()
    await mapLayout(page)
    const start = await page.evaluate(markerGeometry)
    assert(start?.separation > 1)
    await page.mouse.move(start.x, start.y)
    await page.mouse.wheel(0, -100)
    await mapLayout(page)
    const larger = await page.evaluate(markerGeometry)
    assert(larger?.separation > start.separation * 1.12, view + ' wheel up should magnify the scene')
    assert(Math.hypot(larger.x - start.x, larger.y - start.y) < 2, view + ' keeps the cursor anchor')
    await page.mouse.wheel(0, 100)
    await mapLayout(page)
    const restored = await page.evaluate(markerGeometry)
    assert(Math.abs(restored.separation - start.separation) < 2, view + ' wheel down should shrink the scene')
  }
  assert.equal(await model.getByRole('button', { name: /放大模型|缩小模型/ }).count(), 0)
  const canvas = model.locator('canvas')
  await canvas.focus()
  const previous = await page.evaluate(markerGeometry)
  await canvas.press('+')
  await page.waitForFunction(({ x, y }) => {
    const marker = document.querySelector('.model-population')?.getBoundingClientRect()
    return marker && Math.hypot(marker.x + marker.width / 2 - x, marker.y + marker.height / 2 - y) > 1
  }, previous)
  assert((await page.evaluate(markerGeometry))?.separation > previous.separation, 'Keyboard zoom should remain available')
  await model.getByRole('button', { name: '复位视角', exact: true }).click()
  assert.deepEqual(await mapLayout(page), initialLayout)
  assert.equal(await page.getByRole('button', { name: /行政地图|区域地图|行政区划/ }).count(), 0)
}

async function verifyRegionMenuLayout(page) {
  const trigger = page.locator('.region-picker > summary')
  const menu = page.getByRole('navigation', { name: '下辖区域' })
  await trigger.scrollIntoViewIfNeeded()
  const original = await pageLayout(page, mapLayoutAnchors)
  await trigger.click()
  await menu.waitFor()
  assert.deepEqual(await pageLayout(page, mapLayoutAnchors), original, 'The area menu should overlay the map')
  await trigger.press('Escape')
  await menu.waitFor({ state: 'hidden' })
  assert.deepEqual(await pageLayout(page, mapLayoutAnchors), original)
}

async function verifyAs(page, name) {
  const request = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/demo-session'))
  const dialog = page.getByRole('dialog', { name: '身份核验' })
  await page.locator('.identity-button').click()
  await dialog.getByRole('button', { name }).click()
  assert.equal((await request).status(), 200)
  await dialog.waitFor({ state: 'hidden' })
}

try {
  const errors = []
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(15_000)
  page.on('pageerror', error => errors.push(error.message))
  const externalMapRequests = []
  await page.route(/^https:\/\/(?:tiles\.openfreemap\.org|elevation-tiles-prod\.s3\.amazonaws\.com)\//, route => {
    externalMapRequests.push(route.request().url())
    return route.abort('failed')
  })
  await page.goto(baseUrl)
  await page.getByRole('heading', { name: '门头沟区数字驾驶舱' }).waitFor()
  await waitForArea(page, '门头沟区')
  await page.getByRole('button', { name: '身份核验' }).waitFor()
  await assertNoHorizontalOverflow(page)
  await page.setViewportSize({ width: 1072, height: 893 })
  await verifyLocalModel(page)
  await verifyRegionMenuLayout(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await capture(page, 'cockpit-1440.png')

  if (evidence) {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await assertNoHorizontalOverflow(page)
    await capture(page, 'cockpit-1080p.png')
    await page.setViewportSize({ width: 3840, height: 2160 })
    await assertNoHorizontalOverflow(page)
    await capture(page, 'cockpit-4k.png')
    await page.setViewportSize({ width: 1440, height: 900 })
  }

  const districtCanvas = await page.locator('.district-local-model canvas').elementHandle()
  await page.locator('.region-picker > summary').click()
  const town = page.getByRole('navigation', { name: '下辖区域' }).getByRole('link', { name: '大峪街道' })
  await town.focus()
  await town.press('Enter')
  await page.waitForURL('**/areas/dayu')
  await waitForArea(page, '大峪街道')
  assert.equal(await page.locator('.district-local-model canvas').evaluate((canvas, before) => canvas === before, districtCanvas), true,
    'Town drill-down should reuse the loaded district model')
  await capture(page, 'cockpit-town.png')

  await page.locator('.region-picker > summary').click()
  const villageLink = page.getByRole('navigation', { name: '下辖区域' }).getByRole('link').first()
  const villageName = await villageLink.textContent()
  await villageLink.click()
  await waitForArea(page, villageName)
  const villageUrl = page.url()
  await verifyAs(page, /常规身份/)
  assert.equal(page.url(), villageUrl)
  await page.getByRole('button', { name: '区级运行管理者' }).waitFor()
  await page.getByRole('link', { name: '返回上一级 大峪街道' }).click()
  await waitForArea(page, '大峪街道')

  assert.equal(await page.locator('main #voice-assistant').count(), 0)
  const assistant = page.getByRole('dialog', { name: 'AI 问数' })
  const ask = async (question) => {
    await page.getByRole('button', { name: 'AI 问数', exact: true }).click()
    await assistant.getByRole('textbox', { name: '输入问题或指令' }).fill(question)
    await assistant.getByRole('button', { name: '发送', exact: true }).click()
  }

  await page.getByRole('button', { name: '查看问题', exact: true }).click()
  const manualIssues = page.getByRole('dialog', { name: '大峪街道问题诊断' })
  await manualIssues.getByRole('region', { name: '指标与依据' }).waitFor()
  await capture(page, 'issues-manual.png')
  await page.keyboard.press('Escape')
  await manualIssues.waitFor({ state: 'hidden' })

  await ask('我想要看大台街道的数据')
  await page.waitForURL('**/areas/datai')
  await waitForArea(page, '大台街道')
  await assistant.waitFor({ state: 'hidden' })
  await ask('大台有哪些问题')
  const dataiIssues = page.getByRole('dialog', { name: '大台街道问题诊断' })
  await dataiIssues.getByRole('region', { name: '运行事项' }).waitFor()
  await dataiIssues.getByRole('region', { name: '指标与依据' }).waitFor()
  await capture(page, 'issues-datai.png')
  await dataiIssues.getByRole('button', { name: '关闭', exact: true }).last().click()
  await dataiIssues.waitFor({ state: 'hidden' })

  await page.getByRole('link', { name: '返回门头沟区全域' }).click()
  await waitForArea(page, '门头沟区')
  await ask('大台街道的办结率是多少？')
  await page.waitForURL('**/areas/datai')
  await assistant.getByRole('log', { name: '问数记录' }).getByText(/大台街道当前快照的.*办结率/).waitFor()
  await capture(page, 'assistant-cross-area.png')
  await assistant.getByRole('link', { name: '返回门头沟区', exact: true }).click()
  await waitForArea(page, '门头沟区')
  await assistant.waitFor({ state: 'hidden' })
  console.log('PASS anonymous access, manual drill-down and inspection, command navigation, issue dialog and cross-area question')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('link', { name: '返回门头沟区全域' }).click()
  await waitForArea(page, '门头沟区')
  await assertNoHorizontalOverflow(page)
  await verifyLocalModel(page)
  await verifyRegionMenuLayout(page)
  assert.deepEqual(externalMapRequests, [], 'District and regional models use local assets')
  console.log('PASS local model, pointer-anchored 2D/3D wheel zoom, keyboard zoom and stable layout at 1072px and 390px')
  await capture(page, 'cockpit-mobile.png')
  await verifyAs(page, /政务服务专项/)
  await page.waitForURL('**/play/public-services')
  await page.getByRole('heading', { name: '政务服务', level: 1, exact: true }).waitFor()
  await page.locator('.data-chart canvas').first().waitFor()
  await assertNoHorizontalOverflow(page)
  await capture(page, 'cockpit-special-mobile.png')

  const denied = page.waitForResponse(response => response.url().endsWith('/api/v1/playback/city-operations/manifest'))
  await page.goto(new URL('/play/city-operations', baseUrl).toString())
  assert([403, 404].includes((await denied).status()))
  await page.getByRole('heading', { name: '无法打开专题' }).waitFor()
  assert.equal(await page.locator('.screen-component').count(), 0)
  await page.getByRole('link', { name: '返回驾驶舱' }).click()
  await waitForArea(page, '门头沟区')
  await page.locator('.identity-button').click()
  await page.getByRole('button', { name: '退出核验' }).click()
  await page.getByRole('button', { name: '身份核验' }).waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS mobile dashboard, specialist routing, private project isolation, logout and no runtime errors')
} finally {
  await browser.close()
}
