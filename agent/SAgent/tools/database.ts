/**
 * 数据库操作 → SAgent 的工具。
 *
 * ── 为什么要单独一组 ──
 * 子 agent 只生成、不落库（见 ./subagents.ts 的文件头）。落库是**另一个动作**，
 * 由 SAgent 判断"这一版可以采纳"之后再决定做不做。拆开的好处：
 *   · 生成不满意 → 重新生成，库没被污染
 *   · 落库失败 → 重试落库，不用重新生成（生成一次很贵）
 *   · 落库是唯一会让"下游需要重跑"的动作，把它显式化，才看得见影响面
 *
 * ── 写入的工具会返回 id ──
 * 有了 id，SAgent 后面就能只拿 id 说话（"把 character_id:12 的性格改一下"），
 * 不用把全文再搬一遍。这也是压缩策略能生效的前提。
 *
 * ── 事务 ──
 * 不在这层加事务：service 内部已经处理了（例如 saveVolumeOutline 一次写 5 张表，
 * 整体包在一个事务里）。这里再加一层只会让职责变模糊。
 */
import { tool } from "langchain"
import type { RunnableConfig } from "@langchain/core/runnables"
import * as z from "zod"

import { createWorld, getCurrentWorld, listWorldBriefs } from "../../my-app/src/service/storyPlannerService"
import { createCharacter, getCharacter, listCharacters, replaceRelations } from "../../my-app/src/service/characterService"
import { createLocation, listLocations, getTree } from "../../my-app/src/service/locationService"
import { saveVolumeOutline, getAnchor, listVolumeOutlines, listDriftedVolumes } from "../../my-app/src/service/outlineService"
import { listChapters, getChapterByIdx, saveChapterText, listPendingDemands } from "../../my-app/src/service/chapterService"
import { getProgress, listTasks } from "../../my-app/src/service/taskService"
import { recordDecision, listDecisionsByChapter, buildDecisionsText } from "../../my-app/src/service/actorDecisionService"
import { getNovel } from "../../my-app/src/service/novelService"
import type { TextStage } from "../../db/types"

/* ==================== 辅助 ==================== */

function novelIdOf(config?: RunnableConfig): number {
  const id = (config?.configurable as Record<string, unknown> | undefined)?.novelId
  if (typeof id !== "number" || !Number.isInteger(id)) {
    throw new Error("缺少 novelId：调用 SAgent 时请在 config 里传 `configurable: { novelId }`。")
  }
  return id
}

function pack(kind: string, payload: unknown): string {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)
  return `【${kind}】\n${body}`
}

/* ==================== 写入 ==================== */

export const saveWorld = tool(
  async (input, config) => {
    const novelId = novelIdOf(config)
    const world = createWorld({ novel_id: novelId, ...input } as Parameters<typeof createWorld>[0])
    return pack(`世界观已落库｜world_id:${world.id}｜version:${world.version}`, {
      id: world.id,
      version: world.version,
      name: world.name,
      premise: world.premise,
      ruleCount: (world.rules ?? []).length,
      termCount: (world.terms ?? []).length,
    })
  },
  {
    name: "save_world",
    description:
      "把 run_world_planner 生成的世界观写进数据库。" +
      "★ 改世界观 = **新建一版**（version 自动递增），旧版保留——因为下游每一卷都要能回答「我是基于哪版生成的」。" +
      "落库后，下游读到的永远是版本号最大的那一版。" +
      "返回 world_id 与 version；后续派活时用得上。",
    schema: z.object({
      name: z.string().describe("这个世界/这本书的名字。"),
      premise: z.string().describe("一句话前提。"),
      rules: z
        .array(z.object({ ability: z.string(), cost: z.string(), limit: z.string() }))
        .optional()
        .describe("能力规则，每条必须有 ability / cost / limit 三件套。"),
      places: z
        .array(z.object({ name: z.string(), where: z.string() }))
        .optional()
        .describe("地点的粗骨架（城市/学校/街区级别）。"),
      terms: z
        .array(z.object({ name: z.string(), note: z.string().optional() }))
        .optional()
        .describe("专名表：所有不许改写的专有名词。"),
      forbidden: z.array(z.string()).optional().describe("禁止清单。"),
      factions: z.array(z.record(z.string(), z.unknown())).optional().describe("势力。现实题材通常为空。"),
    }),
  },
)

export const saveCharacter = tool(
  async (input, config) => {
    const novelId = novelIdOf(config)
    const card = createCharacter({ novel_id: novelId, ...input } as Parameters<typeof createCharacter>[0])
    return pack(`角色已落库｜character_id:${card.id}`, {
      id: card.id,
      name: card.name,
      role: card.role,
    })
  },
  {
    name: "save_character",
    description:
      "把 run_character_designer 生成的角色卡写进数据库，返回 character_id。" +
      "★ relations 里写的是**对方的姓名**，数据库会自动解析成 id；解析不到的（比如角色还没造）会留空，之后建好再回来补。",
    schema: z.object({
      name: z.string(),
      role: z.string().describe("主角 / 配角 / 反派 / 龙套，按你的角色体系填。"),
      immutable: z.array(z.string()).optional().describe("不可改的可感知事实。"),
      voice: z.string().optional(),
      want: z.string().optional(),
      cost: z.string().optional(),
      need: z.string().optional(),
      secret: z.string().optional(),
      reveal: z.string().optional(),
      line: z.string().optional().describe("底线：越线即翻脸。"),
      flaw: z.string().optional(),
      arc: z.object({ start: z.string(), end: z.string() }).optional(),
      relations: z
        .array(z.object({ id: z.string().describe("对方姓名"), attitude: z.string() }))
        .optional(),
    }),
  },
)

export const saveLocation = tool(
  async (input, config) => {
    const novelId = novelIdOf(config)
    const loc = createLocation({ novel_id: novelId, ...input } as Parameters<typeof createLocation>[0])
    return pack(`地点已落库｜location_id:${loc.id}`, { id: loc.id, name: loc.name })
  },
  {
    name: "save_location",
    description:
      "把 run_location_designer 生成的地点卡写进数据库，返回 location_id。" +
      "★ parent 写**上级地点的名字**，数据库自动解析成 id；解析不到就留空，父级建好后会回头补上。",
    schema: z.object({
      name: z.string(),
      parent: z.string().optional().describe("上级地点的名字。"),
      signature: z.string().describe("一眼认得出的标志。"),
      features: z.array(z.string()).optional(),
      role: z.string().optional().describe("这个地点在故事里承担什么。"),
    }),
  },
)

export const saveVolumeOutlineTool = tool(
  async ({ volume, outline }, config) => {
    const novelId = novelIdOf(config)
    const o = outline as {
      direction: { logline: string; theme: string; coreConflict: string; endingDirection: string }
      structure: { type: string; acts: unknown[]; mainPlot: unknown; subplots: unknown[]; turningPoints: unknown[] }
      pacing: unknown
      constraints: unknown
      chapters: unknown[]
    }
    const result = saveVolumeOutline({
      novel_id: novelId,
      volume: { novel_id: novelId, ...volume },
      outline: {
        structure_type: o.structure.type,
        acts: o.structure.acts,
        turning_points: o.structure.turningPoints,
        pacing: o.pacing,
        constraints: o.constraints,
      },
      anchor: {
        logline: o.direction.logline,
        theme: o.direction.theme,
        core_conflict: o.direction.coreConflict,
        ending_direction: o.direction.endingDirection,
        structure_type: o.structure.type,
        main_plot: o.structure.mainPlot,
        subplots: o.structure.subplots,
      },
      chapters: o.chapters,
    } as Parameters<typeof saveVolumeOutline>[0])
    return pack(`卷大纲已落库｜volume_id:${(result as { volumeId?: number }).volumeId ?? "?"}`, {
      volumeNo: volume.no,
      chapters: o.chapters.length,
      锚点是否漂移: (result as { drifted?: boolean }).drifted ?? false,
    })
  },
  {
    name: "save_volume_outline",
    description:
      "把 run_outline_architect 生成的**一卷**大纲写进数据库（一次写 5 张表：卷 / 卷大纲 / 章 / 出场角色 / 任务，整体包在一个事务里，失败会全部回滚）。" +
      "★ 全篇锚点（direction / structure.type / mainPlot / subplots）由第一卷定稿；后续卷回填时若与已定稿的不一致，" +
      "数据库会判定为**漂移**并拒绝写入——这时要检查是不是模型擅自改了锚点。" +
      "★ outline 直接传 run_outline_architect 返回的整个对象，不要自己裁剪。" +
      "★ 同一卷重跑是安全的：章按「卷内章号」更新，已写的正文一个字都不会动。",
    schema: z.object({
      volume: z.object({
        no: z.number().describe("第几卷，从 1 开始。"),
        name: z.string(),
        goal: z.string().describe("这一卷要达成什么。"),
        from_state: z.string().describe("卷初的状态。"),
        to_state: z.string().describe("卷末的状态。"),
        start_chapter: z.number(),
        end_chapter: z.number(),
      }),
      outline: z.record(z.string(), z.unknown()).describe("run_outline_architect 返回的完整对象，原样传进来。"),
    }),
  },
)

export const saveChapterTextTool = tool(
  async ({ chapterIdx, stage, text: body, summary, endsWith, polishReport }, config) => {
    const novelId = novelIdOf(config)
    const chapter = getChapterByIdx(novelId, chapterIdx)
    if (!chapter) throw new Error(`找不到第 ${chapterIdx} 章，先落库章纲。`)
    const saved = saveChapterText(chapter.id, {
      stage: stage as TextStage,
      text: body,
      summary,
      ends_with: endsWith,
      polish_report: polishReport,
    } as Parameters<typeof saveChapterText>[1])
    return pack(`正文已落库｜chapter_text_id:${(saved as { id?: number }).id ?? "?"}`, {
      chapterIdx,
      stage,
      字数: body.length,
    })
  },
  {
    name: "save_chapter_text",
    description:
      "把正文写进数据库。stage 用 draft（初稿）或 final（润色后的终版），" +
      "同一章同一 stage 只有一行，重写是覆盖，不会新增。" +
      "★ 存的是**润色后的**才标 final；初稿标 draft。" +
      "★ 一定要把 writer 返回的 summary（本章实际发生了什么）和 endsWith（结尾状态）一起存进来——" +
      "写下一章时的前情就是从这两条取的。",
    schema: z.object({
      chapterIdx: z.number().describe("第几章（全篇连续编号）。"),
      stage: z.enum(["draft", "final"]).describe("draft=初稿，final=润色后的终版。"),
      text: z.string().describe("正文全文。"),
      summary: z.string().optional().describe("本章实际发生了什么，一到两句，写给下一章当前情。"),
      endsWith: z.string().optional().describe("结尾状态：谁在哪、带着什么、什么还没解决。"),
      polishReport: z.unknown().optional().describe("润色 agent 的改动清单。"),
    }),
  },
)

export const saveDecision = tool(
  async ({ chapterIdx, characterName, choice, reason, line, customAnswer, promptHash }, config) => {
    const novelId = novelIdOf(config)
    const chapter = getChapterByIdx(novelId, chapterIdx)
    if (!chapter) throw new Error(`找不到第 ${chapterIdx} 章。`)
    const saved = recordDecision(novelId, {
      chapter_id: chapter.id,
      character: characterName,
      choice,
      reason,
      line,
      custom_answer: customAnswer,
      prompt_hash: promptHash,
    } as Parameters<typeof recordDecision>[1])
    return pack(`裁决已落库`, saved)
  },
  {
    name: "save_decision",
    description:
      "把 run_character_actor 的裁决结果记下来，供写正文时当硬约束用。" +
      "★ 同一个 prompt_hash 会复用旧记录（避免同一次裁决被反复写）。" +
      "★ 选 D 时必须带上 custom_answer，否则会被拒绝。",
    schema: z.object({
      chapterIdx: z.number(),
      characterName: z.string(),
      choice: z.enum(["A", "B", "C", "D"]),
      reason: z.string(),
      line: z.string(),
      customAnswer: z.string().optional(),
      promptHash: z.string().optional(),
    }),
  },
)

/* ==================== 读取 ==================== */

export const readIndex = tool(
  async (_input, config) => {
    const novelId = novelIdOf(config)
    const novel = getNovel(novelId)
    const world = getCurrentWorld(novelId)
    const chars = listCharacters(novelId)
    const places = listLocations(novelId)
    const vols = listVolumeOutlines(novelId)
    const chapters = listChapters(novelId)
    const progress = getProgress(novelId)

    return pack("当前索引", {
      小说: novel ? { slug: novel.slug, title: novel.title, genre: novel.genre, style: novel.style } : null,
      世界观: world ? { id: world.id, version: world.version, name: world.name, premise: world.premise } : null,
      角色: chars.map((c) => ({ id: c.id, name: c.name, role: c.role })),
      地点: places.map((p) => ({ id: p.id, name: p.name, parent: p.parent_name ?? p.parent_raw })),
      卷: vols.map((v) => ({ id: (v as { id?: number }).id, name: (v as { name?: string }).name })),
      章节: chapters.map((c) => ({
        idx: (c as { index?: number }).index,
        title: (c as { title?: string }).title,
        stage: (c as { textStage?: string }).textStage ?? "未写",
      })),
      进度: progress,
    })
  },
  {
    name: "read_index",
    description:
      "取**当前索引**：这本小说有哪些角色（名字+id）、哪些地点（名字+id）、哪些卷、已写到第几章、各阶段任务进度。" +
      "★ 只返回索引，不返回全文——全文要用 read_entity 按 id 取。" +
      "★ 每次动手前先调它，确认状态；**不要凭记忆**说「已经写到第 30 章了」。",
    schema: z.object({}),
  },
)

export const readEntity = tool(
  async ({ kind, id }, config) => {
    if (kind === "world") {
      const w = getCurrentWorld(novelIdOf(config))
      return pack("世界观（当前版本）", w)
    }
    if (kind === "character") {
      const c = getCharacter(id)
      if (!c) throw new Error(`找不到 character_id:${id}`)
      return pack(`角色卡（character_id:${id}）`, c)
    }
    if (kind === "location") {
      const l = listLocations(novelIdOf(config)).find((x) => x.id === id)
      if (!l) throw new Error(`找不到 location_id:${id}`)
      return pack(`地点卡（location_id:${id}）`, l)
    }
    if (kind === "chapter") {
      const c = getChapterByIdx(novelIdOf(config), id)
      if (!c) throw new Error(`找不到第 ${id} 章`)
      return pack(`第 ${id} 章章纲`, c)
    }
    if (kind === "decisions") {
      return pack(`第 ${id} 章的裁决`, buildDecisionsText(id))
    }
    throw new Error(`未知 kind：${kind}`)
  },
  {
    name: "read_entity",
    description:
      "按 id 取**完整内容**：kind 选 world / character / location / chapter / decisions。" +
      "★ 派活之前要先把完整资料取出来——索引里只有名字和 id，" +
      "拿索引去派活，子 agent 会自己补空，补出来的就是编的。",
    schema: z.object({
      kind: z.enum(["world", "character", "location", "chapter", "decisions"]),
      id: z.number().describe("character / location / chapter 传 id；world 忽略；decisions 传章号。"),
    }),
  },
)

export const readAnchor = tool(
  async (_input, config) => {
    const novelId = novelIdOf(config)
    const anchor = getAnchor(novelId)
    const drifted = listDriftedVolumes(novelId)
    return pack("全篇锚点与漂移检查", {
      锚点: anchor,
      漂移的卷: drifted.length === 0 ? "无" : drifted,
    })
  },
  {
    name: "read_anchor",
    description:
      "取**全篇锚点**（direction / structure.type / mainPlot / subplots）以及漂移检查结果。" +
      "★ 排新一卷之前必须先看它：锚点由第一卷定稿，后续卷要逐字回填，改了就是漂移。",
    schema: z.object({}),
  },
)

export const readPendingDemands = tool(
  async (_input, config) => {
    const demands = listPendingDemands(novelIdOf(config))
    return pack(
      "待办清单（章纲里声明了但还不存在的东西）",
      demands.length === 0 ? "无待办" : demands,
    )
  },
  {
    name: "read_pending_demands",
    description:
      "取**待办清单**：章纲里出现了 `NEW:戏剧功能` 的地方——那是「需要一个还不存在的角色/地点」，不是名字。" +
      "★ 如果清单非空，应该先去把它补出来（造角色/地点并落库），再往下写。" +
      "★ `NEW:` 后面那段话本身就是派给子 agent 的 need。",
    schema: z.object({}),
  },
)

export const readLocationTree = tool(
  async (_input, config) => {
    return pack("地点层级树", getTree(novelIdOf(config)))
  },
  {
    name: "read_location_tree",
    description:
      "取地点之间的层级关系（谁在谁里面）。用它确认 parent 该填哪个，避免另造一个同级城市。",
    schema: z.object({}),
  },
)

export const readProgress = tool(
  async (_input, config) => {
    const novelId = novelIdOf(config)
    return pack("进度与任务", {
      进度: getProgress(novelId),
      任务: listTasks(novelId),
      世界史: listWorldBriefs(novelId),
    })
  },
  {
    name: "read_progress",
    description:
      "取**进度与任务状态**：各阶段（世界观/角色/大纲/正文）跑到哪一步、哪些任务已完成、哪些失败过。" +
      "★ 断点续跑靠它：失败的任务会带着上次的结束状态，照着它的 reason 判断要不要重跑。",
    schema: z.object({}),
  },
)

/* ==================== 汇总 ==================== */

/** 全部数据库工具。 */
export const databaseTools = [
  // 写入
  saveWorld,
  saveCharacter,
  saveLocation,
  saveVolumeOutlineTool,
  saveChapterTextTool,
  saveDecision,
  // 读取
  readIndex,
  readEntity,
  readAnchor,
  readPendingDemands,
  readLocationTree,
  readProgress,
]
