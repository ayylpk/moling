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
 * ── 不再使用的旧文件 ──
 *   · tools/database.ts  —— 旧的直连工具，已由 my-app 门面替代，不得重新接入。
 *   · tools/subagents.ts —— 旧的七个子 agent 整体封装。五个已迁成
 *     generate_world / generate_character / generate_location / generate_outline /
 *     generate_decision；run_chapter_writer 与 run_prose_polisher **刻意不迁** ——
 *     正文是 generate_chapter 内部一条龙的事，不再暴露第二套章节调度工具。
 *   · tools/tasks.ts     —— 断点续跑的调度侧（plan/claim/finish/fail）。它的活在
 *     chapterRuntime + generate_chapter 里；用户和中心 Agent 都不直接管 generation_tasks。
 *   · tools/index.ts     —— 旧出口（`export * from './chapter'` 指向不存在的文件），更早一批移走。
 * 这些旧工具不能重新接入：它们绕过当前 controller/service 业务门面，或暴露了不应由中心 Agent
 * 直接管理的底层调度动作。当前工具统一从 `agent/my-app` 门面调用，门面内部写 per-novel SQLite。
 * 要看某个子 agent 的提示词，去 agent/<Name>/prompt.ts，那是原件。
 * 口径提醒：**没有"子 agent 的工具"**——挂上的一律是中心 Agent 的工具。
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
