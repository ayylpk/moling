/**
 * 区块题签：闲章记号 + 楷体名 + 界行长线（复用 global.css 的 .sec-title 骨架），
 * 尾部可挂一枚淡墨注（anno），写明这块的数据来源接口 —— 壳阶段先立约，接数不改版。
 */
export default function BlockTitle({ mark, name, anno }) {
  return (
    <div className="sec-title">
      <span className="mark">{mark}</span>
      <span className="name">{name}</span>
      <span className="rule" />
      {anno && <span className="anno wb-anno">{anno}</span>}
    </div>
  );
}
