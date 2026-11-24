import assert from 'node:assert/strict'
import test from 'node:test'
import { interpretCockpitIntent } from '../src/features/assistant/intent.ts'

const locations = [
  { id: 'mentougou', name: '门头沟区', level: 'district', parentId: null },
  { id: 'datai', name: '大台街道', level: 'town', parentId: 'mentougou' },
  { id: 'miaofengshan', name: '妙峰山镇', level: 'town', parentId: 'mentougou' },
  { id: 'miaofengshan-longjiazhuang', name: '陇驾庄村', level: 'village', parentId: 'miaofengshan' },
  { id: 'datai-qianjuntai', name: '千军台社区', level: 'village', parentId: 'datai' },
  { id: 'miaofengshan-dong', name: '东庄村', level: 'village', parentId: 'miaofengshan' },
  { id: 'datai-dong', name: '东庄村', level: 'village', parentId: 'datai' },
  { id: 'junzhuang', name: '军庄镇', level: 'town', parentId: 'mentougou' },
  { id: 'junzhuang-junzhuang', name: '军庄村', level: 'village', parentId: 'junzhuang' },
]

const parse = (question, current = 'mentougou') => interpretCockpitIntent(question, current, locations)
const navigate = (areaId) => ({ kind: 'navigate', areaId })
const questionAction = (kind, areaId, question) => ({ kind, areaId, question })

test('routes the specified cockpit commands', () => {
  assert.deepEqual(parse('我想要看大台街道的数据'), navigate('datai'))
  assert.deepEqual(parse('请帮我切换到陇驾庄村。'), navigate('miaofengshan-longjiazhuang'))
  assert.deepEqual(parse('大台有哪些问题'), questionAction('problems', 'datai', '大台有哪些问题'))
  assert.deepEqual(parse('这里有什么预警', 'datai'), questionAction('problems', 'datai', '这里有什么预警'))
  assert.deepEqual(parse('查看妙峰山镇的预警列表'), questionAction('problems', 'miaofengshan', '查看妙峰山镇的预警列表'))
  assert.deepEqual(parse('返回上一级', 'miaofengshan-longjiazhuang'), navigate('miaofengshan'))
  assert.deepEqual(parse('当前辖区有什么预警', 'datai'), questionAction('problems', 'datai', '当前辖区有什么预警'))
  assert.deepEqual(parse('回到全区', 'miaofengshan-longjiazhuang'), navigate('mentougou'))
})

test('keeps a cross-area metric question intact and preserves ordinary questions', () => {
  const crossArea = '  大台街道的办结率是多少？  '
  assert.deepEqual(parse(crossArea), questionAction('ask', 'datai', crossArea))
  assert.deepEqual(parse('查看大台的治理事件走势'), questionAction('ask', 'datai', '查看大台的治理事件走势'))
  for (const question of [
    '这里的治理事件受理量是多少？',
    '看看空气质量',
    '打开数据面板后怎么看指标？',
    '当前区域的待处置预警有多少条？',
    '为什么今天的预警比昨天多？',
    '社区治理数据如何变化？',
    '办公大台设备联网吗？',
  ]) {
    // A free-form question remains in scope, even when it starts with a viewing verb.
    assert.deepEqual(parse(question, 'datai'), questionAction('ask', 'datai', question))
  }
})

test('resolves topics without bypassing area selection or generic issue routing', () => {
  const topic = (question) => interpretCockpitIntent(question, 'mentougou', locations, text => /水务|人口|诉求/.test(text))
  assert.equal(topic('打开人口专题').reason, 'missing-navigation-target')
  assert.deepEqual(topic('大台水务有哪些问题'), questionAction('ask', 'datai', '大台水务有哪些问题'))
  assert.deepEqual(topic('哪类诉求最多'), questionAction('ask', 'mentougou', '哪类诉求最多'))
  assert.deepEqual(topic('大台有哪些问题'), questionAction('problems', 'datai', '大台有哪些问题'))
  assert.equal(topic('新港街道的水务数据').reason, undefined)
})

test('uses longest official names and explicit ancestor qualifiers', () => {
  assert.deepEqual(parse('打开军庄镇'), navigate('junzhuang'))
  assert.deepEqual(parse('打开军庄村'), navigate('junzhuang-junzhuang'))
  assert.deepEqual(parse('看看妙峰山镇东庄的数据'), navigate('miaofengshan-dong'))
  assert.deepEqual(parse('大台街道千军台社区的受理量是多少'),
    questionAction('ask', 'datai-qianjuntai', '大台街道千军台社区的受理量是多少'))
})

test('disambiguates using the current branch and clarifies when it cannot', () => {
  assert.deepEqual(parse('查看东庄', 'datai-qianjuntai'), navigate('datai-dong'))
  assert.deepEqual(parse('查看东庄村', 'miaofengshan'), navigate('miaofengshan-dong'))
  assert.match(parse('查看东庄').message, /大台街道.*妙峰山镇|妙峰山镇.*大台街道/)
  assert.equal(parse('大台街道和妙峰山镇哪个办结率高？').kind, 'clarify')
  assert.equal(parse('军庄', 'mentougou').kind, 'clarify')
})

test('cannot select unknown or malformed scopes', () => {
  for (const question of ['切换到火星', '新港街道的办结率是多少？', '不存在镇有哪些预警？']) {
    assert.equal(parse(question).kind, 'clarify')
  }
  assert.equal(parse('不要切换到大台街道').kind, 'clarify')
  assert.equal(parse('返回上一级').kind, 'clarify')
  assert.equal(parse('办结率是多少', 'unregistered').kind, 'clarify')
  assert.equal(interpretCockpitIntent('跳转到无效路径', 'mentougou', [
    ...locations, { id: '../unsafe', name: '无效路径', level: 'town', parentId: 'mentougou' },
  ]).kind, 'clarify')
})
