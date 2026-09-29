import { ChatDeepSeek } from "@langchain/deepseek";
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

function loadAgentEnv() {
  try {
    const source = readFileSync(resolve(import.meta.dir, ".env"), "utf8")
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith("#")) continue
      const separator = line.indexOf("=")
      if (separator < 1) continue
      const key = line.slice(0, separator).trim()
      const value = line.slice(separator + 1).trim().replace(/^(['\"])(.*)\1$/, "$2")
      if (!process.env[key]) process.env[key] = value
    }
  } catch {
    // Environment variables may already be supplied by the shell.
  }
}

loadAgentEnv()

export function createModel(temperature: number, timeout = 120_000, thinking = false) {
  const apiKey = process.env.DEEPSEEK_API_KEY
    ?? process.env.ANTHROPIC_AUTH_TOKEN
    ?? process.env.API_KEY
  const baseURL = process.env.DEEPSEEK_BASE_URL
    ?? process.env.ANTHROPIC_BASE_URL
    ?? "https://api.deepseek.com"
  const model = process.env.DEEPSEEK_MODEL
    ?? process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
    ?? "deepseek-flash"

  return new ChatDeepSeek({
    model,
    apiKey,
    temperature,
    // 注意：thinking 模式不支持 tool_choice，而结构化输出（responseFormat）
    // 底层就是靠 tool_choice 强制模型走 schema。两者只能二选一，所以默认关闭。
    // 只有不需要结构化输出、且确实需要深度推理的场景，才显式传 thinking = true。
    ...(thinking
      ? { modelKwargs: { reasoning_effort: "high", thinking: { type: "enabled" } } }
      : {}),
    ...(baseURL ? { configuration: { baseURL } } : {}),
    timeout,
  })
}
