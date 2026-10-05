# 墨灵轻量 RAG 存储

每部小说的 `resources/novels/<slug>/novel.sqlite` 内包含完整的 L0/L1/L3 小说记忆系统，不引入独立数据库服务。

## 当前能力

- `L0` 保存章节事件、Agent 对话等原始记录，保留原文，不把推测直接升级为事实。
- `L1` 保存可回溯的原子事实和场景摘要，带来源、卷章范围、角色和置信度。
- `L3` 保存角色动态画像的当前版本和历史版本，和 `characters` 固定角色表互补，不覆盖固定设定。
- `memory_items` 是统一索引表，保存上述三层以及世界观、剧情、章节资料。
- `memory_items_fts` 提供 SQLite FTS5 关键词召回。
- 混合召回使用标准 RRF（Reciprocal Rank Fusion）合并关键词与向量排名，避免直接比较两种不同量纲的分数。
- `embedding` 以 JSON 数组保存，已支持余弦相似度召回；配置 `SILICONFLOW_API_KEY` 后自动调用硅基流动生成向量，调用失败时自动使用 FTS。
- 每条记忆保留 `sourceType`、`sourceId`、`volumeId`、`chapterId`，便于 Agent 回溯证据。
- 中心 Agent 通过 `search_novel_memory` 检索，通过 `remember_novel_memory` 保存确认后的世界观、角色、剧情和章节事实。
- 中心 Agent 通过 `record_novel_memory_event` 写 L0、`record_novel_memory_fact` 写 L1、`update_character_portrait` 更新 L3。
- `capture_novel_memory_event` 负责自动采集入口：写入 L0 后登记 `memory_jobs`，L1 提取失败会重试，达到上限后保留为 failed 任务，不影响原始记录。
- 正式落库工具成功后会非阻塞地自动采集世界观、角色、地点、卷纲、章节正文和裁决到 L0；Embedding/队列异常不会回滚正式业务表。

## 三层数据流

```text
章节正文 / Agent 事件
        -> L0 原始记录
        -> L1 原子事实与场景摘要
        -> L3 角色动态画像版本
        -> 统一 FTS5 + SiliconFlow Embedding 检索
        -> 中心 Agent
```

L3 更新必须携带 `basedOnFactIds`。Embedding 服务失败时不会丢失原始记录、事实或画像，只会将该条标记为待补向量，并继续使用 FTS5 检索。

L1 提取器参考腾讯项目的质量过滤、场景/事实结构化输出和批内去重，专门适配小说事实类别：角色状态、关系、目标变化、世界规则、剧情转折、场景状态。正式落库后，若存在 `DEEPSEEK_API_KEY`、`ANTHROPIC_AUTH_TOKEN` 或 `API_KEY`，系统会异步处理一条 L0 任务；设置 `MEMORY_AUTO_L1=false` 可关闭自动模型调用。L3 不由队列自动覆盖，只由中心 Agent 审核后调用画像工具。

## HTTP 接口

```text
POST /api/novels/:novelId/memories
GET  /api/novels/:novelId/memories?q=灵脉&volumeId=1&chapterId=2&limit=10
```

写入请求至少包含 `layer`、`title`、`content`、`sourceType`、`sourceId`。默认使用 `Qwen/Qwen3-Embedding-0.6B`、1024 维。配置项：`SILICONFLOW_API_KEY`、`SILICONFLOW_EMBEDDING_MODEL`、`SILICONFLOW_EMBEDDING_DIMENSIONS`、`SILICONFLOW_BASE_URL`。

复制项目根目录 `.env.example` 为 `.env` 并填入新生成的 API Key。不要把密钥提交到版本库。
