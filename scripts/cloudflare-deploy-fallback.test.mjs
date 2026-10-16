import assert from "node:assert/strict";
import test from "node:test";
import fallback from "./cloudflare-deploy-fallback.cjs";

function fixture(runs = []) {
  const calls = [];
  return {
    calls,
    github: { paginate: async (method, args) => (await method(args)).data.workflow_runs, rest: {
      repos: { getBranch: async () => ({ data: { commit: { sha: "current-sha" } } }) },
      actions: {
        listWorkflowRuns: async (args) => {
          assert.equal(args.head_sha, "current-sha");
          assert.equal(args.branch, "main");
          assert.equal(args.workflow_id, "cloudflare-worker.yml");
          return { data: { workflow_runs: runs } };
        },
        createWorkflowDispatch: async (args) => calls.push(args),
      },
    } },
    context: { repo: { owner: "yinyuangu", repo: "renewlet" } },
    core: { info() {} },
  };
}

test("dispatches main when a skip-ci sync has no deployment run", async () => {
  const f = fixture();
  await fallback(f);
  assert.deepEqual(f.calls, [{ owner: "yinyuangu", repo: "renewlet", workflow_id: "cloudflare-worker.yml", ref: "main", inputs: { expected_sha: "current-sha" } }]);
});

test("a dispatch skipped by the expected-SHA guard does not hide a missing deployment", async () => {
  const f = fixture([{ status: "completed", conclusion: "skipped" }]);
  await fallback(f);
  assert.equal(f.calls.length, 1);
});

test("does not duplicate queued, running, successful or failed deployments", async () => {
  for (const run of [{ status: "queued" }, { status: "in_progress" },
    { status: "completed", conclusion: "success" }, { status: "completed", conclusion: "failure" }]) {
    const f = fixture([run]);
    await fallback(f);
    assert.deepEqual(f.calls, []);
  }
});

test("a GitHub API error cannot trigger a blind production deployment", async () => {
  const f = fixture();
  f.github.rest.actions.listWorkflowRuns = async () => { throw new Error("API unavailable"); };
  await assert.rejects(fallback(f), /API unavailable/);
  assert.deepEqual(f.calls, []);
});
