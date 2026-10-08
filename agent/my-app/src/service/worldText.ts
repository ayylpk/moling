import { createWorldRuntime } from '../db/worldDB'
import { withNovel } from '../controller/withNovel'

/**
 * 把 per-novel 的世界观渲染成**子 agent 看得懂的紧凑文本**。
 *
 * 四个生成工具（角色 / 地点 / 大纲 / 裁决）和草案生成服务都要喂这一段，
 * 所以渲染格式只在这里定义一次 —— 两处各写一遍的话，迟早有一处的 rules
 * 渲染漏掉「代价」，而"没有代价的规则就是外挂"正是这套世界观设计的核心约束，
 * 漏掉等于把硬约束放空。
 *
 * 注意喂的是**硬约束**（rules 的三件套 / forbidden / terms），不是 JSON 结构：
 * 子 agent 的提示词就是照这个形状写的。库里没有世界观就直接抛 ——
 * 不要让子 agent 在真空里编一套规则出来。
 */
export const renderWorldText = (novelId: number): string => {
  const world = withNovel(novelId, (database) => createWorldRuntime(database).current())
  if (!world) {
    throw new Error('这本小说还没有世界观。先用 save_world 把世界观落库 —— 角色/地点/大纲都以它为硬约束。')
  }
  const rules = (world.rules ?? []).map((rule, index) => `${index + 1}. ${rule.ability}｜代价：${rule.cost}｜界线：${rule.limit}`)
  const names = (list: unknown[] | undefined): string[] =>
    (list ?? []).map((item) => (item && typeof item === 'object' ? String((item as { name?: unknown }).name ?? '') : '')).filter(Boolean)
  const factions = names(world.factions)
  const places = names(world.places)
  const terms = (world.terms ?? []).map((term) => term.name).filter(Boolean)
  return [
    `premise: ${world.premise}`,
    'rules:',
    ...(rules.length ? rules : ['  （无）']),
    `factions: ${factions.length ? factions.join(' / ') : '（无）'}`,
    `places: ${places.length ? places.join(' / ') : '（无）'}`,
    `terms: ${terms.length ? terms.join(' / ') : '（无）'}`,
    'forbidden:',
    ...((world.forbidden ?? []).length ? (world.forbidden ?? []).map((item) => `- ${item}`) : ['- （无）']),
  ].join('\n')
}
