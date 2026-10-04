# 墨灵 · 前端设计总纲

> 定稿于 2026-10-01；10-04 双界面重塑（执笔/文库 + 夜案配色）并入本纲。
> 本文件是前端的"记忆"：配色、字体、布局、红线，后续所有页面以此为准。
> 改任何主题相关值，先改 `src/styles/tokens.css`（夜案局部变量在 `src/styles/workspace.css`），再同步本文件。

## 一、取意

墨灵是自动写小说的工作台，视觉语言直接取"书画案头"：

- **宣纸为底** —— 界面是一张纸，不是一块玻璃；
- **墨分五阶** —— 层级不靠彩色堆，靠墨的浓淡；
- **朱砂点睛** —— 红色只做印章与主操作，克制到"落印"的程度。

## 二、色板（tokens.css 一一对应）

| 名 | 值 | 职 |
|---|---|---|
| 宣纸 `--m-paper` | `#F5F1E5` | 页面底色 |
| 旧宣 `--m-paper-2` | `#EBE4D2` | 次级面、悬停 |
| 界行 `--m-line` | `#D8CFB8` | 分隔线、描边 |
| 朱丝栏 `--m-line-vermilion` | `rgba(181,56,44,.18)` | 稿纸红线（品牌竖带、重点分隔） |
| 玄墨 `--m-night` | `#191712` | 启动页底（将来深色模式基） |
| 浓墨 `--m-ink` | `#211E18` | 正文文字 |
| 重墨 `--m-ink-2` | `#4C463A` | 次级文字 |
| 淡墨 `--m-ink-3` | `#8B8371` | 辅助文字、占位 |
| 朱砂 `--m-cinnabar` | `#B5382C` | 印章、激活态、主按钮 |
| 印泥沉 `--m-cinnabar-deep` | `#932A20` | 朱砂悬停/按下 |
| 花青 `--m-indigo` | `#33566B` | 链接、进行中信息 |
| 赭石 `--m-ochre` | `#8C6A3F` | 进度、提醒 |

### 夜案（执笔界面局部，`workspace.css` `.ws` 下定义，不进全局 tokens）

| 名 | 值 | 职 |
|---|---|---|
| 案底 `--ws-night` | `#191712` | 工作区底色（=玄墨同值，纸案两界） |
| 案栏 `--ws-bar` | `#14120d` | 顶栏 |
| 案面 `--ws-face` | `#211e18` | 灯位/浮签面 |
| 案线 `--ws-line` | `rgba(237,230,212,.14)` | 暗面描边（纸色反用） |
| 案字 `--ws-ink` | `#ede6d4` | 暗面文字（旧宣反用） |
| 在行 `--ws-run` | `#7fa3bc` | 花青提亮——"在工作"的明光，仅状态用 |
| 沉 `--ws-fail` | `#c4574a` | 深朱提亮——失败沉色，仅状态用 |

明暗即状态：**running=亮花青光晕+呼吸点 / done=常 / idle=暗（opacity .34）/ failed=沉**。
夜案里朱砂只上一处：案心「灵」印的朱框（全局唯一焦点）。

## 三、字体（全本机系统字体，零下载）

| 职 | 栈 | 用于 |
|---|---|---|
| `--f-display` 楷体 | Kaiti SC / STKaiti / KaiTi / DFKai-SB | 品牌、题签、章节名、大字号 |
| `--f-manuscript` 宋体 | Songti SC / STSong / SimSun | 书稿正文（将来的编辑器）、文学样例 |
| `--f-ui` 黑体族 | PingFang SC / Microsoft YaHei / Segoe UI | 界面操作文字，15px / 1.7 |

宋体正文行高放到 2.0，行长 ≤ 58ch——读稿如读书。

## 四、骨架

### 已完成：启动页 → 首页（壳）

```
启动页 ~1.1s+0.5s淡出          首页 = 主题展示
┌──────────────┐          ┌────────────────────┐
│   玄墨满屏     │          │ │墨╱ 自动写小说工作台   │
│  墨灵 ←笔锋扫出 │   ──→    │ │灵╱ 从选题到文风…     │
│      落朱印     │          │ │灵印╲…              │
└──────────────┘          ├─色·主题色板（9色签）──┤
                          ├─字·字体分工（三行）──┤
                          └ 页脚 · 右下"灵"水印 ─┘
```

- `prefers-reduced-motion`：跳过启动页直达首页。
- 纸纹 = `paper-xuan.jpg` 真纸扫描平铺（multiply 混合、透明度 0.55、460px 一循环）+ 四角微晕；素材见第六节。
- 报头右上压"远山"横幅：`ink-mountains.jpg`，透明度 0.16，双向 mask 取交（上缘轻收、左缘洇出、下缘没入纸面），永不参与可读层。

### 已建（10/4 重塑）：双界面 · 一个切换钮

「执笔／文库」两枚紧挨的纸片开关常驻两处顶栏（ModeSwitch）——执笔是暗案、文库是亮纸，
切换即跨界。两界左右镜像是刻意设计：**执笔看 Agent 干活（画布为主、对话为辅），文库翻书之诸页（导航为辅、内容为正）**。

```
执笔 /#/w（夜案）                          文库 /#/w/desk …（纸案）
┌──────────────────────────────┬────────┐  ┌──────┬──────────────────────┐
│ 灵 墨灵 [执笔|文库]《临江》●已保存│        │  │墨╷灵 │ [执笔|文库] 当前小说《临江》│
├──────────────────────────────┼────────┤  │ 文库 │ ●已保存 · 展开规格        │
│  Agent 链路画布（大面积）        │ 对话栏  │  ├──────┼──────────────────────┤
│  六阶七灯＋环＋案心朱印          │ 380px  │  │ 书架  │                      │
│  明暗 = 在不在工作              │ 亮宣头部 │  │ 选题  │   内容区（页至多一枚    │
│  悬停/聚焦出浮签：               │ 消息请示 │  │ …    │   朱砂主按钮）          │
│  状态 · 在读什么 · token 用量    │ 指令框   │  │      │                      │
└──────────────────────────────┴────────┘  └──────┴──────────────────────┘
```

- 执笔壳（`WorkbenchLayout` 判 `pathname==='/w'` 分双壳）：栅格 `54px 顶栏 / 画布+对话列`；
  stage 与 chat 的 grid-column **写死**——子项混有显式 grid-row 时自动落位会错位（坑已踩，CSS 内留注）。
- 画布灯位 = 流水线六阶方位：上（设定/大纲）· 左（角色/场景）· 右（章节/执笔）· 下（润色），中为案心灵印。
  浮签以 `.wsc__map` rect 定位、上下翻转、左右夹逼；pointer-events:none；键盘聚焦同样可出。
- 对话栏纸色分层：头部/状态行=亮宣（暗案上放的一张纸），消息区随案，composer 行式；可收 48px 轨。
- 文库三层纸色治"一色通铺"：**侧栏+顶栏 = `--m-paper` 画框 / 内容区 = `--m-paper-2` 案面 / 卡·签·chip = `--m-paper` 亮纸片**。
  侧栏 232px，当前项 = 朱砂短竖标（界尺式）+ 浓墨加粗；顶栏规格条默认收起。
- 窄屏 ≤920px 文库侧栏收 58px 竖排字轨；执笔 ≤1240px 对话栏压窄、≤980px 灯位缩。
- 书稿页三栏：章目录(210px) / 正文（亮宣整张）/ 章节浮签(245px)。

数据契约（10/2 登记，接数时照此写 fetch，不改版式）：

| 路由（hash） | 入口 | 数据契约（接数时照此写 fetch，不改版式） |
|---|---|---|
| `/#/` | 题签页（v0.1 首页，报头加「开卷」主按钮 → 直进执笔 `/#/w`） | — |
| `/#/w` | 执笔 · Agent 链路 + 对话 | 现状静态在 `src/lib/workbenchData.js`（AGENTS/HUB）→ 将来 `GET /api/agents/status`；对话栏接任务请示流 |
| `/#/w/desk` | 工作台 · 书架 | `GET /api/novels` + `…/:id/generation`（六阶进度） |
| `/#/w/topic` | 选题 | outline.json → `direction`（logline/theme/coreConflict/endingDirection） |
| `/#/w/outline` | 大纲 | `structure.acts` 三幕 + `pacing.tensionCurve` 张力条 + `constraints` |
| `/#/w/cast` | 角色 | cast.json → `protagonists[]`（voice/want/cost/need/secret/immutable） |
| `/#/w/plot` | 剧情 | outline.json → `chapters[]`（goal/conflict/hook/emotion 事件账表） |
| `/#/w/style` | 文风 | `novels.style` + `worlds.terms[]`（白名单表）+ `forbidden[]`（赭石 chip） |
| `/#/w/manuscript` | 书稿 | artifact md 正文 + `chapters[i].hook/emotion` 浮签（可收起） |
| `/#/w/world` | 设定 | `GET /api/worlds/current?novelId=`（版本签 v1 挂朱点=激活） |

- 侧栏八入口顺序 = 写书动线；单字轨 架题界纲色情稿风（窄屏 ≤920px 收成 58px 竖排字轨）。
- 10/4 起壳期脚手架全拆：UI 上不再有「示例」角标、待建虚框、骨架行、接口注——数据契约只活在代码注释与本表中。
- 空态文案直写内容（EmptyState 组件已删）；失败=深朱（印泥沉），错误态永不正朱。

## 五、红线（勿越）

1. **禁毛玻璃**：无 backdrop-filter、无半透玻璃卡。纸就是纸，实底。
2. 圆角全站 ≤ 4px（`--radius-fine/card`），禁泡泡卡、禁一套大圆角刷全站。
3. 红是"印泥"不是"警报"：主操作、激活、印章之外不用朱砂；错误态另议（偏赭石/深朱）。
4. 禁渐变装饰 wash、禁 ALL CAPS 眉题、禁卡片一律软阴影 `rgba(0,0,0,.1)` 的 SaaS kit。
5. 装饰只用文字系统：水印大字、朱丝栏、闲章、界行——不画插画（尤其禁手绘卡通 SVG）。
6. 动效一次性编排（入场一卷、落章一记），不逐卡 fade-slide、不悬停群魔乱舞。
7. 夜案（执笔）内朱砂只上案心「灵」印一处（全局唯一焦点）；状态色走明暗与花青/深朱提亮档（`--ws-run/--ws-fail`），不引入新色相；动效只许灯位呼吸点，`prefers-reduced-motion` 下全站动画关闭。

## 六、背景素材（10/1 下午已入库 `public/images/`）

原图为 AI 生成 PNG（桌面留档），入库时统一处理；CSS 铺法见第四节，**低透明度压成纸下暗纹、不抢文字**是铁律。

| 成品 | 规格 | 状态与用法 |
|---|---|---|
| `ink-mountains.jpg` | 1592×900 · 87KB · q80 | 已接：报头右上横幅，opacity 0.16 + 双向 mask |
| `paper-xuan.jpg` | 2048×2048 · 145KB | 已接：body 底纹，multiply / 0.55 / 460px 平铺 |
| `ink-smoke.png` | 480 宽 · 44KB · 真透明 | 留档待用（原配空状态，EmptyState 已随壳期脚手架 10/4 拆除）：白底已按亮度抠成 alpha，RGB 染浓墨 #211E18，用时宽 ≤ 160px |

当时用的三条英文提示词（重生成/换图时照抄）：

1. 远山：`A serene traditional Chinese ink wash painting (shuimo) of distant misty mountains above a quiet river, one small empty pavilion, vast negative space of ivory rice paper, graded black ink washes with soft wet-brush edges, minimal, no text, no people, no red seal`
2. 纸纹：`Seamless scanned xuan rice paper texture, warm ivory white, short visible plant fibers, faint laid lines, flat even lighting, no stains, no shadows, high resolution scan, tileable`
3. 淡烟：`Single vertical trail of ink smoke dissolving into blank rice paper, very light gray wash, abstract, minimal, calligraphic brushstroke feel, no text, centered composition with large empty margins`

处理参数留档（sharp）：jpg q80+mozjpeg、`linear(-2.1, 508)` 亮度→alpha、`.extractChannel(0)+joinChannel` 合成透明通道。

## 七、工程约定

- React 19 + Vite 7 + react-router-dom（10/2 引，唯一新增依赖；HashRouter——将来静态托管免 rewrite）。纯 CSS 变量，仍无 UI 库；再引库先议。
- 起壳指令：`npm install` → `npm run dev`（5173）。
- 后端已定端口 :3000（Hono/Bun，入口 agent/my-app/src/index.ts）。`vite.config.js` 已配 `server.proxy: /api → :3000`；前端一律相对路径，勿写死绝对地址。接口总表在 `src/api/endpoints.js`（只登记后端已有的路由）；后端枚举镜像在 `src/lib/enums.js`（权威 = agent/db/types/entity.ts，两头对不上以 entity.ts 为准）。
- 页面组件在 `src/pages/`，布局件在 `src/layout/`，共用零件类名一律取 `src/styles/workbench.css` 的词汇表，禁各页自造同义词。
