import type { RunnableConfig } from '@langchain/core/runnables'

import { listNovelsInCatalog, type CatalogNovel } from '../../my-app'
import type { Flavor } from '../../skills'

/**
 * tool 层的公共上下文 —— 拆到 my-app 之后这里只剩三件事。
 *
 * 以前这里还有 `withNovelDatabase`（自己开库）和 `rememberNovelEvent`（自己发记忆）。
 * 现在两样都不在了，因为它们的职责已经下沉：
 *   · 开库关库 → my-app 的 controller（每个动作自己开自己关）
 *   · 发记忆   → my-app 的 service（和落库、回填绑在一起，不会漏）
 *
 * 留下的只有 tool 自己的事：**从调用上下文认出这是哪本书**，以及**把结果包成给人看的样子**。
 *
 * 工具里出现 SQL 仍然是走错了 —— 现在唯一能写 SQL 的地方是 my-app/src/db。
 */

/** 从调用上下文取 novelId。拿不到就直接失败，不要猜、不要回落到"第一本" */
export const novelIdOf = (config?: RunnableConfig): number => {
  const id = (config?.configurable as Record<string, unknown> | undefined)?.novelId
  if (typeof id !== 'number' || !Number.isInteger(id)) {
    throw new Error('缺少小说上下文：调用中心 Agent 时请在 config 里传 `configurable: { novelId }`。')
  }
  return id
}

/** 这本书的元数据（书名 / 题材 / 文风…）。走 my-app 门面，不在这里开库 */
export const novelOf = (config?: RunnableConfig): CatalogNovel => {
  const id = novelIdOf(config)
  const found = listNovelsInCatalog().find((novel) => novel.id === id)
  if (!found) throw new Error(`小说不存在：novelId=${id}`)
  return found
}

/**
 * 这本书的「文风 + 类型」，给 createXxxAgent 的第二个参数。
 *
 * ── 为什么所有生成工具都要过这里 ──
 * style 与 genre 是**建书时作者定的**，不是生成时临时想的。散在 5 个工具里各写一遍
 * `createAgent(undefined, { style: novel.style, genre: novel.genre })`，
 * 下一个新工具就会忘 —— 那个工具产出的东西就少了文风，而它自己不报错，
 * 只是读起来"不太像这本书"。收在一处之后，漏掉的成本变成"这个工具用不了这个函数"。
 *
 * 值是自由文本：命中 skills 目录就用片段，不命中就把原文当说明用（见 loader）。
 */
export const flavorOf = (config?: RunnableConfig): Flavor => {
  const novel = novelOf(config)
  return { style: novel.style, genre: novel.genre }
}

/** 工具的返回格式：一顶 label + 内容。工具结果最终会进中心上下文，别塞全文 */
export const pack = (label: string, value: unknown): string =>
  `【${label}】\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`

/**
 * 把 per-novel 的世界观渲染成**子 agent 看得懂的紧凑文本**。
 *
 * 实现住进了 my-app（service/worldText.ts）—— 草案生成服务（HTTP 按钮）与这里的
 * 四个生成工具喂给子 agent 的必须是同一段文本，两处各写一遍迟早有一处漏掉「代价」。
 * 这里只是转出口，原有引用（./generateCharacter 等）不用改。
 */
export { renderWorldText as renderWorld } from '../../my-app/src/service/worldText'
