import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-shader-disk-cache'],
})

try {
  const page = await browser.newPage({ baseURL, viewport: { width: 1106, height: 893 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(18_000)
  await page.addInitScript(() => {
    const fixture = window.voiceFixture = {
      current: null, starts: 0, voice: true, available: 'available', speaking: null, spoken: [],
      result(text) {
        if (!this.current) throw new Error('Microphone is not listening')
        this.current.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] })
      },
      silence() {
        const engine = this.current
        this.current = null
        engine.onend()
      },
    }
    class Recognition {
      processLocally = false
      static async available() { return fixture.available }
      start() {
        if (!this.processLocally || !this.continuous || this.lang !== 'zh-CN') throw new Error('Invalid microphone mode')
        if (fixture.speaking) throw new Error('Playback leaked into the microphone')
        fixture.starts++
        fixture.current = this
      }
      abort() { if (fixture.current === this) fixture.current = null }
    }
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: Recognition })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class {
      constructor(text) { this.text = text }
    } })
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => fixture.voice ? [{ localService: true, lang: 'zh-CN' }] : [],
      speak(utterance) {
        if (fixture.current) throw new Error('Microphone still open during speech')
        fixture.speaking = utterance
        fixture.spoken.push(utterance.text)
      },
      cancel() { fixture.speaking = null },
    } })
  })
  const button = page.locator('.voice-orb-button')
  const phase = value => page.locator('.voice-orb[data-phase="' + value + '"]').waitFor()
  const hear = text => page.evaluate(value => window.voiceFixture.result(value), text)
  const ready = () => page.waitForFunction(() => Boolean(window.voiceFixture.current))
  const route = path => page.waitForURL(new URL(path, baseURL).href)
  const finish = async pattern => {
    await phase('speaking')
    assert.match(await page.evaluate(() => window.voiceFixture.spoken.at(-1)), pattern)
    assert.equal(await page.evaluate(() => window.voiceFixture.current === null), true)
    await page.evaluate(() => {
      const fixture = window.voiceFixture
      const utterance = fixture.speaking
      fixture.speaking = null
      utterance.onend()
    })
    await ready()
  }

  await page.goto('/screens/population?area=datai')
  await phase('off')
  assert.equal(await page.evaluate(() => window.voiceFixture.starts), 0)
  await button.evaluate(element => { window.originalVoiceOrb = element })
  await button.click()
  await ready()
  await hear('看全域')
  await phase('standby')
  assert.equal(new URL(page.url()).pathname, '/screens/population')
  assert.equal(await page.evaluate(() => window.voiceFixture.spoken.length), 0)

  const bounds = await button.boundingBox()
  await page.mouse.move(bounds.x + 24, bounds.y + 24)
  await page.mouse.down()
  await page.mouse.move(330, 660, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction(() => Math.abs(document.querySelector('.voice-orb-button').getBoundingClientRect().x - 306) < 2, undefined, { timeout: 3000 })
  assert.equal(await button.getAttribute('aria-pressed'), 'true')

  await hear('小门')
  await hear('小门')
  await phase('listening')
  await hear('我看一下政务的')
  await route('/screens/governance?area=datai')
  await finish(/大台街道.*基层治理/)
  await hear('小门小门，这里的接诉即办办结率是多少？')
  await finish(/大台街道.*办结率为 [\d.]+ %/)
  assert.equal(await button.evaluate(element => element === window.originalVoiceOrb), true)
  assert.equal(await page.getByRole('textbox', { name: '输入问题或指令' }).count(), 0)

  await hear('小门小门，打开网格治理')
  await route('/screens/grid?area=datai')
  await finish(/大台街道.*网格治理/)
  await hear('小门小门，这里的微网格有多少？')
  await finish(/大台街道.*微网格为[\d,]+个/)
  await hear('小门小门，看全域')
  await route('/')
  await finish(/返回门头沟全域/)
  const starts = await page.evaluate(() => window.voiceFixture.starts)
  await page.evaluate(() => window.voiceFixture.silence())
  await ready()
  assert.ok(await page.evaluate(() => window.voiceFixture.starts) > starts)

  await page.evaluate(() => { window.voiceFixture.voice = false })
  await hear('小门小门，平均车速是多少')
  await page.getByText(/平均车速为.*设备暂时无法朗读/).waitFor()
  await ready()
  await page.evaluate(() => window.voiceFixture.current.onerror({ error: 'not-allowed' }))
  await phase('error')
  assert.match(await page.locator('.voice-orb-state').textContent(), /允许使用麦克风/)
  await button.click()
  await ready()
  await button.click()
  await phase('off')
  assert.equal(await page.evaluate(() => window.voiceFixture.current === null), true)
  await page.evaluate(() => { window.voiceFixture.available = 'unavailable' })
  await button.click()
  await phase('error')
  assert.match(await page.locator('.voice-orb-state').textContent(), /中文.*语言包/)

  await page.reload()
  await phase('off')
  assert.ok(Math.abs((await button.boundingBox()).x - 306) < 2)
  assert.equal(await page.evaluate(() => window.voiceFixture.starts), 0)
  await page.setViewportSize({ width: 280, height: 310 })
  await page.waitForFunction(() => {
    const box = document.querySelector('.voice-orb-button').getBoundingClientRect()
    return box.right <= innerWidth && box.bottom <= innerHeight
  })
  console.log('PASS local wake, SPA voice navigation, scoped spoken answers, playback isolation, dragging, retries and opt-out')
} finally {
  await browser.close()
}
