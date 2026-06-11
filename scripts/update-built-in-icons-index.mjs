#!/usr/bin/env node

/**
 * 图标索引生成脚本（内置多 provider）。
 *
 * 触发时机：维护者手动运行 `pnpm update:built-in-icons-index`，上游 registry 更新后再提交生成结果。
 * 前置依赖：Node.js fetch、可访问 TheSVG/selfh.st/Dashboard Icons 的网络，以及 shared media resolver 配置。
 * 副作用：重写前端运行时 seed 索引、Go embedded static seed 索引，以及 provider 级 GitHub 版本 metadata。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBuiltInIconIndex,
  canonicalBuiltInIconSeedMetadataJson,
  canonicalBuiltInIconIndexJson,
  countBuiltInIconProviders,
  createBuiltInIconSeedMetadata,
} from "../packages/shared/src/built-in-icon-index-builder.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(__dirname, "../packages/shared/data/media-resolver-config.json");
const mediaResolverConfig = JSON.parse(await readFile(configPath, "utf8"));

const outputPaths = [
  path.resolve(__dirname, "../packages/client/src/lib/built-in-icons-index.json"),
  path.resolve(__dirname, "../packages/server/internal/static/data/built-in-icons-index.json"),
];
const metadataOutputPaths = [
  path.resolve(__dirname, "../packages/client/src/lib/built-in-icons-index-metadata.json"),
  path.resolve(__dirname, "../packages/server/internal/static/data/built-in-icons-index-metadata.json"),
];
const FETCH_TIMEOUT_MS = 15_000;
const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

async function fetchJson(url, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // 上游 registry 是生成期依赖；超时失败必须阻断索引更新，不能写入半截候选库。
    const response = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${label} HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGitHubJson(url, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers = {
      accept: "application/vnd.github+json",
      "user-agent": "Renewlet-built-in-icon-index-generator",
      "x-github-api-version": GITHUB_API_VERSION,
    };
    const token = process.env.RENEWLET_GITHUB_TOKEN?.trim();
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${label} HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLatestRelease(owner, repo) {
  try {
    const release = await fetchGitHubJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/latest`, `${owner}/${repo} latest release`);
    return {
      tagName: typeof release.tag_name === "string" && release.tag_name.trim() ? release.tag_name.trim() : null,
      publishedAt: typeof release.published_at === "string" && release.published_at.trim() ? release.published_at.trim() : null,
    };
  } catch {
    return { tagName: null, publishedAt: null };
  }
}

async function fetchProviderVersion(providerConfig) {
  const { owner, repo, branch, latestRelease } = providerConfig.github;
  const commit = await fetchGitHubJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/commits/${branch}`, `${owner}/${repo} commit`);
  if (typeof commit.sha !== "string" || !commit.sha.trim()) {
    throw new Error(`${owner}/${repo} commit response missing sha`);
  }
  const commitSha = commit.sha.trim();
  const commitShortSha = commitSha.slice(0, 7);
  const commitDate = typeof commit.commit?.committer?.date === "string" && commit.commit.committer.date.trim()
    ? commit.commit.committer.date.trim()
    : null;
  const release = latestRelease ? await fetchLatestRelease(owner, repo) : { tagName: null, publishedAt: null };
  return {
    sourceRef: commitSha,
    displayVersion: commitShortSha,
    commitSha,
    commitShortSha,
    commitDate,
    releaseTag: release.tagName,
    releasePublishedAt: release.publishedAt,
  };
}

async function fetchProviderVersions(config) {
  const entries = await Promise.all(config.builtInProviders.map(async (providerConfig) => [
    providerConfig.provider,
    await fetchProviderVersion(providerConfig),
  ]));
  return Object.fromEntries(entries);
}

const icons = await buildBuiltInIconIndex(mediaResolverConfig, fetchJson);
const json = canonicalBuiltInIconIndexJson(icons);
const hash = createHash("sha256").update(json).digest("hex");
const metadataJson = canonicalBuiltInIconSeedMetadataJson(createBuiltInIconSeedMetadata(
  icons,
  hash,
  await fetchProviderVersions(mediaResolverConfig),
));

for (const outputPath of outputPaths) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  // 前端 seed 和 Go embedded static seed 必须写入同一 JSON 内容，保证 Docker 与 Cloudflare 冷启动行为一致。
  await writeFile(outputPath, json, "utf8");
}

for (const outputPath of metadataOutputPaths) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  // metadata 记录生成期真实 GitHub commit；当前版本展示只能读这里或刷新后的 provider 状态，不能手写来源词。
  await writeFile(outputPath, metadataJson, "utf8");
}

const counts = countBuiltInIconProviders(icons);
console.log(`Generated ${icons.length} built-in icons (${Object.entries(counts).map(([provider, count]) => `${provider}:${count}`).join(", ")}) at ${outputPaths.map((item) => path.relative(process.cwd(), item)).join(", ")} with metadata ${metadataOutputPaths.map((item) => path.relative(process.cwd(), item)).join(", ")}`);
