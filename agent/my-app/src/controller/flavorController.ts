import {
  agentsOfDimension,
  listFlavors as listFlavorsIn,
  listGenres,
  listStyles,
  readFlavor as readFlavorIn,
  removeFlavor as removeFlavorIn,
  renameFlavor as renameFlavorIn,
  saveFlavor as saveFlavorIn,
  trashRoot,
  type AgentKey,
  type FlavorFragments,
  type ManagedFlavor,
  type RemoveOutcome,
  type RenameOutcome,
  type SaveOutcome,
} from '../../../skills'
import {
  generateFlavorFromMaterial,
  type GenerationResult,
  type MaterialInput,
} from '../service/flavorGenerationService'

/**
 * 类型 / 文风库 controller —— 和书架一样**不接 novelId**。
 *
 * 这两个维度是全局共享的配置，任何一本书都用同一套，所以谈不上"哪本书的"。
 * 它下面的动作全是文件操作（见 `skills/manage.ts` 里为什么不上 SQLite 的说明），
 * 没有库可开也没有库要关 —— 这一层在这里只做一件事：
 * **把文件层的结果整形成上层能直接用的形状**，别让它去理解目录结构。
 */

/** 现在有哪些文风与类型可选 —— 前端建书表单靠它渲染下拉 */
export const listFlavors = () => ({ styles: listStyles(), genres: listGenres() })

/** 一个维度下的全部条目（含各片内容）—— 管理页的列表 */
export const listDimension = (dimension: string): ManagedFlavor[] => listFlavorsIn(dimension)

/** 一个条目的详情；不存在返回 null，由调用方决定 404 还是空态 */
export const getFlavor = (dimension: string, name: string): ManagedFlavor | null => readFlavorIn(dimension, name)

/** 这个维度该写哪几片（类型 7 / 文风 2）—— 前端据此渲染编辑框，不写死在前端 */
export const agentsOf = (dimension: string): AgentKey[] => agentsOfDimension(dimension)

/** 保存。`update = true` 是改已有条目，默认是建新（重名会返回 duplicate 而不是覆盖） */
export const saveFlavor = (
  dimension: string,
  name: string,
  fragments: FlavorFragments,
  update = false,
): SaveOutcome => saveFlavorIn(dimension, name, fragments, { update })

export const renameFlavor = (dimension: string, from: string, to: string): RenameOutcome =>
  renameFlavorIn(dimension, from, to)

/** 删除 —— 只是挪到隔离区，不真删。返回挪到了哪里 */
export const removeFlavor = (dimension: string, name: string): RemoveOutcome => removeFlavorIn(dimension, name)

/** 隔离区路径。前端要提示"删掉的在哪"就拿它 */
export const flavorTrashRoot = (): string => trashRoot()

/**
 * 素材 → 一个类型 + 一个文风。
 *
 * 这里**不落库也不落盘**：返回的片段只是草稿，用户在前端改完、勾选之后，
 * 才由 saveFlavor 写出文件。素材本身（图片 base64 / 文本）用完即弃。
 */
export const generateFromMaterial = (material: MaterialInput): Promise<GenerationResult> =>
  generateFlavorFromMaterial(material)
