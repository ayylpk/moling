/**
 * SAgent —— 中心 agent 的封装。
 *
 * ── 它是什么 ──
 * 唯一与作者对话的角色，也是唯一的编排者。
 * 手上是**生成 + 落库/读取 + 记忆/画像**这几组工具（见 ./tools/cleanIndex.ts 的那份清单）。
 * 五个生成工具都已挂上：世界观 / 角色 / 地点 / 大纲 / 裁决。
 * 注意分工：生成类工具**不写库**，落库是中心 Agent 自己的决定（generate_* → 判断 → save_*）。
 * 注意：**所有工具都是它的**，只是有的还没接上；不存在"属于子 agent 的工具"。
 * 它自己不写一个字设定、大纲、正文——只决定这一步该谁做。
 *
 * ── 记忆与上下文（用户 2026-10-03 明确的四条要求，逐条落在这里）──
 *
 * ① 工具平时返回「内容类型 + 全部内容」——见 ./tools/context.ts 的 pack()。
 *
 * ② **一章生成完之后**才做概括压缩：把该章那些超长的工具结果
 *    （正文全文、润色全文）降级成「摘要 + 类型标记」。
 *    实现 = chapterArtifactCompaction()，它只在"最近 N 条工具结果之后"
 *    的回看窗口里动刀，且只对超长内容动手。
 *
 * ③ 上下文到 **80%** 时启动全量压缩，此间不产出任何内容、不调任何子 agent。
 *    实现 = LangChain 的 summarizationMiddleware，`summaryPrompt` 换成
 *    ./compact.ts 里的 COMPACT_PROMPT（analysis + summary 两段，顺序固定）。
 *    它在 beforeModel 阶段跑，模型还没机会调工具，所以天然满足"停止所有内容"。
 *
 * ④ 子 agent 的产出会作为 tool message 留在对话里——这就是"合并回中心"。
 *    全量压缩时，COMPACT_PROMPT 的第 3、4 节要求把"有哪些角色、写到第几章"
 *    抄进 summary，所以即便原文被压掉，接任者仍然知道场上有谁、进行到哪。
 *
 * ── 上下文窗口常量为什么可配 ──
 * token 计数是近似的（中文 ≈ 0.7 token/字），不同模型窗口也不同。
 * 与其写死一个数字骗自己，不如把窗口和触发比例做成环境变量，
 * 跑起来之后按实际情况调。
 */
import { createAgent, summarizationMiddleware } from "langchain"
import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { RemoveMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages"

import { createModel } from "../create_model"
import { SAGENT_PROMPT } from "./prompt"
import { COMPACT_PROMPT } from "./compact"
import { NovelState, novelStateSync } from "./stateLite"
import { memoryTools, portraitTools, generateChapterTool, worldTools, characterTools, locationTools, outlineTools, chapterOutlineTools, decisionTools, generateWorld, generateCharacter, generateLocation, generateOutline, generateDecision } from "./tools/cleanIndex"

/* ==================== 可配常量 ==================== */

/** 模型上下文窗口（token）。当前按 DeepSeek 的 256K 算。 */
const CONTEXT_WINDOW = Number(process.env.SAGENT_CONTEXT_WINDOW ?? 256_000)

/** 压缩触发比例。用户要求：到 80% 启动。 */
const COMPACT_TRIGGER_RATIO = Number(process.env.SAGENT_COMPACT_RATIO ?? 0.8)

/** 压缩后保留最近多少条消息（不参与压缩的那一段）。 */
const KEEP_MESSAGES = Number(process.env.SAGENT_KEEP_MESSAGES ?? 24)

/** 章级降级：最近多少条工具结果保持原样。 */
const ARTIFACT_KEEP_RECENT = Number(process.env.SAGENT_ARTIFACT_KEEP ?? 8)

/** 章级降级：超过多少字符的工具结果才会被降级。 */
const ARTIFACT_MAX_CHARS = Number(process.env.SAGENT_ARTIFACT_MAX_CHARS ?? 3_000)

/** 降级后保留的头部字数。 */
const ARTIFACT_HEAD_CHARS = Number(process.env.SAGENT_ARTIFACT_HEAD ?? 200)

export const CONTEXT_BUDGET = {
  window: CONTEXT_WINDOW,
  triggerAt: Math.floor(CONTEXT_WINDOW * COMPACT_TRIGGER_RATIO),
  keepMessages: KEEP_MESSAGES,
}

/**
 * 单次 invoke 允许的**图步数**上限。
 *
 * LangGraph 默认 **25** —— 那个数字是给"一问一答"的 ReAct 用的，中心 agent 不适用：
 * 它一轮里要连调若干子 agent 再落库，而**一次工具调用算两步**（模型一步、工具一步），
 * 25 步只够十来次工具调用。实测就是：作者一条指令说"立世界观 + 排大纲"，
 * 走到一半抛 `Recursion limit of 25 reached without hitting a stop condition`。
 *
 * 给 **200**（≈95 次工具调用）：够把「世界观 → 角色 → 大纲 → 章纲」一整条链走完。
 * 60 不够 —— 实测卡在"世界观建完、正文还没开始"的位置，作者看到的是刚要成功就停了。
 *
 * ── 更正上一轮我说过的一句 ──
 * 我当时说"一轮跑太久作者看不到进度、也取消不了"，那句是错的：
 * 执笔模式的夜案画布**每 5 秒**重取一次 `/workflow`，六盏灯会跟着亮，
 * 所以长轮次期间是有进度可见的 —— 这正是不限步数变得可接受的前提。
 *
 * 仍然要留着这个刹车：它是**循环失控**的兜底，不是配额。
 * 撞上限时的损失也比想象中小 —— 每次工具调用是独立开库落库再关库的，
 * **已经写进库的东西不会丢**，重发一条指令就能接着往下做。
 */
export const SAGENT_RECURSION_LIMIT = 200

/* ==================== token 估算 ==================== */

/**
 * 近似 token 计数。
 *
 * 中文实测约 0.7 token/字，英文约 4 字符/token。这里统一按 0.7 估，
 * 偏保守（宁可早压缩，不要撞上限被截断——截断是静默的，比早压缩危险得多）。
 *
 * 为什么自己写而不用官方计数器：DeepSeek 没有 tokenizer 的 JS 实现，
 * 为一个估算值装一个包不划算。它是**触发阈值**用的，不需要精确。
 */
export function estimateTokens(messages: BaseMessage[]): number {
  let chars = 0
  for (const m of messages) {
    // content 的联合类型很复杂（string | 各种 content block 数组），
    // 先收成 unknown 再逐层 narrow，避免被推断成 never。
    const raw = m.content as unknown
    if (typeof raw === "string") {
      chars += raw.length
    } else if (Array.isArray(raw)) {
      for (const part of raw as unknown[]) {
        if (typeof part === "string") chars += part.length
        else if (part && typeof part === "object" && "text" in part) {
          chars += String((part as { text: unknown }).text ?? "").length
        }
      }
    }
    if (typeof m.name === "string") chars += m.name.length
  }
  return Math.ceil(chars * 0.7)
}

/* ==================== 章级降级（要求 ②）==================== */

/**
 * 一章写完之后的概括压缩。
 *
 * 做法：保留最近 N 条工具结果原样，更早的、超过 M 字符的，
 * 删掉原文、换成一行的「已归档 + 头部摘要 + 取回方式」。
 *
 * 为什么是"最近 N 条"而不是精确到"这一章"：
 * 工具层拿不到"章写完了"这个语义，硬去猜（扫 save_chapter_text 的返回）
 * 一旦猜错就会把正在用的资料删掉，而**删错是不可逆的**。
 * 回看窗口的边界是钝的，但它永远不会删掉刚拿到的东西——宁可晚一点收，
 * 也不要收错。
 *
 * 出错一律放弃（返回 undefined）而不是抛出：上下文管理是优化项，
 * 它挂掉不该让整个 agent 停摆。
 */
export function chapterArtifactCompaction(opts?: {
  keepRecent?: number
  maxChars?: number
  headChars?: number
}) {
  const keepRecent = opts?.keepRecent ?? ARTIFACT_KEEP_RECENT
  const maxChars = opts?.maxChars ?? ARTIFACT_MAX_CHARS
  const headChars = opts?.headChars ?? ARTIFACT_HEAD_CHARS

  return {
    name: "ChapterArtifactCompaction",
    beforeModel: (state: { messages?: BaseMessage[] }) => {
      try {
        const messages = state.messages ?? []
        const toolPositions: number[] = []
        for (let i = 0; i < messages.length; i++) {
          if (messages[i]?.getType?.() === "tool") toolPositions.push(i)
        }
        if (toolPositions.length <= keepRecent) return undefined

        const boundary = toolPositions[toolPositions.length - keepRecent]
        if (boundary === undefined) return undefined

        const removals: RemoveMessage[] = []
        const replacements: ToolMessage[] = []

        for (const i of toolPositions) {
          if (i >= boundary) break
          const m = messages[i]
          if (!m) continue
          const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")
          // 短的留着（小结果不占地方，删了反而丢信息）
          if (text.length <= maxChars) continue
          // 已经降级过的跳过，避免反复处理
          if (text.startsWith("【已归档】")) continue

          const id = m.id
          if (!id) continue
          const toolCallId = (m as ToolMessage).tool_call_id
          if (!toolCallId) continue

          removals.push(new RemoveMessage({ id }))
          replacements.push(
            new ToolMessage({
              content:
                `【已归档】${text.slice(0, headChars)}…\n` +
                `（原文共 ${text.length} 字，已从上下文移出以免撑爆窗口。` +
                `需要细节时用 read_entity / read_index 按 id 重新取。）`,
              tool_call_id: toolCallId,
            }),
          )
        }

        if (removals.length === 0) return undefined
        return { messages: [...removals, ...replacements] }
      } catch {
        // 降级失败不影响主流程
        return undefined
      }
    },
  }
}

/* ==================== 组装 ==================== */

/**
 * 造一个 SAgent。
 *
 * @param model 中心 agent 自己用的模型。默认 0.3——它的活是裁决与编排，
 *              不是创作，温度高了会把派活顺序排乱。
 */
export function createSAgent(model: BaseChatModel = createModel(0.3)) {
  return createAgent({
    model,
    systemPrompt: SAGENT_PROMPT,
    tools: [
      // 生成类：调子 agent 产出内容，**不写库**（草案回到中心，采纳与否由它判断）
      // generate_world 排在第一位：它是整条链的起点，其余四个都以世界观为硬约束
      generateWorld,
      generateCharacter,
      generateLocation,
      generateOutline,
      generateDecision,
      // 正文：一步到底（执笔 + 润色 + 落库），内部自己管任务表，不另暴露调度工具
      generateChapterTool,
      // 落库 / 读取：当前小说的 per-novel 库
      ...worldTools,
      ...characterTools,
      ...locationTools,
      ...outlineTools,
      ...chapterOutlineTools,
      ...decisionTools,
      // 记忆与画像
      ...memoryTools,
      ...portraitTools,
    ],
    // 状态：小说创作该有的东西（阶段 / 进度 / 场上实体 / 待办 / 任务）
    // 它是**缓存**——真身在数据库，每次调模型前由 novelStateSync 重新推导，见 ./stateLite.ts
    stateSchema: NovelState,
    middleware: [
      // ① 状态同步：把状态刷成库里的实际情况
      //    放在最前面——后面两个中间件要按真实进度做判断
      novelStateSync(),
      // ② 章级：超长的工具结果降级成摘要
      chapterArtifactCompaction(),
      // ③ 窗口级：到 80% 全量压缩，用自定义的两段式提示词
      summarizationMiddleware({
        // 压缩是纯归纳活，温度给低
        model: createModel(0.2),
        trigger: { tokens: CONTEXT_BUDGET.triggerAt },
        keep: { messages: KEEP_MESSAGES },
        summaryPrompt: COMPACT_PROMPT,
        tokenCounter: estimateTokens,
        summaryPrefix: "[前情提要]\n\n",
      }),
    ],
    name: "SAgent",
    description:
      "中心 agent。唯一与作者对话、也是唯一做编排的角色。" +
      "它自己产出任何设定/大纲/正文，只决定每一步该调哪个子 agent、以及把结果落到库里的哪张表。",
  })
}

/**
 * 默认单例。
 *
 * 注意它依赖环境变量里的 API key——没有 key 时返回 undefined，
 * 让调用方自己决定怎么处理（本项目其它 agent 也是这个约定）。
 */
export const sAgent =
  process.env.DEEPSEEK_API_KEY ||
  process.env.ANTHROPIC_AUTH_TOKEN ||
  process.env.API_KEY
    ? createSAgent()
    : undefined
