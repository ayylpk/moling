import { openCatalogDatabase, openNovelDatabase } from './novelDatabase'
import { createMemoryStore, type MemoryRecord } from './memoryStore'
import { createSiliconFlowEmbeddingClient } from './embedding'
import { createWorldRuntime, type WorldInput } from '../SAgent/worldRuntime'
import { createCharacterRuntime, type CharacterInput, type CharacterPatch } from '../SAgent/characterRuntime'
import { createLocationRuntime, type LocationInput } from '../SAgent/locationRuntime'
import { createOutlineRuntime, type AnchorInput, type VolumeOutlineInput } from '../SAgent/outlineRuntime'
import { createChapterRuntime, type ChapterOutlinePatch, type TextStage } from '../SAgent/chapterRuntime'
import {
  rememberChapterOutline,
  rememberChapterText,
  rememberCharacter,
  rememberVolumeOutline,
  rememberWorld,
  saveCharacterWithMemory,
  saveLocationWithMemory,
} from './novelEffects'
import { createSAgent } from '../SAgent'
import { readWorkflowStatus, readWorkflowSummary } from './workflowStatus'

type Novel = { id: number; slug: string; title: string; genre: string; style: string; description: string; logline: string; target_words: number; themes: string; status: string; created_at: string; updated_at: string }
type NovelCreateBody = Partial<Omit<Novel, 'id' | 'created_at' | 'updated_at'>> & { themes?: string[] | string; target_words?: number }
const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS' } })
const bad = (message: string, status = 400) => json({ message }, status)
const catalogNovel = (id: number): Novel | null => { const database = openCatalogDatabase(); try { return database.query('SELECT * FROM novels WHERE id = ?').get(id) as Novel | null } finally { database.close() } }
const listNovels = (): Novel[] => { const database = openCatalogDatabase(); try { return database.query('SELECT * FROM novels ORDER BY updated_at DESC, id DESC').all() as Novel[] } finally { database.close() } }
const embeddingClient = createSiliconFlowEmbeddingClient()
const chatAgents = new Map<number, ReturnType<typeof createSAgent>>()
const embedOrUndefined = async (input: string): Promise<number[] | undefined> => { try { return (await embeddingClient.embed([input]))[0] } catch (error) { console.warn(error instanceof Error ? error.message : error); return undefined } }

/* ==================== 公共路由辅助 ==================== */

/**
 * 打开这本小说的 per-novel 库、执行 action、关掉它。
 * 小说不存在时直接返回 404 Response —— 调用方用 isResponse 判一下就行。
 *
 * 有了它，每条路由只要写「业务」那一句；「先找小说、再开库、再关库」
 * 这段路只有一种写法，就不会出现某条路由漏关连接或开错库。
 */
const isResponse = (value: unknown): value is Response => value instanceof Response
const withNovelDb = <T>(rawId: string | undefined, action: (novel: Novel, database: ReturnType<typeof openNovelDatabase>) => T): T | Response => {
  const novel = catalogNovel(Number(rawId))
  if (!novel) return bad('小说不存在', 404)
  const database = openNovelDatabase(novel.slug)
  try { return action(novel, database) } finally { database.close() }
}

/** 章纲/卷的入参用库里的列名（snake）；转成 runtime 的驼峰 */
type VolumeBody = { no?: number; name?: string; goal?: string; from_state?: string; to_state?: string; start_chapter?: number; end_chapter?: number }
type ChapterBody = {
  volume_id?: number; volume_no?: number; index?: number; title?: string
  goal?: string; conflict?: string; hook?: string; emotion?: string; summary?: string
  place?: string; characters?: string[]; word_count_target?: number
}

const server = Bun.serve({
  port: 3000,
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS' } })
    const url = new URL(request.url); const parts = url.pathname.split('/').filter(Boolean)
    try {
      if (url.pathname === '/api/health') return json({ ok: true, storage: 'catalog + per-novel sqlite' })
      if (url.pathname === '/api/novels' && request.method === 'GET') return json(listNovels())
      if (url.pathname === '/api/novels' && request.method === 'POST') {
        const body = await request.json() as NovelCreateBody
        if (!body.slug || !body.title || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(body.slug)) return bad('slug 必须是小写字母、数字或连字符')
        const targetWords = body.target_words ?? 0
        if (!Number.isInteger(targetWords) || targetWords < 0) return bad('target_words 必须是非负整数')
        let themes = '[]'
        if (body.themes !== undefined) {
          if (Array.isArray(body.themes)) {
            if (!body.themes.every((theme) => typeof theme === 'string')) return bad('themes 必须是字符串数组')
            themes = JSON.stringify(body.themes)
          } else {
            try {
              const parsed = JSON.parse(body.themes)
              if (!Array.isArray(parsed) || !parsed.every((theme) => typeof theme === 'string')) return bad('themes 必须是字符串数组')
              themes = JSON.stringify(parsed)
            } catch { return bad('themes 必须是合法 JSON 数组') }
          }
        }
        const catalog = openCatalogDatabase()
        try { const result = catalog.query('INSERT INTO novels (slug, title, genre, style, description, logline, target_words, themes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(body.slug, body.title, body.genre ?? '', body.style ?? '', body.description ?? '', body.logline ?? '', targetWords, themes, body.status ?? 'draft'); const novel = catalog.query('SELECT * FROM novels WHERE id = ?').get(Number(result.lastInsertRowid)) as Novel; openNovelDatabase(novel.slug).close(); return json(novel, 201) } finally { catalog.close() }
      }
      if (parts[0] === 'api' && parts[1] === 'novels' && parts[2] && parts[3] === 'worlds') {
        const novel = catalogNovel(Number(parts[2])); if (!novel) return bad('小说不存在', 404)
        const database = openNovelDatabase(novel.slug)
        try {
          const runtime = createWorldRuntime(database)
          if (request.method === 'GET') return json(runtime.list())
          if (request.method === 'POST') {
            const body = await request.json() as WorldInput
            const world = runtime.create(body)
            // HTTP 落库也要进记忆链路 —— 与 save_world 工具走同一份记忆格式（见 novelEffects）
            rememberWorld(novel.id, world)
            return json(world, 201)
          }
        } finally { database.close() }
      }
      if (parts[0] === 'api' && parts[1] === 'novels' && parts[2] && parts[3] === 'chat' && request.method === 'POST') {
        const novel = catalogNovel(Number(parts[2])); if (!novel) return bad('小说不存在', 404)
        const body = await request.json() as { message?: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> }
        if (!body.message?.trim()) return bad('消息不能为空')
        const history = Array.isArray(body.history) ? body.history.filter((item) => (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string').slice(-24) : []
        const agent = chatAgents.get(novel.id) ?? createSAgent()
        chatAgents.set(novel.id, agent)
        const result = await agent.invoke({ novelId: novel.id, slug: novel.slug, messages: [...history, { role: 'user', content: body.message.trim() }] }, { configurable: { novelId: novel.id } })
        const messages = (result as { messages?: Array<{ getType?: () => string; content?: unknown }> }).messages ?? []
        const answer = [...messages].reverse().find((item) => item.getType?.() === 'ai' || typeof item.content === 'string')?.content
        return json({ message: typeof answer === 'string' ? answer : JSON.stringify(answer ?? '中心 Agent 暂无回复') })
      }
      if (parts[0] === 'api' && parts[1] === 'novels' && parts[2] && parts[3] === 'agents' && request.method === 'GET') {
        const novel = catalogNovel(Number(parts[2])); if (!novel) return bad('小说不存在', 404)
        const database = openNovelDatabase(novel.slug)
        try { return json(readWorkflowStatus(database)) } finally { database.close() }
      }
      if (parts[0] === 'api' && parts[1] === 'novels' && parts[2] && parts[3] === 'chapters' && request.method === 'GET') {
        const novel = catalogNovel(Number(parts[2])); if (!novel) return bad('小说不存在', 404); const database = openNovelDatabase(novel.slug)
        try { return json(database.query(`SELECT c.id, c.idx, c.title, c.volume_id, c.goal, c.conflict, c.hook, c.emotion, c.summary, coalesce((SELECT t.stage FROM chapter_texts t WHERE t.chapter_id = c.id AND t.stage = 'final'), (SELECT t.stage FROM chapter_texts t WHERE t.chapter_id = c.id AND t.stage = 'draft'), 'none') AS textStage FROM chapters c ORDER BY c.idx`).all()) } finally { database.close() }
      }
      if (parts[0] === 'api' && parts[1] === 'novels' && parts[2] && !parts[3] && request.method === 'GET') { const novel = catalogNovel(Number(parts[2])); return novel ? json(novel) : bad('小说不存在', 404) }
      if (parts[0] === 'api' && parts[1] === 'chapters' && parts[2] && parts[3] === 'text') {
        const chapterId = Number(parts[2]); const stage = url.searchParams.get('stage') ?? 'draft'
        for (const novel of listNovels()) {
          const database = openNovelDatabase(novel.slug)
          try {
            const runtime = createChapterRuntime(database)
            const chapter = runtime.getChapterById(chapterId)
            if (!chapter) continue
            if (request.method === 'GET') return json(database.query('SELECT * FROM chapter_texts WHERE chapter_id = ? AND stage = ?').get(chapterId, stage) ?? { chapter_id: chapterId, stage, text: '' })
            if (request.method === 'PUT') {
              const body = await request.json() as { text?: string; summary?: string; ends_with?: string }
              // 走 runtime 落库，不再内联 SQL —— 顺手把「手写终稿」也接进记忆链路
              // （与 generate_chapter 落 final 用同一份格式，见 novelEffects 的 rememberChapterText）
              runtime.saveText(chapter.idx, { stage: stage as TextStage, text: body.text ?? '', summary: body.summary, endsWith: body.ends_with })
              rememberChapterText(novel.id, { chapterId, chapterIdx: chapter.idx, stage, text: body.text ?? '', summary: body.summary, endsWith: body.ends_with })
              return json(runtime.getText(chapter.idx, stage as TextStage))
            }
          } finally { database.close() }
        }
        return bad('章节不存在', 404)
      }
      if (parts[0] === 'api' && parts[1] === 'novels' && parts[2] && parts[3] === 'memories') {
        const novel = catalogNovel(Number(parts[2])); if (!novel) return bad('小说不存在', 404)
        const database = openNovelDatabase(novel.slug)
        try {
          const store = createMemoryStore(database)
          if (request.method === 'POST') {
            const body = await request.json() as MemoryRecord
            if (!body.layer || !body.title || !body.content || !body.sourceType || !body.sourceId) return bad('记忆条目缺少 layer、title、content、sourceType 或 sourceId')
            const embedding = body.embedding ?? await embedOrUndefined(`${body.title}\n${body.content}`)
            return json(store.upsert({ ...body, novelId: novel.slug, embedding }), 201)
          }
          if (request.method === 'GET') {
            const query = url.searchParams.get('q') ?? ''
            if (!query.trim()) return bad('缺少查询参数 q')
            const parseOptionalNumber = (value: string | null): number | undefined => value == null ? undefined : Number(value)
            const embedding = await embedOrUndefined(query)
            return json(store.search({ novelId: novel.slug, query, volumeId: parseOptionalNumber(url.searchParams.get('volumeId')), chapterId: parseOptionalNumber(url.searchParams.get('chapterId')), embedding, limit: Number(url.searchParams.get('limit') ?? 10) }))
          }
        } finally { database.close() }
      }
      if (parts[0] === 'api' && parts[1] === 'novels' && parts[2] && parts[3] === 'portraits' && request.method === 'GET') {
        const novel = catalogNovel(Number(parts[2])); if (!novel) return bad('小说不存在', 404)
        const database = openNovelDatabase(novel.slug)
        try {
          return json(database.query(`SELECT p.*, c.name AS character_name FROM character_portraits p LEFT JOIN characters c ON c.id = p.character_id WHERE p.version = (SELECT max(p2.version) FROM character_portraits p2 WHERE p2.novel_id = p.novel_id AND p2.character_id = p.character_id) ORDER BY p.character_id`).all())
        } finally { database.close() }
      }
      /* ==================== 工作流摘要 ==================== */
      if (parts[0] === 'api' && parts[1] === 'novels' && parts[2] && parts[3] === 'workflow' && request.method === 'GET') {
        // 只回简化结构（阶段 + 各阶段计数），不回 generation_tasks 的原始字段 —— 那是内部实现
        return withNovelDb(parts[2], (_novel, database) => json(readWorkflowSummary(database)))
      }

      /* ==================== 角色 ==================== */
      if (parts[0] === 'api' && parts[1] === 'novels' && parts[2] && parts[3] === 'characters') {
        const characterId = parts[4]
        if (request.method === 'PUT' && characterId) {
          const patch = await request.json() as CharacterPatch
          return withNovelDb(parts[2], (novel, database) => {
            const updated = createCharacterRuntime(database).update(Number(characterId), patch)
            if (!updated) return bad('角色不存在', 404)
            // 改卡也是一次落库：不记的话，改完这条事实在记忆里就不存在
            rememberCharacter(novel.id, updated)
            return json(updated)
          })
        }
        if (request.method === 'POST' && !characterId) {
          const body = await request.json() as CharacterInput
          return withNovelDb(parts[2], (novel, database) => {
            // 与 save_character 工具同一个入口：落库 + 回填章纲里的出场引用 + 发记忆
            const saved = saveCharacterWithMemory(database, novel.id, body)
            // 201 = 新建，200 = 同名卡已存在（没有重复建）
            return json(saved.character, saved.created ? 201 : 200)
          })
        }
        if (request.method === 'GET' && !characterId) {
          return withNovelDb(parts[2], (_novel, database) => json(createCharacterRuntime(database).list()))
        }
      }

      /* ==================== 地点 ==================== */
      if (parts[0] === 'api' && parts[1] === 'novels' && parts[2] && parts[3] === 'locations') {
        if (request.method === 'GET') return withNovelDb(parts[2], (_novel, database) => json(createLocationRuntime(database).list()))
        if (request.method === 'POST') {
          const body = await request.json() as LocationInput
          return withNovelDb(parts[2], (novel, database) => {
            // 与 save_location 工具同一个入口：落库 + 回填挂在它名下的子地点 + 发记忆
            const saved = saveLocationWithMemory(database, novel.id, body)
            return json(saved.location, saved.created ? 201 : 200)
          })
        }
      }

      /* ==================== 大纲（锚点 + 卷纲） ==================== */
      if (parts[0] === 'api' && parts[1] === 'novels' && parts[2] && parts[3] === 'outline') {
        if (request.method === 'GET') {
          return withNovelDb(parts[2], (_novel, database) => {
            const runtime = createOutlineRuntime(database)
            return json({ anchor: runtime.currentAnchor(), volumeOutlines: runtime.listVolumeOutlines(), driftedVolumeIds: runtime.listDriftedVolumeIds() })
          })
        }
        if (request.method === 'POST') {
          const body = await request.json() as { anchor?: AnchorInput; volumeOutline?: VolumeOutlineInput }
          if (!body?.anchor && !body?.volumeOutline) return bad('请求体至少要有 anchor 或 volumeOutline')
          return withNovelDb(parts[2], (novel, database) => {
            const runtime = createOutlineRuntime(database)
            // 一次要写两张表（锚点 + 卷纲）就包一个事务：半成品的锚点比没锚点更难查
            const result = database.transaction(() => ({
              anchor: body.anchor ? runtime.saveAnchor(body.anchor) : null,
              outline: body.volumeOutline ? runtime.saveVolumeOutline(body.volumeOutline) : null,
            }))()
            // 卷纲同样要进记忆链路（工具层的 save_volume_outline 会记，这里不能漏）
            if (result.outline) {
              const outline = result.outline.outline
              const volume = createChapterRuntime(database).listVolumes().find((v) => v.id === outline.volumeId)
              rememberVolumeOutline(novel.id, {
                volumeId: outline.volumeId,
                volumeName: volume?.name ?? `第${outline.volumeId}卷`,
                volume: { id: outline.volumeId, name: volume?.name ?? '', no: volume?.no },
                direction: body.anchor,
                structureType: outline.structureType,
                acts: outline.acts,
              })
            }
            return json(result, 201)
          })
        }
      }

      /* ==================== 卷 ==================== */
      if (parts[0] === 'api' && parts[1] === 'novels' && parts[2] && parts[3] === 'volumes') {
        if (request.method === 'GET') {
          return withNovelDb(parts[2], (_novel, database) => {
            const chapters = createChapterRuntime(database)
            const outlined = new Set(createOutlineRuntime(database).listVolumeOutlines().map((item) => item.volumeId))
            // hasOutline 现算，卷表上没有这一列（存副本就会和事实不同步）
            return json(chapters.listVolumes().map((volume) => ({ ...volume, hasOutline: outlined.has(volume.id) })))
          })
        }
        if (request.method === 'POST') {
          const body = await request.json() as VolumeBody
          return withNovelDb(parts[2], (_novel, database) => {
            const created = createChapterRuntime(database).createVolume({
              no: Number(body.no),
              name: String(body.name ?? ''),
              goal: body.goal,
              fromState: body.from_state,
              toState: body.to_state,
              startChapter: Number(body.start_chapter),
              endChapter: Number(body.end_chapter),
            })
            return json(created, created.created ? 201 : 200)
          })
        }
      }

      /* ==================== 章纲（新增 / 修改） ==================== */
      if (parts[0] === 'api' && parts[1] === 'novels' && parts[2] && parts[3] === 'chapters' && request.method === 'POST') {
        const body = await request.json() as ChapterBody
        return withNovelDb(parts[2], (novel, database) => {
          const runtime = createChapterRuntime(database)
          const volumeId = body.volume_id ?? (body.volume_no === undefined ? undefined : runtime.getVolumeByNo(Number(body.volume_no))?.id)
          if (volumeId === undefined) return bad('缺少 volume_id（或 volume_no），或该卷不存在')
          const saved = runtime.saveChapterOutline(volumeId, {
            index: Number(body.index),
            title: String(body.title ?? ''),
            goal: body.goal,
            conflict: body.conflict,
            hook: body.hook,
            emotion: body.emotion,
            summary: body.summary,
            place: body.place,
            characters: body.characters,
            wordCountTarget: body.word_count_target,
          })
          rememberChapterOutline(novel.id, saved.chapter, volumeId)
          return json(saved, 201)
        })
      }

      if (parts[0] === 'api' && parts[1] === 'chapters' && parts[2] && !parts[3] && request.method === 'PUT') {
        // 章纲补丁的字段名：库/前端用 snake（word_count_target），runtime 内部是驼峰 —— 在这里对齐一次
        const raw = await request.json() as ChapterOutlinePatch & { word_count_target?: number }
        const { word_count_target: snakeTarget, ...rest } = raw
        const patch: ChapterOutlinePatch = { ...rest, wordCountTarget: raw.wordCountTarget ?? snakeTarget }
        const chapterId = Number(parts[2])
        // 章 id 不带宽表，得挨本找它属于哪本书（与 /api/chapters/:id/text 同一种做法）
        for (const novel of listNovels()) {
          const database = openNovelDatabase(novel.slug)
          try {
            const runtime = createChapterRuntime(database)
            if (!runtime.getChapterById(chapterId)) continue
            const updated = runtime.updateChapter(chapterId, patch)
            if (updated) rememberChapterOutline(novel.id, updated, updated.volumeId)
            return json(updated)
          } finally { database.close() }
        }
        return bad('章节不存在', 404)
      }

      return bad('接口不存在', 404)
    } catch (error) {
      const message = error instanceof Error ? error.message : '服务器错误'
      // runtime 的入参校验一律抛 TypeError —— 那是 400（请求不对），不是 500（服务器炸了）
      return bad(message, error instanceof TypeError ? 400 : 500)
    }
  },
})
console.log(`墨灵 API 已启动：http://localhost:${server.port}`)
