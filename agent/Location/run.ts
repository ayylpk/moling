import { locationAgent } from "./agent";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

if (!locationAgent) {
  console.error("缺少 API Key，locationAgent 未初始化。");
  process.exit(1);
}

const read = readline.createInterface({ input, output });

const need = await read.question("请输入这个地点要承担的戏剧功能与出现位置：");
read.close();

const answer = await locationAgent.invoke({
  messages: [{ role: "user", content: need }],
});

console.log(JSON.stringify(answer.structuredResponse, null, 2));
