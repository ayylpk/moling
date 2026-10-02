/**
 * 磁盘产物的路径约定。
 *
 * ── 为什么这些东西不进 SQLite ──
 * prompt 快照、LLM 原始返回、分段中间产物、被截断的诊断文件 —— 这些是**过程证据**，
 * 永远不参与查询。把它们塞进库只会让 schema 变脏、备份变大、迁移变难。
 * 库里只存指针（generation_tasks.artifact_path），内容是文件。
 *
 * 布局：
 *   resources/runs/<slug>/
 *     world/    v1.prompt.txt   v1.raw.json
 *     outline/  vol1-seg1.prompt.txt  vol1-seg1.raw.json  vol1-seg1.parsed.json
 *     chapter/  ch013.prompt.txt  ch013.raw.json
 */
import path from 'node:path'
import { mkdirSync } from 'node:fs'

// src/shared -> src -> my-app -> agent -> 墨灵，往上四层就是项目根
const resourcesDir = path.join(import.meta.dir, '../../../../resources')

export const runsRoot = path.join(resourcesDir, 'runs')

/**
 * slug 的合法形状。
 *
 * 它要当目录名用，所以必须文件系统安全：只允许小写字母、数字、连字符，
 * 不能以连字符开头，长度封在 48。
 * 这条在 novelService 里做断言 —— **不校验的话，带 ../ 的 slug 会写到项目外面去**。
 */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/

/** 一本小说的产物根目录（绝对路径） */
export const novelRunDir = (slug: string): string => path.join(runsRoot, slug)

/** 库里存的相对路径长这样：outline/vol1-seg1.raw.json */
export const artifactRel = (...segments: string[]): string => path.join(...segments)

/**
 * 相对路径 -> 绝对路径，并且**确认它没跑出该小说的目录**。
 *
 * artifact_path 是从库里读出来的字符串。就算今天写进去的都是自己生成的，
 * 也不该假设它永远干净 —— 一个 ../ 就能让写入落到项目外面。
 */
export const artifactAbs = (slug: string, rel: string): string => {
  const root = novelRunDir(slug)
  const abs = path.resolve(root, rel)
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
  if (!abs.startsWith(rootWithSep)) {
    throw new Error(`artifact_path 越出了小说目录：${rel}`)
  }
  return abs
}

/** 用到才建目录。返回值是建好的绝对路径 */
export const ensureRunDir = (slug: string, stage?: string): string => {
  const dir = stage ? path.join(novelRunDir(slug), stage) : novelRunDir(slug)
  mkdirSync(dir, { recursive: true })
  return dir
}
