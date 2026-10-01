/** 把 outline-20ch.json 渲染成可读的 markdown，仅供人工审阅。 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = import.meta.dir;
const o = JSON.parse(readFileSync(resolve(dir, "outline-20ch.json"), "utf8"));

const L: string[] = [];
const p = (s = "") => L.push(s);

p(`# 玄幻中篇大纲 · 20 章`);
p();
p(`> 由 Architect agent（\`OutlineBuildAgent\`）一次生成 · 输入为 20 章玄幻中篇需求`);
p();

p(`## 一、故事走向`);
p();
p(`- **一句话故事**：${o.direction.logline}`);
p(`- **主题**：${o.direction.theme}`);
p(`- **核心冲突**：${o.direction.coreConflict}`);
p(`- **结局走向**：${o.direction.endingDirection}`);
p();

p(`## 二、情节结构（${o.structure.type}）`);
p();
p(`### 主线：${o.structure.mainPlot.name}`);
p();
p(`- **目标**：${o.structure.mainPlot.goal}`);
p(`- **冲突**：${o.structure.mainPlot.conflict}`);
p(`- **收束**：${o.structure.mainPlot.resolution}`);
p();
p(`### 支线`);
p();
for (const s of o.structure.subplots) {
  p(`**${s.name}**`);
  p();
  p(`- 目标：${s.goal}`);
  p(`- 冲突：${s.conflict}`);
  p(`- 收束：${s.resolution}`);
  p(`- 涉及：${s.involvedCharacters.join(" / ")}`);
  p();
}
p(`### 幕结构`);
p();
p(`| 幕 | 章 | 目标 |`);
p(`|---|---|---|`);
for (const a of o.structure.acts) {
  p(`| ${a.name} | 第 ${a.startChapter}–${a.endChapter} 章 | ${a.goal} |`);
}
p();
for (const a of o.structure.acts) {
  p(`**${a.name}**（第 ${a.startChapter}–${a.endChapter} 章）`);
  p();
  p(a.summary);
  p();
  p(`关键事件：`);
  for (const e of a.keyEvents) p(`- ${e}`);
  p();
}
p(`### 转折点`);
p();
p(`| 类型 | 章 | 发生什么 | 造成什么影响 |`);
p(`|---|---|---|---|`);
for (const t of o.structure.turningPoints) {
  p(`| ${t.type} | ${t.chapter} | ${t.description} | ${t.impact} |`);
}
p();

p(`## 三、节奏与张力`);
p();
p(`- 高潮章：${o.pacing.climaxChapters.join("、")}`);
p(`- 缓冲章：${o.pacing.restChapters.join("、")}`);
p(`- 钩子密度：${o.pacing.hookDensity}`);
p();
p(`张力曲线（逐章 0–10）：`);
p();
p(`| 章 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |`);
p(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
p(`| 强度 | ${o.pacing.tensionCurve.map((t: { intensity: number }) => t.intensity).join(" | ")} |`);
p();

p(`## 四、一致性约束`);
p();
p(`- **时间线**：${o.constraints.timeline}`);
p(`- **地点**：${o.constraints.locations.join("、")}`);
p(`- **依赖的世界规则**：`);
for (const r of o.constraints.rules) p(`  - ${r}`);
p(`- **禁止事项**：`);
for (const f of o.constraints.forbidden) p(`  - ${f}`);
p();

p(`## 五、二十章章纲`);
p();
for (const c of o.chapters) {
  p(`### 第 ${c.index} 章 · ${c.title}`);
  p();
  p(`- **本章目标**：${c.goal}`);
  p(`- **本章冲突**：${c.conflict}`);
  p(`- **结尾钩子**：${c.hook}`);
  p(`- **情绪走向**：${c.emotion}`);
  p(`- **出场角色**：${c.characters.join(" / ")}`);
  p(`- **目标字数**：${c.wordCountTarget}`);
  p();
  p(`> ${c.summary}`);
  p();
}

writeFileSync(resolve(dir, "outline-20ch.md"), L.join("\n"), "utf8");
console.log("md 字符数:", L.join("\n").length);
