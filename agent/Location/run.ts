/**
 * 命令行直跑，仅供本地调试。
 *
 * 静态指令走 systemPrompt（agent.ts 里传的 LOCATION_PROMPT），
 * 这里只负责拼 user message 的动态数据段。
 *
 * 世界观与"已披露地点"用内置演示值，终端只问一句"这个地点要干什么"。
 * 跑法：bun agent/Location/run.ts
 */
import { locationAgent } from "./agent";
import { buildLocationPrompt } from "./prompt";
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

const EXISTING = `
青州旧观（parent: 青州）—— 已经披露。
  signature: 观里所有的门都比墙新。
  features: 药炉冷了三年的焦味 / 廊下青苔滑 / 正殿窗纸破在东边 / 夜里的风从井口往上灌。
`;

if (!locationAgent) {
  console.error("缺少 API Key，locationAgent 未初始化。");
  process.exit(1);
}

const read = readline.createInterface({ input, output });

const need = await read.question("请输入这个地点要承担的戏剧功能与出现位置：");
read.close();

const answer = await locationAgent.invoke({
  messages: [
    {
      role: "user",
      content: buildLocationPrompt({ world: WORLD, existing: EXISTING, need }),
    },
  ],
});

console.log(JSON.stringify(answer.structuredResponse, null, 2));
