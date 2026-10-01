/**
 * 命令行直跑，仅供本地调试。
 *
 * 内置一份演示切片（沈砚）和一处真实分叉点，终端只问一句情境即可覆盖。
 * 跑法：bun agent/Actor/run.ts
 *
 * 注意：演示数据里**不含** arc.end —— 这是刻意的，给了终点角色就会直奔终点。
 */
import { actorAgent } from "./agent";
import type { Actor, ActorScene } from "./agent";
import { buildActorPrompt } from "./prompt";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

const ACTOR: Actor = {
  name: "沈砚",
  voice: "句子短。问句多，陈述句少。从不喊人名字，开口先低头再看人。",
  want: "查清师父十二年前究竟是飞升还是被害。",
  cost: "愿意自断经脉试药性，每断一次折十年寿数。",
  need: "一个不会骗他的亲人；他一直以为这个人是他哥。",
  flaw: "他相信亲人不会骗他，所以他总是先排除最该怀疑的那个人。",
  line: "可以骗他、可以打他，但不能拿师父的尸骨做交易。",
  immutable: ["右手腕有一道旧疤，十岁替兄长挡下的", "说话带青州口音"],
  relations: ["沈无咎——他哥，旧观里唯一还认他的人"],
  knows: [
    "师父旧居的锁被撬开过，锁孔里有新铜屑",
    "师父旧居墙缝里有一枚刻着换骨续命的铜片，背面九道刻痕，第九道是新刻的",
    "他哥的铜药囊夹层里有纸",
    "镇北司差役临走说过：井里捞出来的东西，你们最好自己先看一眼",
  ],
};

const SCENE: ActorScene = {
  story:
    "旧观掌观者已死，只剩师徒数人。沈砚在清点师父遗物，他哥沈无咎替他挡下了上门问话的镇北司差役。夜里他发现师父旧居的锁被撬开过，锁孔里有新铜屑。第二天他在墙缝里找到了那枚铜片，把它藏进了袖子。",
  situation:
    "他哥正在门外等他，说要一起去看井。沈砚袖子里藏着刚从师父旧居找到的铜片，他哥还不知道他拿到了。",
  options: {
    A: "把铜片拿出来给他哥看，直接问背面九道刻痕是什么意思。",
    B: "不提铜片，先跟他哥去看井，路上旁敲侧击井底有什么。",
    C: "找个借口不去了，趁他哥不在自己一个人先下井。",
  },
  chatPrompt: "以上三条都不是他会做的——那就写出来他会怎么做。",
};

if (!actorAgent) {
  console.error("缺少 API Key，actorAgent 未初始化。");
  process.exit(1);
}

const read = readline.createInterface({ input, output });

console.log(`当前情境：\n${SCENE.situation}\n`);
const typed = await read.question("回车用上面的情境，或输入新的情境：");
read.close();

const scene = typed.trim() ? { ...SCENE, situation: typed.trim() } : SCENE;

const result = await actorAgent.invoke({
  messages: [{ role: "user", content: buildActorPrompt({ actor: ACTOR, scene }) }],
});

console.log(JSON.stringify(result.structuredResponse, null, 2));
