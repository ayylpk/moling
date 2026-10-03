/**
 * `NEW:` 约定 —— 全流水线里唯一那个"纯文本接口"。
 *
 * 大纲写到第 12 章发现需要一个"能撞见仇人的地方"，它不会编个名字出来，
 * 而是写 `NEW:一个能撞见仇人又不被察觉的地方`。中心 agent 扫到 NEW: 前缀，
 * 就拿后面那截话去调 Location agent —— **那截话正好是它的 {NEED}**。
 *
 * 这个约定出现在三个地方（章纲的 characters、章纲的 place、角色卡的 relations），
 * 所以判定逻辑放一处，别各写各的。
 *
 * 落库时的规则：**带 NEW: 前缀的 raw 永远不解析成 id**。它描述的是一个需求，
 * 不是一个人 / 一个地方的名字；贸然去查表反而可能查到一个碰巧同名的。
 * 它就一直留在 `character_id IS NULL` 的状态里，直到真的建成卡为止。
 */

export const NEW_PREFIX = 'NEW:'

/** 是不是一个未兑现的需求。大小写不敏感，容忍前后空格 */
export const isDemand = (raw: string): boolean =>
  raw.trim().toUpperCase().startsWith(NEW_PREFIX)

/** 取出 NEW: 后面那段话，也就是下游 agent 的 {NEED}。不是需求则返回空串 */
export const demandNeed = (raw: string): string =>
  isDemand(raw) ? raw.trim().slice(NEW_PREFIX.length).trim() : ''

/** 把一个 raw 值规范化：去掉首尾空白，NEW: 前缀统一成大写 */
export const normalizeRaw = (raw: string): string => {
  const t = raw.trim()
  return isDemand(t) ? NEW_PREFIX + demandNeed(t) : t
}
