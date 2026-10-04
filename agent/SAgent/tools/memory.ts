/**
 * 小说长期记忆工具：给中心 Agent 提供按语义和关键词检索小说资料的入口。
 *
 * 记忆范围始终由当前 novelId 隔离；返回结果保留 sourceType/sourceId，
 * 中心 Agent 可以据此继续调用 read_entity 取完整原始资料。
 */
import { tool } from "langchain"
import type { RunnableConfig } from "@langchain/core/runnables"
import * as z from "zod"

import { createSiliconFlowEmbeddingClient } from "../../storage/embedding"
import { createMemoryStore, type MemoryLayer, type MemoryRecord } from "../../storage/memoryStore"
import { openCatalogDatabase, openNovelDatabase } from "../../storage/novelDatabase"

function novelIdOf(config?: RunnableConfig): number {
  const id = (config?.configurable as Record<string, unknown> | undefined)?.novelId
  if (typeof id !== "number" || !Number.isInteger(id)) throw new Error("缺少 novelId：调用 SAgent 时请在 config 里传 configurable.novelId。")
  return id
}

function novelSlugOf(novelId: number): string {
  const database = openCatalogDatabase()
  try {
    const novel = database.query("SELECT slug FROM novels WHERE id = ?").get(novelId) as { slug: string } | null
    if (!novel) throw new Error(`小说不存在：novelId=${novelId}`)
    return novel.slug
  } finally { database.close() }
}

const embeddingClient = createSiliconFlowEmbeddingClient()
const embedOrUndefined = async (text: string): Promise<number[] | undefined> => {
  try { return (await embeddingClient.embed([text]))[0] }
  catch { return undefined }
}

const layerEnum = z.enum(["raw", "fact", "scene", "world", "character", "plot", "chapter"])

export const searchNovelMemory = tool(
  async ({ query, layer, volumeId, chapterId, limit }, config) => {
    const slug = novelSlugOf(novelIdOf(config))
    const database = openNovelDatabase(slug)
    try {
      const embedding = await embedOrUndefined(query)
      const store = createMemoryStore(database)
      const results = store.search({ novelId: slug, query, layer: layer as MemoryLayer | undefined, volumeId, chapterId, embedding, limit })
      return JSON.stringify({ query, matchMode: embedding ? "hybrid" : "keyword", results: results.map(({ embedding: _embedding, ...result }) => result) }, null, 2)
    } finally { database.close() }
  },
  {
    name: "search_novel_memory",
    description:
      "检索当前小说的长期记忆，使用关键词 + 向量混合召回。适合写大纲、角色、世界观、剧情或章节前查询已确定事实。" +
      "可按 layer（world/character/plot/chapter 等）、volumeId、chapterId 限定范围。" +
      "返回内容同时带 sourceType/sourceId 证据来源；需要完整资料时，再调用 read_entity。" +
      "不要把不同小说的资料混用；当前小说由 configurable.novelId 自动隔离。",
    schema: z.object({
      query: z.string().min(1).describe("要回忆的剧情事实、角色行为、世界规则或章节上下文。"),
      layer: layerEnum.optional().describe("记忆层：world=世界观，character=角色，plot=剧情，chapter=章节，scene=场景，fact=原子事实。"),
      volumeId: z.number().int().positive().optional().describe("只检索指定卷。"),
      chapterId: z.number().int().positive().optional().describe("只检索指定章节。"),
      limit: z.number().int().min(1).max(20).default(8).describe("最多返回多少条，默认 8。"),
    }),
  },
)

export const rememberNovelMemory = tool(
  async (input, config) => {
    const slug = novelSlugOf(novelIdOf(config))
    const database = openNovelDatabase(slug)
    try {
      const record: MemoryRecord = { ...input, novelId: slug, layer: input.layer as MemoryLayer }
      const embedding = await embedOrUndefined(`${record.title}\n${record.content}`)
      const id = createMemoryStore(database).upsert({ ...record, embedding })
      return `【小说记忆已保存｜memory_id:${id}】\n${JSON.stringify({ title: record.title, layer: record.layer, sourceType: record.sourceType, sourceId: record.sourceId }, null, 2)}`
    } finally { database.close() }
  },
  {
    name: "remember_novel_memory",
    description:
      "把经过确认的小说事实写入长期记忆。用于保存世界规则、角色硬约束、剧情转折、章节摘要等，" +
      "必须填写来源 sourceType/sourceId，避免把模型猜测当成事实。相同来源会覆盖更新。",
    schema: z.object({
      layer: layerEnum.describe("记忆层。"),
      title: z.string().min(1).describe("记忆标题。"),
      content: z.string().min(1).describe("可供后续写作检索的事实内容。"),
      sourceType: z.string().min(1).describe("来源类型，例如 world、character、chapter、agent。"),
      sourceId: z.string().min(1).describe("来源 id，例如 world:3、character:12、chapter:8。"),
      volumeId: z.number().int().positive().optional(),
      chapterId: z.number().int().positive().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
  },
)

export const memoryTools = [searchNovelMemory, rememberNovelMemory]
