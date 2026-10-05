/**
 * 开发 CLI —— 在终端里跟中心 Agent 说一句话。
 *
 * 用法：
 *   bun agent/run.ts <slug>                      # 让它汇报进度、给下一步建议
 *   bun agent/run.ts <slug> 把大纲排到第 26 章     # 交代一件事
 *
 * ── 它是什么，不是什么 ──
 * **正式入口是 `agent/storage/server.ts` 的 `/api/novels/:id/chat`**（前端走的就是它）。
 * 这个文件只是本地调试用的壳，省得为了试一句话去开前端 —— 不该被当成第二个后端。
 * 它读的是同一套 per-novel 库，没有任何第二份数据路径。
 *
 * ── 两处与旧版的关键差别 ──
 * 1. **不再自动建档**：小说必须已经在目录库里（书架页建，或 `POST /api/novels`）。
 *    旧版会自动 createNovel，等于把 slug/标题的生成规则在这里又写了一份 ——
 *    迟早和 HTTP 那边对不上，而且"跑一次就多一本空书"本身就是垃圾数据的来源。
 * 2. **不再自己拼状态**：中心 Agent 的状态快照由 `novelStateSync` 每轮从库现推并注入
 *    systemPrompt（见 SAgent/stateLite.ts），连书名/题材/文风都在里面。
 *    这里再拼一份就是第二份真相源 —— 旧版的 renderState() 正是这么干的，已删。
 *
 * 旧版 import 了 7 个 `my-app/src/service/*`（那是另一个库）。那些已经全部去掉。
 */
import { openCatalogDatabase } from "./storage/novelDatabase"
import { createNovelSystem } from "./system"

/* ==================== 参数 ==================== */

const argv = process.argv.slice(2)
const slug = argv[0]?.trim()

if (!slug) {
  console.error("用法：bun agent/run.ts <slug> [要对中心 Agent 说的话]")
  console.error("例：  bun agent/run.ts lianjiang-100 把第一卷大纲排出来")
  process.exit(1)
}

const userTurn = argv.slice(1).join(" ").trim() || "汇报一下当前进度，并告诉我下一步该做什么。"

/* ==================== 找小说（只认目录库） ==================== */

const catalog = openCatalogDatabase()
let row: { id: number; slug: string; title: string } | null = null
try {
  row = catalog.query("SELECT id, slug, title FROM novels WHERE slug = ?").get(slug) as
    | { id: number; slug: string; title: string }
    | null
} finally {
  catalog.close()
}

if (!row) {
  console.error(`目录库里没有 slug=${slug} 的小说。`)
  console.error("先在书架页建一本，或：curl -X POST localhost:3000/api/novels -H 'Content-Type: application/json' -d '{\"slug\":\"...\",\"title\":\"...\"}'")
  process.exit(1)
}

const novel = row
console.log(`\n=== ${novel.title}（slug: ${novel.slug}｜id: ${novel.id}）===\n`)

/* ==================== 跑 ==================== */

const system = createNovelSystem({ novelId: novel.id, slug: novel.slug })

try {
  const result = await system.agent.invoke(
    {
      // 状态种子：novelId 是 SAgent 从库推导状态的入口，必须一起带（见 system.ts 的 seed 注释）。
      // 完整的【当前状态】由 novelStateSync 每轮注入，这里不重复拼。
      ...system.seed,
      messages: [{ role: "user", content: userTurn }],
    },
    system.config,
  )

  const messages = (result as { messages?: unknown[] }).messages ?? []
  const last = messages[messages.length - 1] as { content?: unknown } | undefined
  const text =
    typeof last?.content === "string"
      ? last.content
      : Array.isArray(last?.content)
        ? last.content.map((p) => (typeof p === "string" ? p : ((p as { text?: string }).text ?? ""))).join("")
        : JSON.stringify(last?.content ?? null)

  console.log(text)
  console.log(`\n（thread: ${system.threadId}｜checkpoint: ${novel.slug}.sqlite）`)
} finally {
  system.close()
}
