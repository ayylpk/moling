/**
 * Hono 应用入口 —— package.json 里 "dev": "bun run --hot src/index.ts" 指向的就是这里。
 *
 * 这一层只做两件事：注册 controller、决定监听端口。
 * 业务代码一律不写在这。
 */
import { Hono } from 'hono'
import { storyPlannerController } from './controller/storyPlannerController'

const app = new Hono()

app.get('/', (c) => c.text('墨灵 api 运行中'))

// 世界观相关接口都挂在 /api/worlds 下
app.route('/api/worlds', storyPlannerController)

// bun 直接跑这个文件就会起 HTTP 服务（默认 http://localhost:3000）
export default { port: 3000, fetch: app.fetch }
