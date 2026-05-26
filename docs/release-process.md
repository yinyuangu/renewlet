# Release Process

Renewlet uses a tag-driven release process. `dev` is the integration branch, `main` is the latest stable release, and production artifacts are created only from release tags.

## Branches

- `dev`: day-to-day integration branch. Feature and fix PRs target this branch.
- `release/vX.Y.Z`: release stabilization branch created from `dev`.
- `main`: stable branch. It only receives release and hotfix PRs.
- `hotfix/vX.Y.Z`: urgent fix branch created from `main`, then merged back into `dev`.

Use Conventional Commits for PR titles and commits. Examples: `feat: add notification channel`, `fix: prevent duplicate reminder jobs`, `docs: clarify Docker upgrade`.

## Prepare A Release

1. Make sure `dev` is green in CI.
2. Run the `Release Prepare` workflow.
3. Enter a stable SemVer version such as `0.1.0`.
4. The workflow syncs package versions and opens a `release/v0.1.0` PR against `main`.
5. Edit `CHANGELOG.md` for that version. Keep the notes short and user-facing; the GitHub Release links to the full commit history separately.
6. Keep release-only fixes on `release/v0.1.0`.

## Publish A Release Candidate

1. Run the `Release Candidate` workflow.
2. Enter the stable version, for example `0.1.0`.
3. Enter the RC number, for example `1`.
4. The workflow creates tag `v0.1.0-rc.1`.
5. `Release Publish` builds and pushes:
   - `zhiyingzzhou/renewlet:0.1.0-rc.1`
   - `zhiyingzzhou/renewlet:rc`
   - `ghcr.io/zhiyingzzhou/renewlet:0.1.0-rc.1`
   - `ghcr.io/zhiyingzzhou/renewlet:rc`
6. RC releases are GitHub prereleases. They never update `latest` and never deploy production Cloudflare.

## Cloudflare Test Deploy

Use `.github/workflows/cloudflare-worker.yml` for Cloudflare test deployments. It runs on `dev` pushes and can also be started manually from GitHub Actions. This workflow is for test or user-managed Worker environments; it is separate from the release production gate.

## Publish Stable

1. Validate the RC with Docker and Cloudflare build checks.
2. Merge the release PR into `main`.
3. Create and push an annotated stable tag from `main`:

```bash
git checkout main
git pull --ff-only
git tag -a v0.1.0 -m "Renewlet v0.1.0"
git push origin v0.1.0
```

4. `Release Publish` builds Docker images, creates a draft GitHub Release, and attaches `renewlet-docker-v0.1.0.zip`, `renewlet_0.1.0_linux_amd64.tar.gz`, `renewlet_0.1.0_linux_arm64.tar.gz`, and `checksums.txt`.
5. Stable releases push:
   - `zhiyingzzhou/renewlet:0.1.0`
   - `zhiyingzzhou/renewlet:0.1`
   - `zhiyingzzhou/renewlet:latest`
   - `ghcr.io/zhiyingzzhou/renewlet:0.1.0`
   - `ghcr.io/zhiyingzzhou/renewlet:0.1`
   - `ghcr.io/zhiyingzzhou/renewlet:latest`
6. Review the draft Release, verify the Docker image list and short changelog, then publish it manually.
7. Approve the `production-cloudflare` environment if this release should deploy the production Worker. Stable releases use `.github/workflows/cloudflare-production.yml`, not the test deploy workflow.

## Docker In-App Updates

- `/renewlet` is the stable Docker entrypoint and healthcheck path; do not remove it in later releases.
- The real self-update target is `/opt/renewlet/current/renewlet`; the updater never replaces `/renewlet`.
- Users on images older than this layout must still run `docker compose pull && docker compose up -d` once. Later stable releases can be installed from the admin version dialog.
- Release binary archives must be Linux `amd64` and `arm64` tarballs named `renewlet_<version>_linux_<arch>.tar.gz`, with matching SHA-256 entries in `checksums.txt`.
- Cloudflare builds only expose version/release information and must not expose an executable update path.

## Hotfix

1. Create `hotfix/vX.Y.Z` from `main`.
2. Apply the smallest safe fix.
3. Open a PR to `main`.
4. After merge, tag `vX.Y.Z` and let `Release Publish` create the release.
5. Merge or cherry-pick the hotfix back to `dev`.

## Manual Checks

Before stable release, run or confirm these checks:

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

Production users should pin a concrete image tag. `latest` only moves on stable releases; RC tags are for validation.
