# 墨灵

中文长篇小说的多 Agent 写作系统。

由一个**中心 Agent** 对话与编排，背后挂一组子 Agent（世界观 / 角色 / 地点 / 架构师 / 裁决 / 执笔 / 润色）。
中心 Agent 自己不写一个字 —— 它只负责听懂你要什么、把活儿派下去、把结果收回来。

## 跑起来

```bash
bun install

# 后端（Bun.serve，:3000）
npm run api:dev

# 前端（Vite，:5173，/api 代理到 :3000）
npm run frontend:dev

# 开发用 CLI：在终端里直接跟中心 Agent 说一句话
bun agent/run.ts <slug>
bun agent/run.ts <slug> 把第一卷大纲排出来
```

用了 `HashRouter`，整站可以直接静态托管。

## 环境变量

放在 `agent/.env`（**已在 .gitignore 里，别提交**）。已存在的 shell 变量优先于文件里的。

| 键 | 用途 |
|---|---|
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | 写作链路的模型（经 `@langchain/deepseek`） |
| `ALIYUN_API_KEY` / `ALIYUN_BASE_URL` | 阿里云百炼，OpenAI 兼容模式。**base 要用公共域名**，见下 |
| `ALIYUN_VL_MODEL` / `ALIYUN_TEXT_MODEL` | 读图的视觉模型 / 写片段的文本模型 |
| `SILICONFLOW_API_KEY` 等 | 记忆链路的向量化 |

> 百炼控制台会展示一个业务空间专属域名 `ws-*.cn-beijing.maas.aliyuncs.com`，
> 同一个 key 打它，chat 端点回 `Endpoint.AccessDenied`，而 `/models` 却是 200（很容易误判成 key 坏了）。
> **能用的地址是 `https://dashscope.aliyuncs.com/compatible-mode/v1`。**

## 分层

碰数据库的代码全在 `agent/my-app/`，各层谁也不许越级：

```
tool（中心 Agent 的工具）─┐
                          ├→ index.ts（门面）→ controller → service → db → SQLite
HTTP 路由（server.ts）   ─┘
```

- **db** —— 所有 SQLite 访问。列名、表结构、事务只在这里
- **service** —— 业务逻辑。落库之后该做的事都绑在这里（回填引用、发记忆），要么全做完要么不做
- **controller** —— 一个动作 = 一次调用，是上层唯一看得见的东西
- **index.ts** —— 按领域命名空间导出。`listVolumes` 这类名字在多个领域都合理，平铺会撞名

`agent/storage/server.ts` 是唯一的 HTTP 入口，**只做传输**：把请求变成一次门面调用，把结果变成 JSON。
`agent/run.ts` 是本地调试用的壳，不是第二个后端。

## 数据：一本一个库

- `resources/catalog.sqlite` —— 只有目录级元数据（书列表）
- `resources/novels/<slug>/novel.sqlite` —— 一本书的全部业务数据

建书 = 插目录行 + 建库建表 + 回读，**三件事必须一起成功**。

`chapterId` **不全局唯一**（每本书各自从 1 开始）。所以只有 `chapterId` 的接口必须带 `?novelId=`，
带不上就 400 —— 挨本找"命中第一本"等于写到别人的书里去。

## 类型与文风

`agent/skills/` 下两个正交的维度，加一种就是加一个目录，**代码一个字不用动**：

```
agent/skills/
├── 类型/<类型名>/     7 片：story-planner character location architect actor writer polisher
├── 文风/<文风名>/     2 片：writer polisher
└── index.ts          NO_AI_VOICE —— 跨一切风格的文字红线
```

- 类型回答"这个世界有什么、冲突从哪来"；文风回答"同一件事用什么声音讲"
- **文风片段里不许出现题材家具**：写冷峻不等于写悬疑
- 片段是 `.md` 是有意的 —— 它们要给人看、给人改，也要能在 git 里 diff
- 拼接顺序固定：`agent 自己的提示词 → 同步契约 → 类型 → 文风 → 红线`。**红线永远在最后**

缺哪片就跳哪片，不存在必填片段。

### 从素材生成

前端「题材库」页（`/w/flavors`）可以传一张图、一段文字或一个 `.docx`，
由模型给出一份类型草案（7 片）+ 一份文风草案（2 片），改完勾选保存。

```
素材 ─┬─ 图片 → 视觉模型 ─┐
      └─ 文本 / .docx    ─┴→ 抽象画像（≤300字）→ 文本模型 → 9 个片段
```

中间那层"抽象画像"不是装饰：把原始素材直接喂给第二步，模型会把素材里的原句、数字、地名
抄进"通用规则"里 —— 提示词压不住，因为原文就在输入里。

**素材零留存**：图片与文档都是 base64 进请求体，不落盘、不存路径、不留来源。

## 导出正文

书稿页可以导出 txt：导出当前这一章，或者在目录里勾选若干章批量导出（支持「全选本卷」）。
**单章和一百章走的是同一个接口**：

```
GET /api/novels/:id/export?ids=1,2,3
```

- 取哪一版：**终稿优先，没有终稿才退初稿**。用了初稿的章节会写进文件开头的说明块 ——
  不写的话，拿到 txt 的人会以为通篇都是定稿
- 还没有正文的章节在文件里写明，而不是留一段空白
- 回来的是文件本体（`text/plain`），**只有出错时才回 JSON**
- 中文文件名走 `filename*=UTF-8''`，只给 `filename=` 到浏览器里会变成乱码

## 文字的硬红线

`agent/skills/index.ts` 的 `NO_AI_VOICE` 是**唯一出口**。要调整全项目的文字质量红线，只改那一个文件。

几类典型禁令：情绪不许命名只许外化（不写"他感到恐惧"）、禁用比喻清单、
不许"不是A而是B"的对照壳、不许段尾补抽象结论、不许章首用时间/天气起头。

## 提交前自检

```bash
node node_modules/typescript/bin/tsc --noEmit   # 应为 0 错误
bun test                                        # 应为全绿
cd frontend-moling && npx vite build            # 前端构建
```

> 本机 `vite build` 可能报 `[safe-delete] 操作失败 … emptyDir` —— 那是它要清空产物目录时被拦住了。
> 构建前把旧产物 `mv` 走即可（别用 `rm`），或者换个不存在的目录：`--outDir .build-check`。

## 几条硬约定

- **删除一律不真删**：进 git 的用 `git rm`；没进 git 的 `mv` 到隔离目录（如 `.workbuddy/flavor-trash/`）
- 中心 Agent 的**所有工具都挂在 `SAgent/agent.ts` 的 tools 数组**，没有"子 Agent 的工具"这种说法
- 改了挂载的工具，**同一轮就要同步 skill 里的边界清单**，否则模型照旧文档拒绝用新工具
- 提示词里禁止 `{PLACEHOLDER}` + `.replace()`
- 生成一次一个（批量从第 3～5 个起会退化成模板）；**落库可以批量**
