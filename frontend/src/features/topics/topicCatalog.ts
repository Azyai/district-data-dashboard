import { screenPath } from '../screens/screenCatalog'

export const topics = [
  { id: 'population', title: '人口专题', match: /人口|老龄|年龄结构|家庭户/, samples: ['常住人口有多少？', '年龄结构如何？'] },
  { id: 'hotline', title: '接诉即办', match: /接诉即办|既诉既办|即诉即办|热线|诉求|工单/, samples: ['哪类诉求最多？', '近期受理量如何变化？'] },
  { id: 'water', title: '水务专题', match: /水务|水质|供水|用水|水厂|出厂水|水资源/, samples: ['哪个监测点达标率最低？', '供水量有什么变化？'] },
] as const

export type TopicId = (typeof topics)[number]['id']

export function topicPath(id: TopicId, areaId?: string, month?: string | null) {
  if (id === 'population') return screenPath('population', areaId)
  if (id === 'hotline') return screenPath('governance', areaId, month)
  return '/topics/' + id
}

export function topicFor(id: string | null) {
  return topics.find(topic => topic.id === id)
}

export function matchTopics(question: string) {
  const text = question.normalize('NFKC').replace(/\s/g, '')
  if (/^(?:先?别|不要|不用|不必)(?:看|打开|切换|显示|查询)/.test(text)) return []
  return topics.filter(topic => topic.match.test(text))
}

export function asksForInsight(question: string) {
  return /多少|怎么样|有何|如何|变化|趋势|走势|同比|环比|最高|最低|最多|最少|什么|哪些|哪[个类里]|为何|为什么|分析|解读|对比|比较|占比|问题|风险|吗[？?]?$/.test(question)
}
