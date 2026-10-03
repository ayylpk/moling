/**
 * 把 7 个子 agent 封装成 SAgent 可以直接调用的工具。
 *
 * ── 子 agent 的职责边界（用户 2026-10-03 明确）──
 * 子 agent **只执行任务、把内容返回给中心 agent**，不做任何实际操作：
 *   · 不写数据库
 *   · 不写文件
 *   · 不改别人的产出
 * 它拿到一份输入切片，产出一个 schema，然后就结束了。
 * 调度权、落库权、采纳与否，全在 SAgent 手里。
 *
 * ── 返回格式 ──
 * 每个工具返回「**内容类型 + 全部内容**」，格式统一为：
 *
 *     【角色卡】
 *     {…完整内容…}
 *
 * 类型标记给 SAgent 判断手里拿的是什么；内容给全，因为它接下来要么拿去落库、
 * 要么拿去喂下一个子 agent。**这里不做截断**——截断会让 SAgent 拿到半份资料，
 * 它就会自己补空，补出来的就是编的。
 *
 * ── 子 agent 的上下文如何合并回中心 agent ──
 * 工具的返回值会作为 tool message 留在 SAgent 的对话里，这就是合并点：
 * 子 agent 的产出（以及它是为哪个目标产出的）都回到中心。
 * 中心 agent 的压缩提示词（见 ../compact.ts）第 3、4 节会把这些事实
 * 抄进 summary，所以即使原文被压缩掉，接任者也仍然知道"有哪些角色、写到第几章"。
 *
 * ── 为什么入参是名字/序号而不是全文 ──
 * 子 agent 要的是完整资料，而 SAgent 手上只有索引。
 * 所以由工具自己去库里把资料取全再喂进去——读库是取的，不是"操作"，
 * 子 agent 本身依然没有碰过数据库。
 */
import { tool } from "langchain"
import type { RunnableConfig } from "@langchain/core/runnables"
import * as z from "zod"

import { createModel } from "../../create_model"

import { createWorldAgent, parseWorld } from "../../story-planner/agent"
import { createCharacterAgent } from "../../Character/agent"
import { buildCharacterPrompt } from "../../Character/prompt"
import { createLocationAgent } from "../../Location/agent"
import { buildLocationPrompt } from "../../Location/prompt"
import { createArchitectAgent } from "../../Architect/agent"
import { buildArchitectPrompt } from "../../Architect/prompt"
import { createActorAgent, type Actor, type ActorScene } from "../../Actor/agent"
import { buildActorPrompt } from "../../Actor/prompt"
import { createWriterAgent } from "../../writer/agent"
import { buildWriterPrompt } from "../../writer/prompt"
import { createPolisherAgent } from "../../Polisher/agent"
import { buildPolisherPrompt } from "../../Polisher/prompt"

import { getCurrentWorld } from "../../my-app/src/service/storyPlannerService"
import { listCharacters, getCharacter } from "../../my-app/src/service/characterService"
import { listLocations } from "../../my-app/src/service/locationService"
import { getChapterByIdx } from "../../my-app/src/service/chapterService"
import { getNovel } from "../../my-app/src/service/novelService"

/* ==================== 内部辅助 ==================== */

/**
 * 从工具调用的 config 里取当前小说 id。
 *
 * SAgent 每次 invoke 都会带 `{ configurable: { novelId } }`（见 ../agent.ts）。
 * 拿不到就直接抛——**不要**退回"用第一本小说"，那会在多本之间悄悄串档。
 */
function novelIdOf(config?: RunnableConfig): number {
  const id = (config?.configurable as Record<string, unknown> | undefined)?.novelId
  if (typeof id !== "number" || !Number.isInteger(id)) {
    throw new Error(
      "缺少 novelId：这个工具需要知道当前在写哪本小说。" +
        "调用 SAgent 时请在 config 里传 `configurable: { novelId }`。",
    )
  }
  return id
}

/** 这本小说的文风基准。建小说时就该填，没填就退回一句中性描述。 */
function styleOf(novelId: number): string {
  return getNovel(novelId)?.style || "无特别文风要求。"
}

/**
 * 把世界观序列化成可注入的紧凑文本。
 *
 * 这里喂给子 agent 的是**硬约束**（rules / forbidden / terms），不是 JSON 结构——
 * 子 agent 的提示词就是照着这个形状写的。
 */
function renderWorld(novelId: number): string {
  const world = getCurrentWorld(novelId)
  if (!world) {
    throw new Error(
      `小说 ${novelId} 还没有世界观。先调 run_world_planner 生成，再用 save_world 落库。`,
    )
  }
  return [
    `premise: ${world.premise}`,
    "rules:",
    ...(world.rules ?? []).map((r, i) => `${i + 1}. ${r.id}: ${r.text}`),
    `places: ${(world.places ?? []).map((p) => `${p.name}（${p.desc ?? ""}）`).join(" / ")}`,
    `terms: ${(world.terms ?? []).map((t) => t.term).join(" / ")}`,
    "forbidden:",
    ...(world.forbidden ?? []).map((f) => `- ${f}`),
  ].join("\n")
}

/** 按名字取角色卡的完整内容，渲染成子 agent 看得懂的紧凑文本。 */
function renderCards(names: string[], novelId: number): string {
  const briefs = listCharacters(novelId)
  const picked = briefs.filter((b) => names.includes(b.name))
  if (picked.length === 0) return "（无）"
  return picked
    .map((b) => {
      const c = getCharacter(b.id)
      if (!c) return ""
      return [
        `【${c.name}】role: ${c.role}｜status: ${c.status}`,
        `  voice: ${c.voice ?? ""}`,
        `  want: ${c.want ?? ""}`,
        `  cost: ${c.cost ?? ""}`,
        `  need: ${c.need ?? ""}`,
        `  flaw: ${c.flaw ?? ""}`,
        `  line: ${c.line ?? ""}`,
        `  immutable: ${(c.immutable ?? []).join("；")}`,
        `  relations: ${(c.relations ?? []).map((r) => `${r.id}——${r.attitude}`).join("；")}`,
      ].join("\n")
    })
    .filter(Boolean)
    .join("\n\n")
}

/** 按名字取地点卡，渲染成紧凑文本。 */
function renderPlaces(names: string[], novelId: number): string {
  const all = listLocations(novelId)
  const picked = all.filter((l) => names.some((n) => l.name.includes(n) || n.includes(l.name)))
  if (picked.length === 0) return "（无）"
  return picked
    .map((l) =>
      [
        `【${l.name}】parent: ${l.parent_name ?? l.parent_raw ?? "—"}`,
        `  signature: ${l.signature ?? ""}`,
        `  features: ${(l.features ?? []).join(" / ")}`,
        `  role: ${l.role ?? ""}`,
      ].join("\n"),
    )
    .join("\n\n")
}

/** 统一的结果包装：类型标记 + 全部内容。 */
function pack(kind: string, payload: unknown): string {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)
  return `【${kind}】\n${body}`
}

/* ==================== 1. 世界观 ==================== */

export const runWorldPlanner = tool(
  async ({ need }) => {
    const agent = createWorldAgent()
    const res = await agent.invoke({ messages: [{ role: "user", content: need }] })
    return pack("世界观草案", parseWorld(res.structuredResponse))
  },
  {
    name: "run_world_planner",
    description:
      "生成整本书的世界观圣经：premise、rules（能力/代价/界线三件套）、places 粗骨架、terms 专名表、forbidden 禁止清单。" +
      "这是整条链的起点——角色、地点、大纲都以它为硬约束。" +
      "need 里要交代题材、口味、这个世界必须写死的规则（例如「穿越必须付出代价」）。" +
      "它只返回内容，**不落库**；要保存请接着调 save_world。" +
      "注意：改世界观等于改地基，下游已产出的内容都需要重跑。",
    schema: z.object({
      need: z.string().describe("这本书要什么样的世界：题材、口味、必须写死的规则、必须禁止的东西。"),
    }),
  },
)

/* ==================== 2. 角色 ==================== */

export const runCharacterDesigner = tool(
  async ({ need }, config) => {
    const novelId = novelIdOf(config)
    const agent = createCharacterAgent()
    const res = await agent.invoke({
      messages: [
        {
          role: "user",
          content: buildCharacterPrompt({
            world: renderWorld(novelId),
            need,
            style: styleOf(novelId),
          }),
        },
      ],
    })
    return pack("角色卡", res.structuredResponse)
  },
  {
    name: "run_character_designer",
    description:
      "造**一个**角色的完整卡：voice（说话方式）、want/cost/need（欲望与代价）、flaw（会让他选错的缺陷）、line（底线）、immutable（不可改的可感知事实）、relations（对别人的态度）。" +
      "need 要写清这个角色承担的**戏剧功能**、以及和已有角色的关系。" +
      "★ 一次只造一个：批量造会从第三五个开始退化成模板。" +
      "★ 世界观必须先落库（角色以世界为硬约束），否则工具会报错。" +
      "它只返回内容，**不落库**；要保存请接着调 save_character。",
    schema: z.object({
      need: z.string().describe("这个角色是谁、要承担什么戏剧功能、和已有角色什么关系。"),
    }),
  },
)

/* ==================== 3. 地点 ==================== */

export const runLocationDesigner = tool(
  async ({ need }, config) => {
    const novelId = novelIdOf(config)
    const agent = createLocationAgent()
    const existing = listLocations(novelId)
      .map((l) => `- ${l.name}（parent: ${l.parent_name ?? l.parent_raw ?? "—"}）`)
      .join("\n")
    const res = await agent.invoke({
      messages: [
        {
          role: "user",
          content: buildLocationPrompt({
            world: renderWorld(novelId),
            existing: existing || "（暂无）",
            need,
          }),
        },
      ],
    })
    return pack("地点卡", res.structuredResponse)
  },
  {
    name: "run_location_designer",
    description:
      "造**一个**地点的卡：name / parent（上级地名）/ signature（一眼认得出的标志）/ features / role（在故事里承担什么）。" +
      "need 要写清这个地点要发生的戏、以及它为什么必须存在。" +
      "★ parent 只能从已有地名里选，不许另造城市或学校。" +
      "★ 一次只造一个。" +
      "它只返回内容，**不落库**；要保存请接着调 save_location。",
    schema: z.object({
      need: z.string().describe("这个地点要发生什么戏、为什么必须有它、父级地名是什么。"),
    }),
  },
)

/* ==================== 4. 大纲 ==================== */

export const runOutlineArchitect = tool(
  async ({ range, need, previous }, config) => {
    const novelId = novelIdOf(config)
    const cast = listCharacters(novelId)
      .map((c) => `${c.name}（${c.role}）`)
      .join(" / ")
    const agent = createArchitectAgent(createModel(0.5, 180_000, false, 8192))
    const res = await agent.invoke({
      messages: [
        {
          role: "user",
          content: buildArchitectPrompt({
            world: renderWorld(novelId),
            characters: cast || "（尚未建立角色）",
            previous:
              previous ||
              "本卷为第一卷，从第 1 章开始。此前无任何已写内容，全篇锚点由本卷定稿。",
            style: styleOf(novelId),
            need: `${need}\n\n★ 本次调用只输出 ${range} 的章纲，不要越界去写别的章。`,
          }),
        },
      ],
    })
    return pack(`卷大纲草案（${range}）`, res.structuredResponse)
  },
  {
    name: "run_outline_architect",
    description:
      "排**一卷**（约 50 章）的大纲：本卷的 acts（起承转合）、turningPoints（转折点落在第几章）、pacing（张力曲线）、constraints（一致性约束）、以及逐章章纲。" +
      "全篇级字段（direction / structure.type / mainPlot / subplots）由**第一卷定稿**，后续卷必须原样回填、一个字都不许改——这是防设定漂移的检查点。" +
      "★ 一次调用 = 一卷，按卷序调用。" +
      "★ 一次吐 50 章会撞 deepseek 的 8192 输出上限被截断，所以必须用 range 分段调（如「第 1–13 章」），" +
      "每段的 previous 里要带上已定稿的锚点和此前已写章节的摘要。" +
      "★ 世界观和本卷要用到的角色卡都必须已落库，否则它只能现编人名。" +
      "它只返回内容，**不落库**；要保存请接着调 save_volume_outline。",
    schema: z.object({
      range: z
        .string()
        .describe("本次只出哪些章，例如「第 1–13 章」。必须写，防止一次吐 50 章被截断。"),
      need: z.string().describe("本卷要交付什么：本卷的戏剧任务、必须发生的转折、要埋/要收的伏笔。"),
      previous: z
        .string()
        .describe("已写前情 + 已定稿的全篇锚点（逐字回填）+ 本卷起始章号。第一卷留空即可。"),
    }),
  },
)

/* ==================== 5. 角色裁决 ==================== */

const actorSceneSchema = z.object({
  story: z.string().describe("此前发生了什么。**只写这个角色知道的部分**"),
  situation: z.string().describe("此刻面临的选择"),
  options: z.object({
    A: z.string(),
    B: z.string(),
    C: z.string(),
  }),
  chatPrompt: z.string().describe("D 的题面：三个选项都不对时，让他自己给一个新答案"),
})

export const runCharacterActor = tool(
  async ({ name, story, situation, options, chatPrompt }, config) => {
    const novelId = novelIdOf(config)
    const brief = listCharacters(novelId).find((c) => c.name === name)
    if (!brief) throw new Error(`找不到角色「${name}」。先用 run_character_designer 造出来并落库。`)
    const full = getCharacter(brief.id)
    if (!full) throw new Error(`角色「${name}」的记录读不出来（id:${brief.id}）。`)

    // 切片边界 = 「他此刻自己知道的」+「他自己的驱动力」。
    // 刻意不注入 arc / reveal / secret —— 给了就是剧透，模拟会退化成"读答案"。
    const actor: Actor = {
      name: full.name,
      voice: full.voice ?? "",
      want: full.want ?? "",
      cost: full.cost ?? "",
      need: full.need ?? "",
      flaw: full.flaw ?? "",
      line: full.line ?? "",
      immutable: full.immutable ?? [],
      relations: (full.relations ?? []).map((r) => `${r.id}——${r.attitude}`),
      knows: [],
    }
    const scene: ActorScene = { story, situation, options, chatPrompt }

    const agent = createActorAgent()
    const res = await agent.invoke({
      messages: [{ role: "user", content: buildActorPrompt({ actor, scene }) }],
    })
    return pack(`角色裁决（${name}）`, res.structuredResponse)
  },
  {
    name: "run_character_actor",
    description:
      "扮演**一个**角色，回答「他此刻会怎么选」。输入是他自己知道的前情、此刻的处境、三个具体选项（A/B/C），以及一个 D 让他自己给答案。" +
      "返回：选了哪个、是角色卡上哪个字段决定的、以及他此刻会说的那一句话。" +
      "★ 只在**真正的岔路口**调用——他的 want 和 need 互相拉扯、或者他的 flaw 会让他选错的时候。" +
      "不要每章都调。" +
      "★ **绝对不要**把大纲的预期结果写进 story / situation / options：它必须盲选，" +
      "否则它只会顺着你的预期答「对」，而且不会报错，只会安静地失效。",
    schema: z.object({
      name: z.string().describe("要扮演哪个角色（用角色卡上的名字）。"),
      story: z.string().describe("此前发生了什么。只写这个角色知道的。"),
      situation: z.string().describe("此刻他面临的选择是什么。"),
      options: actorSceneSchema.shape.options.describe("三个具体选项。要具体到动作和话，不要写抽象方向。"),
      chatPrompt: z.string().describe("D 的题面：三个选项都不对时，让他自己给一个新答案。"),
    }),
  },
)

/* ==================== 6. 正文 ==================== */

export const runChapterWriter = tool(
  async ({ chapterIdx, previous, decisions }, config) => {
    const novelId = novelIdOf(config)
    const chapter = getChapterByIdx(novelId, chapterIdx)
    if (!chapter) throw new Error(`小说 ${novelId} 里找不到第 ${chapterIdx} 章。先落库章纲。`)

    const castNames = (chapter.characters ?? [])
      .map((c) => c.raw)
      .filter((n) => !n.startsWith("NEW:"))
    const agent = createWriterAgent(createModel(0.7, 300_000, false, 8192))
    const res = await agent.invoke({
      messages: [
        {
          role: "user",
          content: buildWriterPrompt({
            world: renderWorld(novelId),
            cast: renderCards(castNames, novelId),
            places: renderPlaces([chapter.place_name ?? chapter.place_raw ?? ""], novelId),
            style: styleOf(novelId),
            previous: previous || "这是全书开头，此前没有任何内容。",
            chapter: [
              `【第 ${chapter.idx} 章】${chapter.title}`,
              `本章目标：${chapter.goal}`,
              `本章冲突：${chapter.conflict}`,
              `结尾钩子：${chapter.hook}`,
              `情绪走向：${chapter.emotion}`,
              `发生地点：${chapter.place_name ?? chapter.place_raw ?? ""}`,
              `出场角色：${(chapter.characters ?? []).map((c) => c.raw).join("、")}`,
              `目标字数：${chapter.word_count_target}`,
              `★ 字数硬要求：本章正文必须写到 ${chapter.word_count_target} 字上下，不得少于 ${Math.round((chapter.word_count_target ?? 3000) * 0.9)} 字。`,
              `★ 结尾必须停在结尾钩子上，钩子之后不许再有新场景、不许补收束句。`,
              ``,
              `本章概要（按这个写，但要用场景和对话把它演出来，不要复述）：`,
              chapter.summary,
            ].join("\n"),
            decisions: decisions || "无（本章没有需要裁决的分叉点）",
          }),
        },
      ],
    })
    return pack(`第 ${chapterIdx} 章正文（${chapter.title}）`, res.structuredResponse)
  },
  {
    name: "run_chapter_writer",
    description:
      "把**一章**的章纲写成正文。会自动带上：世界观、本章出场角色的卡（只带出场的那几个）、用到地点的卡、文风、前情、章纲。" +
      "★ 前情（previous）要显式给：上一章结尾的状态 + 相关伏笔的当前情况。不给的话它接不上。" +
      "★ decisions：如果本章有真正的岔路口，先调 run_character_actor 拿裁决，把结果传进来——传了就是**硬约束**，正文必须照它写。" +
      "★ 一章必须一气呵成，不要拆成几次接力写（前后半章文风会断裂）。" +
      "★ 章纲必须先落库（它按章序号去库里取）。" +
      "它只返回内容，**不落库**；要保存请接着调 save_chapter_text。",
    schema: z.object({
      chapterIdx: z.number().describe("第几章（全篇连续编号）。"),
      previous: z.string().describe("上一章结尾状态 + 相关伏笔的当前情况。第一章留空。"),
      decisions: z.string().describe("本章岔路口的裁决结果；没有就留空。"),
    }),
  },
)

/* ==================== 7. 润色 ==================== */

export const runProsePolisher = tool(
  async ({ text }, config) => {
    const novelId = novelIdOf(config)
    const world = getCurrentWorld(novelId)
    const agent = createPolisherAgent()
    const res = await agent.invoke({
      messages: [
        {
          role: "user",
          content: buildPolisherPrompt({
            terms: (world?.terms ?? []).map((t) => t.term).join(" / "),
            forbidden: (world?.forbidden ?? []).join("\n"),
            style: styleOf(novelId),
            text,
          }),
        },
      ],
    })
    return pack("润色结果（含逐条改动清单）", res.structuredResponse)
  },
  {
    name: "run_prose_polisher",
    description:
      "给已完成的正文**去 AI 味**、调节奏和用词。只改表达，绝不改情节、事实、数字、关系、角色语言特征和专名。" +
      "返回润色后的全文 + 逐条改动清单（供人工审计）。" +
      "★ 只在**文字层面**有问题时调它。" +
      "如果这一章情节就不对，别调它——退回 run_outline_architect 重排章纲，或者重写；" +
      "它修不了故事问题，也不该让它去修。",
    schema: z.object({
      text: z.string().describe("待润色的正文全文。"),
    }),
  },
)

/* ==================== 汇总 ==================== */

/** 全部子 agent 工具。SAgent 的 tools 由它 + 数据库工具拼成。 */
export const subAgentTools = [
  runWorldPlanner,
  runCharacterDesigner,
  runLocationDesigner,
  runOutlineArchitect,
  runCharacterActor,
  runChapterWriter,
  runProsePolisher,
]
