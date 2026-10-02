import BlockTitle from '../components/BlockTitle.jsx';

/**
 * 剧情页：逐章事件账（outline.json → chapters[]，每章一条 stage=chapter 任务）。
 * 账表五栏 = chapters 的五个字段：goal/conflict/hook/emotion/(summary)。
 * summary 太长不进表，在书稿页的浮签里读。
 */
const ROWS = [
  {
    no: '01',
    title: '倒计时一百天',
    goal: '周砚让陈默把折成方块的纸条在散会时递到苏晴手上。',
    conflict: '纸条传到第三排被郑立平截住，当着全班念出，贴在倒计时旁边。',
    hook: '那张纸条还贴在那儿，倒计时数字从纸背面透出来。',
    emotion: '兴奋 → 僵',
  },
  {
    no: '02',
    title: '坡道下面那棵树',
    goal: '算好苏晴推电动车的时间，在坡道最上面那排车旁等她。',
    conflict: '苏晴一句「行吧，你有事？」挡回来，隔车把站了半分钟，她走了。',
    hook: '林晚还站在榕树底下，手里两瓶水，一瓶已经温了。',
    emotion: '紧张 → 空',
  },
  {
    no: '03',
    title: '第一次月考',
    goal: '（chapters[2].goal · 接数后填入）',
    conflict: '（chapters[2].conflict · 接数后填入）',
    hook: '（chapters[2].hook · 接数后填入）',
    emotion: '—',
  },
];

export default function Plot() {
  return (
    <main className="wb-page enter">
      <BlockTitle
        mark="情"
        name="剧情 · 事件账"
        anno="outline.chapters[] · stage=chapter · target_key 如 ch:013"
      />

      <div className="card" style={{ padding: '6px 22px 14px' }}>
        <table className="ledger">
          <thead>
            <tr>
              <th>章</th>
              <th>目标 goal</th>
              <th>冲突 conflict</th>
              <th>结尾钩子 hook</th>
              <th>情绪</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.no}>
                <td>{r.no} {r.title}</td>
                <td>{r.goal}</td>
                <td>{r.conflict}</td>
                <td className="cell-hook">{r.hook}</td>
                <td>{r.emotion}</td>
              </tr>
            ))}
            {/* 骨架行：余下 47 章接数后由 chapters.map 生成 */}
            <tr>
              <td>…</td>
              <td colSpan={4}>
                <div className="skel" style={{ width: '72%' }} />
                <div className="skel" style={{ width: '54%' }} />
                <p className="anno">共 50 章 · GET /api/novels/:id/generation/tasks?stage=chapter</p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="anno" style={{ marginTop: 14 }}>
        每章一条任务：claim 判 input_hash —— 一致 skip 复用磁盘稿，不一致才重跑。
        伏笔「埋 / 回收」两张账后端尚无表，留本页下半区待扩。
      </p>
    </main>
  );
}
