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
  await page.addInitScript(() => {
    class LocalSpeechFixture {
      static available() { return Promise.resolve('available') }
      processLocally = false
      start() {
        if (!this.processLocally) throw new Error('Speech should stay on-device')
        setTimeout(() => this.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript: window.testTranscript } }],
        }), 40)
      }
      abort() {}
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: LocalSpeechFixture, configurable: true })
  })
  const open = () => page.getByRole('button', { name: 'AI 问数', exact: true }).click()
  const voice = async text => {
    await page.evaluate(command => { window.testTranscript = command }, text)
    await page.getByRole('button', { name: '语音提问', exact: true }).click()
  }
  const send = async text => {
    const input = page.getByRole('textbox', { name: '输入问题或指令' })
    await input.fill(text)
    await input.press('Enter')
  }
  const log = page.getByRole('log', { name: '问数记录' })
  const region = page.getByRole('combobox', { name: '选择区域', exact: true })
  const topic = page.getByRole('combobox', { name: '选择数据展示' })
  const waitPath = path => page.waitForURL(new URL(path, baseURL).toString())

  await page.goto('/areas/datai')
  await open()
  await voice('我看一下政务的')
  await waitPath('/screens/governance?area=datai')
  const governance = await verifySingleScreen(page, 'governance')
  assert.equal(await region.inputValue(), 'datai')
  await open()
  await send('这里的接诉即办办结率是多少？')
  await log.getByText(/大台街道 2026-10.*办结率为 93.9/).waitFor()
  await send('工单表里的 town_id 字段表示什么？')
  await log.getByText(/town_id.*镇街标识.*hotline_area/).waitFor()
  await page.keyboard.press('Escape')
  await governance.getByRole('combobox', { name: '受理月份' }).selectOption('2026-09')
  await page.waitForURL(url => url.searchParams.get('month') === '2026-09')
  await open()
  await send('受理量是多少？')
  await log.getByText(/大台街道 2026-09.*受理工单为/).waitFor()
  await capture(page, 'hotline-agent-analysis')
  await send('看城镇人数')
  await waitPath('/screens/population?area=datai')
  await verifySingleScreen(page, 'population')
  await open()
  await send('老龄人口占比是多少？')
  await log.getByText(/大台街道.*占比为 33%/).waitFor()
  await send('斋堂镇的人口有多少？')
  await log.getByText(/斋堂镇.*10,600/).waitFor()
  await page.keyboard.press('Escape')

  await region.selectOption('zhaitang')
  await waitPath('/screens/population?area=zhaitang')
  await topic.selectOption('economy')
  await waitPath('/screens/economy?area=zhaitang')
  await verifySingleScreen(page, 'economy')
  await page.reload()
  await verifySingleScreen(page, 'economy')
  assert.equal(await region.inputValue(), 'zhaitang')
  await open()
  await send('哪些项目需要关注？')
  await log.getByText(/斋堂镇.*生态文旅配套提升落后计划 12 个百分点/).waitFor()
  await page.keyboard.press('Escape')
  await page.goBack()
  await waitPath('/screens/population?area=zhaitang')
  await verifySingleScreen(page, 'population')
  await open()
  await voice('看全域')
  await waitPath('/')
  await page.getByRole('heading', { name: '门头沟区数字驾驶舱' }).waitFor()

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
  await page.goto('/workbench?area=dayu#area-issues')
  await waitPath('/data/areas/dayu#area-issues')
  await page.getByRole('dialog', { name: '大峪街道问题诊断' }).waitFor()

  await page.goto('/workbench')
  await open()
  await send('打开水务专题')
  await waitPath('/topics/water')
  const water = page.getByRole('main', { name: '水务专题' })
  const prompt = water.getByRole('textbox', { name: '追问当前专题' })
  await water.getByText('星状雷达图', { exact: true }).waitFor()
  for (const [question, answer] of [
    ['哪个监测点达标率最低？', /大台监测点最低，为 98.7%/],
    ['水质趋势如何？', /暂无该指标的时间序列/],
    ['水务有哪些风险？', /判定风险需核对业务阈值/],
    ['大台街道供水量是多少？', /大台街道暂无专题快照/],
  ]) {
    await prompt.fill(question)
    await prompt.press('Enter')
    await water.getByText(answer).waitFor()
  }
  await capture(page, 'water-scope-and-insight')
  await prompt.fill('打开大台街道数据')
  await prompt.press('Enter')
  await waitPath('/data/areas/datai')
  await page.getByRole('link', { name: '人口专题', exact: true }).click()
  await waitPath('/screens/population?area=datai')
  await page.goto('/topics/water')
  await prompt.fill('大台街道的热线工单有多少？')
  await prompt.press('Enter')
  await water.getByText(/大台街道 2026-10.*受理工单为 66/).waitFor()
  await page.evaluate(() => { window.testTranscript = '看一下斋堂镇的政务' })
  await water.getByRole('button', { name: '语音追问' }).click()
  await waitPath('/screens/governance?area=zhaitang')
  await page.goBack()
  await waitPath('/topics/water')
  await prompt.fill('看全域')
  await prompt.press('Enter')
  await waitPath('/')
  assert.deepEqual(failures, [])
  console.log('PASS scoped screen navigation, SQL and mock analysis, simulated speech, single-viewport layouts, legacy links and water topic')
} finally {
  await browser.close()
}
