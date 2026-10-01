import { outlineAgent } from "./agent";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

if (!outlineAgent) {
  console.error("缺少 API Key，outlineAgent 未初始化。");
  process.exit(1);
}

const read = readline.createInterface({ input, output });

const need = await read.question("请输入本次大纲的要求（篇幅、走向、范围）：");
read.close();

const answer = await outlineAgent.invoke({
  messages: [{ role: "user", content: need }],
});

console.log(JSON.stringify(answer.structuredResponse, null, 2));
