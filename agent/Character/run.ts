import { characterAgent } from "./agent";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

if (!characterAgent) {
  console.error("缺少 API Key，characterAgent 未初始化。");
  process.exit(1);
}

const read = readline.createInterface({ input, output });

const description = await read.question("请输入角色的戏剧功能与故事位置：");
read.close();

const answer = await characterAgent.invoke({
  messages: [{ role: "user", content: description }],
});

console.log(JSON.stringify(answer.structuredResponse, null, 2));
