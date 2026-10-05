import { tool } from 'langchain'
import type { RunnableConfig } from '@langchain/core/runnables'
import * as z from 'zod'
import { captureNovelEvent } from '../../storage/autoCapture'
import { openCatalogDatabase, openNovelDatabase } from '../../storage/novelDatabase'
import { createWorldRuntime, type WorldInput } from '../worldRuntime'

const novelOf = (config?: RunnableConfig): { id: number; slug: string } => {
  const id = (config?.configurable as Record<string, unknown> | undefined)?.novelId
  if (typeof id !== 'number' || !Number.isInteger(id)) throw new Error('世界观工具缺少 configurable.novelId')
  const catalog = openCatalogDatabase()
  try {
    const novel = catalog.query('SELECT slug FROM novels WHERE id = ?').get(id) as { slug: string } | null
    if (!novel) throw new Error(`小说不存在：novelId=${id}`)
    return { id, slug: novel.slug }
  } finally { catalog.close() }
}

const pack = (label: string, value: unknown): string => `【${label}】\n${JSON.stringify(value, null, 2)}`

export const saveWorld = tool(
  async (input, config) => {
    const novel = novelOf(config)
    const database = openNovelDatabase(novel.slug)
    try {
      const world = createWorldRuntime(database).create(input as WorldInput)
      void captureNovelEvent(novel.id, { title: `世界观:${world.name}:v${world.version}`, content: JSON.stringify(world), sourceType: 'world', sourceId: `world:${world.id}` }).catch(() => undefined)
      return pack('世界观已落库', { id: world.id, version: world.version, name: world.name, ruleCount: world.rules?.length ?? 0, termCount: world.terms?.length ?? 0 })
    } finally { database.close() }
  },
  {
    name: 'save_world',
    description: '保存一版小说世界观。修改世界观必须新建版本，旧版本保留；保存后自动进入小说记忆链路。',
    schema: z.object({
      name: z.string().min(1), premise: z.string().min(1),
      rules: z.array(z.object({ ability: z.string(), cost: z.string(), limit: z.string() })).optional(),
      factions: z.array(z.unknown()).optional(), places: z.array(z.unknown()).optional(),
      terms: z.array(z.object({ name: z.string(), note: z.string().optional() })).optional(),
      forbidden: z.array(z.string()).optional(),
    }),
  },
)

export const readWorld = tool(
  async (_input, config) => {
    const novel = novelOf(config)
    const database = openNovelDatabase(novel.slug)
    try { return pack('当前世界观', createWorldRuntime(database).current()) } finally { database.close() }
  },
  { name: 'read_world', description: '读取当前小说版本号最高的世界观完整内容。', schema: z.object({}) },
)

export const worldTools = [saveWorld, readWorld]
