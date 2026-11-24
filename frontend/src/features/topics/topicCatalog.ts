const topics = [
  { id: 'population', screen: 'population', title: '城镇人口' },
  { id: 'hotline', screen: 'governance', title: '基层治理' },
  { id: 'water', screen: 'waters', title: '水域态势' },
] as const

export function topicFor(id: string | null) {
  return topics.find(topic => topic.id === id)
}
