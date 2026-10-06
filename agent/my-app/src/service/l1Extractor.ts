import type { L0Event, L1Fact } from './portraitService'

export type NovelFactCategory = 'character_state' | 'relationship' | 'goal_change' | 'world_rule' | 'plot_turn' | 'scene_state'
export type NovelFactCandidate = { title: string; content: string; category: NovelFactCategory; confidence: number; characterId?: number }
type L1Model = { invoke(input: string): Promise<unknown> }

const CATEGORIES = new Set<NovelFactCategory>(['character_state', 'relationship', 'goal_change', 'world_rule', 'plot_turn', 'scene_state'])
const MIN_FACT_LENGTH = 8

const contentOf = (response: unknown): string => {
  if (typeof response === 'string') return response
  if (response && typeof response === 'object' && 'content' in response) return String((response as { content: unknown }).content)
  return String(response ?? '')
}

export const parseNovelL1Output = (raw: string): NovelFactCandidate[] => {
  const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[0]) as unknown
    const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && 'facts' in parsed ? (parsed as { facts: unknown }).facts : []
    if (!Array.isArray(list)) return []
    const seen = new Set<string>()
    const result: NovelFactCandidate[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const value = item as Record<string, unknown>
      const content = typeof value.content === 'string' ? value.content.trim() : ''
      const category = value.category as NovelFactCategory
      if (content.length < MIN_FACT_LENGTH || !CATEGORIES.has(category) || seen.has(content)) continue
      const confidence = typeof value.confidence === 'number' ? Math.max(0, Math.min(1, value.confidence)) : 0.5
      result.push({ title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : '未命名事实', content, category, confidence, characterId: typeof value.characterId === 'number' ? value.characterId : undefined })
      seen.add(content)
    }
    return result.slice(0, 12)
  } catch { return [] }
}

const extractionPrompt = (event: L0Event): string => `你是中文小说记忆系统的 L1 事实提取器。
请只从下面这条 L0 原始记录中提取已经发生、可被后续写作引用的事实，不要推测，不要写评价，不要复述整段正文。

允许的 category：character_state（角色状态/性格变化）、relationship（关系变化）、goal_change（目标变化）、world_rule（世界规则）、plot_turn（剧情转折）、scene_state（场景状态）。
过滤：闲聊、礼貌话、纯操作指令、没有事实内容的句子。每条事实必须是完整陈述，长度至少 8 个中文字符。
输出严格 JSON，不要 Markdown：{"facts":[{"title":"简短标题","content":"事实","category":"上述枚举","confidence":0.0到1.0,"characterId":可选数字}]}

小说范围：${event.novelId}
来源：${event.sourceType}/${event.sourceId}
原始标题：${event.title}
原始内容：
${event.content}`

export const createNovelL1Extractor = (model: L1Model) => async (event: L0Event): Promise<L1Fact[]> => {
  const candidates = parseNovelL1Output(contentOf(await model.invoke(extractionPrompt(event))))
  return candidates.map((candidate, index) => ({
    novelId: event.novelId,
    title: candidate.title,
    content: candidate.content,
    sourceType: event.sourceType,
    sourceId: `${event.sourceId}:fact:${index + 1}`,
    characterId: candidate.characterId ?? event.characterId,
    volumeId: event.volumeId,
    chapterId: event.chapterId,
    confidence: candidate.confidence,
    metadata: { ...(event.metadata ?? {}), category: candidate.category, extractor: 'novel-l1' },
  }))
}
