import type { Database } from 'bun:sqlite'

/**
 * 角色裁决 runtime —— actor_decisions 的写读入口，以及 writer 的 {DECISIONS} 那一段。
 *
 * ── 存裁决换来的两样东西 ──
 *   1. 写正文时有地方读（buildDecisionsText）—— 没它，正文里就会出现
 *      "主角突然做了他不会做的事"。
 *   2. **重跑同一章不必重问 Actor** —— prompt_hash 一致就直接复用旧裁决。
 *      Actor 是每章可能问两三次的调用，这一步省下的是真金白银，
 *      而且顺带保证"同一章反复跑不会得到不同答案"（下游没法吃摇摆的抉择）。
 *
 * ── character_id 可空，是这一层最容易写错的地方 ──
 * 裁决那一刻，那个角色可能还没建卡（大纲先写了 NEW: 需求），所以 character_id 落 NULL。
 * 于是查重不能只靠 UNIQUE 约束 —— SQLite 里 **NULL 互不相等**，
 * 两条 character_id 都为 NULL 的行不会互相冲突。必须在 SQL 里显式写
 * `character_id IS NULL` 分支，否则同一问会被重复落库。
 *
 * ── 这段文本给谁看 ──
 * buildDecisionsText 的产物直接进 writer 的提示词，而 **writer 的世界里只有名字**。
 * 所以这里一律用角色名，绝不写 "角色 #7" —— 那样它认不出是谁。
 */
export type ActorChoice = 'A' | 'B' | 'C' | 'D'

export type DecisionOptions = {
  A: string
  B: string
  C: string
  /** D 的题面：允许角色说出选项外的答案 */
  chatPrompt?: string
}

export type DecisionInput = {
  chapterIdx: number
  /** 角色名。还没建卡时照样能记，character_id 落 NULL */
  characterName: string
  situation: string
  options: DecisionOptions
  choice: ActorChoice
  reason?: string
  line?: string
  /** choice = D 时必填 —— 否则这次裁决没有结论 */
  customAnswer?: string
  promptHash: string
}

export type ActorDecision = {
  id: number
  chapterIdx: number
  chapterId: number
  characterId: number | null
  /** 未建卡时为 null；文本里显示成「未建卡的角色」 */
  characterName: string | null
  situation: string
  options: DecisionOptions
  choice: ActorChoice
  customAnswer: string
  reason: string
  line: string
  promptHash: string
  createdAt: string
}

export type SaveDecisionResult = { decision: ActorDecision; reused: boolean }
export type ChapterDecisionText = { chapterIdx: number; text: string; count: number }

const CHOICE_SET: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D'])

export const createDecisionRuntime = (database: Database) => {
  const chapterIdByIdx = (idx: number): number | null => {
    const row = database.query('SELECT id FROM chapters WHERE idx = ?').get(idx) as { id: number } | null
    return row ? Number(row.id) : null
  }

  const characterIdByName = (name: string): number | null => {
    if (!name?.trim()) return null
    const row = database.query('SELECT id FROM characters WHERE name = ?').get(name.trim()) as { id: number } | null
    return row ? Number(row.id) : null
  }

  const characterNameById = (id: number | null): string | null => {
    if (id === null) return null
    const row = database.query('SELECT name FROM characters WHERE id = ?').get(id) as { name: string } | null
    return row ? String(row.name) : null
  }

  const findExisting = (chapterId: number, characterId: number | null, promptHash: string): Record<string, unknown> | null => {
    // NULL 分支必须显式写：`character_id = NULL` 永远不成立
    if (characterId === null) {
      return database
        .query('SELECT * FROM actor_decisions WHERE chapter_id = ? AND character_id IS NULL AND prompt_hash = ? LIMIT 1')
        .get(chapterId, promptHash) as Record<string, unknown> | null
    }
    return database
      .query('SELECT * FROM actor_decisions WHERE chapter_id = ? AND character_id = ? AND prompt_hash = ? LIMIT 1')
      .get(chapterId, characterId, promptHash) as Record<string, unknown> | null
  }

  const toDecision = (row: Record<string, unknown>): ActorDecision => {
    const characterId = row.character_id === null || row.character_id === undefined ? null : Number(row.character_id)
    const chapterId = Number(row.chapter_id)
    const chapterIdxRow = database.query('SELECT idx FROM chapters WHERE id = ?').get(chapterId) as { idx: number } | null
    return {
      id: Number(row.id),
      chapterIdx: chapterIdxRow ? Number(chapterIdxRow.idx) : Number(row.chapter_id),
      chapterId,
      characterId,
      characterName: characterNameById(characterId),
      situation: String(row.situation),
      options: parseOptions(row.options),
      choice: row.choice as ActorChoice,
      customAnswer: String(row.custom_answer),
      reason: String(row.reason),
      line: String(row.line),
      promptHash: String(row.prompt_hash),
      createdAt: String(row.created_at),
    }
  }

  /**
   * 记一次裁决。同一 (chapter, character, prompt_hash) 已存在就原样返回，reused=true。
   * 角色名解析不到 id 也照记不误（人还没建），只是 character_id 落 NULL。
   */
  const save = (input: DecisionInput): SaveDecisionResult => {
    assertDecision(input)
    const chapterId = chapterIdByIdx(input.chapterIdx)
    if (chapterId === null) throw new TypeError(`找不到第 ${input.chapterIdx} 章，先落库章纲`)

    const characterId = characterIdByName(input.characterName)
    const hash = input.promptHash.trim()

    const existing = findExisting(chapterId, characterId, hash)
    if (existing) return { decision: toDecision(existing), reused: true }

    const result = database
      .query(
        `INSERT INTO actor_decisions (chapter_id, character_id, situation, options, choice, custom_answer, reason, line, prompt_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        chapterId,
        characterId,
        input.situation.trim(),
        JSON.stringify({ A: input.options.A, B: input.options.B, C: input.options.C, chatPrompt: input.options.chatPrompt ?? '' }),
        input.choice,
        (input.customAnswer ?? '').trim(),
        (input.reason ?? '').trim(),
        (input.line ?? '').trim(),
        hash,
      )
    const row = database.query('SELECT * FROM actor_decisions WHERE id = ?').get(Number(result.lastInsertRowid)) as Record<string, unknown>
    return { decision: toDecision(row), reused: false }
  }

  const list = (chapterIdx: number): ActorDecision[] => {
    const chapterId = chapterIdByIdx(chapterIdx)
    if (chapterId === null) return []
    return (database.query('SELECT * FROM actor_decisions WHERE chapter_id = ? ORDER BY id').all(chapterId) as Array<Record<string, unknown>>).map(toDecision)
  }

  /**
   * 拼 writer 的 {DECISIONS} 段。
   *
   * 没有裁决时返回一句明确的"无"，而不是空串 —— 空串会让 writer 分不清
   * "这一章没有分叉点"（该按角色卡自由发挥）和"调用方漏填了"（是 bug）。
   */
  const buildDecisionsText = (chapterIdx: number): ChapterDecisionText => {
    const decisions = list(chapterIdx)
    if (decisions.length === 0) {
      return { chapterIdx, count: 0, text: '（无。这一章没有需要裁决的分叉点，按角色卡自由发挥。）' }
    }
    const text = decisions
      .map((d) => {
        const who = d.characterName ?? '（未建卡的角色）'
        const pick = d.choice === 'D' ? `D —— ${d.customAnswer}` : d.choice
        const options = [`    A. ${d.options.A}`, `    B. ${d.options.B}`, `    C. ${d.options.C}`, `    D. ${d.options.chatPrompt || '（自由作答）'}`].join('\n')
        return [
          `【${who}】`,
          `  他面对的是：${d.situation}`,
          `  给过的选项：`,
          options,
          `  他选了：${pick}`,
          `  依据：${d.reason}`,
          `  他会说的话：「${d.line}」`,
        ].join('\n')
      })
      .join('\n\n')
    return { chapterIdx, count: decisions.length, text }
  }

  return { save, list, buildDecisionsText }
}

const assertDecision = (input: DecisionInput): void => {
  if (!input || typeof input !== 'object') throw new TypeError('裁决必须是对象')
  if (!Number.isInteger(input.chapterIdx) || input.chapterIdx < 1) throw new TypeError('chapterIdx 必须是正整数')
  if (!input.characterName?.trim()) throw new TypeError('characterName 不能为空')
  if (!input.situation?.trim()) throw new TypeError('situation 不能为空')
  if (!input.options || typeof input.options !== 'object') throw new TypeError('options 不能为空')
  for (const key of ['A', 'B', 'C'] as const) {
    if (typeof input.options[key] !== 'string' || !input.options[key].trim()) throw new TypeError(`options.${key} 不能为空`)
  }
  if (!CHOICE_SET.has(input.choice)) throw new TypeError(`choice 只能是 ${[...CHOICE_SET].join(' / ')}`)
  if (!input.promptHash?.trim()) throw new TypeError('promptHash 不能为空 —— 没有它就判断不了"这一问是不是问过了"')
  if (input.choice === 'D' && !input.customAnswer?.trim()) throw new TypeError('choice = D 时必须给出 customAnswer')
}

const parseOptions = (value: unknown): DecisionOptions => {
  try {
    const o = JSON.parse(String(value ?? '{}')) as Partial<DecisionOptions>
    return { A: String(o.A ?? ''), B: String(o.B ?? ''), C: String(o.C ?? ''), chatPrompt: o.chatPrompt === undefined ? undefined : String(o.chatPrompt) }
  } catch {
    return { A: '', B: '', C: '' }
  }
}
