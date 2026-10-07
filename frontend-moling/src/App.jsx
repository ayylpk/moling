import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Splash from './components/Splash.jsx';
import Home from './components/Home.jsx';
import WorkbenchLayout from './layout/WorkbenchLayout.jsx';
import Workspace from './pages/Workspace.jsx';
import Desk from './pages/Desk.jsx';
import Topic from './pages/Topic.jsx';
import Outline from './pages/Outline.jsx';
import Cast from './pages/Cast.jsx';
import Plot from './pages/Plot.jsx';
import Style from './pages/Style.jsx';
import Flavors from './pages/Flavors.jsx';
import Manuscript from './pages/Manuscript.jsx';
import World from './pages/World.jsx';

// 系统开关「减少动态效果」：直接跳过启动页进首页
const reducedMotion = window
  .matchMedia('(prefers-reduced-motion: reduce)')
  .matches;

/**
 * 壳的阶段机（沿用 v0.1）：
 *   splash  启动页演出中（约 1s：墨字扫出 → 落章）
 *   leave   启动页淡出，下层页面已挂载垫底
 *   home    只剩路由页
 *
 * 路由用 HashRouter：将来整站大概率是静态托管（同 hinaverse 的教训），
 * hash 路由免服务器 rewrite，`vite preview` 下刷新也不 404。
 *
 * 双界面（10/4 重塑，取代原「侧栏九宫格」）：
 *   /w      执笔 —— Agent 链路画布 + 对话栏（WorkbenchLayout 分发的暗色壳）
 *   /w/*    文库 —— 侧栏导航 + 资料页（书架/选题/世界观/大纲/角色/剧情/文风/书稿）
 * 两壳共用 WorkbenchContext（当前小说、偏好、保存态），顶栏「执笔/文库」纸签互切。
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
      {/* 淡出期就把当前路由页挂上垫底，启动页退场时直接露出纸面 */}
      {stage !== 'splash' && (
        <HashRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/w" element={<WorkbenchLayout />}>
              <Route index element={<Workspace />} />
              <Route path="desk" element={<Desk />} />
              <Route path="topic" element={<Topic />} />
              <Route path="outline" element={<Outline />} />
              <Route path="cast" element={<Cast />} />
              <Route path="plot" element={<Plot />} />
              <Route path="style" element={<Style />} />
              <Route path="flavors" element={<Flavors />} />
              <Route path="manuscript" element={<Manuscript />} />
              <Route path="world" element={<World />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      )}
      {!reducedMotion && stage !== 'home' && (
        <Splash leaving={stage === 'leave'} />
      )}
    </>
  );
}
