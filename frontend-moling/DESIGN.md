# 墨灵 · 前端设计总纲

> 定稿于 2026-10-01。本文件是前端的"记忆"：配色、字体、布局、红线，后续所有页面以此为准。
> 改任何主题相关值，先改 `src/styles/tokens.css`，再同步本文件。

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

### 待建：业务工作台的页面框架（下一期的壳）

```
┌─────────┬────────────────────────────────┐
│ 墨灵(竖排) │ 顶栏: 书名/章节 · 字数 · 笔灵状态 · 保存 │
│ 工作台    ├────────────────────────────────┤
│ 选题     │                                │
│ 大纲     │        内容区                    │
│ 角色     │     (max-width 按页裁)           │
│ 剧情     │                                │
│ 文风     │                                │
│ 书稿     │                                │
│ 设定     │                                │
└─────────┴────────────────────────────────┘
```

- 侧栏 232px：宣纸底 + 右界行线（不用深色栏，保持纸面一体）；
  当前项 = 朱砂短竖标（界尺式）+ 浓墨加粗；悬停 = 旧宣底。
- 顶栏 56px：信息密度低，字数、保存态、Agent（笔灵）状态三枚小示签。
- 书稿页三栏：章目录(200px) / 正文(≤68ch 居中) / 大纲浮签(可收起)。
- Agent 五模块对应五个页面壳，全部复用同一 `page + sec-title` 骨架。

## 五、红线（勿越）

1. **禁毛玻璃**：无 backdrop-filter、无半透玻璃卡。纸就是纸，实底。
2. 圆角全站 ≤ 4px（`--radius-fine/card`），禁泡泡卡、禁一套大圆角刷全站。
3. 红是"印泥"不是"警报"：主操作、激活、印章之外不用朱砂；错误态另议（偏赭石/深朱）。
4. 禁渐变装饰 wash、禁 ALL CAPS 眉题、禁卡片一律软阴影 `rgba(0,0,0,.1)` 的 SaaS kit。
5. 装饰只用文字系统：水印大字、朱丝栏、闲章、界行——不画插画（尤其禁手绘卡通 SVG）。
6. 动效一次性编排（入场一卷、落章一记），不逐卡 fade-slide、不悬停群魔乱舞。

## 六、背景素材（10/1 下午已入库 `public/images/`）

原图为 AI 生成 PNG（桌面留档），入库时统一处理；CSS 铺法见第四节，**低透明度压成纸下暗纹、不抢文字**是铁律。

| 成品 | 规格 | 状态与用法 |
|---|---|---|
| `ink-mountains.jpg` | 1592×900 · 87KB · q80 | 已接：报头右上横幅，opacity 0.16 + 双向 mask |
| `paper-xuan.jpg` | 2048×2048 · 145KB | 已接：body 底纹，multiply / 0.55 / 460px 平铺 |
| `ink-smoke.png` | 480 宽 · 44KB · 真透明 | 待用：空状态小图（白底已按亮度抠成 alpha，RGB 染浓墨 #211E18），用时宽 ≤ 160px |

当时用的三条英文提示词（重生成/换图时照抄）：

1. 远山：`A serene traditional Chinese ink wash painting (shuimo) of distant misty mountains above a quiet river, one small empty pavilion, vast negative space of ivory rice paper, graded black ink washes with soft wet-brush edges, minimal, no text, no people, no red seal`
2. 纸纹：`Seamless scanned xuan rice paper texture, warm ivory white, short visible plant fibers, faint laid lines, flat even lighting, no stains, no shadows, high resolution scan, tileable`
3. 淡烟：`Single vertical trail of ink smoke dissolving into blank rice paper, very light gray wash, abstract, minimal, calligraphic brushstroke feel, no text, centered composition with large empty margins`

处理参数留档（sharp）：jpg q80+mozjpeg、`linear(-2.1, 508)` 亮度→alpha、`.extractChannel(0)+joinChannel` 合成透明通道。

## 七、工程约定

- React 19 + Vite 7，纯 CSS 变量，无 UI 库；引库先议（本壳零依赖是刻意的）。
- 起壳指令：`npm install` → `npm run dev`（5173）。
- 后端/Agent 定端口后，在 `vite.config.js` 加 `server.proxy`，前端勿写死绝对地址。
- 页面组件放 `src/pages/`，布局件放 `src/layout/`，路由下一期再引 `react-router-dom`。
