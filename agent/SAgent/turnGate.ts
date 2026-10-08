import { ToolMessage } from '@langchain/core/messages'
import { createMiddleware } from 'langchain'

import { draft as draftApi, type DraftStage } from '../my-app'

/**
 * 阶段闸门 —— 「一轮只做一个生成阶段」的**程序层**强制。
 *
 * ── 为什么必须有这层 ──
 * 提示词里的纪律（一轮一个阶段、生成完停下等审核）是**对模型的期望**，
 * 模型会违反。这个中间件是兜底的硬边界：同一轮里第二次生成调用、或生成之后
 * 紧接着落库，都会被它拦下并收到一条明确的指令——立即停下，向作者汇报草案。
 *
 * ── 什么算"一轮" ──
 * 一次 agent.invoke。调用方（HTTP chat 路由 / run.ts）每次请求生成一个 `turnId`
 * 放进 `configurable`，闸门按 turnId 记账。没有 turnId 的调用路径（单测直调工具等）
 * 不拦 —— 闸门拦的是**对话轮次**的失控，不是所有工具使用。
 *
 * ── 拦截规则 ──
 * 1. 生成工具（generate_*）：一轮内第二次调用 → 拒绝执行，要求立即停止并汇报。
 * 2. 落库工具（save_*）：本轮已经生成过 → 拒绝（生成与落库不许同轮，采纳必须是
 *    作者看过草案之后的**下一轮**指令）。
 * 3. 落库工具（save_*）：对应的待审核草案不存在 → 拒绝（保存只能采纳已生成的草案；
 *    这是"没有作者确认过的生成结果就写正式表"在程序层的表达）。
 *
 * 拒绝的方式是返回一条 status='error' 的 ToolMessage 而不是抛异常：
 * 抛异常会炸掉整轮对话，而这里要的是模型**停下来、如实汇报**。
 */

/** 六个生成阶段对应的工具（spec：world / cast / volume-outline / chapter-outline / prose / polish）。 */
const GENERATION_TOOLS = new Set([
  'generate_world',
  'generate_character',
  'generate_location',
  'generate_outline',
  'generate_decision',
  'generate_chapter',
])

/** 生成工具的中文名（给拦截消息用的「本轮已生成过 XX」）。 */
const GENERATION_LABELS: Record<string, string> = {
  generate_world: '世界观草案',
  generate_character: '角色卡草案',
  generate_location: '地点卡草案',
  generate_outline: '卷纲草案',
  generate_decision: '角色裁决草案',
  generate_chapter: '本章正文草案',
}

/**
 * 落库工具 → 它采纳的草案阶段。
 * save_* 只能采纳对应的待审核草案；没有草案就没有可保存的东西。
 */
const SAVE_TOOL_STAGES: Record<string, DraftStage> = {
  save_world: 'world',
  save_character: 'cast',
  save_location: 'cast',
  save_volume_outline: 'volume_outline',
  save_chapter_outline: 'volume_outline',
  save_actor_decision: 'decision',
}

/** 每轮的记账。键是 turnId；量很小，超过上限就清掉最早的一半（对话轮次远达不到）。 */
const turnStates = new Map<string, { generated?: string }>()
const MAX_TRACKED_TURNS = 500

const stateFor = (turnId: string): { generated?: string } => {
  if (!turnStates.has(turnId) && turnStates.size >= MAX_TRACKED_TURNS) {
    const half = Math.floor(MAX_TRACKED_TURNS / 2)
    for (const key of [...turnStates.keys()].slice(0, half)) turnStates.delete(key)
  }
  let state = turnStates.get(turnId)
  if (!state) { state = {}; turnStates.set(turnId, state) }
  return state
}

const configurableOf = (request: { runtime?: { configurable?: Record<string, unknown> } }): Record<string, unknown> =>
  request.runtime?.configurable ?? {}

const block = (request: { toolCall: { id?: string }; tool?: { name?: string } }, content: string): ToolMessage =>
  new ToolMessage({
    content,
    tool_call_id: request.toolCall.id ?? '',
    ...(typeof request.tool?.name === 'string' ? { name: request.tool.name } : {}),
    status: 'error',
  })

export const turnGate = () =>
  createMiddleware({
    name: 'TurnGate',
    wrapToolCall: async (request, handler) => {
      const toolName = String(request.tool?.name ?? request.toolCall.name ?? '')
      const configurable = (request.runtime?.configurable ?? {}) as Record<string, unknown>
      const turnId = configurable.turnId
      // 没有 turnId = 调用方没接闸门（单测直调等）。闸门管对话轮次，不管这种路径。
      if (typeof turnId !== 'string' || !turnId) return handler(request)

      const state = stateFor(turnId)
      const novelId = configurable.novelId

      // 规则 1：一轮内第二次生成 → 停
      if (GENERATION_TOOLS.has(toolName) && state.generated) {
        return block(
          request,
          `【阶段闸门】本轮已经生成过「${GENERATION_LABELS[state.generated] ?? state.generated}」，` +
            '一轮只允许一个生成阶段，不能再发起第二个。请**立即停止调用任何工具**，' +
            '按标准格式向作者汇报这份草案（阶段/结果/状态=草案），请他审核；下一步由他发指令。',
        )
      }

      // 规则 2：生成与落库不许同轮 —— 采纳必须是作者看过草案之后的下一轮
      const saveStage = SAVE_TOOL_STAGES[toolName]
      if (saveStage && state.generated) {
        return block(
          request,
          `【阶段闸门】本轮已经生成过「${GENERATION_LABELS[state.generated] ?? state.generated}」，` +
            '生成与落库不能在同一轮完成：草案必须先交作者审核，他确认采纳后，**下一轮**才能保存。' +
            '请立即停止调用工具，按标准格式向作者汇报并请他审核。',
        )
      }

      // 规则 3：落库只能采纳已存在的待审核草案
      if (saveStage) {
        const hasDraft =
          typeof novelId === 'number' &&
          (() => { try { return draftApi.listDrafts(novelId, saveStage).length > 0 } catch { return false } })()
        if (!hasDraft) {
          return block(
            request,
            '【阶段闸门】没有待审核的草案可保存。保存只能采纳已生成、作者已确认的草案；' +
              '请先用对应的 generate_* 生成草案，交作者审核。若作者要求直接凭空写入，' +
              '请说明这条流程红线：生成 → 审核 → 采纳，一步不能少。',
          )
        }
      }

      const result = await handler(request)
      // 工具成功跑完才记账：失败的生成不算"本轮已生成"
      if (GENERATION_TOOLS.has(toolName)) state.generated = toolName
      return result
    },
  })

/** 测试用：清空记账（turnId 复用时避免串轮）。 */
export const resetTurnGate = (): void => { turnStates.clear() }
