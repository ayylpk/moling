import Seal from './Seal.jsx';

/**
 * 启动页（约 1 秒）：玄墨底 → 「墨灵」笔锋扫出 → 朱砂落章。
 * 纯 CSS 动画，无任何素材依赖；退场由 App 的阶段机加 splash--out 淡出。
 */
export default function Splash({ leaving }) {
  return (
    <div className={`splash${leaving ? ' splash--out' : ''}`}>
      <div className="splash__stack">
        <span className="splash__word">墨灵</span>
        <span className="splash__seal">
          <Seal />
        </span>
        <span className="splash__bleed" aria-hidden="true" />
      </div>
    </div>
  );
}
