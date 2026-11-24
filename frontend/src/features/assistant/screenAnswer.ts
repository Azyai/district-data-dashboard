import type { CockpitArea } from '../../api/client'
import type { ScreenId } from '../screens/screenCatalog'
import {
  ageNames, economyFor, formatNumber, populationFor, projectAttentionGap, towns,
} from '../screens/screenData'
import type { SnapshotAnswer } from './answer'

const populationWords = /人口|年龄|老龄|老年|儿童|未成年|劳动年龄|人数|多少人|60\s*岁/
const economyWords = /经济|生产总值|GDP|投资|消费品|零售|产业|企业|项目/i
const currentScreenQuestion = /分析|概况|概览|情况|怎么样|问题|关注|风险|异常|数据/
const changeWords = /趋势|变化|增减|环比|比上月|比较|对比|走势/

function populationAnswer(question: string, area: CockpitArea): string {
  const sample = populationFor(area)
  if (!sample) return '该区域暂无常住人口样例。'
  if (/同比|去年|增长|减少|趋势|变化|男女|性别|户籍|流动人口/.test(question)) {
    return '人口样例记录了 10 月常住人口和三个年龄组占比，暂缺这个口径的数据。'
  }
  const ageIndex = /老龄|老年|60\s*岁/.test(question) ? 2
    : /儿童|未成年|0[–—-]17/.test(question) ? 0
      : /劳动年龄|18[–—-]59/.test(question) ? 1 : null
  if (/排行|排名|最多|最高|最少|最低/.test(question)) {
    const value = (town: typeof sample) => ageIndex !== null ? town.age[ageIndex] : town.population
    const ascending = /最少|最低/.test(question)
    const candidates = towns.filter(town => {
      if (area.level !== 'district') return true
      if (/哪(?:一?个|些)?街道/.test(question)) return town.name.endsWith('街道')
      if (/哪(?:一?个|些)?(?:乡镇|镇)(?!街)/.test(question)) return town.name.endsWith('镇')
      return true
    })
    const order = candidates.sort((a, b) => (ascending ? 1 : -1) * (value(a) - value(b)))
    const metric = ageIndex !== null ? ageNames[ageIndex] + '人口占比' : '常住人口'
    const unit = ageIndex !== null ? '%' : ' 人'
    if (area.level === 'district') return metric + (ascending ? '最低' : '最高') + '的是' + order[0].name + '，为 ' + formatNumber(value(order[0])) + unit + '。'
    if (area.level === 'town') {
      const rank = order.findIndex(town => value(town) === value(sample)) + 1
      return metric + '为 ' + formatNumber(value(sample)) + unit + '，在 13 个镇街中' + (ascending ? '由低到高' : '由高到低') + '排第 ' + rank + '。'
    }
    return '该区域是村社，镇街排行仅比较 13 个镇街。'
  }
  if (ageIndex !== null) {
    const share = sample.age[ageIndex]
    return ageNames[ageIndex] + '人口占比为 ' + formatNumber(share) + '%，按常住人口估算约 '
      + formatNumber(Math.round(sample.population * share / 100)) + ' 人。'
  }
  const headline = '常住人口为 ' + formatNumber(sample.population) + ' 人。'
  if (/年龄|结构|占比|分析|问题|关注|概况|风险/.test(question)) {
    return headline + ageNames.map((name, index) => name + '占 ' + formatNumber(sample.age[index]) + '%').join('，') + '。'
  }
  return headline
}

function economyAnswer(question: string, area: CockpitArea): string {
  const sample = economyFor(area)
  if (/同比|去年|上年|财政收入|税收|失业/.test(question)) return '经济样例涵盖最近六个月的累计生产总值、投资和零售额，暂缺这个口径的数据。'
  if (/项目|风险|问题|预警|关注/.test(question)) {
    const delayed = sample.projects.filter(project => project.planned - project.progress >= projectAttentionGap)
    const names = delayed.map(project => project.name + '落后计划 ' + (project.planned - project.progress) + ' 个百分点')
    return '重点项目 ' + formatNumber(sample.projectCount) + ' 个，当前区域有 ' + sample.projects.length + ' 个样例提供进度明细。'
      + (names.length ? names.join('，') + '。' : sample.projects.length ? '这些样例的进度偏差均低于预警阈值。' : '')
  }
  if (/产业|企业/.test(question)) {
    if (/服务|诉求|办结/.test(question)) return '服务企业 ' + sample.served + ' 家，记录企业服务诉求 '
      + sample.serviceCount + ' 件，其中已办结 ' + sample.serviceDone + ' 件。'
    return sample.industries.map(item => item.label + ' ' + item.value + ' 家').join('，') + '。'
  }
  const series = [
    { label: '地区生产总值', values: sample.gdp, match: /生产总值|GDP/i },
    { label: '固定资产投资', values: sample.investment, match: /投资/ },
    { label: '社会消费品零售总额', values: sample.sales, match: /零售|消费/ },
  ]
  const selected = series.filter(item => item.match.test(question))
  const namedMonth = question.match(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月/)
  const monthIndex = namedMonth
    ? sample.periods.findIndex(period => period.month === Number(namedMonth[2]) && (!namedMonth[1] || period.year === Number(namedMonth[1])))
    : sample.periods.length - (/上月/.test(question) && !changeWords.test(question) ? 2 : 1)
  if (monthIndex < 0) return '经济样例提供截至本月的最近六个月累计值。'
  const period = sample.periods[monthIndex]
  return (selected.length ? selected : series).map(item => {
    const total = item.values[monthIndex]
    const headline = period.label + '累计' + item.label + '为 ' + formatNumber(total) + ' 亿元'
    if (!changeWords.test(question)) return headline
    if (!monthIndex || period.month === 1) return headline + '，该期缺少同年度的上月累计值'
    const delta = total - item.values[monthIndex - 1]
    return headline + '，较上月累计值' + (delta >= 0 ? '增加 ' : '减少 ') + formatNumber(Math.abs(delta)) + ' 亿元'
  }).join('。') + '。'
}

export function answerFromScreen(question: string, area: CockpitArea, screen?: ScreenId): SnapshotAnswer | undefined {
  const contextual = currentScreenQuestion.test(question)
  const population = populationWords.test(question)
  const economy = economyWords.test(question)
  if (population || !economy && screen === 'population' && contextual) {
    return { text: area.name + ' 10 月人口演示数据。' + populationAnswer(question, area), evidence: '镇街人口专题 · 模拟快照' }
  }
  if (economy || screen === 'economy' && contextual) {
    return { text: area.name + '经济演示数据。' + economyAnswer(question, area), evidence: '经济发展专题 · 模拟快照' }
  }
}
