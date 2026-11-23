import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { pageLayout } from './layout-check.mjs'

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'
const browserPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
const evidence = process.env.E2E_ARTIFACTS
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

async function waitForArea(page, name) {
  const area = page.getByRole('navigation', { name: '区域层级' })
  await area.locator('[aria-current="page"]').filter({ hasText: name }).waitFor()
  await page.getByRole('heading', { name: '空间态势' }).waitFor()
  await page.locator('.district-terrain .terrain-surface canvas').waitFor()
}

async function verifyRegionMenuLayout(page) {
  const trigger = page.locator('.region-picker > summary')
  const menu = page.getByRole('navigation', { name: '下辖区域' })
  const anchors = ['.map-panel', '.cockpit-brief', '.cockpit-deck']
  await trigger.scrollIntoViewIfNeeded()
  const original = await pageLayout(page, anchors)
  await trigger.click()
  await menu.waitFor()
  assert.deepEqual(await pageLayout(page, anchors), original, 'The area menu should overlay the map')
  await trigger.press('Escape')
  await menu.waitFor({ state: 'hidden' })
  assert.deepEqual(await pageLayout(page, anchors), original)
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
  await page.goto(baseUrl)
  await page.getByRole('heading', { name: '门头沟区数字驾驶舱' }).waitFor()
  await waitForArea(page, '门头沟区')
  await page.getByRole('button', { name: '身份核验' }).waitFor()
  await assertNoHorizontalOverflow(page)
  await page.setViewportSize({ width: 1072, height: 893 })
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
  await verifyRegionMenuLayout(page)
  console.log('PASS area selector preserves the cockpit layout at 1072px and 390px')
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
