/**
 * 命令行直跑，仅供本地调试。
 *
 * 静态指令走 systemPrompt（agent.ts 里传的 ARCHITECT_PROMPT），
 * 这里只负责拼 user message 的动态数据段。
 *
 * 世界观 / CAST / PREVIOUS / 文风都用内置演示值，终端只问一句"本卷要写什么"。
 * 跑法：bun agent/Architect/run.ts
 *
 * 注意：本 agent 一次只出一卷（约 50 章）。跑之前先想清楚 NEED 里的篇幅。
 */
import { outlineAgent } from "./agent";
import { buildArchitectPrompt } from "./prompt";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

const WORLD = `
premise: 换骨续命之术真实存在，但每一次都必须以一具同血脉的活人心脏为引，且须此人自愿开口应允，术才成立。
rules:
1. 换骨延寿 — 可续寿十年；须同血脉至亲自愿应允并以活心为引；一生至多三次，第三次术者必死。
2. 断脉试药 — 可自断经脉试药性；每断一次折十年寿数；断满三次即成废人。
3. 应允不可强取 — 任何胁迫下的口头应允都不成立；术者只能等对方自己开口。
factions: 青州旧观（衰败的道门，掌观者已死）/ 镇北司（缉拿邪修的官署，只认尸首，不问缘由）
places: 青州 / 青州旧观 / 镇北司
terms: 换骨续命 / 药引 / 应允
forbidden: 不许出现无代价的延寿；不许出现凭空飞升、坐化成仙；不许出现以强迫手段生效的应允。
`;

const CHARACTERS = `
- 沈砚（主角）：沈无咎的胞弟，十七岁。右手腕一道旧疤（十岁替兄长挡下的）；说话先低头再看人。
  want: 查清师父十二年前"飞升"的真相。 need: 一个不会骗他的亲人。 flaw: 他相信亲人不会骗他。
  line: 不能拿师父的尸骨做交易。
- 沈无咎（antagonist）：断去左手两指，随身铜药囊，口头禅"划算"。
  want: 三年内凑齐九味药引。 need: 一个能证明"我这条命值得被留下"的人。
  flaw: 把"划算"当唯一的尺子，算不出"有人愿意白给他一样东西"。 line: 不能有人说"你师父比你强"。
`;

const PREVIOUS = "这是第一卷，从第 1 章开始。此前无任何已写内容，全篇锚点由本卷定稿。";

const STYLE = "冷硬白描，句子短，少形容词。情感靠动作和物件传递，不靠心理独白。";

if (!outlineAgent) {
  console.error("缺少 API Key，outlineAgent 未初始化。");
  process.exit(1);
}

const read = readline.createInterface({ input, output });

const need = await read.question("请输入本卷的要求（篇幅、走向、范围）：");
read.close();

const answer = await outlineAgent.invoke({
  messages: [
    {
      role: "user",
      content: buildArchitectPrompt({
        world: WORLD,
        characters: CHARACTERS,
        previous: PREVIOUS,
        style: STYLE,
        need,
      }),
    },
  ],
});

console.log(JSON.stringify(answer.structuredResponse, null, 2));
