/**
 * 命令行直跑，仅供本地调试。
 *
 * 内置一段**故意写满 AI 味**的演示草稿，终端问一句正文文件路径即可覆盖。
 * 跑法：bun agent/Polisher/run.ts            → 用内置演示
 *       bun agent/Polisher/run.ts ch2.txt    → 从文件读正文（argv 优先）
 */
import { polisherAgent } from "./agent";
import { buildPolisherPrompt } from "./prompt";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { readFileSync } from "node:fs";

const TERMS = "换骨续命 / 药引 / 应允 / 青州旧观 / 镇北司";

const FORBIDDEN = "不许出现无代价的延寿；不许出现以强迫手段生效的应允。";

const STYLE = "冷硬白描，句子短，少形容词。情感靠动作和物件传递，不靠心理独白。";

/** 刻意塞满了禁用词、二分对照壳、破折号、安全比喻、段尾抽象收束 */
const DRAFT = `沈砚不由得停住了脚步。他心中暗道，这扇门不对劲。

这不是一扇普通的门，而是一道横在他和真相之间的屏障。他顿时恍然大悟，良久才回过神来。门缝里透出的，不仅仅是光，更是一种难以言喻的东西。他的眼底闪过一丝波澜。

他微微一笑，嘴角微微上扬，仿佛终于抓住了什么。就在这时，他猛地伸手推开了门。空气中弥漫着一种陈旧的气息，那是时间的味道——像一本无人翻阅的旧书。

他知道，自己再也回不去了。

这一刻，他忽然明白了很多事。作为一名修士，他理应保持冷静。他的心中五味杂陈，气氛瞬间凝滞了。

而这一切，才刚刚开始。`;

if (!polisherAgent) {
  console.error("缺少 API Key，polisherAgent 未初始化。");
  process.exit(1);
}

const read = readline.createInterface({ input, output });

const argvPath = process.argv[2]?.trim();
const typed = argvPath ? "" : await read.question("待润色的正文文件路径（回车用内置演示草稿）：");
read.close();

let text = DRAFT;
const path = argvPath || typed.trim();
if (path) {
  text = readFileSync(path, "utf8");
  console.log(`已从文件读取正文：${path}`);
}

const result = await polisherAgent.invoke({
  messages: [
    {
      role: "user",
      content: buildPolisherPrompt({ terms: TERMS, forbidden: FORBIDDEN, style: STYLE, text }),
    },
  ],
});

const out = result.structuredResponse;
console.log("\n──────── 润色后 ────────\n");
console.log(out.text);
console.log("\n──────── 改动清单 ────────");
console.log(`原文 ${text.length} 字 → 改后 ${out.text.length} 字，变动 ${(((out.text.length - text.length) / text.length) * 100).toFixed(1)}%`);
console.log(JSON.stringify(out.changes, null, 2));
