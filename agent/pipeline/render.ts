/**
 * 把 pipeline 的中间产物渲染成可读的 markdown。
 * 跑法：bun agent/pipeline/render.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(import.meta.dir, "out");
const read = (n: string) => JSON.parse(readFileSync(resolve(DIR, `${n}.json`), "utf8"));

const world = read("world");
const cast = read("cast");
const outline = read("outline");
const draft = read("chapter-1");
const final = read("chapter-1-polished");

const allCards = [...cast.protagonists, ...cast.supporting];
const ch1 = outline.chapters[0];

// ── 第 1 章 ──
const realChanges = final.changes.filter((c: any) => c.before !== c.after);
const chLines: string[] = [];
chLines.push(`# 第 1 章　${ch1.title}`);
chLines.push("");
chLines.push(`> ${world.premise}`);
chLines.push("");
chLines.push(
  `**本章目标**：${ch1.goal}　|　**冲突**：${ch1.conflict}`,
);
chLines.push(`**结尾钩子**：${ch1.hook}`);
chLines.push(`**字数**：初稿 ${draft.text.length} → 润色后 ${final.text.length}`);
chLines.push("");
chLines.push("---");
chLines.push("");
chLines.push(final.text);
chLines.push("");
chLines.push("---");
chLines.push("");
chLines.push(`## 润色改动（${realChanges.length} 处实质改动 / 报告 ${final.changes.length} 条，其余为空转）`);
chLines.push("");
for (const c of realChanges) {
  chLines.push(`- **[${c.kind}]**`);
  chLines.push(`  - 前：${c.before}`);
  chLines.push(`  - 后：${c.after}`);
}
writeFileSync(resolve(DIR, "第01章-倒计时一百天.md"), chLines.join("\n"), "utf8");

// ── 50 章大纲 ──
const oLines: string[] = [];
oLines.push("# 《临江》五十章大纲");
oLines.push("");
oLines.push(`> ${world.premise}`);
oLines.push("");
oLines.push("## 故事走向");
oLines.push("");
oLines.push(`- **一句话**：${outline.direction.logline}`);
oLines.push(`- **主题**：${outline.direction.theme}`);
oLines.push(`- **核心冲突**：${outline.direction.coreConflict}`);
oLines.push(`- **结局**：${outline.direction.endingDirection}`);
oLines.push("");
oLines.push(`## 结构（${outline.structure.type}）`);
oLines.push("");
oLines.push(`**主线**：${outline.structure.mainPlot.name}`);
oLines.push(`- 目标：${outline.structure.mainPlot.goal}`);
oLines.push(`- 冲突：${outline.structure.mainPlot.conflict}`);
oLines.push(`- 收束：${outline.structure.mainPlot.resolution}`);
oLines.push("");
for (const s of outline.structure.subplots) {
  oLines.push(`**支线 · ${s.name}**：${s.goal}｜收束：${s.resolution}`);
  oLines.push("");
}
oLines.push("### 幕");
oLines.push("");
oLines.push("| 幕 | 章 | 目标 |");
oLines.push("|---|---|---|");
for (const a of outline.structure.acts) {
  oLines.push(`| ${a.name} | 第 ${a.startChapter}–${a.endChapter} 章 | ${a.goal} |`);
}
oLines.push("");
oLines.push("### 转折点");
oLines.push("");
oLines.push("| 类型 | 章 | 发生了什么 | 造成什么 |");
oLines.push("|---|---|---|---|");
for (const t of outline.structure.turningPoints) {
  oLines.push(`| ${t.type} | ${t.chapter} | ${t.description} | ${t.impact} |`);
}
oLines.push("");
const inten = outline.pacing.tensionCurve.map((p: any) => p.intensity);
oLines.push(
  `### 节奏\n\n高潮章 ${outline.pacing.climaxChapters.join("、")}｜缓冲章 ${outline.pacing.restChapters.join("、")}｜钩子密度 ${outline.pacing.hookDensity}｜张力 ${Math.min(...inten)}–${Math.max(...inten)}`,
);
oLines.push("");
oLines.push("| 章 | " + outline.pacing.tensionCurve.map((p: any) => p.chapter).join(" | ") + " |");
oLines.push("|---|" + outline.pacing.tensionCurve.map(() => "---").join("|") + "|");
oLines.push("| 张力 | " + inten.join(" | ") + " |");
oLines.push("");
oLines.push(`## 五十章章纲`);
oLines.push("");
for (const c of outline.chapters) {
  oLines.push(`**第 ${c.index} 章　${c.title}**　\`${c.emotion}\``);
  oLines.push("");
  oLines.push(`- 目标：${c.goal}`);
  oLines.push(`- 冲突：${c.conflict}`);
  oLines.push(`- 钩子：${c.hook}`);
  oLines.push(`- 地点：${c.place}｜出场：${c.characters.join("、")}`);
  oLines.push("");
  oLines.push(`> ${c.summary}`);
  oLines.push("");
}
writeFileSync(resolve(DIR, "五十章大纲.md"), oLines.join("\n"), "utf8");

// ── 设定（世界观 + 人物 + 地点）──
const sLines: string[] = [];
sLines.push("# 《临江》设定");
sLines.push("");
sLines.push("## 世界观");
sLines.push("");
sLines.push(world.premise);
sLines.push("");
sLines.push("### 规则");
sLines.push("");
world.rules.forEach((r: any, i: number) => {
  sLines.push(`**${i + 1}. ${r.ability}**`);
  sLines.push("");
  sLines.push(`- 代价：${r.cost}`);
  sLines.push(`- 界线：${r.limit}`);
  sLines.push("");
});
sLines.push("### 地点骨架");
sLines.push("");
for (const p of world.places) sLines.push(`- **${p.name}**：${p.where}｜${p.role}`);
sLines.push("");
sLines.push("### 专名表");
sLines.push("");
sLines.push(world.terms.map((t: any) => t.name + (t.aliases?.length ? `（${t.aliases.join("、")}）` : "")).join("　·　"));
sLines.push("");
sLines.push("### 禁止清单");
sLines.push("");
for (const f of world.forbidden) sLines.push(`- ${f}`);
sLines.push("");
sLines.push("## 人物");
sLines.push("");
for (const c of allCards) {
  sLines.push(`### ${c.name}　\`${c.role}\`　\`${c.status}\``);
  sLines.push("");
  sLines.push(`- **不可改事实**：${c.immutable.join("；")}`);
  sLines.push(`- **说话方式**：${c.voice}`);
  sLines.push(`- **想要**：${c.want}`);
  sLines.push(`- **代价**：${c.cost}`);
  sLines.push(`- **真正缺的**：${c.need}`);
  sLines.push(`- **缺陷**：${c.flaw}`);
  sLines.push(`- **底线**：${c.line}`);
  sLines.push(`- **隐瞒**：${c.secret}`);
  sLines.push(`- **暴露条件**：${c.reveal}`);
  sLines.push(`- **关系**：${c.relations.map((r: any) => `${r.id}——${r.attitude}`).join("；")}`);
  sLines.push(`- **弧光**：${c.arc.start} → ${c.arc.end}`);
  sLines.push("");
}
sLines.push("## 地点");
sLines.push("");
for (const l of cast.locations) {
  sLines.push(`### ${l.name}　\`parent: ${l.parent}\``);
  sLines.push("");
  sLines.push(`- **记忆点**：${l.signature}`);
  sLines.push(`- **可感知细节**：${l.features.join("；")}`);
  sLines.push(`- **剧作功能**：${l.role}`);
  sLines.push("");
}
writeFileSync(resolve(DIR, "设定集.md"), sLines.join("\n"), "utf8");

console.log("已生成：第01章-倒计时一百天.md / 五十章大纲.md / 设定集.md");
