import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { createWorldAgent, parseWorld } from "./agent"

async function loadEnvFile() {
  const path = resolve(import.meta.dir, "../.env")
  try {
    const source = await readFile(path, "utf8")
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
    // Shell-provided environment variables are sufficient.
  }
}

export async function run(prompt?: string) {
  await loadEnvFile()
  const description = prompt?.trim() || await readPrompt()
  if (!description) throw new Error("请输入世界观描述后再运行。")

  const result = await createWorldAgent().invoke({
    messages: [{ role: "user", content: description }],
  })
  const world = parseWorld(result.structuredResponse)
  console.log(JSON.stringify(world, null, 2))
  return world
}

async function readPrompt() {
  const rl = createInterface({ input, output })
  try {
    return await rl.question("请输入世界观描述：")
  } finally {
    rl.close()
  }
}

if (import.meta.main) {
  const prompt = process.argv.slice(2).join(" ")
  run(prompt).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`世界观 Agent 运行失败：${message}`)
    process.exitCode = 1
  })
}
