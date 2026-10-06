/**
 * 手工扮演「中心 agent」的驱动脚本。
 *
 * 中心 agent 还没建，所以这一步由这个脚本顶替它：按顺序调子 agent、把上一步的输出
 * 喂给下一步、把中间产物落盘（agent/pipeline/out/）。
 *
 * 跑法（一次一个阶段，便于中途检查）：
 *   bun agent/pipeline/run.ts world        → 世界观
 *   bun agent/pipeline/run.ts cast         → 男女主(手写) + 学校人物 + 地点
 *   bun agent/pipeline/run.ts outline      → 50 章大纲
 *   bun agent/pipeline/run.ts chapter      → 第 1 章正文 + 润色
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(import.meta.dir, "out");
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });

const outPath = (name: string) => resolve(DIR, `${name}.json`);
const save = (name: string, value: unknown) => {
  writeFileSync(outPath(name), JSON.stringify(value, null, 2), "utf8");
  console.log(`  → 已保存 out/${name}.json`);
};
const load = <T>(name: string): T =>
  JSON.parse(readFileSync(outPath(name), "utf8")) as T;

// ─────────────────────────────────────────────────────────────
// 交付要求（来自用户 brief）
// ─────────────────────────────────────────────────────────────

const BRIEF = `
题材：校园恋爱，高三。南方某地级市的走读制普通高中。

【硬性设定】
- 所有地名、校名、街道名一律虚构，不得出现任何真实地名。
- 这是一个没有异能、没有战斗的现实世界。唯一的超自然设定是「穿越」：
  男主在第一段人生里因一场车祸失去了青梅，随后回到高三百日誓师那天，重来一次。
- 穿越必须写成一条**有代价、有界线**的规则——它会决定结局。第二段人生末尾，
  男主在医院门口突发意外离世，那就是这次穿越的代价。这条代价必须在故事前段就埋下伏笔。

【主要人物】
- 男主：高三生，家庭幸福美满，父母都在身边。第一段人生里喜欢同班校花，人尽皆知。
- 女主：男主的青梅，从小一起长大，两家只隔着一条街。留守，父母长期在外打工。
  第二段人生里，男主这次选择了她。两人的甜蜜关系是主线；她慢慢养成轻度占有欲
  （病娇向，但只到「占有」，不涉及任何人身伤害）——有一次她把男主拷在自己家里，
  没做过分的事，只是在他怀里睡着了。

【口味】
- 清水向。不出现性描写，不出现越界身体接触。
- 以撒糖为主线。糖要具体：一件具体的事、一句具体的话、一个具体的物件。
- 调性：南方小城的潮湿、闷热、走读生的通勤、晚自习、月考、留守家庭的空房子。
`;

const STYLE = `
冷硬白描，句子短，少形容词。情感靠动作和物件传递，不靠心理独白。
对话口语化，符合高三学生的说话方式。南方的潮、热、雨要有体感。
`;
const GENRE = "现实校园恋爱，核心冲突来自人物选择与关系变化；不得引入异能、战斗或真实地名。";

// ─────────────────────────────────────────────────────────────

const stage = process.argv[2] || "world";
console.log(`\n=== 阶段：${stage} ===\n`);

if (stage === "world") {
  const { createWorldAgent, parseWorld } = await import("../story-planner/agent");
  const agent = createWorldAgent();
  const need = `${BRIEF}

请把这个设定整理成世界观圣经。
- rules：把「穿越」写成一条规则，必须有 ability / cost / limit 三件套。
  它的 cost 就是结局里那条代价，要写死。另外可以补充少量现实规则（走读通勤、晚自习、月考）。
- premise：一句话，是这个故事的前提。
- factions：不要写势力。这里只有家庭、班级、年级这种很小的社会单位，没有势力就留空数组。
- places：只给粗骨架——虚构的城市名、学校名、两个家庭所在的街区名。
- terms：列出这个世界所有专名（城市 / 学校 / 街道 / 关键物件）。
- forbidden：必须包含这四条——不得出现真实地名；不得出现性描写与越界身体接触（清水向）；
  不许出现无代价的穿越；不许把穿越写成可以随意反复使用的能力。`;

  const result = await agent.invoke({ messages: [{ role: "user", content: need }] });
  const world = parseWorld(result.structuredResponse);
  save("world", world);
  console.log(JSON.stringify(world, null, 2));
}

// ─────────────────────────────────────────────────────────────
// 阶段2：角色 + 地点
// ─────────────────────────────────────────────────────────────

if (stage === "cast") {
  const world = load<any>("world");

  /** 把 world 序列化成可注入的紧凑文本 */
  const worldText = [
    `premise: ${world.premise}`,
    "rules:",
    ...world.rules.map(
      (r: any, i: number) => `${i + 1}. ability: ${r.ability} | cost: ${r.cost} | limit: ${r.limit}`,
    ),
    `places: ${world.places.map((p: any) => `${p.name}（${p.where}）`).join(" / ")}`,
    `terms: ${world.terms.map((t: any) => t.name).join(" / ")}`,
    `forbidden:`,
    ...world.forbidden.map((f: string) => `- ${f}`),
  ].join("\n");

  /** 手写的主角卡：用户已给全设定，直接落成 CharacterSchema 形状，不走 agent。 */
  const PROTAGONISTS = [
    {
      name: "周砚",
      role: "protagonist",
      immutable: [
        "左手虎口有一道浅疤，初二削铅笔削的，一直没退",
        "右眉尾断了一小截，小时候从隔街巷的矮墙上摔下来磕的",
        "总是把校服外套的拉链拉到最上面，哪怕六月",
        "书包侧袋常年插一把黑柄折叠伞，临江的雨说来就来",
        "走路习惯贴着墙根，靠右",
      ],
      voice:
        "句子短，常用「嗯」「行」这类单字回应。心里有事的时候会重复对方最后一个词。从不说「我爱你」，最重的话是「我在」。",
      want: "在第一段人生里，让同班的苏晴注意到他——他喜欢苏晴这件事全校都知道。",
      cost: "为了这件事，他把每天和林晚一起走的那二十分钟拆开，改成绕路去苏晴常走的那条坡道；他愿意担这个代价，且从没觉得那是代价。",
      need: "一个不用他做任何事、就已经在那里等他的人。他从小就有，但他一直没看见。",
      secret: "他一直偷偷收着林晚从小到大塞在他书包里的东西——一颗糖、一张卷子角、一片榕树叶。他没告诉过任何人，包括他自己都不承认那是收着。",
      reveal: "当林晚在他面前出事、他冲过去却只碰到她的袖口那一次，他会在同一瞬间明白自己在收着什么。",
      line: "不能有人当着他的面说林晚「没人要」。这一句越线，他立刻翻脸，不管对方是谁。",
      flaw: "他相信「重要的事可以以后再说」。他把所有真正重要的话都存在一个「以后」里，所以他从不在当下开口。",
      relations: [
        { id: "林晚", attitude: "从有记忆起就住在隔街，是空气一样的存在；他没想过有一天会没有她" },
      ],
      arc: {
        start: "一个把「喜欢」当成一件要办的事的高三男生，追的是全校都看得见的那一个，看不见隔街的那一个。",
        end: "第二段人生里他过完了一百天，把每一句话都说在了当下；在医院门口倒下之前，他已经把该说的全部说完了。他没有活下来。",
      },
      status: "alive",
    },
    {
      name: "林晚",
      role: "protagonist",
      immutable: [
        "头发永远扎得很紧，一根碎发都不放下来",
        "校服袖口磨出了毛边，是自己洗了太多次",
        "左手食指内侧有一小块笔茧，写字很用力",
        "家里钥匙挂在脖子上，用一根红绳，从不摘",
        "走路不出声，经常在人背后站定了才被发觉",
      ],
      voice:
        "话极少，句子极短。想问什么就直接问，不加「那个」「不好意思」。撒娇的时候不用语气词，只是把手里东西递过去。从不解释自己的行为。",
      want: "让周砚每天放学都在校门口等她——已经等了十几年，她想让这件事一直继续下去，哪怕他这段时间绕路去追苏晴，她也只是站在原地等。",
      cost: "她愿意一个人吃掉所有「他今天又没来」的晚上，愿意在隔街那栋空房子里一个人待到十一点，愿意不问他为什么。",
      need: "一个不会走的人。父母常年在外，她所有的安全感都押在同一个人身上，所以她要的不是甜，是「确定」。",
      secret: "第一段人生里出事那天，她是故意跟上去的——她知道周砚要去找苏晴，她想抄近路先到路口等他，那样他会先看见她。她没告诉任何人，这件事她带进了自己的结局里。",
      reveal: "第二段人生里，周砚第一次问出「那天你为什么会往马路上走」的时候，她会沉默很久，然后说「我想让你先看见我」。",
      line: "不能有人替她做决定。周砚替她决定「这样对你好」时，她会立刻冷下来，哪怕对方是好意。",
      flaw: "她只会用「等在原地」来表达在乎，不会开口要。所以她永远在被看见之前先被忽略。",
      relations: [
        { id: "周砚", attitude: "从有记忆起就在隔街隔着一条马路的那一个；她把他当成唯一不会走的人，所以从不问他去哪" },
      ],
      arc: {
        start: "一个把全部安全感押在一个人身上的留守女孩，习惯等，习惯不问，习惯自己待着。",
        end: "第二段人生里她第一次开口要，第一次把人留住，第一次在急诊门口没有哭。最后她拿回了他留下的全部东西，把它们写成了一本书。",
      },
      status: "alive",
    },
  ];

  const castList: string[] = [
    "周砚（主角，protagonist）—— 男主。追苏晴人尽皆知。",
    "林晚（主角，protagonist）—— 女主。青梅，住隔街巷，留守。",
  ];

  const { createCharacterAgent } = await import("../Character/agent");
  const { buildCharacterPrompt } = await import("../Character/prompt");
  const { createLocationAgent } = await import("../Location/agent");
  const { buildLocationPrompt } = await import("../Location/prompt");

  const SUPPORTING = [
    {
      id: "苏晴",
      need: "同班校花，年级排名前五，家境好，人缘好。周砚第一段人生里喜欢的人，「人尽皆知」的那一个。她的戏剧功能是：作为男主前半段执念的载体，同时也是第二段人生里最大的一块对照——她什么都不缺，所以男主转向林晚这件事，在她那里没有掀起任何波澜，这本身就是本书要写的东西。她不是反派，也不使坏。",
    },
    {
      id: "陈默",
      need: "周砚的同班死党，坐他后排，爱起哄，是「周砚喜欢苏晴」这件事的传播源。戏剧功能：一是当旁观者和见证者，让「男主的转变」被班里人看见；二是提供低强度的喜剧调剂；三是他的不加掩饰会不断戳破周砚的自我欺骗。",
    },
    {
      id: "何雨",
      need: "林晚的同班同学，也是她唯一说得上话的朋友。戏剧功能：一是替读者问出林晚不会说的话；二是她是第一个看出林晚占有欲正在成形的人，并且会提醒、会退让、也会害怕；三是她是林晚在班主任和同学面前唯一的社会缓冲。",
    },
    {
      id: "曹立",
      need: "高三(7)班班主任，教数学，四十多岁，带过十届高三。戏剧功能：一是「百日誓师」的组织者，是故事时间起点的发令人；二是升学和月考排名的压力来源，让甜蜜关系始终有一层现实底色；三是他会看到周砚的成绩变化，从而成为第一个对「周砚好像变了」产生疑问的老师。",
    },
  ];

  const supporting: unknown[] = [];
  for (const item of SUPPORTING) {
    const agent = createCharacterAgent();
    const need = `
戏剧功能与出现位置：
${item.need}

已有角色清单（relations 只能引用这些，id 一律直接用姓名）：
${castList.join("\n")}

补充约束：
- relations 的 id 字段直接用对方姓名，形如 {"id":"周砚","attitude":"..."}。
- 这是清水向校园恋爱，不要给角色加任何超自然能力。
- 不要写反派，不要写霸凌者。
`;
    const res = await agent.invoke({
      messages: [
        { role: "user", content: buildCharacterPrompt({ world: worldText, need, style: STYLE }) },
      ],
    });
    const card = res.structuredResponse;
    supporting.push(card);
    castList.push(`${(card as any).name}（${(card as any).role}）—— ${item.need.slice(0, 28)}…`);
    console.log(`  ✓ ${(card as any).name}`);
  }

  const LOCATIONS = [
    { id: "教室", need: "高三(7)班教室，位于教学楼四楼东侧。戏剧功能：全书出现频率最高的地点，周砚和林晚的座位在这里；也是「他绕路去追苏晴」与「他一直坐在她旁边」这两件事同时发生的地方。" },
    { id: "天台", need: "教学楼天台，通过四楼消防通道的一扇没锁的门上去。戏剧功能：两人关系里唯一一个没有旁人的地方，用来放最重的那几句话；也是男主身体出现征兆（耳鸣、失神）时被撞见的场所。" },
    { id: "旧楼房间", need: "隔街巷那栋两层旧楼的二楼房间，林晚一个人住。戏剧功能：她的空房子，是甜蜜关系的主要发生地，也是她占有欲成形的地点——「把他留在自己家里」这件事就发生在这里。" },
    { id: "医院站台", need: "临江市第一人民医院门口的公交站台。戏剧功能：第二段人生终点，男主在这里倒下；前段的伏笔（体检、陪人看病、路过）都要指向这个站台。" },
  ];

  const existingPlaces: string[] = [
    `临江市（预定义）—— 虚构的南方地级市，故事的全部地理范围。`,
    `临江三中（预定义）—— 走读制普通高中，校门口一条种满榕树的坡道。`,
    `榕树街（预定义）—— 校门外坡道所在街区，周砚家。`,
    `隔街巷（预定义）—— 与榕树街只隔一条马路的旧巷，林晚家。`,
    `临江市第一人民医院（预定义）—— 城东，坐公交约半小时。`,
  ];

  const locations: unknown[] = [];
  for (const item of LOCATIONS) {
    const agent = createLocationAgent();
    const need = `
这个地点要承担的戏剧功能与出现位置：
${item.need}

补充约束：
- parent 必须从上列已有地名里选一个填进去（填名字即可），不要另造城市或学校。
`;
    const res = await agent.invoke({
      messages: [
        {
          role: "user",
          content: buildLocationPrompt({
            world: worldText,
            existing: existingPlaces.join("\n"),
            need,
          }),
        },
      ],
    });
    const card = res.structuredResponse;
    locations.push(card);
    existingPlaces.push(`${(card as any).name}（parent: ${(card as any).parent}）—— ${(card as any).signature}`);
    console.log(`  ✓ ${(card as any).name}`);
  }

  save("cast", { protagonists: PROTAGONISTS, supporting, locations });
  console.log(`\n角色 ${PROTAGONISTS.length + supporting.length} 张，地点 ${locations.length} 个。`);
}

// ─────────────────────────────────────────────────────────────
// 阶段3：50 章大纲
// ─────────────────────────────────────────────────────────────

if (stage === "outline") {
  const world = load<any>("world");
  const cast = load<any>("cast");

  const worldText = [
    `premise: ${world.premise}`,
    "rules:",
    ...world.rules.map(
      (r: any, i: number) =>
        `${i + 1}. ability: ${r.ability}\n   cost: ${r.cost}\n   limit: ${r.limit}`,
    ),
    `places: ${world.places.map((p: any) => `${p.name}（${p.where}）`).join(" / ")}`,
    `terms: ${world.terms.map((t: any) => t.name).join(" / ")}`,
    `forbidden:`,
    ...world.forbidden.map((f: string) => `- ${f}`),
  ].join("\n");

  const card = (c: any) =>
    [
      `【${c.name}】role: ${c.role}｜status: ${c.status}`,
      `  voice: ${c.voice}`,
      `  want: ${c.want}`,
      `  need: ${c.need}`,
      `  flaw: ${c.flaw}`,
      `  line: ${c.line}`,
      `  immutable: ${c.immutable.join("；")}`,
      `  relations: ${c.relations.map((r: any) => `${r.id}——${r.attitude}`).join("；")}`,
      `  arc: ${c.arc.start} → ${c.arc.end}`,
    ].join("\n");

  const castText = [...cast.protagonists, ...cast.supporting].map(card).join("\n\n");

  const placeText = [
    ...world.places.map((p: any) => `- ${p.name}（预定义，parent 之外）`,
    ),
    ...cast.locations.map(
      (l: any) =>
        `- ${l.name}（parent: ${l.parent}）\n  signature: ${l.signature}\n  features: ${l.features.join(" / ")}\n  role: ${l.role}`,
    ),
  ].join("\n");

  /**
   * 一次吐 50 章会撞 deepseek-chat 的输出上限（实测 finish_reason=length）。
   * 所以拆两次调用：上半 + 下半，下半通过 PREVIOUS 回填上半定稿的锚点。
   * 这正好是「分卷 + 锚点回填」机制要解决的问题，顺带验证它是否真的工作。
   */
  const NEED = (range: string) => `
本卷 = 全篇，50 章，每章 3000 字左右（wordCountTarget 填 3000）。
★ 本次调用**只出 ${range}**，不要越界去写别的章。

【三段结构】

一、前世线——**作为正文实写**。不是楔子，不是回忆，不压缩。要让读者真的认识"那个一直没被看见的林晚"。
   内容：高三百日誓师那天起，周砚追同班苏晴人尽皆知 → 一场车祸 → 林晚推开他、自己被撞 → 处理后事 → 他关上门坐在地上 → 回到百日誓师那天清晨。
   穿越本身要实写成戏：写清他意识到自己回到哪一天的那一瞬间。它是前段的收束，不是转场。

二、第二段人生——主体，占大头。
   周砚这次选择林晚。甜是主线；冲突是**低强度外部阻力**（月考排名、走读通勤、留守、班主任、陈默的起哄、苏晴的对照）。
   每章必须有一个**具体**的关系推进事件——不许写"两人关系更进一步"这种话。
   林晚的占有欲在这一段逐渐成形，到"把周砚拷在自己家里、只是抱着他睡着"那一场达到顶点。
   ★「穿越的代价」必须在这段**前部就埋下伏笔**：耳鸣、短暂失神、鼻腔出血；
     并且"第一人民医院门口公交站台"要至少出现两次（陪人看病 / 路过），先让读者记住它。

三、后段与收尾。
   高考完去游乐场约会 → 这次是林晚要被撞，周砚推开她 → 他进急诊，活下来了 → 以林晚的哭泣、担心、照顾为主线（前面有多甜，这里就有多紧）。
   录取通知书下来，两张一模一样 → 带去医院 → 在病房门口周砚突发意外去抢救（穿越的代价在这里回收）→ 没抢救回来。
   林晚在急诊门口看着两张通知书愣神，她**没有崩溃**，坦然接受了。此后她常去看周砚父母，一直没谈恋爱。
   尾声反转：这个故事其实是林晚自己写出来的，写完，她抱着周砚的遗物痛哭。

【硬要求】
- 全篇锚点（direction / structure.type / mainPlot / subplots）由本卷定稿。
- constraints.locations 只能从下面的地点清单里取，一个都不许新造。
- chapters 的 characters / place 只能引用给定的角色与地点；确实需要新的，写 NEW:戏剧功能。
- endingDirection 必须确定，不许出现"开放结局""留白""由作者决定"。
- 清水向校园恋爱。穿越是全篇唯一的超自然设定，不许出现战斗、异能、势力那类东西。
- 撒糖要求：糖要**具体**——一件具体的事、一句具体的话、一个具体的物件。
  严禁"相视一笑""眼底闪过温柔""心里一暖"这类写法出现在 summary / emotion 里。

【地点清单】
${placeText}
`;

  const { createArchitectAgent } = await import("../Architect/agent");
  const { buildArchitectPrompt } = await import("../Architect/prompt");
  const { createModel } = await import("../create_model");

  const agent = createArchitectAgent(createModel(0.5, 180_000, false, 8192));

  const call = async (need: string, previous: string, attempt = 0): Promise<any> => {
    const res = await agent.invoke({
      messages: [
        {
          role: "user",
          content: buildArchitectPrompt({
            world: worldText,
            characters: castText,
            previous,
            style: STYLE,
            need,
          }),
        },
      ],
    });
    const last: any = (res as any).messages?.at(-1);
    const meta = last?.response_metadata ?? {};
    const usage = meta.usage ?? meta.tokenUsage ?? {};
    const finish = meta.finish_reason ?? meta.stop_reason ?? "?";
    const calls = (last as any)?.tool_calls?.length ?? 0;

    const out = res.structuredResponse as any;
    if (out) {
      console.log(
        `    finish=${finish} out_tokens=${usage.completion_tokens ?? usage.output_tokens ?? "?"} ✓`,
      );
      return out;
    }

    // 实测：偶尔会返回 finish=tool_calls 但 structuredResponse 为空（args 没解析出来）。
    // 是瞬时的，重试即可。
    console.log(`    finish=${finish} out_tokens=${usage.completion_tokens ?? "?"} tool_calls=${calls} ✗ 空返回`);
    if (attempt < 2) {
      console.log(`    ↻ 重试（第 ${attempt + 2} 次）`);
      return call(need, previous, attempt + 1);
    }
    const content =
      typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? null);
    writeFileSync(resolve(DIR, "outline-raw.txt"), content ?? "", "utf8");
    throw new Error(`structuredResponse 连续 3 次为空（finish=${finish}）`);
  };

  const FIRST = "这是第一卷，从第 1 章开始。此前无任何已写内容，全篇锚点由本卷定稿。";

  /**
   * deepseek-chat 单次输出上限 8192 tokens，一次出 25 章以上必截断（实测）。
   * 所以按段循环：每段约 13 章，锚点由第一段定稿，后续段逐字回填。
   * 每段落盘缓存，重跑时直接复用，不必从头再跑。
   */
  const SEGMENTS = ["第 1–13 章", "第 14–26 章", "第 27–39 章", "第 40–50 章"];

  const previousFor = (segIndex: number, done: any[]) => {
    if (segIndex === 0) return FIRST;
    const anchor = done[0];
    return [
      FIRST,
      "",
      "【全篇锚点——第一段已定稿，必须逐字原样回填，一个字都不许改】",
      `direction: ${JSON.stringify(anchor.direction)}`,
      `structure.type: ${anchor.structure.type}`,
      `mainPlot: ${JSON.stringify(anchor.structure.mainPlot)}`,
      `subplots: ${JSON.stringify(anchor.structure.subplots)}`,
      "",
      "【此前已写完的部分】",
      ...done.flatMap((o) =>
        (o.chapters ?? []).map(
          (c: any) => `第${c.index}章《${c.title}》：${c.summary}［章末钩子：${c.hook}］`,
        ),
      ),
      "",
      `本段接着往下编号，不要从 1 重开。`,
    ].join("\n");
  };

  const partPath = (i: number) => resolve(DIR, `segment-${i + 1}.json`);
  const parts: any[] = [];
  for (const [i, seg] of SEGMENTS.entries()) {
    if (existsSync(partPath(i))) {
      parts.push(JSON.parse(readFileSync(partPath(i), "utf8")));
      console.log(`  ${seg} … 复用缓存 ✓`);
      continue;
    }
    console.log(`  ${seg} …`);
    const out = await call(NEED(seg), previousFor(i, parts));
    writeFileSync(partPath(i), JSON.stringify(out, null, 2), "utf8");
    parts.push(out);
  }

  const head = parts[0];

  /**
   * 各段都会把「全篇」的转折点重列一遍，直接 flatMap 会重复。
   * 去重规则：同一个 type 只保留章号最小的那一次（最早的首次声明）。
   * 顺序按章号排。
   */
  const TP_ORDER = [
    "inciting",
    "plot-point-1",
    "midpoint",
    "plot-point-2",
    "climax",
    "resolution",
  ] as const;
  const tpByType = new Map<string, any>();
  for (const tp of parts.flatMap((p) => p.structure.turningPoints ?? [])) {
    const prev = tpByType.get(tp.type);
    if (!prev || tp.chapter < prev.chapter) tpByType.set(tp.type, tp);
  }
  const turningPoints = TP_ORDER.filter((t) => tpByType.has(t)).map((t) => tpByType.get(t));

  const merged = {
    direction: head.direction,
    structure: {
      ...head.structure,
      acts: parts.flatMap((p) => p.structure.acts ?? []),
      turningPoints,
    },
    pacing: {
      tensionCurve: parts.flatMap((p) => p.pacing.tensionCurve ?? []),
      climaxChapters: [...new Set(parts.flatMap((p) => p.pacing.climaxChapters ?? []))].sort(
        (x, y) => x - y,
      ),
      restChapters: [...new Set(parts.flatMap((p) => p.pacing.restChapters ?? []))].sort(
        (x, y) => x - y,
      ),
      hookDensity: head.pacing.hookDensity,
    },
    constraints: head.constraints,
    chapters: parts.flatMap((p) => p.chapters ?? []),
  };

  save("outline", merged);

  // ── 锚点漂移检查：后续段回填的 direction 是否与第一段逐字一致 ──
  const drifted = parts.filter((p) => JSON.stringify(p.direction) !== JSON.stringify(head.direction));
  console.log(
    `\n锚点回填检查：${drifted.length === 0 ? "✅ 全部逐字一致" : `❌ 有 ${drifted.length} 段改写了 direction`}`,
  );
  drifted.forEach((p, i) => console.log(`  漂移段${i + 1}: ${JSON.stringify(p.direction)}`));

  const chs = merged.chapters;
  const gaps = chs.filter((c: any, i: number) => c.index !== i + 1);
  console.log(`\n章数 ${chs.length}（${chs[0]?.index}–${chs.at(-1)?.index}）`);
  console.log(`编号连续性：${gaps.length === 0 ? "✅ 1 起无跳号" : `❌ 异常章 ${gaps.map((c: any) => c.index).join(",")}`}`);
  console.log(
    `转折点 ${merged.structure.turningPoints.length}：` +
      merged.structure.turningPoints.map((t: any) => `${t.type}@${t.chapter}`).join(" "),
  );
  const inten = merged.pacing.tensionCurve.map((p: any) => p.intensity);
  console.log(`张力区间 ${Math.min(...inten)}–${Math.max(...inten)}，曲线点数 ${inten.length}`);
  console.log(`\n结局：${merged.direction.endingDirection}`);
  console.log("\n前 5 章：");
    for (const c of chs.slice(0, 5)) console.log(`  第${c.index}章《${c.title}》— ${c.summary}`);
}

// ─────────────────────────────────────────────────────────────
// 阶段4：第 1 章正文 + 润色
// ─────────────────────────────────────────────────────────────

if (stage === "chapter") {
  const world = load<any>("world");
  const cast = load<any>("cast");
  const outline = load<any>("outline");

  const worldText = [
    `premise: ${world.premise}`,
    "rules:",
    ...world.rules.map(
      (r: any, i: number) => `${i + 1}. ability: ${r.ability}\n   cost: ${r.cost}\n   limit: ${r.limit}`,
    ),
    `terms: ${world.terms.map((t: any) => t.name).join(" / ")}`,
    `forbidden:`,
    ...world.forbidden.map((f: string) => `- ${f}`),
  ].join("\n");

  const allCards = [...cast.protagonists, ...cast.supporting];
  const cardText = (c: any) =>
    [
      `【${c.name}】role: ${c.role}｜status: ${c.status}`,
      `  immutable: ${c.immutable.join("；")}`,
      `  voice: ${c.voice}`,
      `  want: ${c.want}`,
      `  cost: ${c.cost}`,
      `  need: ${c.need}`,
      `  flaw: ${c.flaw}`,
      `  line: ${c.line}`,
      `  relations: ${c.relations.map((r: any) => `${r.id}——${r.attitude}`).join("；")}`,
    ].join("\n");

  const chapter = outline.chapters[0];

  // 只放本章出场角色的卡（writer 的 prompt 明确要求"and nobody else"）
  const castText = chapter.characters
    .filter((n: string) => !n.startsWith("NEW:"))
    .map((n: string) => allCards.find((c: any) => c.name === n))
    .filter(Boolean)
    .map(cardText)
    .join("\n\n");

  const placeText = cast.locations
    .filter((l: any) => chapter.place.includes(l.name) || l.name.includes(chapter.place))
    .map(
      (l: any) =>
        `【${l.name}】\n  signature: ${l.signature}\n  features: ${l.features.join(" / ")}\n  role: ${l.role}`,
    )
    .join("\n\n");

  const prevText = [
    "这是第 1 章，全书的开头。此前没有任何内容。故事从这个早晨开始。",
    "",
    "★ 时间线位置（务必遵守）：这是**第一段人生**的百日誓师当天。",
    "  此刻的周砚**还没有穿越**——他不知道将来会重来一次，也不知道后面会发生什么，",
    "  更没有「上一世」可以回望。对他来说，这是唯一的一次，他只有一次高三。",
    "  因此正文里**不许出现**「第一段人生」「上一世」「这次」「重来」这类回望性说法。",
    "  全书要等到第 13 章他才会回到这一天；第 1 章就是这一天本身，第一次。",
  ].join("\n");

  function renderChapter(): string {
    return [
      `【第 1 章】${chapter.title}`,
      `本章目标：${chapter.goal}`,
      `本章冲突：${chapter.conflict}`,
      `结尾钩子：${chapter.hook}`,
      `情绪走向：${chapter.emotion}`,
      `发生地点：${chapter.place}`,
      `出场角色：${chapter.characters.join("、")}`,
      `目标字数：${chapter.wordCountTarget}`,
      ``,
      `★ 字数硬要求：本章正文必须写到 ${chapter.wordCountTarget} 字上下，**不得少于 ${Math.round(chapter.wordCountTarget * 0.9)} 字**。`,
      `  写不够说明你只把概要翻译了一遍——要给每个场景补足动作、对话、感官细节，`,
      `  让 goal / conflict / hook 三件事都真正演出来。`,
      ``,
      `★ 结尾：本章必须**停在结尾钩子上**。钩子之后不许再有新场景、不许补收束句。`,
      `  如果要写散会后的场景，就把它放在钩子之前。`,
      ``,
      `本章概要（按这个写，但要用场景和对话把它演出来，不要复述）：`,
      chapter.summary,
    ].join("\n");
  }

  const { createWriterAgent } = await import("../writer/agent");
  const { buildWriterPrompt } = await import("../writer/prompt");
  const { createPolisherAgent } = await import("../Polisher/agent");
  const { buildPolisherPrompt } = await import("../Polisher/prompt");
  const { createModel } = await import("../create_model");

  console.log(`  写第 1 章《${chapter.title}》（目标 ${chapter.wordCountTarget} 字）…`);
  const writer = createWriterAgent(createModel(0.7, 300_000, false, 8192));
  const wrote = (await writer.invoke({
    messages: [
      {
        role: "user",
        content: buildWriterPrompt({
          world: worldText,
          cast: castText,
          places: placeText,
          style: STYLE,
          genre: GENRE,
          previous: prevText,
          chapter: renderChapter(),
          decisions: "无（本章没有需要裁决的分叉点）",
        }),
      },
    ],
  })).structuredResponse as any;
  if (!wrote) throw new Error("writer 返回空");
  save("chapter-1", wrote);
  console.log(`    ✓ 初稿 ${wrote.text.length} 字`);

  console.log("  润色…");
  const polisher = createPolisherAgent(createModel(0.3, 300_000, false, 8192));
  const polished = (await polisher.invoke({
    messages: [
      {
        role: "user",
        content: buildPolisherPrompt({
          terms: world.terms.map((t: any) => t.name).join(" / "),
          forbidden: world.forbidden.join("\n"),
          style: STYLE,
          genre: GENRE,
          text: wrote.text,
        }),
      },
    ],
  })).structuredResponse as any;
  if (!polished) throw new Error("polisher 返回空");
  save("chapter-1-polished", polished);

  const delta = ((polished.text.length - wrote.text.length) / wrote.text.length) * 100;
  console.log(`    ✓ 润色后 ${polished.text.length} 字，变动 ${delta.toFixed(1)}%，改动 ${polished.changes.length} 处`);

  // 专名核对：terms 里的词在润色后是否仍逐字存在
  const missing = world.terms
    .map((t: any) => t.name)
    .filter((n: string) => wrote.text.includes(n) && !polished.text.includes(n));
  console.log(`    专名核对：${missing.length === 0 ? "✅ 初稿里出现过的专名全部原样保留" : `❌ 丢失 ${missing.join("、")}`}`);
}



