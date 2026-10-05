import BlockTitle from '../components/BlockTitle.jsx';
import { useWorkbench } from '../layout/WorkbenchLayout.jsx';

/**
 * 选题页：一本书的「题眼」四问 —— logline / theme / coreConflict / endingDirection。
 *
 * 这四个字段存在 `outline_anchors`（全篇锚点，由第一卷大纲定稿时写入）。
 * ⚠️ 现在**没有任何东西往那张表写**（大纲这一类还没从 my-app 迁到 per-novel 库），
 * 所以这一页只能如实说"还没有" —— 之前这里摆的是另一本书的题眼。
 * 表一有产出，这一页照原来的四张卡渲染即可（字段名就是它定死的形状）。
 */
const FIELDS = [
  { zh: '一句话故事', en: 'logline' },
  { zh: '主题', en: 'theme' },
  { zh: '核心冲突', en: 'coreConflict' },
  { zh: '结局走向', en: 'endingDirection' },
];

export default function Topic() {
  const { novel } = useWorkbench();

  return (
    <main className="wb-page enter">
      <BlockTitle mark="题" name="选题" />

      <div className="dir-grid">
        {FIELDS.map((field) => (
          <article className="card dir-card" key={field.en}>
            <div className="field">
              <p className="field__k" data-en={field.en}>{field.zh}</p>
              <p className="field__v anno">尚未定稿</p>
            </div>
          </article>
        ))}
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        <p className="anno">
          {novel ? `《${novel.title}》还没有题眼。` : '书架上还没有书稿。'}
          这四个字段是「全篇锚点」，由第一卷大纲定稿时一次性写死，后续卷只许原样回填、不许重写。
        </p>
      </div>
    </main>
  );
}
