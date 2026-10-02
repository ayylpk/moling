/**
 * 命令行直跑，仅供本地调试。
 *
 * 内置一份演示输入（沈砚第二章），终端问一句章纲 JSON 的文件路径即可覆盖。
 * 跑法：bun agent/writer/run.ts            → 用内置演示
 *       bun agent/writer/run.ts ch2.json   → 从文件读章纲（argv 优先）
 */
import { writerAgent } from "./agent";
import { buildWriterPrompt } from "./prompt";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { readFileSync } from "node:fs";

const WORLD = `
premise: 换骨续命之术真实存在，但每一次都必须以一具同血脉的活人心脏为引，且须此人自愿开口应允，术才成立。
rules:
1. 换骨延寿 — 可续寿十年；须同血脉至亲自愿应允并以活心为引；一生至多三次，第三次术者必死。
2. 断脉试药 — 可自断经脉试药性；每断一次折十年寿数；断满三次即成废人。
forbidden: 不许出现无代价的延寿；不许出现以强迫手段生效的应允。
terms: 换骨续命 / 药引 / 应允 / 青州旧观 / 镇北司
`;

const CAST = `
沈砚（主角）—— seventeen，右手腕有一道旧疤（十岁替兄长挡下的）；说话先低头再看人。
  want: 查清师父十二年前"飞升"的真相。 need: 一个不会骗他的亲人。 flaw: 他相信亲人不会骗他。
  line: 不能拿师父的尸骨做交易。
  他知道：师父旧居的锁被撬开过，锁孔里有新铜屑。
沈无咎（antagonist）—— 断去左手两指，随身铜药囊，口头禅"划算"。
  want: 三年内凑齐九味药引。 flaw: 把"划算"当唯一的尺子，算不出"有人愿意白给他一样东西"。
  line: 不能有人当着他的面说"你师父比你强"。
`;

const PLACES = `
青州旧观 —— signature: 观里所有门都比墙新。 features: 药炉冷了三年的焦味、廊下青苔滑、
  正殿窗纸破在东边、夜里的风从井口往上灌。
`;

const STYLE = "冷硬白描，句子短，少形容词。情感靠动作和物件传递，不靠心理独白。";

const PREVIOUS =
  "第 1 章《旧观无主》：沈砚清点师父遗物，沈无咎替他挡下上门问话的镇北司差役。夜里他发现师父旧居的锁被撬开过，锁孔里有新铜屑。";

const CHAPTER = JSON.stringify(
  {
    index: 2,
    title: "铜片上的九道刻痕",
    goal: "沈砚进师父旧居，找出师父留下的最后一件东西。",
    conflict: "沈无咎守在门外，一边替他把风一边不断打断他的翻找，沈砚必须在兄长眼皮底下藏起找到的东西。",
    hook: "铜片背面九道刻痕，第九道是新刻的。",
    emotion: "从对兄长的依赖，转向第一次对兄长隐瞒。",
    summary: "沈砚在师父旧居墙缝里找到一枚刻着换骨续命的铜片，背面九道刻痕，第九道是新刻的。他把铜片藏进袖中，出门时沈无咎替他拂了拂袖子。",
    place: "青州旧观",
    characters: ["沈砚", "沈无咎"],
    wordCountTarget: 3000,
  },
  null,
  2,
);

const DECISIONS = "无（本章没有需要裁决的分叉）";

if (!writerAgent) {
  console.error("缺少 API Key，writerAgent 未初始化。");
  process.exit(1);
}

const read = readline.createInterface({ input, output });

const argvPath = process.argv[2]?.trim();
const typed = argvPath ? "" : await read.question("章纲 JSON 文件路径（回车用内置演示第 2 章）：");
read.close();

let chapter = CHAPTER;
const path = argvPath || typed.trim();
if (path) {
  chapter = readFileSync(path, "utf8");
  console.log(`已从文件读取章纲：${path}`);
}

const result = await writerAgent.invoke({
  messages: [
    {
      role: "user",
      content: buildWriterPrompt({
        world: WORLD,
        cast: CAST,
        places: PLACES,
        style: STYLE,
        previous: PREVIOUS,
        chapter,
        decisions: DECISIONS,
      }),
    },
  ],
});

const out = result.structuredResponse;
console.log("\n──────── 正文 ────────\n");
console.log(out.text);
console.log("\n──────── 元信息 ────────");
console.log(JSON.stringify({ summary: out.summary, endsWith: out.endsWith, 字数: out.text.length }, null, 2));
