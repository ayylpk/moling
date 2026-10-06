import fs from 'node:fs'
import path from 'node:path'

/**
 * 文风 / 类型片段的**加载与拼接**。
 *
 * ============================ 为什么是这个目录结构 ============================
 *
 * agent 自己的提示词只回答"写什么、怎么算合格、什么绝对不许"，
 * **不带文风也不带类型** —— 那是两个可以随时替换的维度，绑进提示词就换不掉了。
 *
 *   agent/skills/
 *   ├── 文风/冷峻克制/writer.md     ← 语气、句式、节奏、距离感
 *   ├── 类型/都市/writer.md         ← 这个题材的规则、套路、专名约束
 *   └── index.ts                    ← NO_AI_VOICE 等跨一切风格的红线
 *
 * 两者**正交**：冷峻 + 都市 和 冷峻 + 悬疑 是两种东西，任意组合都成立。
 * 加一种文风 = 加一个目录，**代码一个字不动**。
 *
 * ============================ 拼接顺序 ============================
 *
 * 顺序是刻意的，段与段之间会互相影响，先后不能随便换：
 *
 *   1. agent 自己的提示词   —— 做什么
 *   2. 类型片段             —— 这个世界有什么、按什么规矩来
 *   3. 文风片段             —— 用什么声音说
 *   4. 红线（NO_AI_VOICE）  —— 无论什么风格都不许
 *
 * 红线**永远在最后**：它是"不许"，放在任何片段之后都还在生效；
 * 放在中间会被后面的文风片段"稀释"——模型读到文风的鼓励就容易忘了禁。
 */

const SKILLS_DIR = import.meta.dir

/** 目录名 → agent 键。加一个 agent 时这里也要加一行，否则它的片段永远不会被读到 */
export type AgentKey = 'story-planner' | 'character' | 'location' | 'architect' | 'actor' | 'writer' | 'polisher'

/**
 * 一部书的「文风 + 类型」。**两个字段都是自由文本**，不是枚举——
 * 作者可以写"冷峻克制"（命中目录，用片段），
 * 也可以写"90年代港风"（不命中，那段文字原样当文风说明用）。
 */
export type Flavor = { style?: string; genre?: string }

/**
 * 所有会产出或验收小说内容的 agent 共用的风格同步契约。
 *
 * 题材与文风是两个正交维度：题材决定写什么、什么因果成立；文风决定怎么写。
 * 把这段规则集中在 loader，避免 writer、polisher 和各类 agent 的边界逐渐漂移。
 */
export const FLAVOR_SYNC_RULES = `
=== 类型与文风同步契约（必须执行）===

类型决定题材规则、世界运行方式、冲突边界和读者预期；文风决定叙述距离、句式、节奏、词语与表达声音。
两者都必须生效，但职责不能互换：类型回答“写什么、哪些因果成立”，文风回答“怎么写、以什么声音呈现”。
世界观、章纲、角色卡、地点卡与裁决结果是事实硬约束，类型和文风都不能覆盖它们。

每次开始产出前，确认当前请求收到同一份小说 genre 与 style，并确认对应片段已经被加载；自由文本也必须作为约束执行，不能因为没有同名片段就忽略。
每个主要场景完成后，检查事件是否符合类型规则、表达是否符合文风、角色声音是否稳定、是否引入了章纲之外的剧情。
交付前再次核对类型、文风、世界观、章纲、角色声音、专名与禁语；发现冲突时，事实硬约束优先，不能用“风格需要”掩盖越界。
`.trim()

/** 片段文件扩展名。用 .md 是因为它们就是给人看的、也要能被人改 */
const FRAGMENT_EXT = '.md'

export const STYLE_DIR = '文风'
export const GENRE_DIR = '类型'

/** 现在有哪些文风 / 类型可选 —— 前端建书表单的选项该从这里来，而不是硬编码在页面里 */
export const listStyles = (): string[] => listSubdirs(STYLE_DIR)
export const listGenres = (): string[] => listSubdirs(GENRE_DIR)

const listSubdirs = (dimension: string): string[] => {
  const full = path.join(SKILLS_DIR, dimension)
  if (!fs.existsSync(full)) return []
  return fs
    .readdirSync(full, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

/**
 * 读一个片段。**没有这个文件就返回 null**，不抛错也不写占位。
 *
 * ── 为什么读的时候一律静默 ──
 * 书里的 style / genre 是**自由文本**（前端是输入框，不是下拉）。作者可能写
 * "清冷的"、"90年代港风"、"我自己定义的节奏"——这些不是目录名，拿不到片段是正常的，
 * 那一段文字本来就会原样传给 writer 作为它的文风说明。
 *
 * 也因为不是每个文风都需要给 7 个 agent 都写片段：文风只对 writer/polisher 有意义
 * （它们直接产出文字），给世界观 agent 写文风片段是没有内容的。缺了就少一段。
 *
 * ── 那拼错怎么办 ──
 * 静默的代价是："我选了冷峻克制，结果文风没生效"这件事作者自己发现不了。
 * 所以错别字由 **assertDimensionMatches** 在建书那一刻拦住（见下），
 * 而不是让每次生成都失败 —— 生成要几十秒，为一个拼写错误失败不值。
 */
const readFragment = (dimension: string, name: string, agent: AgentKey): string | null => {
  const file = path.join(SKILLS_DIR, dimension, name, agent + FRAGMENT_EXT)
  if (!fs.existsSync(file)) return null
  return fs.readFileSync(file, 'utf8').trim()
}

/**
 * 校验一个维度名是不是真的一个可选值 —— **建书时用**。
 *
 * 返回 `{ ok }` 而不是抛错：调用方决定是拒绝建书，还是只提示一句。
 * 拼错字与"作者自定义"在这里被分开了：命中任何一个现有目录名就算 ok，
 * 都不匹配则交给调用方当自由文本处理。
 */
export const assertDimensionMatches = (
  dimension: typeof STYLE_DIR | typeof GENRE_DIR,
  name: string | undefined,
): { ok: boolean; known: string[]; matched: string | null } => {
  const known = listSubdirs(dimension)
  const trimmed = name?.trim() ?? ''
  return { ok: !trimmed || known.includes(trimmed), known, matched: known.includes(trimmed) ? trimmed : null }
}

/**
 * 拼出一个 agent 的完整提示词。
 *
 * @param base   agent 自己的提示词（做什么、怎么算合格）
 * @param agent  谁在用——决定读哪个片段文件
 * @param style  文风名。前端选的 style；没选就传空串（不注入文风段）
 * @param genre  类型名。前端选的 genre；没选就传空串（不注入类型段）
 * @param redLines 跨风格的红线段（NO_AI_VOICE）。**放最后，不要往前挪**
 */
export const composePrompt = (
  base: string,
  agent: AgentKey,
  style: string | undefined,
  genre: string | undefined,
  redLines: string,
): string => {
  const styleName = style?.trim() ?? ''
  const genreName = genre?.trim() ?? ''

  // 拿不到片段就少一段，不报错：作者的自由输入（"清冷的"、"90年代港风"）
  // 本来就不该被当成"选中了某个可组合的文风"，它会原样进 writer 的
  // READER-FACING STYLE 段落。拼错目录名的场景由建书时的校验拦住。
  const styleFragment = styleName ? readFragment(STYLE_DIR, styleName, agent) : null
  const genreFragment = genreName ? readFragment(GENRE_DIR, genreName, agent) : null

  return [base, FLAVOR_SYNC_RULES, genreFragment, styleFragment, redLines]
    .filter((part): part is string => Boolean(part))
    .join('\n\n')
}

/** 拼完的提示词有多长 —— 供调试与 token 预算用 */
export const describeComposition = (
  agent: AgentKey,
  style: string | undefined,
  genre: string | undefined,
): string => {
  const parts: string[] = [agent]
  if (genre?.trim()) parts.push(`类型=${genre.trim()}`)
  if (style?.trim()) parts.push(`文风=${style.trim()}`)
  const missing: string[] = []
  if (genre?.trim() && !readFragment(GENRE_DIR, genre.trim(), agent)) missing.push(`类型/${genre.trim()}/${agent}.md`)
  if (style?.trim() && !readFragment(STYLE_DIR, style.trim(), agent)) missing.push(`文风/${style.trim()}/${agent}.md`)
  return `${parts.join(' + ')}${missing.length ? `（无片段：${missing.join('、')}）` : ''}`
}
