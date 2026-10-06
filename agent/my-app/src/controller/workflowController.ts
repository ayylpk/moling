import { readWorkflowStatus, readWorkflowSummary } from '../service/workflowService'
import { withNovel } from './withNovel'

/**
 * 工作流 controller —— 给「这本书走到哪一步了」这个问题一个出口。
 *
 * 两个读法，刻意分开：
 *   · getWorkflowSummary —— 简化结构（阶段 + 各阶段计数），给页面用。
 *     generation_tasks 的 target_key / input_hash / attempt 这些**内部实现不外泄**：
 *     页面一旦开始拿它们做判断，任务表的语义就被前端冻住了，以后改不动。
 *   · getWorkflowLamps —— 执笔画布那七盏灯的原始视图。
 */
export const getWorkflowSummary = (novelId: number) =>
  withNovel(novelId, (database) => readWorkflowSummary(database))

export const getWorkflowLamps = (novelId: number) =>
  withNovel(novelId, (database) => readWorkflowStatus(database))
