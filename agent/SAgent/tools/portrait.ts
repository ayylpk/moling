/** 中心 Agent 调用的小说 L0/L1/L3 画像工具。 */
import { tool } from "langchain"
import type { RunnableConfig } from "@langchain/core/runnables"
import * as z from "zod"

import { createSiliconFlowEmbeddingClient } from "../../storage/embedding"
import { createPortraitPipeline } from "../../storage/portraitPipeline"
import { createMemoryAutomation } from "../../storage/memoryAutomation"
import { openCatalogDatabase, openNovelDatabase } from "../../storage/novelDatabase"

const novelSlugOf = (config?: RunnableConfig): string => {
  const id = (config?.configurable as Record<string, unknown> | undefined)?.novelId
  if (typeof id !== "number" || !Number.isInteger(id)) throw new Error("缺少 novelId：调用 SAgent 时请传 configurable.novelId。")
  const catalog = openCatalogDatabase()
  try {
    const novel = catalog.query("SELECT slug FROM novels WHERE id = ?").get(id) as { slug: string } | null
    if (!novel) throw new Error(`小说不存在：novelId=${id}`)
    return novel.slug
  } finally { catalog.close() }
}

const databaseFor = (config?: RunnableConfig) => openNovelDatabase(novelSlugOf(config))

export const recordNovelMemoryEvent = tool(
  async ({ title, content, sourceType, sourceId, characterId, volumeId, chapterId }, config) => {
    const slug = novelSlugOf(config); const database = databaseFor(config)
    try { return JSON.stringify(await createPortraitPipeline(database, createSiliconFlowEmbeddingClient()).recordEvent({ novelId: slug, title, content, sourceType, sourceId, characterId, volumeId, chapterId }), null, 2) } finally { database.close() }
  },
  {
    name: "record_novel_memory_event",
    description: "记录小说运行中的 L0 原始事件。保留原文和来源，不要把未经确认的推测写成 L1 事实。",
    schema: z.object({ title: z.string().min(1), content: z.string().min(1), sourceType: z.string().min(1), sourceId: z.string().min(1), characterId: z.number().int().positive().optional(), volumeId: z.number().int().positive().optional(), chapterId: z.number().int().positive().optional() }),
  },
)

export const recordNovelMemoryFact = tool(
  async ({ title, content, sourceType, sourceId, characterId, volumeId, chapterId, confidence }, config) => {
    const slug = novelSlugOf(config); const database = databaseFor(config)
    try { return JSON.stringify(await createPortraitPipeline(database, createSiliconFlowEmbeddingClient()).recordFact({ novelId: slug, title, content, sourceType, sourceId, characterId, volumeId, chapterId, confidence }), null, 2) } finally { database.close() }
  },
  {
    name: "record_novel_memory_fact",
    description: "记录小说 L1 原子事实或场景摘要。必须能回溯到章节、角色或 Agent 输出的来源。",
    schema: z.object({ title: z.string().min(1), content: z.string().min(1), sourceType: z.string().min(1), sourceId: z.string().min(1), characterId: z.number().int().positive().optional(), volumeId: z.number().int().positive().optional(), chapterId: z.number().int().positive().optional(), confidence: z.number().min(0).max(1).default(1) }),
  },
)

export const updateCharacterPortrait = tool(
  async ({ characterId, profile, tags, basedOnFactIds }, config) => {
    const slug = novelSlugOf(config)
    const database = openNovelDatabase(slug)
    try { return JSON.stringify(await createPortraitPipeline(database, createSiliconFlowEmbeddingClient()).updatePortrait({ novelId: slug, characterId, profile, tags, basedOnFactIds }), null, 2) } finally { database.close() }
  },
  {
    name: "update_character_portrait",
    description: "更新角色 L3 动态画像。画像表和固定角色表互补；只保存当前状态、关系和成长变化，不覆盖角色表的固定设定。必须填写用于推导画像的 L1 fact id。",
    schema: z.object({ characterId: z.number().int().positive(), profile: z.string().min(1), tags: z.array(z.string()).default([]), basedOnFactIds: z.array(z.number().int().positive()).default([]) }),
  },
)

export const captureNovelMemoryEvent = tool(
  async ({ title, content, sourceType, sourceId, characterId, volumeId, chapterId }, config) => {
    const slug = novelSlugOf(config); const database = databaseFor(config)
    try {
      return JSON.stringify(await createMemoryAutomation(database, createSiliconFlowEmbeddingClient()).capture({ novelId: slug, title, content, sourceType, sourceId, characterId, volumeId, chapterId }), null, 2)
    } finally { database.close() }
  },
  {
    name: "capture_novel_memory_event",
    description: "将世界观、角色、卷纲、章节或 Agent 决策作为 L0 原始事件自动登记，并加入待处理队列。后续由 L1 提取器生成候选事实；不会直接修改 L3 画像。",
    schema: z.object({ title: z.string().min(1), content: z.string().min(1), sourceType: z.string().min(1), sourceId: z.string().min(1), characterId: z.number().int().positive().optional(), volumeId: z.number().int().positive().optional(), chapterId: z.number().int().positive().optional() }),
  },
)

export const portraitTools = [captureNovelMemoryEvent, recordNovelMemoryEvent, recordNovelMemoryFact, updateCharacterPortrait]
