import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5177'
const output = process.env.E2E_ARTIFACTS
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

async function capture(page, name) {
  if (!output) return
  await mkdir(output, { recursive: true })
  await page.screenshot({ path: join(output, name + '.png'), animations: 'disabled' })
}

try {
  const page = await browser.newPage({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(15_000)
  const failures = []
  page.on('pageerror', error => failures.push(error.message))
  await page.addInitScript(() => {
    class LocalSpeechFixture {
      static available() { return Promise.resolve('available') }
      processLocally = false
      start() {
        if (!this.processLocally) throw new Error('Speech should stay on-device')
        setTimeout(() => this.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript: '哪类诉求最多？' } }],
        }), 40)
      }
      abort() {}
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: LocalSpeechFixture, configurable: true })
  })
  await page.goto('/workbench')
  const workbench = page.getByRole('main', { name: '区域数据工作台' })
  const assistant = page.getByRole('button', { name: 'AI 问数' })
  await assistant.click()
  await page.getByRole('button', { name: '语音提问', exact: true }).click()
  await page.waitForURL('**/topics/hotline')
  const hotline = page.getByRole('main', { name: '接诉即办' })
  await hotline.waitFor()
  await hotline.getByText(/市容环境最高，为 381 件/).waitFor()
  await hotline.getByText('柱状图', { exact: true }).waitFor()
  await hotline.getByText('分类网络图', { exact: true }).waitFor()
  await hotline.locator('.data-chart canvas').first().waitFor()
  assert.equal(await workbench.count(), 0, 'Standalone topic unmounts the workbench')
  await capture(page, 'hotline-voice-insight')

  const prompt = page.getByRole('textbox', { name: '追问当前专题' })
  await prompt.fill('打开水务专题')
  await prompt.press('Enter')
  await page.waitForURL('**/topics/water')
  const water = page.getByRole('main', { name: '水务专题' })
  await water.waitFor()
  await water.getByText('星状雷达图', { exact: true }).waitFor()
  await prompt.fill('哪个监测点达标率最低？')
  await prompt.press('Enter')
  await water.getByText(/大台监测点最低，为 98.7%/).waitFor()
  await prompt.fill('水质趋势如何？')
  await prompt.press('Enter')
  await water.getByText(/暂无该指标的时间序列/).waitFor()
  await prompt.fill('水务有哪些风险？')
  await prompt.press('Enter')
  await water.getByText(/判定风险需核对业务阈值/).waitFor()
  await prompt.fill('大台街道供水量是多少？')
  await prompt.press('Enter')
  await water.getByText(/大台街道暂无专题快照/).waitFor()
  await capture(page, 'water-scope-and-insight')
  await prompt.fill('打开大台街道数据')
  await prompt.press('Enter')
  await page.waitForURL('**/data/areas/datai')
  await page.getByRole('heading', { name: '大台街道', exact: true }).waitFor()

  await page.getByRole('link', { name: '人口专题', exact: true }).click()
  await page.waitForURL('**/topics/population')
  const population = page.getByRole('main', { name: '人口专题' })
  await population.waitFor()
  await population.getByText('392,000', { exact: true }).waitFor()
  await population.getByText('折线图', { exact: true }).waitFor()
  await population.getByText('环形图', { exact: true }).waitFor()
  await population.locator('.data-chart canvas').first().waitFor()
  await capture(page, 'population-topic')
  await page.reload()
  await population.getByText('392,000', { exact: true }).waitFor()
  await prompt.fill('返回地图')
  await prompt.press('Enter')
  await page.waitForURL(new URL('/', baseURL).toString())
  await page.getByRole('heading', { name: '门头沟区数字驾驶舱' }).waitFor()

  await page.goto('/workbench?area=dayu#area-issues')
  await page.waitForURL('**/data/areas/dayu#area-issues')
  await page.getByRole('dialog', { name: '大峪街道问题诊断' }).waitFor()
  assert.deepEqual(failures, [])

  const phone = await browser.newPage({
    baseURL, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true,
  })
  await phone.goto('/?topic=population')
  await phone.waitForURL('**/topics/population')
  const phonePopulation = phone.getByRole('main', { name: '人口专题' })
  await phonePopulation.getByText('392,000', { exact: true }).waitFor()
  await phonePopulation.locator('.data-chart canvas').first().waitFor()
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  await capture(phone, 'population-topic-mobile')
  console.log('PASS voice routing, standalone topics, snapshot analysis, direct regional data links, legacy redirects and mobile')
} finally {
  await browser.close()
}
