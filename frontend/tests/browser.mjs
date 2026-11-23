import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { pageLayout } from './layout-check.mjs'

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'
const browserPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
const evidence = process.env.E2E_ARTIFACTS
const verifyLiveBasemap = process.env.VERIFY_LIVE_BASEMAP === '1'
const basemapOrigin = 'https://tiles.openfreemap.org'
const elevationOrigin = 'https://elevation-tiles-prod.s3.amazonaws.com'
const mapLayoutAnchors = ['.map-panel', '.cockpit-primary', '.cockpit-brief', '.cockpit-trend']
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

async function waitForArea(page, name, mapReady = 'fallback') {
  const area = page.getByRole('navigation', { name: '区域层级' })
  await area.locator('[aria-current="page"]').filter({ hasText: name }).waitFor()
  await page.getByRole('heading', { name: '空间态势' }).waitFor()
  if (name !== '门头沟区') {
    await page.locator('.terrain-surface canvas').waitFor()
    return
  }
  const map = page.locator(`.navigation-map[data-map-ready="${mapReady}"]`)
  await map.locator(mapReady === 'true' ? '.maplibregl-canvas' : '.district-map > canvas').waitFor()
}

async function verifyDistrictMap(page, stacked = false) {
  const map = page.locator('.district-map')
  const attribution = map.getByRole('link', { name: '© OpenStreetMap contributors' })
  assert.equal(await attribution.getAttribute('href'), 'https://www.openstreetmap.org/copyright')
  const layoutBeforeZoom = await mapLayout(page)
  await map.getByRole('button', { name: '放大地图', exact: true }).click()
  assert.equal(await map.getAttribute('data-zoomed'), 'true')
  await map.getByRole('button', { name: '全域', exact: true }).click()
  assert.equal(await map.getAttribute('data-zoomed'), 'false')
  assert.deepEqual(await mapLayout(page), layoutBeforeZoom, 'Offline map zoom should preserve cockpit layout')
  await verifyPanelLayout(page, { stacked })
}

async function verifyPanelLayout(page, { stacked = false, online = false } = {}) {
  const layout = await page.evaluate(({ credits, controls }) => {
    const bounds = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON()
    return {
      stage: bounds('.map-panel'), map: bounds('.district-map-extent'),
      left: bounds('.cockpit-primary'), right: bounds('.cockpit-brief'),
      credits: bounds(credits), controls: bounds(controls),
    }
  }, {
    credits: online ? '.maplibregl-ctrl-attrib' : '.district-map-credit',
    controls: online ? '.navigation-map-tools' : '.district-map-tools',
  })
  if (stacked) {
    assert.ok(layout.stage.bottom <= layout.left.top && layout.left.bottom <= layout.right.top, 'The map leads the mobile layout')
  } else {
    assert.ok(layout.map.left <= layout.left.left && layout.right.right <= layout.map.right, 'The map continues behind the desktop panels')
    assert.ok(layout.left.right <= layout.credits.left && layout.controls.right <= layout.right.left,
      'Attribution and map controls clear the desktop panels')
    for (const rail of [layout.left, layout.right]) {
      assert.ok(rail.top >= layout.stage.top && rail.bottom <= layout.stage.bottom, 'Panels float within the stage')
    }
  }
  const { credits, controls } = layout
  assert.ok(credits.right <= controls.left || controls.right <= credits.left ||
    credits.bottom <= controls.top || controls.bottom <= credits.top, 'Attribution and map controls do not cover each other')
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

function mapResponse(page, expectedOrigin, pathPattern) {
  return page.waitForResponse(response => {
    const { origin, pathname } = new URL(response.url())
    return response.ok() && origin === expectedOrigin && pathPattern.test(pathname)
  }, { timeout: 30_000 })
}

async function waitForCamera(page, { minZoom = 0, minPitch = 0, maxPitch = 85 } = {}) {
  await page.waitForFunction(({ minZoom, maxPitch, minPitch }) => {
    const state = document.querySelector('.navigation-map')?.dataset
    const zoom = Number(state?.mapZoom)
    const pitch = Number(state?.mapPitch)
    return zoom >= minZoom && pitch <= maxPitch && pitch >= minPitch
  }, { minZoom, minPitch, maxPitch })
}

async function verifyOnlineDistrictMap(page) {
  const [styleResponse, tileResponse] = await Promise.all([
    mapResponse(page, basemapOrigin, /^\/styles\//),
    mapResponse(page, basemapOrigin, /\/\d+\/\d+\/\d+\.(pbf|mvt)$/),
    page.goto(baseUrl),
  ])
  const style = await styleResponse.json()
  assert.equal(style.version, 8)
  assert.ok(style.layers.some(layer => layer['source-layer'] === 'building' && layer.type === 'fill-extrusion'),
    'The online style supplies building extrusion data')
  assert.ok((await tileResponse.body()).byteLength > 0, 'The online vector tile has data')

  await waitForArea(page, '门头沟区', 'true')
  const map = page.locator('.navigation-map[data-map-ready="true"]')
  const mode2D = map.getByRole('button', { name: '2D', exact: true })
  const mode3D = map.getByRole('button', { name: '3D', exact: true })
  await waitForCamera(page, { maxPitch: 0 })
  await map.getByRole('link', { name: /OpenStreetMap/ }).waitFor()
  await verifyPanelLayout(page, { online: true })
  const startingZoom = Number(await map.getAttribute('data-map-zoom'))
  const layout = await mapLayout(page)
  assert.equal(await mode2D.getAttribute('aria-pressed'), 'true')
  await capture(page, 'cockpit-online-2d.png')

  const [demResponse] = await Promise.all([
    mapResponse(page, elevationOrigin, /^\/terrarium\/\d+\/\d+\/\d+\.png$/),
    mode3D.click(),
  ])
  assert.equal((await demResponse.body()).subarray(1, 4).toString('ascii'), 'PNG', '3D loads real elevation tiles')
  await map.and(page.locator('[data-map-mode="3d"]')).waitFor()
  await waitForCamera(page, { minZoom: startingZoom - 1, minPitch: 30 })
  assert.equal(await mode3D.getAttribute('aria-pressed'), 'true')
  await capture(page, 'cockpit-online-3d-overview.png')

  const zoomIn = map.getByRole('button', { name: '放大地图', exact: true })
  const beforeDetail = Number(await map.getAttribute('data-map-zoom'))
  await Promise.all([
    mapResponse(page, basemapOrigin, /\/14\/\d+\/\d+\.(pbf|mvt)$/).then(async response => {
      assert.ok((await response.body()).byteLength > 0, 'The detailed 3D view requests vector data')
    }),
    (async () => {
      const zoomSteps = Math.max(0, Math.ceil(14.05 - beforeDetail))
      for (let step = 0; step < zoomSteps; step++) {
        const currentZoom = Number(await map.getAttribute('data-map-zoom'))
        await zoomIn.click()
        await waitForCamera(page, { minZoom: currentZoom + 0.9, minPitch: 30 })
      }
      await waitForCamera(page, { minZoom: 14, minPitch: 30 })
    })(),
  ])
  await capture(page, 'cockpit-online-3d-detail.png')

  const detailZoom = Number(await map.getAttribute('data-map-zoom'))
  await map.getByRole('button', { name: '缩小地图', exact: true }).click()
  await page.waitForFunction(previous => {
    const zoom = Number(document.querySelector('.navigation-map')?.getAttribute('data-map-zoom'))
    return zoom < previous - 0.9
  }, detailZoom)

  await mode2D.click()
  await map.and(page.locator('[data-map-mode="2d"]')).waitFor()
  await waitForCamera(page, { maxPitch: 0 })
  await map.getByRole('button', { name: '全域', exact: true }).click()
  await page.waitForFunction(expected => {
    const zoom = Number(document.querySelector('.navigation-map')?.getAttribute('data-map-zoom'))
    return Math.abs(zoom - expected) <= 0.05
  }, startingZoom)
  assert.deepEqual(await mapLayout(page), layout, '2D/3D switching should preserve cockpit layout')
  await assertNoHorizontalOverflow(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await verifyPanelLayout(page, { stacked: true, online: true })
  await assertNoHorizontalOverflow(page)
  await capture(page, 'cockpit-online-mobile.png')

  await map.getByRole('button', { name: '大峪街道', exact: true }).press('Enter')
  await page.waitForURL('**/areas/dayu')
  await waitForArea(page, '大峪街道')
  console.log('PASS live basemap and elevation tiles, 3D camera at building zoom, 2D reset and map pin drill-down')
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
  let blockedBasemapRequests = 0
  await page.route(`${basemapOrigin}/**`, route => {
    blockedBasemapRequests++
    return route.abort('failed')
  })
  await page.goto(baseUrl)
  await page.getByRole('heading', { name: '门头沟区数字驾驶舱' }).waitFor()
  await waitForArea(page, '门头沟区')
  assert.ok(blockedBasemapRequests > 0, 'Offline coverage should exercise an unavailable tile service')
  await page.getByRole('button', { name: '身份核验' }).waitFor()
  await assertNoHorizontalOverflow(page)
  await page.setViewportSize({ width: 1072, height: 893 })
  await verifyDistrictMap(page)
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

  await page.locator('.region-picker > summary').click()
  const town = page.getByRole('navigation', { name: '下辖区域' }).getByRole('link', { name: '大峪街道' })
  await town.focus()
  await town.press('Enter')
  await page.waitForURL('**/areas/dayu')
  await waitForArea(page, '大峪街道')
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
  await verifyDistrictMap(page, true)
  await verifyRegionMenuLayout(page)
  console.log('PASS offline district map, zoom/reset and stable panel layout at 1072px and 390px')
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

  if (verifyLiveBasemap) {
    const onlinePage = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
    onlinePage.setDefaultTimeout(15_000)
    onlinePage.on('pageerror', error => errors.push(error.message))
    await verifyOnlineDistrictMap(onlinePage)
    assert.deepEqual(errors, [])
  }
} finally {
  await browser.close()
}
