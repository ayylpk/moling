/**
 * 角色裁决业务层。
 *
 * 这一层的价值集中在一处：**同一个问题只问一次**。
 *
 * Actor 是「每章可能问两三次」的调用，而重跑一章是常事（改了风格、补了设定）。
 * 所以记 `prompt_hash`：拿同一份情境再问一次时，直接把上次的裁决返回，
 * 标 `reused: true`。省下的是真金白银，而且顺带保证"重跑不会得到不同答案" ——
 * 同一章反复跑出不同抉择，下游根本没法用。
 */
import * as store from '../db/actorDecisionDB'
import * as chapterStore from '../db/chapterDB'
import * as characterStore from '../db/characterDB'
import { now } from '../shared/time'
import { resolveCharacterId } from './characterService'
import { ACTOR_CHOICE } from '../../../db/types'
import type {
  SaveActorDecisionDTO,
  ActorDecisionVO,
  ActorDecisionEntity,
  ActorOptions,
} from '../../../db/types'

/* ==================== 转换 ==================== */

const toVO = (e: ActorDecisionEntity): ActorDecisionVO => ({
  id: e.id,
  novel_id: e.novel_id,
  chapter_id: e.chapter_id,
  character_id: e.character_id,
  character_name:
    e.character_id === null ? null : (characterStore.selectCharacter(e.character_id)?.name ?? null),
  situation: e.situation,
  options: JSON.parse(e.options) as ActorOptions,
  choice: e.choice,
  custom_answer: e.custom_answer,
  reason: e.reason,
  line: e.line,
  prompt_hash: e.prompt_hash,
  created_at: e.created_at,
})

/* ==================== 校验 ==================== */

const assertDTO = (dto: SaveActorDecisionDTO): void => {
  if (!dto || typeof dto !== 'object') throw new TypeError('请求体必须是对象')
  if (!Number.isInteger(dto.chapter_id)) throw new TypeError('chapter_id 必须是整数')
  if (typeof dto.character !== 'string' || !dto.character.trim()) {
    throw new TypeError('character 不能为空')
  }
  if (!dto.options || typeof dto.options !== 'object') throw new TypeError('options 不能为空')
  for (const k of ['A', 'B', 'C'] as const) {
    if (typeof dto.options[k] !== 'string' || !dto.options[k].trim()) {
      throw new TypeError(`options.${k} 不能为空`)
    }
  }
  if (!(ACTOR_CHOICE as readonly string[]).includes(dto.choice)) {
    throw new TypeError(`choice 只能是 ${ACTOR_CHOICE.join(' / ')}`)
  }
  if (!dto.prompt_hash?.trim()) {
    throw new TypeError('prompt_hash 不能为空 —— 没有它就判断不了"这一问是不是问过了"')
  }
  // 选 D 却给了空答案，等于这次裁决没有结论
  if (dto.choice === 'D' && !dto.custom_answer?.trim()) {
    throw new TypeError('choice = D 时必须给出 custom_answer')
  }
}

/* ==================== 写入 ==================== */

export interface RecordDecisionResult {
  decision: ActorDecisionVO
  /** true = 直接复用了上次的裁决，没有新增记录 */
  reused: boolean
}

/**
 * 记一次裁决。
 *
 * 先按 (chapter, character, prompt_hash) 找有没有现成的；找到就原样返回，
 * `reused: true`。没找到才插。
 *
 * 注意 character 传的是**名字**：那个角色可能还没建卡（大纲先写了 NEW: 需求），
 * 这时 character_id 落 NULL。所以查重不能只靠 UNIQUE 约束 ——
 * SQLite 里 NULL 互不相等，带 NULL 的行不会互相冲突。
 */
export const recordDecision = (
  novelId: number,
  dto: SaveActorDecisionDTO,
): RecordDecisionResult => {
  assertDTO(dto)

  const chapter = chapterStore.selectChapter(dto.chapter_id)
  if (!chapter) throw new TypeError(`chapter_id=${dto.chapter_id} 不存在`)

  const characterId = resolveCharacterId(novelId, dto.character)
  const hash = dto.prompt_hash.trim()

  const existing = store.selectDecisionByHash(chapter.id, characterId, hash)
  if (existing) return { decision: toVO(existing), reused: true }

  const id = store.insertDecision({
    novel_id: novelId,
    chapter_id: chapter.id,
    character_id: characterId,
    situation: dto.situation,
    options: JSON.stringify(dto.options),
    choice: dto.choice,
    custom_answer: (dto.custom_answer ?? '').trim(),
    reason: (dto.reason ?? '').trim(),
    line: (dto.line ?? '').trim(),
    prompt_hash: hash,
  })
  return { decision: toVO(store.selectDecisionById(id)!), reused: false }
}

export const listDecisionsByChapter = (chapterId: number): ActorDecisionVO[] =>
  store.selectDecisionsByChapter(chapterId).map(toVO)

export const deleteDecisionsByChapter = (chapterId: number): number =>
  store.deleteDecisionsByChapter(chapterId)

/* ==================== 给 writer 的那一段 ==================== */

/**
 * 把这一章的裁决拼成 writer 的 `{DECISIONS}` 段。
 *
 * 这是整个流水线里**唯一的接缝**：Actor 的产出经这里进 writer 的提示。
 * 没有它，正文里就会出现"主角突然做了他不会做的事"。
 *
 * 没有裁决时返回一句明确的"无" —— 而不是空串。空串会让 writer 分不清
 * "没有分叉点"和"这一节没填上"，前者应该按角色卡自由发挥，后者是调用方的 bug。
 */
export const buildDecisionsText = (chapterId: number): string => {
  const list = store.selectDecisionsByChapter(chapterId)
  if (list.length === 0) return '（无。这一章没有需要裁决的分叉点，按角色卡自由发挥。）'

  return list
    .map((d) => {
      const v = toVO(d)
      // **用名字，不用 id**：这段文本是直接进 writer 提示的，
      // 而 writer 的世界里只有名字。写 "角色 #7" 它认不出那是谁。
      const who = v.character_name ?? '（未建卡的角色）'
      const pick = v.choice === 'D' ? `D —— ${v.custom_answer}` : v.choice
      const optionText = `    A. ${v.options.A}\n    B. ${v.options.B}\n    C. ${v.options.C}\n    D. ${v.options.chatPrompt}`
      return [
        `【${who}】`,
        `  他面对的是：${v.situation}`,
        `  给过的选项：`,
        optionText,
        `  他选了：${pick}`,
        `  依据：${v.reason}`,
        `  他会说的话：「${v.line}」`,
      ].join('\n')
    })
    .join('\n\n')
}
