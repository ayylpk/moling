import { useEffect, useState } from 'react';
import Splash from './components/Splash.jsx';
import Home from './components/Home.jsx';

// 系统开关「减少动态效果」：直接跳过启动页进首页
const reducedMotion = window
  .matchMedia('(prefers-reduced-motion: reduce)')
  .matches;

/**
 * 壳的阶段机：
 *   splash  启动页演出中（约 1s：墨字扫出 → 落章）
 *   leave   启动页淡出，首页已挂载垫在下层
 *   home    只剩首页
 */
export default function App() {
  const [stage, setStage] = useState(reducedMotion ? 'home' : 'splash');

  useEffect(() => {
    if (stage !== 'splash') return;
    const t = setTimeout(() => setStage('leave'), 1100);
    return () => clearTimeout(t);
  }, [stage]);

  useEffect(() => {
    if (stage !== 'leave') return;
    const t = setTimeout(() => setStage('home'), 480);
    return () => clearTimeout(t);
  }, [stage]);

  return (
    <>
      {/* 首页在淡出期就挂上垫底，启动页退场时直接露出纸面 */}
      {stage !== 'splash' && <Home />}
      {!reducedMotion && stage !== 'home' && (
        <Splash leaving={stage === 'leave'} />
      )}
    </>
  );
}
