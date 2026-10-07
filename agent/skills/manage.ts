import fs from 'node:fs'
import path from 'node:path'
import {
  FRAGMENT_EXT,
  GENRE_DIR,
  STYLE_DIR,
  isDimension,
  listFlavorNames,
  SKILLS_DIR,
  type AgentKey,
  type Dimension,
} from './loader'

/**
 * 类型 / 文风片段的**增删改查**（文件操作）。
 *
 * ============================ 为什么是文件而不是表 ============================
 *
 * 这两个维度是**全局共享的配置**，不属于任何一本书：
 *   · 它们在 git 里 —— 改一句能 diff、能回滚、能 review。存进 SQLite 后 diff 出来是乱码
 *   · README 写明用 .md 就是「给人看的、也要能被人改」。进库后加一个题材要写 SQL
 *   · loader.composePrompt 在生成热路径上是**同步读文件**，改成查库要动那条路径
 *   · 项目约定是「一本一个库」，而这里与具体某本书无关，塞进 catalog 会让语义变浑
 * 所以 CRUD 就是文件操作，和 loader 共用同一份读盘逻辑。
 *
 * ============================ 删除：只挪走，不删 ============================
 *
 * `removeFlavor` **绝不调用任何删除 API**。它把整个目录 rename 到
 * `<项目>/.workbuddy/flavor-trash/<时间戳>/<维度>/<名字>/`：
 *   · `.workbuddy/` 在 .gitignore 里 —— 挪过去不会变成待提交的改动
 *   · 同一个盘 —— rename 是原子的，**不需要"先复制再删原件"**（那才有真删）
 * 挪错了、挪秃噜了，把目录 rename 回来就行。
 *
 * ============================ 校验在前，写入在后 ============================
 *
 * 名字与片段内容全部校验通过才落盘。建新条目时先建目录再写文件，
 * 中途失败会把**这个刚建出来的目录**收拾掉 —— 收拾的是自己刚造的东西，不是用户数据。
 */

/** 这个名字太长就该换一个了 —— 目录名不承担描述职责，描述在片段正文里 */
const NAME_MAX = 40

/** Windows 保留设备名。作为目录名会被系统拒绝或行为诡异，提前拦掉 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * 每个维度允许写哪几个 agent 片段。
 *
 * 与 `类型/README.md`、`文风/README.md` 的表一一对应：
 * 类型 7 片（世界的规则、人物位、地点、卷结构、两难、执笔、润色），
 * 文风 2 片（只有直接产出文字的 writer / polisher 需要文风）。
 */
export const DIMENSION_AGENTS: Record<Dimension, AgentKey[]> = {
  [GENRE_DIR]: ['story-planner', 'character', 'location', 'architect', 'actor', 'writer', 'polisher'],
  [STYLE_DIR]: ['writer', 'polisher'],
}

/** 一个条目的片段集合。**允许缺** —— README 里"缺哪个文件就跳过哪个" */
export type FlavorFragments = Partial<Record<AgentKey, string>>

export type Flavor = {
  dimension: Dimension
  name: string
  /** 实际存在于磁盘上的片段，按 DIMENSION_AGENTS 的顺序 */
  fragments: FlavorFragments
  /** 有哪几片是空的 —— 一片都没有的条目在生成时会完全没有效果 */
  missing: AgentKey[]
}

/** 项目根。`.workbuddy/` 与 `agent/` 同级 */
const PROJECT_ROOT = path.resolve(SKILLS_DIR, '..', '..')
const TRASH_ROOT = path.join(PROJECT_ROOT, '.workbuddy', 'flavor-trash')

const dimensionDir = (dimension: Dimension): string => path.join(SKILLS_DIR, dimension)

const assertDimension = (value: string): Dimension => {
  if (!isDimension(value)) throw new TypeError(`维度只能是「${GENRE_DIR}」或「${STYLE_DIR}」，收到：${value}`)
  return value
}

/**
 * 名字就是目录名，所以它的约束来自**文件系统**，不是来自业务。
 *
 * 特别地：**不许含点**。一是 `loader.test.ts` 有「条目名不含 .」的断言，
 * 含点的目录会被别处当成带后缀的文件；二是删除/重命名都要拿它拼路径，
 * 放开点号等于给路径拼接留口子。
 */
const assertName = (raw: string | undefined, label: string): string => {
  const name = (raw ?? '').trim()
  if (!name) throw new TypeError(`${label}不能为空`)
  if (name.length > NAME_MAX) throw new TypeError(`${label}不能超过 ${NAME_MAX} 个字：${name}`)
  if (name.includes('.')) throw new TypeError(`${label}不能含点号「.」：${name}`)
  if (/[\\/:*?"<>|]/.test(name)) throw new TypeError(`${label}不能含 \\ / : * ? " < > | 这些字符：${name}`)
  if (/[\u0000-\u001f]/.test(name)) throw new TypeError(`${label}含不可见字符，换一个`)
  if (WINDOWS_RESERVED.test(name)) throw new TypeError(`「${name}」是系统保留名，换一个`)
  return name
}

/**
 * 这个维度该写哪几片 —— 已校验维度名。
 * 前端渲染编辑框用它，别把"类型 7 片、文风 2 片"这两个数写死在前端。
 */
export const agentsOfDimension = (dimension: string): AgentKey[] => [...DIMENSION_AGENTS[assertDimension(dimension)]]

/** 读一个条目的全部片段。不存在返回 null（和 loader.readFragment 一样不抛错） */
export const readFlavor = (dimension: string, rawName: string): Flavor | null => {
  const dim = assertDimension(dimension)
  const name = assertName(rawName, '名字')
  const dir = path.join(dimensionDir(dim), name)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null

  const fragments: FlavorFragments = {}
  const missing: AgentKey[] = []
  for (const agent of DIMENSION_AGENTS[dim]) {
    const file = path.join(dir, agent + FRAGMENT_EXT)
    if (fs.existsSync(file)) {
      // **读的时候 trim**，与写对称：写盘时末尾补了一个换行，不 trim 的话
      // 「读出来的值」和「刚存进去的值」永远差一个 \n，前端编辑框里看着没变、
      // 比较起来却不等 —— 这种不对称最难查。
      const text = fs.readFileSync(file, 'utf8').trim()
      fragments[agent] = text
      if (!text) missing.push(agent)
    } else {
      missing.push(agent)
    }
  }
  return { dimension: dim, name, fragments, missing }
}

/** 列一个维度的条目（带各自的片段清单）—— 前端的"查" */
export const listFlavors = (dimension: string): Flavor[] => {
  const dim = assertDimension(dimension)
  return listFlavorNames(dim)
    .map((name) => readFlavor(dim, name))
    .filter((item): item is Flavor => item !== null)
}

export type SaveOutcome =
  | { ok: true; created: boolean; name: string; files: string[] }
  | { ok: false; reason: 'duplicate' | 'notFound'; message: string; existing: string[] }

/**
 * 保存一个条目。
 *
 * `created: true` 走建新 —— 同名已存在就**不覆盖**，把现成的名字交回去让用户改名。
 * `created: false` 走更新 —— 条目必须已经存在，避免"以为在改、其实在悄悄新建"。
 *
 * 空片段**不写文件**：写一个空的 writer.md 和没有 writer.md 是两回事，
 * 前者会被 loader 当成"这一片存在"，于是一个空片段悄悄生效。
 */
export const saveFlavor = (
  dimension: string,
  rawName: string,
  fragments: FlavorFragments,
  options: { update?: boolean } = {},
): SaveOutcome => {
  const dim = assertDimension(dimension)
  const name = assertName(rawName, '名字')
  const allowed = DIMENSION_AGENTS[dim]

  // 1) 校验片段名 —— 未知的 agent 键会被静默忽略，那等于用户改了没生效
  const unknown = Object.keys(fragments).filter((key) => !allowed.includes(key as AgentKey))
  if (unknown.length > 0) {
    throw new TypeError(`${dim}只接受这几片：${allowed.join('、')}。收到多余的：${unknown.join('、')}`)
  }
  for (const [key, value] of Object.entries(fragments)) {
    if (value !== undefined && typeof value !== 'string') throw new TypeError(`片段 ${key} 必须是文本`)
  }

  const dir = path.join(dimensionDir(dim), name)
  const exists = fs.existsSync(dir)

  // 2) 重复 / 不存在 —— 都是可预期的结果，用返回值表达，不抛错
  if (!exists && options.update) {
    return { ok: false, reason: 'notFound', message: `「${dim}/${name}」不存在，改不了`, existing: listFlavorNames(dim) }
  }
  if (exists && !options.update) {
    return { ok: false, reason: 'duplicate', message: `「${dim}/${name}」已存在，换个名字`, existing: [name] }
  }

  // 3) 全部校验过了才落盘。非空片段才写文件
  const pending = allowed
    .filter((agent) => (fragments[agent] ?? '').trim().length > 0)
    .map((agent) => ({ agent, body: (fragments[agent] as string).replace(/\s+$/, '') + '\n' }))

  if (pending.length === 0) throw new TypeError('一条片段都没给，没什么可写的')

  const justCreated = !exists
  fs.mkdirSync(dir, { recursive: true })
  try {
    for (const item of pending) {
      fs.writeFileSync(path.join(dir, item.agent + FRAGMENT_EXT), item.body, 'utf8')
    }
  } catch (error) {
    // 收拾的是"自己刚建出来的目录"，不是用户原有的东西
    if (justCreated) fs.rmSync(dir, { recursive: true, force: true })
    throw error
  }

  return { ok: true, created: justCreated, name, files: pending.map((item) => item.agent + FRAGMENT_EXT) }
}

export type RenameOutcome =
  | { ok: true; from: string; to: string }
  | { ok: false; reason: 'notFound' | 'duplicate'; message: string; existing: string[] }

/** 重命名 = 同目录内 rename。不改片段内容，也不动别的条目 */
export const renameFlavor = (dimension: string, rawFrom: string, rawTo: string): RenameOutcome => {
  const dim = assertDimension(dimension)
  const from = assertName(rawFrom, '原名字')
  const to = assertName(rawTo, '新名字')

  const base = dimensionDir(dim)
  const source = path.join(base, from)
  const target = path.join(base, to)

  const known = listFlavorNames(dim)
  if (!known.includes(from)) return { ok: false, reason: 'notFound', message: `「${dim}/${from}」不存在`, existing: known }
  if (from === to) return { ok: true, from, to }
  if (known.includes(to)) return { ok: false, reason: 'duplicate', message: `「${dim}/${to}」已存在，换个名字`, existing: known }

  fs.renameSync(source, target)
  return { ok: true, from, to }
}

export type RemoveOutcome = { ok: true; name: string; movedTo: string } | { ok: false; reason: 'notFound'; message: string }

/**
 * 删除一个条目 —— **只是把它挪到隔离区**。
 *
 * 全函数没有 unlink / rm / rmdir：目标与隔离区同盘，rename 一步到位。
 * 隔离区在 `.workbuddy/` 下（已 gitignore），所以挪走之后 git status 是干净的，
 * 而东西还在，rename 回来就复原了。
 */
export const removeFlavor = (dimension: string, rawName: string): RemoveOutcome => {
  const dim = assertDimension(dimension)
  const name = assertName(rawName, '名字')

  const source = path.join(dimensionDir(dim), name)
  if (!fs.existsSync(source)) return { ok: false, reason: 'notFound', message: `「${dim}/${name}」不存在` }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = path.join(TRASH_ROOT, stamp, dim, name)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.renameSync(source, target)

  return { ok: true, name, movedTo: target }
}

/** 隔离区在哪 —— 给"我删的东西去哪了"一个可回答的答案 */
export const trashRoot = (): string => TRASH_ROOT
