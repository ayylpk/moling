import BlockTitle from '../components/BlockTitle.jsx';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';

/**
 * 大纲页：三幕结构 / 张力曲线 / 硬约束。
 *
 * 这三样都存在 `outline_volumes`（一卷一行：acts / pacing / constraints / anchor_snapshot）。
 * ⚠️ 现在**没有任何东西往那张表写**（大纲这一类还没从 my-app 迁到 per-novel 库），
 * 所以这一页只能如实说"还没有" —— 之前这里摆的是另一本书的三幕与张力值。
 * 表一有产出，照原来的版式渲染即可：幕是卡片、张力是细墨条、约束是一张名单。
 */

export default function Outline() {
  const { novel } = useWorkbench();

  return (
    <main className="wb-page enter">
      <BlockTitle mark="纲" name="大纲" />

      <div className="card">
        <p className="anno">
          {novel ? `《${novel.title}》还没有大纲。` : '书架上还没有书稿。'}
          一卷大纲落库时，会同时写进：三幕结构（acts）、张力曲线（pacing）、硬约束（constraints），
          以及这一卷的全篇锚点快照 —— 之后拿它和当前锚点逐字比对，对不上就是漂移。
        </p>
      </div>
    </main>
  );
}
