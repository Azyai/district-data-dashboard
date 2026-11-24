import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'
const output = process.env.E2E_ARTIFACTS
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-shader-disk-cache'],
})

async function capture(page, name) {
  if (!output) return
  await mkdir(output, { recursive: true })
  await page.screenshot({ path: join(output, name + '.png'), animations: 'disabled' })
}

async function verifySingleScreen(page, screen) {
  const frame = page.frameLocator('main iframe')
  const section = frame.locator('.ref-' + screen)
  await section.waitFor()
  const fits = await section.evaluate(element => {
    const frameDocument = element.ownerDocument
    const view = frameDocument.defaultView
    const top = view.parent
    const bounds = element.getBoundingClientRect()
    return frameDocument.documentElement.scrollHeight <= view.innerHeight + 1
      && frameDocument.documentElement.scrollWidth <= view.innerWidth + 1
      && bounds.bottom <= view.innerHeight + 1 && bounds.right <= view.innerWidth + 1
      && top.document.documentElement.scrollHeight <= top.innerHeight + 1
      && top.document.documentElement.scrollWidth <= top.innerWidth + 1
  })
  assert.equal(fits, true, screen + ' and its reference canvas fit one viewport')
  return frame
}

try {
  const page = await browser.newPage({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(15_000)
  const failures = []
  page.on('pageerror', error => failures.push(error.message.replace(/(\btk=)[^&\s"']+/gi, '$1[redacted]')))
  const region = page.getByRole('combobox', { name: '选择区域', exact: true })
  const topic = page.getByRole('combobox', { name: '选择数据展示' })
  const waitPath = path => page.waitForURL(new URL(path, baseURL).toString())
  const title = expected => page.waitForFunction(value => document.title === value, expected)
  const openTopic = async (name, path) => {
    const options = () => topic.locator('option[value="' + name + '"]')
    if (!await options().count()) {
      await page.locator('.display-switch').click()
      await options().waitFor({ state: 'attached' })
    }
    if (await topic.inputValue() !== name) await topic.selectOption(name)
    await waitPath(path)
  }

  await page.goto('/areas/datai')
  await page.getByRole('heading', { name: '门头沟大台街道全域数字中心', exact: true }).waitFor()
  await openTopic('governance', '/screens/governance?area=datai')
  const gov = await verifySingleScreen(page, 'governance')
  assert.equal(await region.inputValue(), 'datai')
  await gov.getByLabel('受理月份').selectOption('2026-09')
  await waitPath('/screens/governance?area=datai&month=2026-09')
  await gov.locator('.hotline-snapshot[data-visible-month="2026-09"]:not([inert])').waitFor()
  await gov.locator('.hotline-analysis', { hasText: '办理分析' }).first().click()
  const analysis = gov.getByRole('dialog', { name: '接诉即办分析' })
  await analysis.getByText(/大台街道 · 2026-09/).waitFor()
  await analysis.locator('.insight-section').first().waitFor()
  await capture(page, 'hotline-scope-analysis')
  await analysis.getByRole('button', { name: '关闭分析' }).click()

  await openTopic('population', '/screens/population?area=datai')
  const pop = await verifySingleScreen(page, 'population')
  await title('门头沟大台街道全域数字中心 - 城镇人口')
  await pop.locator('.population-detail').getByRole('heading', { name: '大台街道' }).waitFor()
  await region.selectOption('zhaitang')
  await waitPath('/screens/population?area=zhaitang')
  await openTopic('economy', '/screens/economy?area=zhaitang')
  const economy = await verifySingleScreen(page, 'economy')
  await economy.locator('[data-eco-topic="projects"]').click()
  await economy.getByRole('button', { name: /生态文旅配套提升/ }).first().waitFor()
  await page.reload()
  await verifySingleScreen(page, 'economy')
  assert.equal(await region.inputValue(), 'zhaitang')
  await page.goBack()
  await waitPath('/screens/population?area=zhaitang')
  await openTopic('overview', '/areas/zhaitang')
  await page.locator('main[data-page=roads]').waitFor()
  await region.selectOption('mentougou')
  await waitPath('/')
  await title('门头沟全域数字中心 - 路网监测')

  for (const [width, height] of [[1106, 893], [390, 844]]) {
    await page.setViewportSize({ width, height })
    for (const screen of ['governance', 'population', 'economy']) {
      await page.goto('/screens/' + screen)
      await verifySingleScreen(page, screen)
      await capture(page, screen + '-' + width)
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?topic=population')
  await waitPath('/screens/population')
  assert.equal(await region.inputValue(), 'mentougou')
  await page.goto('/topics/hotline?area=dayu&month=2026-09')
  await waitPath('/screens/governance?area=dayu&month=2026-09')
  await verifySingleScreen(page, 'governance')
  for (const path of ['/workbench?area=dayu#area-issues', '/data/areas/dayu', '/areas/dayu#area-issues']) {
    await page.goto(path)
    await waitPath('/screens/diagnosis?area=dayu')
    await page.getByRole('heading', { name: '区域问题诊断' }).waitFor()
    assert.equal(await region.inputValue(), 'dayu')
    assert.equal(await page.getByRole('dialog').count(), 0)
  }

  await page.goto('/workbench')
  const settings = page.getByRole('navigation', { name: '工作台入口' })
  await settings.getByRole('link', { name: /数据管理/ }).waitFor()
  await settings.getByRole('link', { name: /区域诊断/ }).click()
  await waitPath('/screens/diagnosis')
  await page.goto('/topics/water')
  await waitPath('/screens/waters')
  await title('门头沟全域数字中心 - 水域态势')
  const water = page.getByRole('complementary', { name: '水务运行' })
  await water.getByRole('heading', { name: '当日入库流量' }).waitFor()
  await region.selectOption('zhaitang')
  await waitPath('/screens/waters?area=zhaitang')
  await water.getByRole('heading', { name: '当日入库流量' }).waitFor()
  await page.locator('.monitor-map-layout:not([inert])').waitFor()
  await capture(page, 'water-scoped')
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), true)
  await openTopic('population', '/screens/population?area=zhaitang')
  assert.equal(await region.inputValue(), 'zhaitang')
  assert.deepEqual(failures, [])
  console.log('PASS manual scoped navigation, independent panels, database analysis, one-screen layouts and legacy diagnosis/water links')
} finally {
  await browser.close()
}
