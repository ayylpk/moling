/**
 * Architect agent 冒烟测试：20 章玄幻中篇。
 * 跑法：bun agent/Architect/smoke.ts
 * 产物：agent/Architect/outline-20ch.json（完整输出）
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildArchitectPrompt } from "./prompt";
import { outlineAgent } from "./agent";

const WORLD = `
premise: 换骨续命之术真实存在，但每一次都必须以一具同血脉的活人心脏为引，且须此人自愿开口应允，术才成立。

rules:
1. 换骨延寿 — ability: 施术者可续寿十年；cost: 必须同血脉至亲自愿应允，并以活心为引；limit: 一生至多三次，第三次施术者必死。
2. 断脉试药 — ability: 修士可自断经脉以试药性；cost: 每断一次折去十年寿数；limit: 经脉断满三次即成废人，再无法行术。
3. 应允不可强取 — ability: 任何胁迫下的口头应允都不成立；cost: 术者只能等对方自己开口；limit: 迷魂、逼迫、代答一律无效。

factions:
- 青州旧观：已经衰败的道门，只剩师徒数人，掌观者已死。
- 镇北司：缉拿邪修的官署，只认尸首，不问缘由。

places: 青州、青州旧观、镇北司

terms: 换骨续命、药引、应允

forbidden:
- 不许出现无代价的延寿。
- 不许出现凭空飞升、坐化成仙。
- 不许出现以强迫手段生效的应允。
`;

const CHARACTERS = `
- 沈砚（主角，support→protagonist）：沈无咎的胞弟。十七岁，不知自己被兄长当作最后一味药引。想查清师父十二年前"飞升"的真相。
  不可改事实：右手腕有一道旧疤，是十岁替兄长挡下的；说话习惯先低头再看人。
  底层缺陷：他相信亲人不会骗他。
- 沈无咎（antagonist）：断去左手两指，随身铜药囊，口头禅"划算"。十二年前换骨失败，亲手杀了师父并沉尸旧观水井，对外称师父飞升。
  表层欲望：三年内凑齐九味药引。深层需求：一个能证明"我这条命值得被留下"的人。
  底线：不能有人当着他的面说"你师父比你强"。
`;

const STYLE = "冷硬白描，句子短，少形容词。情感靠动作和物件传递，不靠心理独白。";

const PREVIOUS = "这是第一卷，从第 1 章开始。此前无任何已写内容。";

const NEED = `
第一卷，20 章，每章 3000 字上下。
主角沈砚要从"不知道自己被兄长当作药引"走到"知道真相并做出选择"。
反派的师父之死这条暗线必须在中点前后翻出一角。
本卷末要留下指向第二卷的钩子：换骨续命之术还有第三次，而沈无咎只剩这一条路。
`;

if (!outlineAgent) {
  console.error("缺少 API Key，outlineAgent 未初始化。");
  process.exit(1);
}

const prompt = buildArchitectPrompt({
  world: WORLD,
  characters: CHARACTERS,
  previous: PREVIOUS,
  style: STYLE,
  need: NEED,
});

const t0 = Date.now();
const result = await outlineAgent.invoke({
  messages: [{ role: "user", content: prompt }],
});
const out = result.structuredResponse;
const ms = Date.now() - t0;

const json = JSON.stringify(out, null, 2);
writeFileSync(resolve(import.meta.dir, "outline-20ch.json"), json, "utf8");

// ---------- 自检 ----------
const problems: string[] = [];
const chapters = out.chapters ?? [];

if (chapters.length < 15 || chapters.length > 25) {
  problems.push(`章数 ${chapters.length}，不在 15-25 区间`);
}
if (chapters.some((c, i) => c.index !== i + 1)) {
  problems.push("index 不连续或未从 1 开始");
}
const curve = out.pacing?.tensionCurve ?? [];
if (curve.length !== chapters.length) {
  problems.push(`tensionCurve 长度 ${curve.length} != 章数 ${chapters.length}`);
}
const intensity = curve.map((p) => p.intensity);
const flat = intensity.length > 1 && Math.max(...intensity) - Math.min(...intensity) < 3;
if (flat) {
  problems.push(`张力曲线过平：min ${Math.min(...intensity)} / max ${Math.max(...intensity)}`);
}
// 分卷后：一卷内只会有 1-2 个转折点，不再要求六种齐全；只查类型合法 + 章号递增。
const TP_TYPES = ["inciting", "plot-point-1", "midpoint", "plot-point-2", "climax", "resolution"];
const tps = (out.structure?.turningPoints ?? []).slice().sort((a, b) => a.chapter - b.chapter);
if (tps.length === 0) problems.push("本卷没有任何转折点");
if (tps.some((t) => !TP_TYPES.includes(t.type))) {
  problems.push(`出现非法转折点类型：${tps.map((t) => t.type).join(",")}`);
}
if (tps.some((t, i) => i > 0 && t.chapter < (tps[i - 1]?.chapter ?? 0))) {
  problems.push("转折点章号未递增");
}
const climaxTp = tps.find((t) => t.type === "climax");
if (climaxTp && !(out.pacing?.climaxChapters ?? []).includes(climaxTp.chapter)) {
  problems.push(`climaxChapters 未包含 climax 转折点所在章 ${climaxTp.chapter}`);
}
const acts = out.structure?.acts ?? [];
const firstIndex = chapters[0]?.index ?? 1;
if (acts[0]?.startChapter !== firstIndex) {
  problems.push(`首幕未从本卷起始章 ${firstIndex} 开始`);
}
if (acts.at(-1)?.endChapter !== chapters.at(-1)?.index) {
  problems.push(`末幕结束章 ${acts.at(-1)?.endChapter} != 本卷末章 ${chapters.at(-1)?.index}`);
}
const known = ["沈砚", "沈无咎"];
const nameRe = /^NEW[:：]/;
const invented: string[] = [];
for (const c of chapters) {
  for (const n of c.characters ?? []) {
    if (nameRe.test(n)) continue;
    if (!known.includes(n)) invented.push(`第${c.index}章: ${n}`);
  }
}
const worldPlaces = ["青州", "青州旧观", "镇北司"];
const badPlaces = (out.constraints?.locations ?? []).filter((p) => !worldPlaces.includes(p));
const badChapterPlaces = chapters
  .filter((c) => c.place && !nameRe.test(c.place) && !worldPlaces.includes(c.place))
  .map((c) => `第${c.index}章: ${c.place}`);
const subplotsNoRes = (out.structure?.subplots ?? []).filter(
  (s) => !s.resolution || /待续|未定|留有/.test(s.resolution),
);

console.log(JSON.stringify({
  ok: true,
  elapsedSeconds: Math.round(ms / 1000),
  chapters: chapters.length,
  jsonChars: json.length,
  acts: acts.length,
  subplots: (out.structure?.subplots ?? []).length,
  turningPoints: tps.length,
  tensionRange: intensity.length ? [Math.min(...intensity), Math.max(...intensity)] : [],
  endingDirection: out.direction?.endingDirection,
  自检问题: problems,
  幻觉人名: invented,
  constraints越界地点: badPlaces,
  章级越界地点: badChapterPlaces,
  未收束的支线: subplotsNoRes.map((s) => s.name),
}, null, 2));
