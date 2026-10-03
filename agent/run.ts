/**
 * 小说创作系统 —— 运行入口。
 *
 * 装配在 ./system.ts（状态、checkpointer、SAgent 接线），这里只负责"跑一次"：
 * 找到小说 → 起系统 → 把当前状态拼进这一轮的输入 → 把作者的话交给 SAgent。
 *
 * 用法：
 *   bun agent/run.ts <slug>                      # 看当前进度
 *   bun agent/run.ts <slug> 把大纲排到第 26 章     # 交代一件事
 *
 * slug 就是 novels 表的唯一键，同时也是 checkpoint 文件名（一本一个文件）。
 * 小说不存在时会自动建一本空的——这样第一次跑不用先手动建档。
 */
import { createNovelSystem } from "./system"
import { buildSAgentPrompt } from "./SAgent/prompt"

import { createNovel, getNovelBySlug } from "./my-app/src/service/novelService"
import { getCurrentWorld } from "./my-app/src/service/storyPlannerService"
import { listCharacters } from "./my-app/src/service/characterService"
import { listLocations } from "./my-app/src/service/locationService"
import { getAnchor, listVolumeOutlines } from "./my-app/src/service/outlineService"
import { listChapters, listPendingDemands } from "./my-app/src/service/chapterService"
import { getProgress } from "./my-app/src/service/taskService"

/* ==================== 参数 ==================== */

const argv = process.argv.slice(2)
const slug = argv[0]?.trim()

if (!slug) {
  console.error("用法：bun agent/run.ts <slug> [要对 SAgent 说的话]")
  console.error("例：  bun agent/run.ts lianjiang-100 把第一卷大纲排出来")
  process.exit(1)
}

const userTurn = argv.slice(1).join(" ").trim() || "汇报一下当前进度，并告诉我下一步该做什么。"

/* ==================== 小说 ==================== */

const novel =
  getNovelBySlug(slug) ??
  createNovel({
    slug,
    title: slug,
    genre: "",
    style: "",
  })

console.log(`\n=== ${novel.title}（slug: ${novel.slug}｜id: ${novel.id}）===\n`)

/* ==================== 拼当前状态 ==================== */

/** 把库里的东西序列化成给 SAgent 看的"索引"。只放指针，不放全文。 */
function renderState(): string {
  const world = getCurrentWorld(novel.id)
  const chars = listCharacters(novel.id)
  const places = listLocations(novel.id)
  const vols = listVolumeOutlines(novel.id)
  const chapters = listChapters(novel.id)
  const anchor = getAnchor(novel.id)
  const demands = listPendingDemands(novel.id)
  const progress = getProgress(novel.id)

  return buildSAgentPrompt({
    novel: [
      `title: ${novel.title}`,
      `genre: ${novel.genre || "未定"}`,
      `style: ${novel.style || "未定"}`,
      `status: ${novel.status}`,
    ].join("\n"),

    progress: [
      `各阶段任务：${JSON.stringify(progress)}`,
      `已写章节：${chapters.length} 章`,
      `已建立卷：${vols.length} 卷`,
    ].join("\n"),

    anchors: anchor
      ? [
          `direction: ${JSON.stringify({
            logline: anchor.logline,
            theme: anchor.theme,
            coreConflict: anchor.core_conflict,
            endingDirection: anchor.ending_direction,
          })}`,
          `structure.type: ${anchor.structure_type}`,
          `mainPlot: ${JSON.stringify(anchor.main_plot)}`,
          `subplots: ${JSON.stringify(anchor.subplots)}`,
          `（以上由第 ${anchor.locked_by_volume ?? 1} 卷定稿，后续卷必须逐字回填）`,
        ].join("\n")
      : "（尚未定稿——由第一卷的架构师输出确定）",

    index: [
      world ? `世界观：id=${world.id} version=${world.version} name=${world.name}` : "世界观：未建立",
      `角色（${chars.length}）：${chars.map((c) => `${c.name}(id:${c.id},${c.role})`).join("、") || "无"}`,
      `地点（${places.length}）：${places.map((p) => `${p.name}(id:${p.id})`).join("、") || "无"}`,
      `章（${chapters.length}）：${chapters.map((c) => `第${c.idx}章《${c.title}》`).join("、") || "无"}`,
      `待办需求（${demands.length}）：${demands.length ? JSON.stringify(demands) : "无"}`,
    ].join("\n"),
  })
}

/* ==================== 跑 ==================== */

const system = createNovelSystem({ novelId: novel.id, slug: novel.slug })

try {
  const result = await system.agent.invoke(
    {
      messages: [
        {
          role: "user",
          content: `${renderState()}\n\n=== 作者的话 ===\n${userTurn}`,
        },
      ],
    },
    system.config,
  )

  // 打印最后一条 assistant 消息
  const messages = (result as { messages?: unknown[] }).messages ?? []
  const last = messages[messages.length - 1] as { content?: unknown } | undefined
  const text =
    typeof last?.content === "string"
      ? last.content
      : Array.isArray(last?.content)
        ? last.content
            .map((p) => (typeof p === "string" ? p : ((p as { text?: string }).text ?? "")))
            .join("")
        : JSON.stringify(last?.content ?? null)

  console.log(text)
  console.log(`\n（thread: ${system.threadId}｜checkpoint: ${novel.slug}.sqlite）`)
} finally {
  system.close()
}
