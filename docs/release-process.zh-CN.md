# 发布流程

Renewlet 使用 tag 驱动发布。`dev` 是日常集成分支，`main` 是最新稳定版分支，Release、镜像和 Cloudflare 生产部署只从发布 tag 产生。

## 分支

- `dev`：日常集成分支，功能和修复 PR 默认合入这里。
- `release/vX.Y.Z`：从 `dev` 拉出的发布稳定分支。
- `main`：稳定版分支，只接收 release PR 和 hotfix PR。
- `hotfix/vX.Y.Z`：从 `main` 拉出的紧急修复分支，修完后回灌到 `dev`。

PR 标题和 commit 使用 Conventional Commits。示例：`feat: add notification channel`、`fix: prevent duplicate reminder jobs`、`docs: clarify Docker upgrade`。

## 准备发布

1. 确认 `dev` 的 CI 通过。
2. 运行 `Release Prepare` workflow。
3. 输入稳定版 SemVer，例如 `0.1.0`。
4. workflow 会同步 package 版本，并创建指向 `main` 的 `release/v0.1.0` PR。
5. 编辑 `CHANGELOG.md` 中对应版本的短 release notes。内容保持面向用户、简短可读；GitHub Release 会单独附完整 commit 历史链接。
6. 发布期只在 `release/v0.1.0` 上做 release 修复。

## 发布候选版

1. 运行 `Release Candidate` workflow。
2. 输入稳定版版本号，例如 `0.1.0`。
3. 输入 RC 编号，例如 `1`。
4. workflow 会创建 `v0.1.0-rc.1` tag。
5. `Release Publish` 会构建并推送：
   - `zhiyingzzhou/renewlet:0.1.0-rc.1`
   - `zhiyingzzhou/renewlet:rc`
   - `ghcr.io/zhiyingzzhou/renewlet:0.1.0-rc.1`
   - `ghcr.io/zhiyingzzhou/renewlet:rc`
6. RC 是 GitHub prerelease，永远不会更新 `latest`，也不会部署 Cloudflare 生产环境。

## Cloudflare 测试部署

Cloudflare 测试部署使用 `.github/workflows/cloudflare-worker.yml`。它会在 `dev` push 时运行，也可以在 GitHub Actions 页面手动启动。这个 workflow 面向测试环境或用户自管 Worker 环境，和正式版发布的生产审批门分开。

## 发布稳定版

1. 用 Docker 和 Cloudflare build 检查验证 RC。
2. 把 release PR 合入 `main`。
3. 从 `main` 创建并推送稳定版 annotated tag：

```bash
git checkout main
git pull --ff-only
git tag -a v0.1.0 -m "Renewlet v0.1.0"
git push origin v0.1.0
```

4. `Release Publish` 会构建 Docker 镜像、创建 draft GitHub Release，并附加 `renewlet-docker-v0.1.0.zip`、`renewlet_0.1.0_linux_amd64.tar.gz`、`renewlet_0.1.0_linux_arm64.tar.gz` 和 `checksums.txt`。
5. 稳定版推送：
   - `zhiyingzzhou/renewlet:0.1.0`
   - `zhiyingzzhou/renewlet:0.1`
   - `zhiyingzzhou/renewlet:latest`
   - `ghcr.io/zhiyingzzhou/renewlet:0.1.0`
   - `ghcr.io/zhiyingzzhou/renewlet:0.1`
   - `ghcr.io/zhiyingzzhou/renewlet:latest`
6. 检查 draft Release 的镜像列表和短 changelog 后，手动发布 Release。
7. 如果本次稳定版需要部署 Cloudflare 生产 Worker，审批 `production-cloudflare` environment。稳定版发布使用 `.github/workflows/cloudflare-production.yml`，不使用测试部署 workflow。

## Docker 页面内更新

- `/renewlet` 是稳定 Docker 入口和 healthcheck 路径，后续版本不要删除。
- 真实自更新目标是 `/opt/renewlet/current/renewlet`；更新器永远不替换 `/renewlet`。
- 使用旧布局镜像的用户仍需先执行一次 `docker compose pull && docker compose up -d`。完成桥接后，后续稳定版可在管理员版本弹窗里更新。
- Release 二进制包必须提供 Linux `amd64` 和 `arm64` tarball，命名为 `renewlet_<version>_linux_<arch>.tar.gz`，并在 `checksums.txt` 写入对应 SHA-256。
- Cloudflare 构建只暴露版本/发布页信息，不允许暴露可执行更新路径。

## 热修复

1. 从 `main` 拉出 `hotfix/vX.Y.Z`。
2. 做最小安全修复。
3. 开 PR 合入 `main`。
4. 合并后打 `vX.Y.Z` tag，让 `Release Publish` 创建发布。
5. 把 hotfix merge 或 cherry-pick 回 `dev`。

## 手动检查

稳定版发布前运行或确认以下检查：

```bash
pnpm check:file-lines
pnpm check:deploy
pnpm --filter @renewlet/client lint
pnpm --filter @renewlet/client i18n:check
pnpm --filter @renewlet/client test:run
pnpm --dir packages/server test
pnpm typecheck
pnpm check:cloudflare
pnpm build:cloudflare
docker build --pull --no-cache -t renewlet:release-smoke .
```

生产用户应固定具体镜像标签。`latest` 只随稳定版移动；RC 标签只用于发布前验证。
