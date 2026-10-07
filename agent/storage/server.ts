import {
  catalog,
  chapter as chapterApi,
  character as characterApi,
  flavor as flavorApi,
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

/** 视觉接口收哪些图片格式 —— 与百炼支持的 Content Type 对齐 */
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']

/** base64 长度上限（约 10MB 原文件）。再大应该先压，而不是把请求体撑爆 */
const MEDIA_BASE64_LIMIT = 14_000_000

/** 素材体里出现了几种素材？三种互斥，一次只能给一种 */
const toMaterial = (body: { text?: string; image?: { mediaType?: string; base64?: string }; document?: { base64?: string } }) => {
  const image = body.image
  const imageBase64 = typeof image?.base64 === 'string' ? image.base64 : ''
  const documentBase64 = typeof body.document?.base64 === 'string' ? body.document.base64 : ''
  const text = typeof body.text === 'string' ? body.text.trim() : ''

  const kinds = [text.length > 0, imageBase64.length > 0, documentBase64.length > 0].filter(Boolean).length
  if (kinds > 1) throw new TypeError('一次只能给一种素材：文本、图片、或 Word 文档')

  if (imageBase64) {
    const mediaType = String(image?.mediaType ?? '').toLowerCase()
    if (!ALLOWED_IMAGE_TYPES.includes(mediaType)) {
      throw new TypeError(`图片格式只支持 ${ALLOWED_IMAGE_TYPES.join('、')}，收到：${mediaType || '（空）'}`)
    }
    if (imageBase64.length > MEDIA_BASE64_LIMIT) {
      throw new TypeError(`图片太大（base64 ${Math.round(imageBase64.length / 1024 / 1024)}MB），请先压缩再传`)
    }
    return { kind: 'image' as const, mediaType, base64: imageBase64 }
  }

  // .docx 原样交给 service 解析（它是 zip，解出来只有正文文字），
  // 这里不解析：HTTP 层只做传输，不认识文件格式
  if (documentBase64) {
    if (documentBase64.length > MEDIA_BASE64_LIMIT) {
      throw new TypeError(`Word 文件太大（base64 ${Math.round(documentBase64.length / 1024 / 1024)}MB）`)
    }
    return { kind: 'document' as const, base64: documentBase64 }
  }

  if (!text) throw new TypeError('缺少素材：给 text、image.base64 或 document.base64')
  return { kind: 'text' as const, text }
}

/**
 * 路径分段必须**解码**：`url.pathname` 是 percent-encoded 的，而类型/文风的名字
 * 和条目的名字都是中文（`/api/flavors/类型/玄幻`），不解码就永远匹配不上。
 * 解码失败不抛错 —— 保持原样让它落进后面的维度校验，变成 400 而不是 500。
 */
const decodeSegment = (segment: string): string => {
  try { return decodeURIComponent(segment) } catch { return segment }
}

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
    const parts = url.pathname.split('/').filter(Boolean).map(decodeSegment)
    const novelPath = parts[0] === 'api' && parts[1] === 'novels' && parts[2] !== undefined

    try {
      if (url.pathname === '/api/health') return json({ ok: true, storage: 'catalog + per-novel sqlite' })

      /* ==================== 类型 / 文风库 ==================== */
      // 这一组**不接 novelId** —— 两个维度全局共享，任何一本书都用同一套。
      // 读写对象是 agent/skills/ 下的目录与片段文件（为什么不上 SQLite 见 skills/manage.ts）。
      // 放在最前面：建书表单与素材生成页都要靠这里的清单渲染。
      if (parts[0] === 'api' && parts[1] === 'flavors') {
        const dimension = parts[2]
        const flavorName = parts[3]

        // 清单：随 agent/skills/ 下的目录变化而变，不写死在前端
        if (!dimension && request.method === 'GET') return json(flavorApi.listFlavors())

        // ⚠️ 必须排在维度分支**前面**：否则 'generate' 会被当成维度名（虽然必然校验不过，
        // 但报出来的错会是"维度只能是类型或文风"，把人往错的方向引）
        if (dimension === 'generate' && request.method === 'POST') {
          const body = await request.json() as {
            text?: string
            image?: { mediaType?: string; base64?: string }
            document?: { base64?: string }
          }
          return json(await flavorApi.generateFromMaterial(toMaterial(body)), 201)
        }

        if (dimension && !flavorName) {
          // agents 一起回：前端据此渲染编辑框，别把"类型 7 片、文风 2 片"写死在前端
          if (request.method === 'GET') {
            return json({ dimension, agents: flavorApi.agentsOf(dimension), items: flavorApi.listDimension(dimension) })
          }
          if (request.method === 'POST') {
            const body = await request.json() as { name?: string; fragments?: Record<string, string> }
            const saved = flavorApi.saveFlavor(dimension, body.name ?? '', body.fragments ?? {}, false)
            // 重名**不覆盖**：把现成的名字交回去让用户改，而不是替他把已有的那份冲掉
            if (!saved.ok) return json(saved, 409)
            return json(saved, 201)
          }
        }

        if (dimension && flavorName) {
          if (request.method === 'GET') {
            const found = flavorApi.getFlavor(dimension, flavorName)
            return found ? json(found) : bad(`「${dimension}/${flavorName}」不存在`, 404)
          }
          if (request.method === 'PUT') {
            const body = await request.json() as { name?: string; fragments?: Record<string, string> }
            // **先改名再写内容**：改完名目录就换了，后面的写入必须落在新名字上
            let current = flavorName
            if (body.name !== undefined && body.name !== flavorName) {
              const renamed = flavorApi.renameFlavor(dimension, flavorName, body.name)
              if (!renamed.ok) return json(renamed, renamed.reason === 'duplicate' ? 409 : 404)
              current = renamed.to
            }
            // 只改名不写内容也是合法的一次调用
            if (body.fragments === undefined) {
              return flavorApi.getFlavor(dimension, current)
                ? json({ ok: true, created: false, name: current, files: [] })
                : bad('改完名之后读不到这个条目', 500)
            }
            const saved = flavorApi.saveFlavor(dimension, current, body.fragments, true)
            if (!saved.ok) return json(saved, saved.reason === 'duplicate' ? 409 : 404)
            return json(saved)
          }
          if (request.method === 'DELETE') {
            const removed = flavorApi.removeFlavor(dimension, flavorName)
            if (!removed.ok) return json(removed, 404)
            // 200 里带回挪到了哪里 —— 删除只是隔离，找得回来这件事要说清
            return json(removed)
          }
        }
      }

      /* ==================== 书架 ==================== */
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

      /* ==================== 导出 ==================== */
      // **单章与批量是同一个接口**：ids 里给一个就是单章，给多个就是批量。
      // 返回的是文件本体（text/plain）而不是 JSON —— 所以只有出错时才回 JSON，
      // 调用方必须先用 fetch 判 status，不能直接挂一个 <a href> 让它去下载。
      if (novelPath && parts[3] === 'export' && request.method === 'GET') {
        const novelId = novelIdOf(parts[2])
        const ids = (url.searchParams.get('ids') ?? '')
          .split(',')
          .map((item) => Number(item.trim()))
          .filter((value) => Number.isInteger(value) && value > 0)
        if (ids.length === 0) return bad('缺少 ids：逗号分隔的 chapterId。给一个就是单章，给多个就是批量')

        // 去重：同一个 chapterId 传两遍不该导出两遍
        const result = chapterApi.exportChapters(novelId, catalog.getNovel(novelId)?.title ?? '', [...new Set(ids)])
        const filename = `${result.filename}.txt`
        return new Response(result.content, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            // 中文名必须走 filename*（RFC 5987）：只给 filename= 到了浏览器里是乱码，
            // 而乱码文件名在 Windows 上可能根本存不下来
            'Content-Disposition': `attachment; filename="novel.txt"; filename*=UTF-8''${encodeURIComponent(filename)}`,
            'Access-Control-Allow-Origin': '*',
            // 前端要靠这个头给文件命名，得先允许它被读到
            'Access-Control-Expose-Headers': 'Content-Disposition',
          },
        })
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