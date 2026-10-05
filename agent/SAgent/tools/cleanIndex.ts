/**
 * SAgent 的工具总出口 —— **只有从这里出去的工具才会真正挂到中心 Agent 上**。
 *
 * 显式具名导出，不用 export *：多一层人眼可查的清单，
 * 谁被挂上去了一目了然（这个项目的工具集曾经"提示词里点名的比实际挂载的多"，
 * 那份清单就是从这里漏出去的）。
 *
 * 注意同目录下还有几个**不在这里出口**、也**不许再被 import** 的文件：
 *   · tools/database.ts  —— 走 agent/my-app 的服务、写 resources/myapp.sqlite，已作废
 *   · tools/subagents.ts —— 调子 agent 的那一套，尚未接入（阶段 2 只做落库/读取）
 *   · tools/tasks.ts     —— 断点续跑的手工侧，generate_chapter 内部已自带
 *   · tools/index.ts     —— 旧出口，里面的 export * from './chapter' 指向不存在的文件
 * 它们是迁移参考，不是运行时依赖。（清理只能 mv 隔离，本机不许删。）
 */
export * from './memory'
export * from './portrait'
export { generateChapterTool } from './chapterStandalone'
export { worldTools, saveWorld, readWorld } from './world'

// per-novel 库的落库 / 读取工具（阶段 2 新挂）
export { characterTools, saveCharacter, readCharacters } from './character'
export { locationTools, saveLocation, readLocations } from './location'
export { outlineTools, saveVolumeOutline, readOutline } from './outline'
export { chapterOutlineTools, saveChapterOutline, readChapters } from './chapterOutline'
export { decisionTools, saveActorDecision, readActorDecisions } from './decision'
