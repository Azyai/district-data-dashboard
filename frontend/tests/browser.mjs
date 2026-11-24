import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'
const evidence = process.env.E2E_ARTIFACTS
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-shader-disk-cache'],
})
const page = await browser.newPage({ baseURL, viewport: { width: 1106, height: 893 }, reducedMotion: 'reduce' })
page.setDefaultTimeout(20_000)
const errors = []
page.on('pageerror', error => errors.push(error.message.replace(/(\btk=)[^&\s"']+/gi, '$1[redacted]')))
const map = page.locator('.tianditu-map')
const subject = page.getByLabel('选择数据展示')
const region = page.getByLabel('选择区域')
const header = page.locator('.center-masthead')
const route = path => page.waitForURL(new URL(path, baseURL).href)
const ready = id => map.and(page.locator('[data-map-ready="ready"][data-map-scope="' + id + '"]')).waitFor()
const cleanCI = process.env.CI === 'true' || process.env.CI === '1'
const diskAsset = name => existsSync(new URL('../public/maps/' + name, import.meta.url))

async function capture(name) {
  if (!evidence) return
  await mkdir(evidence, { recursive: true })
  await page.screenshot({ path: join(evidence, name + '.png'), animations: 'disabled' })
}

async function singleViewport() {
  await page.waitForFunction(() => {
    const doc = document.documentElement
    const stage = document.querySelector('.monitoring-stage')
    return doc.scrollHeight <= innerHeight + 1 && doc.scrollWidth <= innerWidth + 1
      && (!stage || stage.getBoundingClientRect().bottom <= innerHeight + 1)
  })
}

async function currentSubject(name, scope = '') {
  await header.getByRole('heading', { name: '门头沟' + scope + '全域数字中心', exact: true }).waitFor()
  await header.locator('.center-heading p').getByText(name, { exact: true }).waitFor()
}

async function freePoint() {
  return map.evaluate(node => {
    const box = node.getBoundingClientRect()
    for (const y of [.46, .58, .71, .34]) for (const x of [.5, .56, .43, .65, .37]) {
      const point = { x: box.left + box.width * x, y: box.top + box.height * y }
      if (document.elementFromPoint(point.x, point.y)?.matches('canvas.maplibregl-canvas')) return point
    }
    throw new Error('No exposed map surface')
  })
}

async function globeAction(target, name) {
  await target.getByRole('button', { name: '地图工具', exact: true }).click()
  const panel = target.getByRole('group', { name: '地图视角' })
  await panel.getByRole('button', { name, exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
}

async function verifyCamera() {
  await ready('mentougou')
  const towns = await region.locator('optgroup').count()
  assert.equal(towns, 13)
  assert.equal(await map.locator('.atlas-place').count(), towns)
  const canvas = map.locator('.maplibregl-canvas')
  const pointer = await freePoint()
  const marker = map.locator('[data-place="datai"]')
  const before = await marker.boundingBox()
  await page.mouse.move(pointer.x, pointer.y)
  await page.mouse.down()
  await page.mouse.move(pointer.x + 72, pointer.y - 28, { steps: 7 })
  await page.mouse.up()
  await page.waitForFunction(start => {
    const pin = document.querySelector('[data-place="datai"]').getBoundingClientRect()
    return Math.hypot(pin.x - start.x, pin.y - start.y) > 10
  }, before)
  await globeAction(map, '复位视角')
  await page.waitForFunction(start => {
    const pin = document.querySelector('[data-place="datai"]').getBoundingClientRect()
    return Math.hypot(pin.x - start.x, pin.y - start.y) < 3
  }, before)
  const zoom = () => map.evaluate(el => Number(el.dataset.zoom))
  const wheel = async (dy, direction) => {
    const initial = await zoom()
    const anchor = await freePoint()
    await page.mouse.move(anchor.x, anchor.y)
    await page.mouse.wheel(0, dy)
    await page.waitForFunction(({ initial, direction }) =>
      (Number(document.querySelector('.tianditu-map').dataset.zoom) - initial) * direction > .04, { initial, direction })
  }
  await wheel(-240, 1)
  await wheel(240, -1)
  for (const [key, limit] of [['Shift+Equal', '50'], ['Shift+Minus', '5000']]) {
    const scale = map.locator('.atlas-scale')
    for (let i = 0; i < 8 && await scale.getAttribute('data-meters') !== limit; i++) {
      const initial = await zoom()
      await canvas.press(key)
      await page.waitForFunction(start => Number(document.querySelector('.tianditu-map').dataset.zoom) !== start, initial)
    }
    assert.equal(await scale.getAttribute('data-meters'), limit)
  }
  await globeAction(map, '复位视角')
  await globeAction(map, '3D')
  await map.and(page.locator('[data-view="3d"]')).waitFor()
  const camera = await map.evaluate(el => ({ bearing: Number(el.dataset.bearing), pitch: Number(el.dataset.pitch) }))
  const anchor = await freePoint()
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.down()
  await page.mouse.move(anchor.x + 58, anchor.y - 28, { steps: 7 })
  await page.mouse.up()
  await page.waitForFunction(start => {
    const pose = document.querySelector('.tianditu-map').dataset
    return Math.abs(Number(pose.bearing) - start.bearing) > 1 && Math.abs(Number(pose.pitch) - start.pitch) > 1
  }, camera)
  await globeAction(map, '2D')
  await map.and(page.locator('[data-view="2d"]')).waitFor()
  console.log('PASS geographic pan, wheel zoom, 50 m–5 km endpoints, 3D orbit and 2D reset')
}

async function verifyDeselection() {
  const original = await map.locator('.maplibregl-canvas').elementHandle()
  await region.selectOption('junzhuang')
  await ready('junzhuang')
  await currentSubject('路网监测', '军庄镇')
  await globeAction(map, '3D')
  await map.getByRole('button', { name: '查看灰峪村', exact: true }).click()
  await ready('junzhuang-huiyu')
  await route('/areas/junzhuang-huiyu')
  const selected = map.getByRole('button', { name: '查看灰峪村', exact: true })
  assert.equal(await selected.getAttribute('aria-current'), 'location')
  await selected.dblclick()
  await ready('junzhuang')
  await route('/areas/junzhuang')
  await map.getByRole('button', { name: '查看军庄村', exact: true }).click()
  await ready('junzhuang-junzhuang')
  const point = await freePoint()
  await page.mouse.dblclick(point.x, point.y)
  await ready('junzhuang')
  await route('/areas/junzhuang')
  const townPoint = await freePoint()
  await page.mouse.dblclick(townPoint.x, townPoint.y)
  await ready('mentougou')
  await route('/')
  assert.equal(await map.getAttribute('data-view'), '3d')
  assert.equal(await map.locator('.maplibregl-canvas').evaluate((el, previous) => el === previous, original), true)
  await globeAction(map, '2D')
  console.log('PASS town and village drill-down, double-click deselection and retained WebGL canvas')
}

async function verifyLandmarks() {
  for (const [id, title] of [['tianjie', '龙湖北京长安天街'], ['jingxi', '京西智谷']]) {
    const selector = id === 'tianjie' ? subject : page.getByLabel('选择地标')
    await selector.selectOption(id)
    await route('/twins/' + id)
    await currentSubject(title)
    const model = page.locator('.district-local-model')
    const present = ['', '-hd', '-detail'].some(suffix => diskAsset('local-model/' + id + suffix + '.glb'))
    if (cleanCI && !present) {
      await model.getByRole('status').getByText(title + '模型暂不可用', { exact: true }).waitFor()
      console.log('CI missing ' + id + ' GLB: verified unavailable state, skipped model camera interactions')
    } else {
      await model.and(page.locator('[data-model-ready="ready"]')).waitFor({ timeout: 60_000 })
      await model.getByRole('img', { name: title + '本地模型画布' }).waitFor()
      for (const view of ['2D', '3D']) {
        await globeAction(model, view)
        await model.and(page.locator('[data-view="' + view.toLowerCase() + '"]')).waitFor()
      }
      console.log('PASS ' + title + ' real building model and camera modes')
    }
    await singleViewport()
  }
  await page.getByRole('link', { name: '返回地图' }).click()
  await route('/areas/datai')
}

async function verifyIdentity() {
  await page.goto('/workbench')
  const dialog = page.getByRole('dialog', { name: '身份核验' })
  async function signIn(name) {
    await page.locator('.identity-button').click()
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/auth/demo-session')
    await dialog.getByRole('button', { name }).click()
    assert.equal((await response).status(), 200)
    await dialog.waitFor({ state: 'hidden' })
  }
  await signIn(/常规身份/)
  await page.getByRole('button', { name: '区级运行管理者' }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/workbench')
  await signIn(/政务服务专项/)
  await route('/play/public-services')
  await currentSubject('政务服务')
  await page.locator('.data-chart canvas').first().waitFor()
  const denied = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/playback/city-operations/manifest')
  await page.goto('/play/city-operations')
  assert.ok([403, 404].includes((await denied).status()))
  await page.getByRole('heading', { name: '无法打开专题' }).waitFor()
  assert.equal(await page.locator('.screen-component').count(), 0)
  await page.goto('/workbench')
  await page.locator('.identity-button').click()
  await dialog.getByRole('button', { name: '退出核验' }).click()
  await page.getByRole('button', { name: '身份核验', exact: true }).waitFor()
  await page.goto('/play/public-services')
  await route('/')
  console.log('PASS default and specialist identities, authorized landing, private project denial and logout')
}

try {
  const retired = []
  await page.route(/^https:\/\/(?:tiles\.openfreemap\.org|elevation-tiles-prod\.s3\.amazonaws\.com)\//, route => {
    retired.push(new URL(route.request().url()).hostname)
    return route.abort()
  })
  await page.goto('/')
  await currentSubject('路网监测')
  assert.equal(await subject.inputValue(), 'overview')
  assert.equal(await header.getByRole('button').count(), 0)
  assert.equal(await page.getByRole('link', { name: '数据管理', exact: true }).count(), 0)
  const stamp = await header.locator('time').getAttribute('datetime')
  assert.ok(Math.abs(Date.parse(stamp) - Date.now()) < 5000)
  await page.waitForFunction(before => document.querySelector('.center-clock').dateTime !== before, stamp)
  assert.ok(await header.locator('h1').evaluate(el => {
    const rect = el.getBoundingClientRect()
    return Math.abs(rect.x + rect.width / 2 - innerWidth / 2) < 2
  }))
  await page.getByLabel('当前区域指标').getByText('拥堵指数', { exact: true }).waitFor()
  await page.getByRole('complementary', { name: '道路监测目录' }).waitFor()
  await page.getByRole('complementary', { name: '路网运行分析' }).waitFor()

  const originalDocument = await page.evaluateHandle(() => document)
  if (cleanCI && !diskAsset('district-atlas.geojson')) {
    await map.getByRole('status').getByText('区界数据暂不可用', { exact: true }).waitFor()
    assert.equal(await map.getAttribute('data-map-ready'), 'unavailable')
    console.log('CI missing district-atlas.geojson: verified boundary error; skipped camera, geographic marker and deselection interactions')
  } else {
    await verifyCamera()
    await verifyDeselection()
  }

  for (const [width, height] of [[1106, 893], [1366, 768], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await singleViewport()
    await capture('cockpit-' + width)
    if (width === 390) {
      await page.getByRole('button', { name: '监测概况' }).click()
      await page.getByRole('complementary', { name: '道路监测目录' }).waitFor()
      await singleViewport()
      await page.getByRole('button', { name: '监测概况' }).click()
    }
  }
  await page.setViewportSize({ width: 1106, height: 893 })
  await region.selectOption('datai')
  await route('/areas/datai')
  await currentSubject('路网监测', '大台街道')
  for (const [id, title] of [['grid', '网格治理'], ['waters', '水域态势'], ['population', '城镇人口'], ['governance', '基层治理'], ['economy', '经济发展'], ['diagnosis', '区域诊断']]) {
    await subject.selectOption(id)
    await route('/screens/' + id + '?area=datai')
    await currentSubject(title, '大台街道')
    assert.equal(await region.inputValue(), 'datai')
    assert.equal(await subject.inputValue(), id)
    assert.equal(await page.evaluate(previous => previous === document, originalDocument), true)
    if (id === 'grid' || id === 'waters') await page.locator('.monitoring-stage[data-page="' + id + '"] .monitor-kpis').waitFor()
    else if (id === 'diagnosis') await page.getByRole('heading', { name: '区域问题诊断' }).waitFor()
    else await page.frameLocator('main iframe').locator('.ref-' + id).waitFor()
    await singleViewport()
  }
  await subject.selectOption('overview')
  await route('/areas/datai')
  await verifyLandmarks()
  await verifyIdentity()
  assert.deepEqual(retired, [])
  assert.deepEqual(errors, [])
  console.log('PASS scoped SPA display routes, centered live masthead, desktop/mobile viewport and public data')
} finally {
  await browser.close()
}
