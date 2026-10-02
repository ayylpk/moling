/**
 * Hono 应用入口 —— package.json 里 "dev": "bun run --hot src/index.ts" 指向的就是这里。
 *
 * 这一层只做两件事：注册 controller、决定监听端口。
 * 业务代码一律不写在这。
 *
 * 路由分两族：
 *   /api/novels/...          小说本身（整库的根）
 *   /api/novels/:id/...      挂在某本小说下的内容
 *   /api/worlds/...          世界观（历史路径，保留不动）
 */
import { Hono } from 'hono'
import { storyPlannerController } from './controller/storyPlannerController'
import { novelController } from './controller/novelController'
import { generationController } from './controller/generationController'

const app = new Hono()

app.get('/', (c) => c.text('墨灵 api 运行中'))

// 世界观相关接口
app.route('/api/worlds', storyPlannerController)

// 小说相关接口
app.route('/api/novels', novelController)

// 生成进度与续跑：挂在某本小说下面
app.route('/api/novels/:novelId/generation', generationController)

// bun 直接跑这个文件就会起 HTTP 服务（默认 http://localhost:3000）
export default { port: 3000, fetch: app.fetch }
