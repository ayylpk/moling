/**
 * 断点续跑的任务工具 —— `generation_tasks` 的写侧。
 *
 * ── 为什么这组必须存在 ──
 * 在这之前，任务表只有读（`read_progress`），没有写。也就是：
 * 中心 agent 能看到"跑到哪了"，但**没法记录"这一步我跑过了"**。
 * 结果是每次重进都从头再来，而重跑一卷 50 章的大纲很贵。
 *
 * ── 表的设计（读懂这三条才知道怎么用）──
 * 唯一键是 `(novel_id, stage, target_key)`，外加一个 `input_hash`（输入指纹）。
 * `claim` 的判定规则：
 *   · 记录是 `done` + 本次带了指纹 + 指纹一致  → `skip`（复用上次产物）
 *   · **空指纹一律 `run`** —— 调用方放弃缓存判断时，宁可重跑也不要错用旧产物
 *   · `reason` 分三种、不混：尚未执行 / 输入已变需要重跑 / 上次结束状态是 X 需要重跑
 *
 * ── 正确用法（顺序别乱）──
 *   1. `plan_tasks`   —— 先把这一步要做的事登记下来（可批量）
 *   2. `claim_task`   —— 逐条领，看 action 是 run 还是 skip
 *   3. 动作：run 就去调子 agent 干活；skip 就复用旧产物，别重跑
 *   4. `finish_task` / `fail_task` —— **必须收尾**。没收尾的任务会一直挂在
 *      `running`，下次进来就会变成"上次结束状态是 running"的脏数据。
 *
 * `reset_stale_running` 是给这种脏数据准备的：进程被杀、崩溃、断电之后，
 * 先把卡住的 running 标成 stale，再重新 claim。
 *
 * `invalidate_from_stage` 是另一回事：**改了上游就让下游全部作废**。
 * 世界观一变，角色/地点/大纲/正文都是基于旧世界观的，必须重跑。
 * 它**只管下游、不含自己**——自己那条记录是"这一版生成过"的历史事实，要留着。
 */
import { tool } from "langchain"
import type { RunnableConfig } from "@langchain/core/runnables"
import * as z from "zod"

import { STAGE_ORDER, type Stage } from "../../db/types"
import {
  planTasks,
  claimTask,
  finishTask,
  failTask,
  resetStaleRunning,
  invalidateFromStage,
} from "../../my-app/src/service/taskService"

/* ==================== 辅助 ==================== */

function novelIdOf(config?: RunnableConfig): number {
  const id = (config?.configurable as Record<string, unknown> | undefined)?.novelId
  if (typeof id !== "number" || !Number.isInteger(id)) {
    throw new Error("缺少 novelId：调用 SAgent 时请在 config 里传 `configurable: { novelId }`。")
  }
  return id
}

function pack(kind: string, payload: unknown): string {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)
  return `【${kind}】\n${body}`
}

/** 阶段名。取值直接绑 STAGE_ORDER，避免和库里的定义漂移。 */
const stageSchema = z.enum(STAGE_ORDER as unknown as [Stage, ...Stage[]])

/* ==================== 工具 ==================== */

export const planTasksTool = tool(
  async ({ stage, targetKeys, inputHash }, config) => {
    const novelId = novelIdOf(config)
    const res = planTasks(novelId, {
      stage,
      target_keys: targetKeys,
      ...(inputHash ? { input_hash: inputHash } : {}),
    })
    return pack("任务已登记", {
      新建: res.created,
      已存在跳过: res.skipped,
      任务: res.tasks.map((t) => ({ id: t.id, key: t.target_key, status: t.status })),
    })
  },
  {
    name: "plan_tasks",
    description:
      "把**这一步要做的事**登记进任务表（可批量）。" +
      "★ 在动手之前先登记，这样中途断了才查得出来漏了哪一步。" +
      "★ target_key 是这一步的标识：世界观用 'v1'、某章正文用章号、某卷大纲用卷号。" +
      "登记是幂等的——同一个 (stage, target_key) 重复登记只会 skip，不会产生两条。",
    schema: z.object({
      stage: stageSchema.describe(
        "阶段名。顺序有意义：上游一变，下游全部作废。character 与 location 并列同级。",
      ),
      targetKeys: z.array(z.string()).describe("要登记的目标标识，例如 ['v1'] 或 ['1','2','3']。"),
      inputHash: z.string().optional().describe("这批目标共同的输入指纹；不确定就留空。"),
    }),
  },
)

export const claimTaskTool = tool(
  async ({ stage, targetKey, inputHash }, config) => {
    const novelId = novelIdOf(config)
    const res = claimTask(novelId, {
      stage,
      target_key: targetKey,
      ...(inputHash ? { input_hash: inputHash } : {}),
    })
    return pack(res.action === "skip" ? "任务：可跳过（复用旧产物）" : "任务：需要执行", {
      action: res.action,
      原因: res.reason,
      taskId: res.task.id,
      status: res.task.status,
    })
  },
  {
    name: "claim_task",
    description:
      "**在动手生成之前先领任务**，它会告诉你这一步该跑还是该跳。" +
      "返回 action：`run` = 要做；`skip` = 输入没变、复用上次产物，**不要再调子 agent 了**。" +
      "reason 会说明为什么（尚未执行 / 输入已变需要重跑 / 上次结束状态是 X 需要重跑）。" +
      "★ 带上 inputHash 才可能 skip；**不带指纹一律 run**——这是刻意的，宁可重跑也不要错用旧产物。" +
      "★ 返回的 taskId 要留着，做完用 finish_task / 失败用 fail_task 收尾。",
    schema: z.object({
      stage: stageSchema,
      targetKey: z.string().describe("这一步的标识，例如 'v1' 或章号 '14'。"),
      inputHash: z
        .string()
        .optional()
        .describe("本次输入（世界观版本 + 角色卡 + 前情等）的指纹。留空则一定会重跑。"),
    }),
  },
)

export const finishTaskTool = tool(
  async ({ taskId, artifactPath }, config) => {
    const novelId = novelIdOf(config)
    const t = finishTask(novelId, taskId, artifactPath ? { artifact_path: artifactPath } : {})
    return pack(`任务已完成｜task_id:${t.id}`, { status: t.status })
  },
  {
    name: "finish_task",
    description:
      "把任务标记为完成。**做完必须调它**——不收尾的任务会一直挂在 running，" +
      "下次进来就变成脏数据，而脏数据会让 claim 判断出错。" +
      "artifact_path 填磁盘产物路径（如果落了盘），下次 skip 时就是复用它。",
    schema: z.object({
      taskId: z.number().describe("claim_task 返回的 taskId。"),
      artifactPath: z.string().optional().describe("磁盘产物路径，例如 resources/runs/<slug>/outline-v1.json。"),
    }),
  },
)

export const failTaskTool = tool(
  async ({ taskId, error }, config) => {
    const novelId = novelIdOf(config)
    const t = failTask(novelId, taskId, { error })
    return pack(`任务已标记失败｜task_id:${t.id}`, { status: t.status })
  },
  {
    name: "fail_task",
    description:
      "把任务标记为失败，并把错误原因记下来（截断到 2000 字）。" +
      "★ 工具返回空、输出被截断、模型连续重试仍失败，都要走到这里——" +
      "**不要静默跳过**，否则下次 claim 会以为它还在跑。" +
      "失败记录留着有用：重试时能看到上次是怎么挂的。",
    schema: z.object({
      taskId: z.number(),
      error: z.string().describe("为什么失败。写具体：是空返回、被截断，还是别的。"),
    }),
  },
)

export const resetStaleRunningTool = tool(
  async (_input, config) => {
    const novelId = novelIdOf(config)
    const res = resetStaleRunning(novelId)
    return pack("已重置卡住的任务", { 改动条数: res.changed })
  },
  {
    name: "reset_stale_running",
    description:
      "把所有还挂在 `running` 的任务标成 `stale`。" +
      "★ 什么时候用：进程被杀、崩溃、断电之后——那些任务实际上已经没人跑了，" +
      "但记录还停在 running，会让后续 claim 判断失真。" +
      "★ 开始新一轮工作之前调一次，是安全的做法（它只动 running 的）。",
    schema: z.object({}),
  },
)

export const invalidateFromStageTool = tool(
  async ({ fromStage }, config) => {
    const novelId = novelIdOf(config)
    const res = invalidateFromStage(novelId, fromStage)
    return pack("失效传播已执行", {
      起点: res.from_stage,
      被作废的阶段: res.invalidated_stages,
      改动条数: res.changed,
    })
  },
  {
    name: "invalidate_from_stage",
    description:
      "**改了上游就让下游全部作废**：从 fromStage 开始，把它后面所有阶段的任务标记为需要重跑。" +
      "★ 典型场景：世界观改了（新建了一版）→ 角色/地点/大纲/正文全都是基于旧世界观的，必须重跑。" +
      "★ 它**只管下游、不含自己**——起点那条记录是「这一版生成过」的历史事实，要留着，" +
      "否则将来就回答不了「这一卷是基于哪版世界观生成的」。" +
      "★ 这是有成本的操作，做之前先跟作者说清楚会影响哪些阶段。",
    schema: z.object({
      fromStage: stageSchema.describe("从哪个阶段开始作废下游。例如改了世界观就传 'world'。"),
    }),
  },
)

/* ==================== 汇总 ==================== */

/** 任务（断点续跑）工具。 */
export const taskTools = [
  planTasksTool,
  claimTaskTool,
  finishTaskTool,
  failTaskTool,
  resetStaleRunningTool,
  invalidateFromStageTool,
]
