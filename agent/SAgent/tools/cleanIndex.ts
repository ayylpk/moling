/**
 * SAgent 的工具总出口 —— **只有从这里出去的工具才会真正挂到中心 Agent 上**。
 *
 * 显式具名导出，不用 export *：多一层人眼可查的清单，
 * 谁被挂上去了一目了然（这个项目的工具集曾经"提示词里点名的比实际挂载的多"，
 * 那份清单就是从这里漏出去的）。
 *
 * ── 两类工具的分工 ──
 *   生成类（generate_*）：调子 agent 产出内容，**不写库**，把草案交给中心 Agent
 *   落库/读取类（save_* / read_*）：写读 per-novel 库，由中心 Agent 决定何时采纳
 * 「生成」与「落库」是两个动作，别把它们合成一个工具 —— 合成之后
 * "生成不满意"就只能靠重跑整条链来收拾，而生成是贵的那个。
 *
 * ── 同目录下不在出口、也不许再被 import 的文件 ──
 *   · tools/database.ts  —— 走 agent/my-app 的服务、写 resources/myapp.sqlite，**继续废弃，禁止再挂**
 *   · tools/subagents.ts —— 旧的整体封装，**不要整体 import**（它 import 了 my-app 的 service）。
 *     其中五个已迁成 generate_world / generate_character / generate_location / generate_outline /
 *     generate_decision；剩下的 run_chapter_writer 与 run_prose_polisher **刻意不迁** ——
 *     正文是 generate_chapter 内部一条龙的事，不再暴露第二套章节调度工具。
 *   · tools/tasks.ts     —— 断点续跑的调度侧（plan/claim/finish/fail）。**不作为工具挂载**：
 *     它属于 generate_chapter 的内部实现，用户和中心 Agent 都不直接管理 generation_tasks。
 *   · tools/index.ts     —— 旧出口，里面的 export * from './chapter' 指向不存在的文件
 * 它们是迁移参考，不是运行时依赖。（清理只能 mv 隔离，本机不许删。）
 * 口径提醒：**没有"子 agent 的工具"**——上面这些挂了都是中心 Agent 的工具，只是有的还没接。
 */
export * from './memory'
export * from './portrait'
export { generateChapterTool } from './chapterStandalone'
export { worldTools, saveWorld, readWorld } from './world'

// 生成类：调子 agent 产出内容，不落库（采纳与否由中心 Agent 决定）
export { generateWorld, worldGenerationTools } from './generateWorld'
export { generateCharacter, characterGenerationTools } from './generateCharacter'
export { generateLocation, locationGenerationTools } from './generateLocation'
export { generateOutline, outlineGenerationTools } from './generateOutline'
export { generateDecision, decisionGenerationTools } from './generateDecision'

// 落库 / 读取：写读当前小说的 per-novel 库
export { characterTools, saveCharacter, readCharacters } from './character'
export { locationTools, saveLocation, readLocations } from './location'
export { outlineTools, saveVolumeOutline, readOutline } from './outline'
export { chapterOutlineTools, saveChapterOutline, readChapters } from './chapterOutline'
export { decisionTools, saveActorDecision, readActorDecisions } from './decision'
