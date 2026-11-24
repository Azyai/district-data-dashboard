import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ['--disable-gpu-shader-disk-cache'],
})
const page = await browser.newPage({
  baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5173',
  viewport: { width: 1106, height: 893 },
})
page.setDefaultTimeout(12_000)
const failures = []
page.on('pageerror', error => failures.push(error.message))

// Hold the real response so even a very fast local service exercises the pending state.
function holdRequest(pattern) {
  let release
  const released = new Promise(resolve => { release = resolve })
  const installed = page.route(pattern, async route => {
    await released
    await route.continue()
  }, { times: 1 })
  return { installed, release }
}

try {
  await page.goto('/screens/population')
  const frame = page.frameLocator('main iframe')
  await frame.locator('.ref-population').waitFor()
  await frame.locator('[data-town-rank="older"]').click()
  const sky = frame.locator('canvas.population-sky')
  const originalSky = await sky.elementHandle()
  const holdTown = holdRequest('**/api/v1/cockpit/areas/datai')
  await holdTown.installed
  await page.getByLabel('选择区域').selectOption('datai')
  try {
    assert.equal(await page.locator('.scope-surface[inert]').getAttribute('data-visible-area'), 'mentougou')
    assert.match(await page.locator('.scope-feedback').innerText(), /门头沟区/)
  } finally { holdTown.release() }
  await frame.locator('.population-detail h2').filter({ hasText: '大台街道' }).waitFor()
  assert.equal(await sky.evaluate((current, previous) => current === previous, originalSky), true)
  assert.equal(await frame.locator('[data-town-rank="older"]').getAttribute('aria-pressed'), 'true')
  await page.goBack()
  await page.locator('.scope-surface[data-visible-area=mentougou]:not([inert])').waitFor()
  assert.equal(await sky.evaluate((current, previous) => current === previous, originalSky), true)

  await page.getByLabel('选择数据展示').selectOption('economy')
  await frame.locator('[data-eco-topic="services"]').click()
  await page.getByLabel('选择区域').selectOption('datai')
  await frame.locator('.economy-orb small').filter({ hasText: '大台街道' }).waitFor()
  assert.equal(await frame.locator('[data-eco-topic="services"]').getAttribute('aria-pressed'), 'true')

  await page.getByLabel('选择数据展示').selectOption('governance')
  await frame.locator('#lane-late').click()
  await frame.getByLabel('诉求分类').selectOption('property')
  const board = frame.locator('.governance-stage')
  const originalBoard = await board.elementHandle()
  const holdMonth = holdRequest(url => url.pathname === '/api/v1/hotline/overview' && url.searchParams.get('month') === '2026-01')
  await holdMonth.installed
  await frame.getByLabel('受理月份').selectOption('2026-01')
  try {
    assert.equal(await frame.locator('.hotline-snapshot[inert]').getAttribute('data-visible-month'), '2026-10')
    assert.match(await frame.locator('.hotline-loading').innerText(), /大台街道 · 2026-10/)
  } finally { holdMonth.release() }
  await frame.locator('.hotline-snapshot[data-visible-month="2026-01"]:not([inert])').waitFor()
  assert.equal(await board.evaluate((current, previous) => current === previous, originalBoard), true)
  assert.equal(await frame.locator('#lane-late').getAttribute('aria-pressed'), 'true')
  assert.equal(await frame.getByLabel('诉求分类').inputValue(), 'property')
  await page.getByLabel('选择区域').selectOption('zhaitang')
  await frame.locator('.hotline-snapshot[data-visible-area="zhaitang"]:not([inert])').waitFor()
  assert.equal(await board.evaluate((current, previous) => current === previous, originalBoard), true)
  assert.equal(await frame.getByLabel('受理月份').inputValue(), '2026-01')

  await page.getByLabel('选择数据展示').selectOption('diagnosis')
  await page.getByRole('heading', { name: '区域问题诊断' }).waitFor()
  // A newly published metric may open a later group by default.
  const previousMetrics = page.getByRole('button', { name: '上一组指标' })
  while (await previousMetrics.count() && await previousMetrics.isEnabled()) {
    const before = await page.locator('.diagnosis-pager small').textContent()
    await previousMetrics.click()
    await page.waitForFunction(previous => document.querySelector('.diagnosis-pager small')?.textContent !== previous, before)
  }
  await page.locator('.diagnosis-metric-node').filter({ hasText: '道路通行量' }).click()
  await page.locator('.diagnosis-reading h3').filter({ hasText: '道路通行量' }).waitFor()
  await page.getByLabel('查看事项').selectOption('demo-refresh')
  await page.locator('.diagnosis-signal-body h4').filter({ hasText: '已同步' }).waitFor()
  await page.reload()
  await page.locator('.diagnosis-reading h3').filter({ hasText: '道路通行量' }).waitFor()
  await page.locator('.diagnosis-signal-body h4').filter({ hasText: '已同步' }).waitFor()

  for (const viewport of [{ width: 1106, height: 893 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    const fits = await page.locator('.diagnosis-screen').evaluate(el => {
      const evidence = el.querySelector('.diagnosis-evidence').getBoundingClientRect()
      return evidence.bottom <= innerHeight + 1 && evidence.right <= innerWidth + 1 &&
        document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1
    })
    assert.equal(fits, true, 'diagnosis in one viewport at ' + viewport.width)
  }
  assert.deepEqual(failures, [])
  console.log('Scoped display transitions, stable canvases and diagnostic evidence verified')
} finally {
  await browser.close()
}
