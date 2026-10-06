/**
 * 「这本小说走到哪一步了」——**全项目只有这一个判据**。
 *
 * 放在 shared/ 而不是任何一层里：中心 Agent 的状态快照和后端的 /workflow 接口
 * 都要回答这个问题。各写一份的话，两边迟早给出不同的阶段（页面说"正在整理大纲"、
 * Agent 说"还没世界观"），而那种不一致没人能一眼看出是谁错了。
 *
 * 反过来说，谁都不许在这里 import 别的层 —— 它是最底层的判据，
 * 依赖任何一方的概念都会让它变成某一方的一部分。
 *
 * 按「缺什么往后退」推：没世界观 → init；没卷 → world；没章 → outline；有定稿 → polish；否则 prose。
 */
export type Phase = 'init' | 'world' | 'cast' | 'outline' | 'prose' | 'polish' | 'done'

export const PHASE_ORDER: Phase[] = ['init', 'world', 'cast', 'outline', 'prose', 'polish', 'done']

export const phaseOf = (input: { hasWorld: boolean; volumes: number; chapters: number; finalized: number }): Phase => {
  if (!input.hasWorld) return 'init'
  if (input.volumes === 0) return 'world'
  if (input.chapters === 0) return 'outline'
  if (input.finalized > 0) return 'polish'
  return 'prose'
}
