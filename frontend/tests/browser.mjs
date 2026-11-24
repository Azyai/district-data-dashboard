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

const errorMessage = error => error.message.replace(/(\btk=)[^&\s"']+/gi, '$1[redacted]')

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
  await page.locator('.cockpit-main[aria-busy="false"] #area-model').filter({ hasText: name }).waitFor()
  const route = new URL(page.url()).pathname
  const id = route === '/' ? 'mentougou' : decodeURIComponent(route.split('/').at(-1))
  const map = page.locator(`.tianditu-map[data-map-ready="ready"][data-map-scope=${JSON.stringify(id)}]`)
  await map.locator('canvas.maplibregl-canvas').waitFor()
  return map
}

async function freeMapPoint(map) {
  return map.evaluate(node => {
    const box = node.getBoundingClientRect()
    for (const height of [.45, .6, .72, .35]) {
      for (const width of [.5, .56, .43, .65, .37]) {
        const x = box.x + box.width * width
        const y = box.y + box.height * height
        if (document.elementFromPoint(x, y)?.matches('canvas.maplibregl-canvas')) return { x, y }
      }
    }
    throw new Error('No exposed map surface')
  })
}

async function zoomChanged(page, before, direction) {
  await page.waitForFunction(({ before, direction }) => {
    const value = document.querySelector('.tianditu-map')?.getAttribute('data-zoom')
    return value && (Number(value) - before) * direction > .02
  }, { before, direction })
}

async function verifyDistrictMap(page) {
  const map = await waitForArea(page, '门头沟区')
  const initialLayout = await mapLayout(page)
  const tool = map.getByRole('button', { name: '地图工具' })
  const panel = map.getByRole('group', { name: '地图视角' })
  const canvas = map.locator('canvas.maplibregl-canvas')
  await map.getByRole('link', { name: '查看全区人口专题' }).waitFor()
  const townCount = Number(await page.locator('.region-picker summary span').innerText())
  assert(townCount > 0)
  assert.equal(await map.locator('.atlas-place').count(), townCount, 'Every listed town needs a geographic marker')
  await map.getByRole('button', { name: '长安天街' }).waitFor()
  await map.getByRole('button', { name: '京西智谷' }).waitFor()
  for (const name of ['左侧指标', '右侧指标']) {
    await page.getByRole('complementary', { name }).locator('li').first().waitFor()
  }
  const choose = async name => {
    if (await tool.getAttribute('aria-expanded') === 'false') await tool.click()
    await panel.getByRole('button', { name, exact: true }).click()
    await panel.waitFor({ state: 'hidden' })
  }
  const zoom = () => map.evaluate(node => Number(node.dataset.zoom))
  for (const mode of ['2D', '3D']) {
    await choose(mode)
    await page.waitForFunction(view => document.querySelector('.tianditu-map')?.dataset.view === view, mode.toLowerCase())
    if (mode === '3D') {
      const anchor = await freeMapPoint(map)
      const initial = await map.evaluate(el => ({ bearing: Number(el.dataset.bearing), pitch: Number(el.dataset.pitch) }))
      await page.mouse.move(anchor.x, anchor.y)
      await page.mouse.down()
      await page.mouse.move(anchor.x + 45, anchor.y - 25, { steps: 6 })
      await page.waitForFunction(({ bearing, pitch }) => {
        const data = document.querySelector('.tianditu-map')?.dataset
        return Math.abs(Number(data?.bearing) - bearing) > 1 && Math.abs(Number(data?.pitch) - pitch) > 1
      }, initial)
      await page.mouse.up()
      await tool.click()
      assert.equal(await panel.getByRole('button').count(), 3)
      assert.equal(await panel.getByText(/天地图/).count(), 0)
    }
    await choose('复位视角')
    const start = await zoom()
    assert(start > 0)
    const pointer = await freeMapPoint(map)
    await page.mouse.move(pointer.x, pointer.y)
    await page.mouse.wheel(0, -200)
    await zoomChanged(page, start, 1)
    const magnified = await zoom()
    await page.mouse.wheel(0, 200)
    await zoomChanged(page, magnified, -1)
    await choose('复位视角')
    await page.waitForFunction(expected => Math.abs(Number(document.querySelector('.tianditu-map')?.dataset.zoom) - expected) < .05, start)
  }
  await choose('2D')
  const datai = map.locator('.atlas-place[data-place="datai"]')
  const original = await datai.boundingBox()
  assert(original)
  const pointer = await freeMapPoint(map)
  await page.mouse.move(pointer.x, pointer.y)
  await page.mouse.down()
  await page.mouse.move(pointer.x + 45, pointer.y - 20, { steps: 6 })
  await page.mouse.up()
  await page.waitForFunction(({ x, y }) => {
    const marker = document.querySelector('.atlas-place[data-place="datai"]')?.getBoundingClientRect()
    return marker && Math.hypot(marker.x - x, marker.y - y) > 12
  }, original)
  await choose('复位视角')
  await page.waitForFunction(({ x, y }) => {
    const marker = document.querySelector('.atlas-place[data-place="datai"]')?.getBoundingClientRect()
    return marker && Math.hypot(marker.x - x, marker.y - y) < 3
  }, original)
  await canvas.focus()
  const beforeKeyboard = await zoom()
  await canvas.press('Equal')
  await zoomChanged(page, beforeKeyboard, 1)
  await choose('复位视角')

  const bounds = await map.boundingBox()
  const beforeDrag = await tool.boundingBox()
  assert(bounds && beforeDrag)
  const x = beforeDrag.x + beforeDrag.width / 2
  const y = beforeDrag.y + beforeDrag.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 85, y - 15, { steps: 6 })
  await page.mouse.up()
  await page.waitForFunction(start => document.querySelector('.map-globe-trigger').getBoundingClientRect().x < start - 70, beforeDrag.x)
  const moved = await tool.boundingBox()
  assert(moved.x >= bounds.x && moved.y >= bounds.y)
  assert.equal(await tool.getAttribute('aria-expanded'), 'false')
  await tool.press('Enter')
  await panel.waitFor()
  const popover = await panel.boundingBox()
  assert(popover.x >= bounds.x && popover.y >= bounds.y &&
    popover.x + popover.width <= bounds.x + bounds.width + 1 &&
    popover.y + popover.height <= bounds.y + bounds.height + 1)
  await tool.press('Escape')
  await panel.waitFor({ state: 'hidden' })
  await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, y, { steps: 6 })
  await page.mouse.up()
  await page.waitForFunction(start => Math.abs(document.querySelector('.map-globe-trigger').getBoundingClientRect().x - start) < 2, beforeDrag.x)
  await choose('2D')
  for (const [key, direction, limit] of [['Shift+Equal', 1, '50'], ['Shift+Minus', -1, '5000']]) {
    for (let i = 0; i < 5 && await map.locator('.atlas-scale').getAttribute('data-meters') !== limit; i++) {
      const previousZoom = await zoom()
      await canvas.press(key)
      await zoomChanged(page, previousZoom, direction)
    }
    assert.equal(await map.locator('.atlas-scale').getAttribute('data-meters'), limit)
    await canvas.press(key)
    await mapLayout(page)
    const endpoint = await zoom()
    await canvas.press(key)
    await mapLayout(page)
    assert.equal(await zoom(), endpoint)
  }
  await choose('复位视角')
  assert.deepEqual(await mapLayout(page), initialLayout)
}

async function verifyRegionMenuLayout(page) {
  const trigger = page.locator('.region-picker > summary')
  const menu = page.getByRole('navigation', { name: '区域目录' })
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
  page.on('pageerror', error => errors.push(errorMessage(error)))
  const retiredMapHosts = []
  await page.route(/^https:\/\/(?:tiles\.openfreemap\.org|elevation-tiles-prod\.s3\.amazonaws\.com)\//, route => {
    retiredMapHosts.push(new URL(route.request().url()).hostname)
    return route.abort('failed')
  })
  await page.goto(baseUrl)
  const title = page.getByRole('heading', { name: '门头沟区数字驾驶舱' })
  await title.waitFor()
  await waitForArea(page, '门头沟区')
  assert.equal(await page.locator('.cockpit-masthead').getByRole('button').count(), 0)
  assert.equal(await page.getByRole('link', { name: '数据管理', exact: true }).count(), 0)
  const clock = page.locator('.cockpit-masthead time[datetime]')
  await clock.waitFor()
  const initialClock = await clock.getAttribute('datetime')
  assert(Math.abs(Date.parse(initialClock) - Date.now()) < 5_000, 'The masthead shows current time')
  await page.waitForFunction(previous => document.querySelector('.masthead-time')?.dateTime !== previous, initialClock)
  assert.equal(await page.locator('.area-bar, .model-imagery-source, .atlas-credit').count(), 0)
  await assertNoHorizontalOverflow(page)
  await page.setViewportSize({ width: 1106, height: 893 })
  assert.equal(await page.locator('.map-panel').evaluate(el => parseFloat(getComputedStyle(el).borderTopWidth)), 0)
  assert.equal(await page.locator('.metric-rail').first().evaluate(el => getComputedStyle(el).borderWidth), '0px')
  assert(await title.evaluate(el => Math.abs(el.getBoundingClientRect().left + el.clientWidth / 2 - innerWidth / 2) < 2))
  await verifyDistrictMap(page)
  await verifyRegionMenuLayout(page)
  await capture(page, 'cockpit-1106.png')
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

  const districtCanvas = await page.locator('.tianditu-map canvas.maplibregl-canvas').elementHandle()
  await page.locator('.atlas-place[data-place="datai"]').click()
  await page.waitForURL('**/areas/datai')
  await waitForArea(page, '大台街道')
  await page.getByRole('link', { name: '返回门头沟区全域' }).click()
  await waitForArea(page, '门头沟区')
  await page.locator('.region-picker > summary').click()
  const directory = page.getByRole('navigation', { name: '区域目录' })
  const town = directory.getByRole('link', { name: '大峪街道', exact: true })
  await town.focus()
  await town.press('Enter')
  await page.waitForURL('**/areas/dayu')
  await waitForArea(page, '大峪街道')
  assert.equal(await page.locator('.tianditu-map canvas.maplibregl-canvas').evaluate((canvas, before) => canvas === before, districtCanvas), true,
    'Town drill-down should reuse the active map canvas')
  await capture(page, 'cockpit-town.png')

  await page.locator('.region-picker > summary').click()
  const villageLink = directory.getByRole('link', { name: '剧场东街社区', exact: true })
  const villageName = await villageLink.textContent()
  await villageLink.click()
  await waitForArea(page, villageName)
  const villageUrl = page.url()
  const opening = page.context().waitForEvent('page')
  await page.getByRole('link', { name: '区域数据' }).click()
  const workbench = await opening
  workbench.on('pageerror', error => errors.push(errorMessage(error)))
  await workbench.getByRole('dialog', { name: villageName + '问题诊断' }).waitFor()
  await workbench.keyboard.press('Escape')
  await verifyAs(workbench, /常规身份/)
  assert.equal(page.url(), villageUrl)
  assert.equal(await workbench.evaluate(() => window.opener), null)
  await workbench.getByRole('button', { name: '区级运行管理者' }).waitFor()
  await page.getByRole('link', { name: '返回上一级 大峪街道' }).click()
  await waitForArea(page, '大峪街道')
  await page.locator('.region-picker > summary').click()
  await directory.getByRole('link', { name: '爨底下村', exact: true }).click()
  const villageMap = await waitForArea(page, '爨底下村')
  const villageCanvas = villageMap.locator('canvas')
  await villageCanvas.focus()
  for (let i = 0; i < 5 && await villageMap.locator('.atlas-scale').getAttribute('data-meters') !== '5000'; i++) {
    const before = Number(await villageMap.getAttribute('data-zoom'))
    await villageCanvas.press('Shift+Minus')
    await zoomChanged(page, before, -1)
  }
  await villageMap.getByRole('button', { name: '查看东斋堂村', exact: true }).click()
  await page.waitForURL('**/areas/zhaitang-dongzhaitang')
  await waitForArea(page, '东斋堂村')
  await page.locator('.region-picker > summary').click()
  await directory.getByRole('link', { name: '木城涧社区', exact: true }).click()
  await waitForArea(page, '木城涧社区')
  await page.locator('.region-picker > summary').click()
  await directory.getByRole('link', { name: '大峪街道', exact: true }).click()
  await waitForArea(page, '大峪街道')

  assert.equal(await page.locator('main #voice-assistant').count(), 0)
  await workbench.goto(new URL('/workbench?area=dayu', baseUrl).toString())
  const assistant = workbench.getByRole('dialog', { name: 'AI 问数' })
  const ask = async (question) => {
    await workbench.getByRole('button', { name: 'AI 问数', exact: true }).click()
    await assistant.getByRole('textbox', { name: '输入问题或指令' }).fill(question)
    await assistant.getByRole('button', { name: '发送', exact: true }).click()
  }

  await workbench.getByRole('button', { name: '查看问题', exact: true }).click()
  const manualIssues = workbench.getByRole('dialog', { name: '大峪街道问题诊断' })
  await manualIssues.getByRole('region', { name: '指标与依据' }).waitFor()
  await capture(workbench, 'issues-manual.png')
  await workbench.keyboard.press('Escape')
  await manualIssues.waitFor({ state: 'hidden' })

  await ask('我想要看大台街道的数据')
  await workbench.waitForURL('**/data/areas/datai')
  await workbench.getByRole('heading', { name: '大台街道', exact: true }).waitFor()
  await assistant.waitFor({ state: 'hidden' })
  await ask('大台有哪些问题')
  const dataiIssues = workbench.getByRole('dialog', { name: '大台街道问题诊断' })
  await dataiIssues.getByRole('region', { name: '运行事项' }).waitFor()
  await dataiIssues.getByRole('region', { name: '指标与依据' }).waitFor()
  await capture(workbench, 'issues-datai.png')
  await dataiIssues.getByRole('button', { name: '关闭', exact: true }).last().click()
  await dataiIssues.waitFor({ state: 'hidden' })

  await workbench.getByRole('link', { name: '门头沟区', exact: true }).click()
  await ask('大台街道的办结率是多少？')
  await workbench.waitForURL('**/data/areas/datai')
  await assistant.getByRole('log', { name: '问数记录' }).getByText(/大台街道当前快照的.*办结率/).waitFor()
  await capture(workbench, 'assistant-cross-area.png')
  await assistant.getByRole('link', { name: '返回门头沟区', exact: true }).click()
  await workbench.getByRole('heading', { name: '门头沟区', exact: true }).waitFor()
  await assistant.waitFor({ state: 'hidden' })
  console.log('PASS anonymous access, manual drill-down and inspection, command navigation, issue dialog and cross-area question')

  await page.bringToFront()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('link', { name: '返回门头沟区全域' }).click()
  await waitForArea(page, '门头沟区')
  await assertNoHorizontalOverflow(page)
  await verifyDistrictMap(page)
  await verifyRegionMenuLayout(page)
  assert.deepEqual(retiredMapHosts, [], 'Retired map providers should never be requested')
  console.log('PASS district map, metric rails, geographic drag, wheel and keyboard zoom, globe tools and stable layout at 1106px and 390px')
  await capture(page, 'cockpit-mobile.png')
  await workbench.bringToFront()
  await workbench.setViewportSize({ width: 390, height: 844 })
  await verifyAs(workbench, /政务服务专项/)
  await workbench.waitForURL('**/play/public-services')
  await workbench.getByRole('heading', { name: '政务服务', level: 1, exact: true }).waitFor()
  await workbench.locator('.data-chart canvas').first().waitFor()
  await assertNoHorizontalOverflow(workbench)
  await capture(workbench, 'cockpit-special-mobile.png')

  const denied = workbench.waitForResponse(response => response.url().endsWith('/api/v1/playback/city-operations/manifest'))
  await workbench.goto(new URL('/play/city-operations', baseUrl).toString())
  assert([403, 404].includes((await denied).status()))
  await workbench.getByRole('heading', { name: '无法打开专题' }).waitFor()
  assert.equal(await workbench.locator('.screen-component').count(), 0)
  await workbench.goto(new URL('/workbench', baseUrl).toString())
  await workbench.locator('.identity-button').click()
  await workbench.getByRole('button', { name: '退出核验' }).click()
  await workbench.getByRole('button', { name: '身份核验' }).waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS mobile dashboard, specialist routing, private project isolation, logout and no runtime errors')
} finally {
  await browser.close()
}
