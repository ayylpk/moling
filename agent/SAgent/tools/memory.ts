/**
 * 小说长期记忆工具：给中心 Agent 提供按语义和关键词检索小说资料的入口。
 *
 * 记忆范围始终由当前 novelId 隔离；返回结果保留 sourceType/sourceId，
 * 中心 Agent 可以据此继续调用 read_entity 取完整原始资料。
 */
import { tool } from "langchain"
import type { RunnableConfig } from "@langchain/core/runnables"
import * as z from "zod"

import { memory as memoryApi, type CatalogNovel } from "../../my-app"
import { createSiliconFlowEmbeddingClient } from "../../my-app/src/shared/embedding"
import { novelIdOf, novelOf } from "./context"

const embeddingClient = createSiliconFlowEmbeddingClient()
const embedOrUndefined = async (text: string): Promise<number[] | undefined> => {
  try { return (await embeddingClient.embed([text]))[0] }
  catch { return undefined }
}

const layerEnum = z.enum(["raw", "fact", "scene", "world", "character", "plot", "chapter"])

export const searchNovelMemory = tool(
  async ({ query, layer, volumeId, chapterId, limit }, config) => {
    const embedding = await embedOrUndefined(query)
    const results = memoryApi.searchNovelMemory(novelIdOf(config), query, { layer, volumeId, chapterId, embedding, limit })
    return JSON.stringify({ query, matchMode: embedding ? "hybrid" : "keyword", results }, null, 2)
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
    const novel = novelOf(config)
    const embedding = await embedOrUndefined(`${input.title}\n${input.content}`)
    const id = memoryApi.upsertNovelMemory(novel.id, { ...input, novelId: novel.slug })
    return `【小说记忆已保存｜memory_id:${id}】\n${JSON.stringify({ title: input.title, layer: input.layer, sourceType: input.sourceType, sourceId: input.sourceId }, null, 2)}`
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
