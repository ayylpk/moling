import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 把 `agent/.env` 里的键值读进 `process.env`。
 *
 * **两个模型工厂共用这一份**（create_model 的 DeepSeek、aliyun 的百炼），
 * 别各写一遍解析 —— 两份解析迟早会在"引号怎么剥""注释怎么算"上长歪。
 *
 * 已存在的进程变量优先：shell 里 export 的覆盖文件里的，
 * 这样临时换个 key 调试不用改文件。
 */
export const loadAgentEnv = (): void => {
  try {
    const source = readFileSync(resolve(import.meta.dir, '.env'), 'utf8')
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const separator = line.indexOf('=')
      if (separator < 1) continue
      const key = line.slice(0, separator).trim()
      const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
      if (!process.env[key]) process.env[key] = value
    }
  } catch {
    // Environment variables may already be supplied by the shell.
  }
}
