import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { pageLayout } from './layout-check.mjs'

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'
const output = process.env.E2E_ARTIFACTS
const stamp = Date.now().toString(36)
const metricId = 'browser-metric-' + stamp
const metricName = '同步验收事件 ' + stamp
const allConnectors = process.env.E2E_VERIFY_ALL_CONNECTORS === '1'
const workspaceHeaders = { 'X-Dashboard-Workspace': 'management' }
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

async function capture(page, filename) {
  if (!output) return
  await mkdir(output, { recursive: true })
  await page.screenshot({ path: join(output, filename), fullPage: true })
}

async function addSource(page, kind, name, id) {
  await page.getByRole('button', { name: '新增来源' }).click()
  const form = page.getByRole('dialog', { name: '新增来源' })
  await form.getByLabel('来源名称').fill(name)
  await form.getByLabel(/来源编码/).fill(id)
  await form.getByLabel('接入方式').selectOption(kind)
  if (kind === 'CSV') {
    await form.getByLabel(/CSV 文件/).setInputFiles({
      name: 'browser-fixture.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('region,date,measure,value,denominator\nmentougou,2026-11-22,events,16,20\nmentougou,2026-11-23,events,73,80\n'),
    })
    await form.getByRole('button', { name: '上传文件' }).click()
    await form.getByText(/已关联 browser-fixture.csv/).waitFor()
    await form.getByLabel(/分母字段/).fill('denominator')
  } else if (kind === 'HTTPS_JSON') {
    const connector = form.getByLabel('已批准接口')
    const endpoint = await connector.locator('option[value$="/data.json"]').getAttribute('value')
    assert(endpoint, 'Expected the approved TLS validation fixture endpoint')
    await connector.selectOption(endpoint)
  } else {
    await form.getByLabel('只读连接').selectOption('fixture')
    await form.getByLabel('批准视图').selectOption('observations')
  }
  await form.getByRole('button', { name: '保存来源' }).click()
  await form.waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name, exact: true }).waitFor()
}

async function connectAndRun(page) {
  await page.getByRole('button', { name: '测试并预览' }).click()
  await page.getByText('连接通过', { exact: true }).waitFor()
  await page.getByRole('region', { name: '标准化样本预览' }).waitFor()
  await page.getByRole('button', { name: '启动同步' }).click()
  const history = page.getByRole('region', { name: '同步历史记录' })
  await history.getByText('成功', { exact: true }).first().waitFor()
  await page.getByRole('heading', { name: '当前数据集' }).waitFor()
}

async function publish(page, name, version) {
  await page.getByRole('button', { name: '发布指标 ' + name, exact: true }).click()
  await page.getByRole('dialog', { name: '发布指标' }).getByRole('button', { name: '确认发布' }).click()
  await page.getByText(name + ' 已发布 v' + version, { exact: true }).waitFor()
}

async function openSeparateTab(page, link) {
  const opened = page.context().waitForEvent('page')
  await link.click()
  const newPage = await opened
  await newPage.waitForLoadState()
  assert.equal(await newPage.evaluate(() => window.opener === null), true)
  return newPage
}

async function identity(page, headers) {
  const response = await page.request.get('/api/v1/me', { headers })
  assert.equal(response.status(), 200)
  return (await response.json()).data
}

try {
  const display = await browser.newPage({ baseURL: baseUrl, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const errors = []
  display.on('pageerror', error => errors.push(error.message))
  await display.goto('/')
  await display.getByRole('button', { name: '身份核验' }).click()
  await display.getByRole('button', { name: /政务服务专项/ }).click()
  await display.getByRole('heading', { name: '政务服务', exact: true }).waitFor()
  await display.getByRole('link', { name: '返回驾驶舱' }).click()
  const originalUrl = new URL('/', baseUrl).toString()
  const page = await openSeparateTab(display, display.getByRole('link', { name: '数据管理', exact: true }))
  page.setDefaultTimeout(15_000)
  page.on('pageerror', error => errors.push(error.message))

  assert.equal(display.url(), originalUrl)
  assert.equal(await display.title(), '门头沟区数字驾驶舱')
  await page.getByRole('heading', { name: '数据管理员核验' }).waitFor()
  assert.equal(await page.title(), '门头沟区数据管理')
  const response = await page.request.get('/api/v1/admin/sources', { headers: workspaceHeaders })
  assert.equal(response.status(), 401)
  await page.getByRole('button', { name: '使用演示数据管理员' }).click()
  await page.getByRole('heading', { name: '数据来源', exact: true }).waitFor()
  assert.equal((await identity(page, workspaceHeaders)).id, 'demo-data-admin')
  assert.equal((await identity(display)).id, 'demo-service')
  assert.equal((await display.request.get('/api/v1/playback/public-services/manifest')).status(), 200)
  assert.equal(await page.locator('.district-local-model').count(), 0)
  console.log('PASS separate admin tab and independent display and management identities')

  if (allConnectors) {
    for (const [kind, label] of [['HTTPS_JSON', 'HTTPS 验收'], ['MYSQL_VIEW', 'MySQL 验收']]) {
      await addSource(page, kind, label + ' ' + stamp, 'browser-' + kind.toLowerCase().replaceAll('_', '-') + '-' + stamp)
      await connectAndRun(page)
      await capture(page, 'admin-source-' + kind.toLowerCase().replaceAll('_', '-') + '.png')
      console.log('PASS ' + kind + ' selected approved configuration, connection preview and sync')
    }
  }
  const sourceId = 'browser-csv-' + stamp
  const initialName = 'CSV 验收 ' + stamp
  const sourceName = initialName + ' 复核'
  await addSource(page, 'CSV', initialName, sourceId)
  await page.getByRole('button', { name: '编辑配置' }).click()
  const editor = page.getByRole('dialog', { name: '编辑来源' })
  await editor.getByLabel('来源名称').fill(sourceName)
  await editor.getByRole('button', { name: '保存来源' }).click()
  await editor.waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: sourceName, exact: true }).waitFor()
  await connectAndRun(page)
  await page.getByRole('region', { name: '标准化样本预览' }).getByText('73', { exact: true }).waitFor()
  await capture(page, 'admin-source-sync.png')
  const sourceDetail = page.getByRole('dialog', { name: '来源详情', exact: true })
  await sourceDetail.getByRole('button', { name: '关闭', exact: true }).click()
  await sourceDetail.waitFor({ state: 'hidden' })
  const listAnchors = ['.admin-list', '.admin-content']
  const sourcesLayout = await pageLayout(page, listAnchors)
  await page.getByRole('button', { name: '查看来源 ' + sourceName, exact: true }).click()
  await sourceDetail.getByRole('heading', { name: sourceName, exact: true }).waitFor()
  assert.deepEqual(await pageLayout(page, listAnchors), sourcesLayout, 'Source detail should overlay the list')
  await sourceDetail.getByRole('button', { name: '关闭', exact: true }).click()
  await sourceDetail.waitFor({ state: 'hidden' })
  assert.deepEqual(await pageLayout(page, listAnchors), sourcesLayout)
  console.log('PASS CSV upload, config revision, preview, sync history and dataset')

  await page.getByRole('link', { name: '指标目录', exact: true }).click()
  await page.getByRole('button', { name: '新增指标' }).click()
  const metric = page.getByRole('dialog', { name: '新增指标' })
  await metric.getByLabel('指标名称').fill(metricName)
  await metric.getByLabel('指标编码').fill(metricId)
  await metric.getByLabel('口径说明').fill('浏览器验收，使用当前行政区最新成功批次的事件度量。')
  await metric.getByLabel(/绑定来源/).selectOption(sourceId)
  await metric.getByLabel('度量', { exact: true }).selectOption('events')
  await metric.getByLabel('单位', { exact: true }).fill('件')
  await metric.getByRole('button', { name: '保存草稿' }).click()
  await metric.waitFor({ state: 'hidden' })

  await publish(page, metricName, 1)
  await page.getByRole('button', { name: '编辑指标 ' + metricName, exact: true }).click()
  const metricEditor = page.getByRole('dialog', { name: '编辑指标口径' })
  await metricEditor.getByLabel('口径说明').fill('浏览器验收，复核修订后发布第二版。')
  await metricEditor.getByRole('button', { name: '保存草稿' }).click()
  await metricEditor.waitFor({ state: 'hidden' })
  await publish(page, metricName, 2)
  const metricsLayout = await pageLayout(page, listAnchors)
  await page.getByRole('button', { name: '查看口径 ' + metricName, exact: true }).click()
  const metricDetail = page.getByRole('dialog', { name: '指标口径', exact: true })
  await metricDetail.getByRole('link', { name: '到驾驶舱核对' }).waitFor()
  assert.deepEqual(await pageLayout(page, listAnchors), metricsLayout, 'Metric detail should overlay the list')
  await capture(page, 'admin-metric-published.png')

  const verifyTab = await openSeparateTab(page, metricDetail.getByRole('link', { name: '到驾驶舱核对' }))
  await metricDetail.waitFor()
  assert.match(page.url(), /\/admin\/metrics/)
  const issues = verifyTab.getByRole('dialog', { name: '门头沟区问题诊断' })
  const evidence = issues.getByRole('region', { name: '指标与依据' })
  const metricRow = evidence.getByRole('listitem').filter({ hasText: metricName })
  await metricRow.getByText(sourceName, { exact: false }).waitFor()
  await metricRow.getByText(/^73\s*件$/).waitFor()
  await capture(verifyTab, 'admin-cockpit-verification.png')
  const cockpitAnchors = ['.map-panel', '.district-local-model']
  const cockpitLayout = await pageLayout(verifyTab, cockpitAnchors)
  await issues.getByRole('button', { name: '关闭', exact: true }).last().click()
  await issues.waitFor({ state: 'hidden' })
  assert.deepEqual(await pageLayout(verifyTab, cockpitAnchors), cockpitLayout)
  await verifyTab.close()
  console.log('PASS metric publication, separate verification tab and stable cockpit evidence')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(new URL('/admin/sources', baseUrl).toString())
  await page.getByRole('heading', { name: '数据来源', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  const sourceAction = page.getByRole('button', { name: '查看来源 ' + sourceName })
  const actionBox = await sourceAction.boundingBox()
  assert(actionBox && actionBox.x >= 0 && actionBox.x + actionBox.width <= 390, 'The source action should be reachable without horizontal scrolling')
  await capture(page, 'admin-mobile.png')
  const mobileLayout = await pageLayout(page, listAnchors)
  await sourceAction.click()
  await sourceDetail.getByRole('heading', { name: sourceName, exact: true }).waitFor()
  assert.deepEqual(await pageLayout(page, listAnchors), mobileLayout)
  await sourceDetail.getByRole('button', { name: '关闭', exact: true }).click()
  await sourceDetail.waitFor({ state: 'hidden' })
  assert.deepEqual(await pageLayout(page, listAnchors), mobileLayout)
  await page.getByRole('button', { name: '退出管理' }).click()
  await page.getByRole('heading', { name: '数据管理员核验' }).waitFor()
  assert.equal((await identity(display)).id, 'demo-service')
  await page.getByRole('link', { name: '发布审核' }).click()
  await page.getByRole('button', { name: '使用演示审核员' }).click()
  await page.getByRole('heading', { name: '大屏发布审核' }).waitFor()
  assert.equal((await identity(page, workspaceHeaders)).id, 'demo-dashboard-reviewer')
  assert.equal((await identity(display)).id, 'demo-service')
  await page.getByRole('button', { name: '退出审核' }).click()
  await page.getByRole('heading', { name: '发布审核员核验' }).waitFor()
  assert.equal((await identity(display)).id, 'demo-service')
  assert.equal(display.url(), originalUrl)
  assert.deepEqual(errors, [])
  console.log('PASS mobile admin, independent management/review logout and retained specialist display')
} finally {
  await browser.close()
}
