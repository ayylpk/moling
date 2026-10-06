import { createDecisionRuntime, type DecisionInput } from '../db/actorDecisionDB'
import { saveActorDecisionWithMemory } from '../service/entityService'
import { withNovel } from './withNovel'

/**
 * 角色裁决 controller —— 一个动作一次调用。
 *
 * prompt_hash 相同就直接复用旧记录（reused=true），不重复问 Actor、不新增行。
 * 复用时照样发记忆：记忆按 sourceId 去重，不会重复堆。
 */
export const saveActorDecision = (novelId: number, input: DecisionInput) =>
  withNovel(novelId, (database) => saveActorDecisionWithMemory(database, novelId, input))

/** 某一章的全部裁决 */
export const listActorDecisions = (novelId: number, chapterIdx: number) =>
  withNovel(novelId, (database) => createDecisionRuntime(database).list(chapterIdx))

/**
 * 给执笔用的裁决文本。
 *
 * 以前这个拼装散在 writer 的调用处，现在收在这里：Actor 的答案经裁决表进正文，
 * 这条缝只有一个出口，格式才不会在两个地方各写一遍。
 */
export const buildChapterDecisionsText = (novelId: number, chapterIdx: number) =>
  withNovel(novelId, (database) => createDecisionRuntime(database).buildDecisionsText(chapterIdx))
