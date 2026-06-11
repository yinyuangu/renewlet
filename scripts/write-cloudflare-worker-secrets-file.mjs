#!/usr/bin/env node
/**
 * Cloudflare Worker 可选运行时 secrets 文件生成器。
 *
 * CI 的 Wrangler config 只保存 Worker/D1/R2 资源标识；敏感运行时 token 必须走
 * Wrangler `--secrets-file` 临时文件，避免进入 wrangler.jsonc、generated config 或日志。
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const outputPathInput = process.argv[2] ?? process.env.CLOUDFLARE_WORKER_SECRETS_FILE;
if (!outputPathInput?.trim()) {
  throw new Error("Missing output path for Cloudflare Worker secrets file.");
}

const outputPath = resolve(outputPathInput);
const secrets = {};
const githubToken = process.env.RENEWLET_GITHUB_TOKEN?.trim();
if (githubToken) {
  secrets.RENEWLET_GITHUB_TOKEN = githubToken;
}

const hasSecrets = Object.keys(secrets).length > 0;
if (hasSecrets) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `has_secrets=${hasSecrets ? "true" : "false"}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `secrets_file=${hasSecrets ? outputPath : ""}\n`);
}

console.log(hasSecrets ? `Generated Cloudflare Worker secrets file: ${outputPath}` : "No optional Cloudflare Worker secrets configured.");
