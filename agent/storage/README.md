# 墨灵轻量 RAG 存储

每部小说的 `resources/novels/<slug>/novel.sqlite` 内包含记忆表，不引入独立数据库服务。

## 当前能力

- `memory_items` 保存原子事实、场景摘要、世界观、角色、剧情和章节记忆。
- `memory_items_fts` 提供 SQLite FTS5 关键词召回。
- `embedding` 以 JSON 数组保存，已支持余弦相似度召回；配置 `SILICONFLOW_API_KEY` 后自动调用硅基流动生成向量，调用失败时自动使用 FTS。
- 每条记忆保留 `sourceType`、`sourceId`、`volumeId`、`chapterId`，便于 Agent 回溯证据。
- 中心 Agent 通过 `search_novel_memory` 检索，通过 `remember_novel_memory` 保存确认后的世界观、角色、剧情和章节事实。

## HTTP 接口

```text
POST /api/novels/:novelId/memories
GET  /api/novels/:novelId/memories?q=灵脉&volumeId=1&chapterId=2&limit=10
```

写入请求至少包含 `layer`、`title`、`content`、`sourceType`、`sourceId`。默认使用 `Qwen/Qwen3-Embedding-0.6B`、1024 维。配置项：`SILICONFLOW_API_KEY`、`SILICONFLOW_EMBEDDING_MODEL`、`SILICONFLOW_EMBEDDING_DIMENSIONS`、`SILICONFLOW_BASE_URL`。

复制项目根目录 `.env.example` 为 `.env` 并填入新生成的 API Key。不要把密钥提交到版本库。
