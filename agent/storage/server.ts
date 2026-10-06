import {
  catalog,
  chapter as chapterApi,
  character as characterApi,
  location as locationApi,
  memory as memoryApi,
  outline as outlineApi,
  workflow as workflowApi,
  world as worldApi,
  type ChapterOutlineInput,
  type ChapterOutlinePatch,
  type TextStage,
  type WorldInput,
  type NovelCreateInput,
  type CharacterInput,
  type CharacterPatch,
  type LocationInput,
} from '../my-app'
import { createSAgent } from '../SAgent'

/**
 * HTTP 传输层 —— **只做传输**。
 *
 * 这里不写 SQL、不开库、不发记忆、不做业务判断。要做的那几件事都在
 * `agent/my-app/` 后面：index.ts（门面）→ controller → service → db → SQLite。
 *
 * 写完这个文件如果发现自己在 `import createXxxRuntime`，说明分层漏了 ——
 * 上一版就是这么长出 14 处越级 import 的，路由自己开库、自己记记忆，
 * 于是「走 HTTP 落库不进记忆链路」这种分叉迟早出现。
 * 现在每条路由要做的事只有一件：**把请求变成一个门面调用，把结果变成 JSON**。
 */

/** 路由动作可能「什么都没找到」，用 null 表达，别用 Response 混在返回值里 */
const notFound = (message: string) => ({ __notFound: message })
const isNotFound = (value: unknown): value is { __notFound: string } =>
  typeof value === 'object' && value !== null && '__notFound' in value

const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS' } })
const bad = (message: string, status = 400) => json({ message }, status)

/** novelId 有效吗 —— 路径里的 :id 在这里是字符串 */
const novelIdOf = (raw: string | undefined): number => {
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) throw new TypeError('缺少有效的 novelId')
  if (!catalog.getNovel(id)) throw new Error(`小说不存在：novelId=${id}`)
  return id
}

/**
 * 可选的 novelId（来自 `?novelId=`）—— 给那些**只有 chapterId** 的接口用。
 *
 * chapterId 是每本书各自从 1 开始的自增主键，多本书之间会撞。
 * 所以正文/章纲这三个接口必须能说清"是哪本书的第几章"；说不清就不猜，报 400。
 */
const novelIdHint = (url: URL): number | undefined => {
  const raw = url.searchParams.get('novelId')
  if (raw === null) return undefined
  return novelIdOf(raw)
}

/** 章纲/卷的入参用库里的列名（snake）；转成 db 层入参（camel）。字段名在这里对齐一次。 */
type VolumeBody = { no?: number; name?: string; goal?: string; from_state?: string; to_state?: string; start_chapter?: number; end_chapter?: number }
type ChapterBody = {
  volume_id?: number; volume_no?: number; index?: number; title?: string
  goal?: string; conflict?: string; hook?: string; emotion?: string; summary?: string
  place?: string; characters?: string[]; word_count_target?: number
  /** 批量：一次落一整卷。与工具层 save_chapter_outline 的入参一致 */
  chapters?: ChapterBody[]
}

const toChapterInput = (body: ChapterBody): ChapterOutlineInput => ({
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

/** 聊天用的 agent 按小说缓存：会话状态在 agent 内部，重建就丢上下文了 */
const chatAgents = new Map<number, ReturnType<typeof createSAgent>>()

const server = Bun.serve({
  port: 3000,
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS' } })
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)
    const novelPath = parts[0] === 'api' && parts[1] === 'novels' && parts[2] !== undefined

    try {
      if (url.pathname === '/api/health') return json({ ok: true, storage: 'catalog + per-novel sqlite' })

      /* ==================== 书架 ==================== */
      // 文风与类型的可选项放在最前面：前端建书表单要靠它渲染下拉，
      // 而这个清单会随 agent/skills/ 下的目录变化而变，不该写死在前端
      if (url.pathname === '/api/flavors' && request.method === 'GET') return json(catalog.listFlavors())
      if (parts[0] === 'api' && parts[1] === 'novels' && !parts[2]) {
        if (request.method === 'GET') return json(catalog.listNovels())
        if (request.method === 'POST') {
          const body = await request.json() as NovelCreateInput
          const created = catalog.createNovel(body)
          // 建书成功之后把「你是不是想写这个」带回去：拼错目录名不会报错，
          // 但这本书就完全没有文风。**在返回值里说一声，而不是拒绝建书** ——
          // 作者写"90年代港风"是合法的创作决定，替他拦下才是越权。
          const flavor = catalog.checkFlavorNames(body)
          return json({
            ...created,
            flavorHints: {
              style: flavor.style.ok ? null : flavor.style.known,
              genre: flavor.genre.ok ? null : flavor.genre.known,
            },
          }, 201)
        }
      }
      if (novelPath && !parts[3] && request.method === 'GET') {
        const novel = catalog.getNovel(novelIdOf(parts[2]))
        return novel ? json(novel) : bad('小说不存在', 404)
      }

      /* ==================== 世界观 ==================== */
      if (novelPath && parts[3] === 'worlds') {
        const novelId = novelIdOf(parts[2])
        if (request.method === 'GET') return json(worldApi.listWorlds(novelId))
        if (request.method === 'POST') return json(worldApi.saveWorld(novelId, await request.json() as WorldInput), 201)
      }

      /* ==================== 角色 ==================== */
      if (novelPath && parts[3] === 'characters') {
        const novelId = novelIdOf(parts[2])
        const characterId = parts[4]
        if (request.method === 'GET' && !characterId) return json(characterApi.listCharacters(novelId))
        if (request.method === 'POST' && !characterId) {
          // 201 = 新建，200 = 同名卡已存在（没有重复建）
          const saved = characterApi.saveCharacter(novelId, await request.json() as CharacterInput)
          return json(saved.character, saved.created ? 201 : 200)
        }
        if (request.method === 'PUT' && characterId) {
          const updated = characterApi.updateCharacter(novelId, Number(characterId), await request.json() as CharacterPatch)
          return updated ? json(updated) : bad('角色不存在', 404)
        }
      }

      /* ==================== 地点 ==================== */
      if (novelPath && parts[3] === 'locations') {
        const novelId = novelIdOf(parts[2])
        if (request.method === 'GET') return json(locationApi.listLocations(novelId))
        if (request.method === 'POST') {
          const saved = locationApi.saveLocation(novelId, await request.json() as LocationInput)
          return json(saved.location, saved.created ? 201 : 200)
        }
      }

      /* ==================== 大纲（锚点 + 卷纲） ==================== */
      if (novelPath && parts[3] === 'outline') {
        const novelId = novelIdOf(parts[2])
        if (request.method === 'GET') return json(outlineApi.readOutline(novelId))
        if (request.method === 'POST') {
          const body = await request.json() as { anchor?: Parameters<typeof outlineApi.saveAnchorWithOutline>[1]['anchor']; volumeOutline?: Parameters<typeof outlineApi.saveAnchorWithOutline>[1]['volumeOutline'] }
          if (!body?.anchor && !body?.volumeOutline) return bad('请求体至少要有 anchor 或 volumeOutline')
          return json(outlineApi.saveAnchorWithOutline(novelId, body), 201)
        }
      }

      /* ==================== 卷 ==================== */
      if (novelPath && parts[3] === 'volumes') {
        const novelId = novelIdOf(parts[2])
        if (request.method === 'GET') return json(outlineApi.listVolumes(novelId))
        if (request.method === 'POST') {
          const body = await request.json() as VolumeBody
          const created = chapterApi.createVolume(novelId, {
            no: Number(body.no),
            name: String(body.name ?? ''),
            goal: body.goal,
            fromState: body.from_state,
            toState: body.to_state,
            startChapter: Number(body.start_chapter),
            endChapter: Number(body.end_chapter),
          })
          return json(created, created.created ? 201 : 200)
        }
      }

      /* ==================== 章节 ==================== */
      if (novelPath && parts[3] === 'chapters') {
        const novelId = novelIdOf(parts[2])
        if (request.method === 'GET') return json(chapterApi.listChapterSummaries(novelId))
        if (request.method === 'POST') {
          const body = await request.json() as ChapterBody
          // 入参与工具层 save_chapter_outline 对齐：传 chapters 数组。
          // 传一条 = 单章落库/重跑；传一整卷 = 一次落完。逐条提交，某条失败不影响其余。
          const drafts = Array.isArray(body.chapters) && body.chapters.length > 0 ? body.chapters : [body]
          // volume_no 优先（对外形态），其次 volume_id（前端已知 id 的情况）
          const volumeNo = body.volume_no
            ?? (body.volume_id === undefined
              ? undefined
              : chapterApi.listVolumes(novelId).find((volume) => volume.id === body.volume_id)?.no)
          if (volumeNo === undefined) return bad('缺少 volume_id（或 volume_no），或该卷不存在')
          const report = chapterApi.saveChapterOutlines(novelId, volumeNo, drafts.map(toChapterInput))
          // 一条都没落成 = 请求本身有问题；部分落成仍算成功，失败的那几条在报告里
          return json(report, report.saved.length === 0 ? 400 : 201)
        }
      }

      /* ---- 按 chapterId 定位的章节接口（没有 novelId，挨本找） ---- */
      if (parts[0] === 'api' && parts[1] === 'chapters' && parts[2]) {
        const chapterId = Number(parts[2])
        if (parts[3] === 'text') {
          const stage = (url.searchParams.get('stage') ?? 'draft') as TextStage
          const novelId = novelIdHint(url)
          if (request.method === 'GET') {
            const text = chapterApi.getChapterTextById(chapterId, stage, novelId)
            if (!text && novelId === undefined) return bad('该 chapter_id 在多本书里都存在，请带 novelId 参数', 400)
            return json(text ?? { chapter_id: chapterId, stage, text: '' })
          }
          if (request.method === 'PUT') {
            const body = await request.json() as { text?: string; summary?: string; ends_with?: string }
            const saved = chapterApi.saveChapterTextById(chapterId, stage, {
              text: body.text ?? '',
              summary: body.summary,
              endsWith: body.ends_with,
            }, novelId)
            if (!saved) return bad('章节不存在', 404)
            return json(saved)
          }
        }
        if (!parts[3] && request.method === 'PUT') {
          // 章纲补丁的字段名：库/前端用 snake（word_count_target），db 内部是驼峰 —— 在这里对齐一次
          const raw = await request.json() as ChapterOutlinePatch & { word_count_target?: number }
          const { word_count_target: snakeTarget, ...rest } = raw
          const updated = chapterApi.updateChapterById(
            chapterId,
            { ...rest, wordCountTarget: raw.wordCountTarget ?? snakeTarget },
            novelIdHint(url),
          )
          // 找不到就是找不到：不要拿"第一本"的第一章当答案
          if (!updated) return bad('章节不存在', 404)
          return json(updated)
        }
      }

      /* ==================== 工作流 ==================== */
      if (novelPath && parts[3] === 'workflow' && request.method === 'GET') {
        // 只回简化结构（阶段 + 各阶段计数），不回 generation_tasks 的原始字段 —— 那是内部实现
        return json(workflowApi.getWorkflowSummary(novelIdOf(parts[2])))
      }
      if (novelPath && parts[3] === 'agents' && request.method === 'GET') {
        return json(workflowApi.getWorkflowLamps(novelIdOf(parts[2])))
      }

      /* ==================== 记忆与画像（只读 / 直写） ==================== */
      if (novelPath && parts[3] === 'memories') {
        const novelId = novelIdOf(parts[2])
        if (request.method === 'POST') {
          const body = await request.json() as { layer?: string; title?: string; content?: string; sourceType?: string; sourceId?: string; volumeId?: number; chapterId?: number }
          if (!body.layer || !body.title || !body.content || !body.sourceType || !body.sourceId) {
            return bad('记忆条目缺少 layer、title、content、sourceType 或 sourceId')
          }
          const embedding = await memoryApi.embedOrUndefined(`${body.title}\n${body.content}`)
          return json(memoryApi.upsertNovelMemory(novelId, { ...body, novelId: '', embedding } as never), 201)
        }
        if (request.method === 'GET') {
          const query = url.searchParams.get('q') ?? ''
          if (!query.trim()) return bad('缺少查询参数 q')
          const parseOptionalNumber = (value: string | null): number | undefined => (value == null ? undefined : Number(value))
          return json(memoryApi.searchNovelMemory(novelId, query, {
            volumeId: parseOptionalNumber(url.searchParams.get('volumeId')),
            chapterId: parseOptionalNumber(url.searchParams.get('chapterId')),
            embedding: await memoryApi.embedOrUndefined(query),
            limit: Number(url.searchParams.get('limit') ?? 10),
          }))
        }
      }
      if (novelPath && parts[3] === 'portraits' && request.method === 'GET') {
        return json(memoryApi.listCharacterPortraits(novelIdOf(parts[2])))
      }

      /* ==================== 中心 Agent ==================== */
      if (novelPath && parts[3] === 'chat' && request.method === 'POST') {
        const novelId = novelIdOf(parts[2])
        const novel = catalog.getNovel(novelId)!
        const body = await request.json() as { message?: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> }
        if (!body.message?.trim()) return bad('消息不能为空')
        const history = Array.isArray(body.history)
          ? body.history.filter((item) => (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string').slice(-24)
          : []
        const agent = chatAgents.get(novelId) ?? createSAgent()
        chatAgents.set(novelId, agent)
        const result = await agent.invoke(
          { novelId, slug: novel.slug, messages: [...history, { role: 'user', content: body.message.trim() }] },
          { configurable: { novelId } },
        )
        const messages = (result as { messages?: Array<{ getType?: () => string; content?: unknown }> }).messages ?? []
        const answer = [...messages].reverse().find((item) => item.getType?.() === 'ai' || typeof item.content === 'string')?.content
        return json({ message: typeof answer === 'string' ? answer : JSON.stringify(answer ?? '中心 Agent 暂无回复') })
      }

      return bad('接口不存在', 404)
    } catch (error) {
      const message = error instanceof Error ? error.message : '服务器错误'
      // db 层入参校验一律抛 TypeError —— 那是 400（请求不对），不是 500（服务器炸了）
      if (error instanceof TypeError) return bad(message, 400)
      if (/^小说不存在/.test(message)) return bad(message, 404)
      return bad(message, 500)
    }
  },
})
console.log(`墨灵 API 已启动：http://localhost:${server.port}`)