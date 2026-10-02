/**
 * 命令行直跑，仅供本地调试。
 *
 * 静态指令走 systemPrompt（agent.ts 里传的 CHARACTER_PROMPT），
 * 这里只负责拼 user message 的动态数据段——按 A 方案，不再有 {PLACEHOLDER}。
 *
 * 世界观和文风用内置演示值，终端只问一句"这个角色要填什么戏剧功能"。
 * 跑法：bun agent/Character/run.ts
 */
import { characterAgent } from "./agent";
import { buildCharacterPrompt } from "./prompt";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

const WORLD = `
premise: 换骨续命之术真实存在，但每一次都必须以一具同血脉的活人心脏为引，且须此人自愿开口应允，术才成立。
rules:
1. 换骨延寿 — 可续寿十年；须同血脉至亲自愿应允并以活心为引；一生至多三次，第三次术者必死。
2. 断脉试药 — 可自断经脉试药性；每断一次折十年寿数；断满三次即成废人。
factions: 青州旧观（衰败的道门，只剩师徒数人）/ 镇北司（缉拿邪修的官署，只认尸首）
places: 青州 / 青州旧观 / 镇北司
terms: 换骨续命 / 药引 / 应允
forbidden: 不许出现无代价的延寿；不许出现凭空飞升、坐化成仙；不许出现以强迫手段生效的应允。
`;

const STYLE = "冷硬白描，句子短，少形容词。情感靠动作和物件传递，不靠心理独白。";

if (!characterAgent) {
  console.error("缺少 API Key，characterAgent 未初始化。");
  process.exit(1);
}

const read = readline.createInterface({ input, output });

const need = await read.question("请输入角色的戏剧功能与故事位置：");
read.close();

const answer = await characterAgent.invoke({
  messages: [
    {
      role: "user",
      content: buildCharacterPrompt({ world: WORLD, need, style: STYLE }),
    },
  ],
});

console.log(JSON.stringify(answer.structuredResponse, null, 2));
