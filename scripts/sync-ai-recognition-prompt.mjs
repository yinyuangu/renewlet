#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// AI 识别提示词同步器：shared JSON 是事实源，Go 嵌入副本只用于 Docker 二进制运行时读取。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "packages/shared/data/ai-recognition-prompt.json");
const serverPath = path.join(repoRoot, "packages/server/internal/static/data/ai-recognition-prompt.json");
const checkOnly = process.argv.includes("--check");

const source = await readFile(sourcePath, "utf8");
const current = await readFile(serverPath, "utf8").catch(() => "");

if (source === current) {
  console.log("AI recognition prompt is in sync");
  process.exit(0);
}

if (checkOnly) {
  throw new Error("packages/server/internal/static/data/ai-recognition-prompt.json is out of sync with packages/shared/data/ai-recognition-prompt.json");
}

await mkdir(path.dirname(serverPath), { recursive: true });
await writeFile(serverPath, source, "utf8");
console.log("synced AI recognition prompt to server embedded data");
