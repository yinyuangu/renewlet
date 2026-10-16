import assert from "node:assert/strict";
import test from "node:test";
import { parseDeployedWorkerVersion, waitForWorkerVersion } from "./cloudflare-deployment-confirmation";

const expected = "12345678-abcd-4321-abcd-1234567890ab";
const old = "87654321-abcd-4321-abcd-1234567890ab";
const entry = { type: "deploy", version: 1, worker_name: "renewlet", version_id: expected };

test("reads the exact deployed version from Wrangler structured output", () => {
  assert.equal(parseDeployedWorkerVersion(JSON.stringify({ type: "wrangler-session" }) + "\n" + JSON.stringify(entry) + "\n", "renewlet"), expected);
});

test("missing, ambiguous, malformed or wrong-worker output cannot authorize migrations", () => {
  for (const output of ["", "not-json", JSON.stringify({ ...entry, worker_name: "other" }),
    JSON.stringify({ ...entry, version_id: null }), JSON.stringify({ ...entry, version: 2 }),
    JSON.stringify({ ...entry, type: "version-upload" }), JSON.stringify(entry) + "\n" + JSON.stringify(entry)]) {
    assert.throws(() => parseDeployedWorkerVersion(output, "renewlet"), /structured deployment output/);
  }
});

test("waits through old, missing and unrelated versions until the exact version is active", async () => {
  const versions = [old, undefined, "unrelated-version", expected];
  let elapsed = 0;
  const result = await waitForWorkerVersion(expected, async () => {
    const versionId = versions.shift();
    return versionId ? { versionId } : undefined;
  }, { timeoutMs: 20, intervalMs: 5, now: () => elapsed, wait: async (ms) => { elapsed += ms; } });
  assert.deepEqual(result, { versionId: expected });
  assert.equal(elapsed, 15);
});

test("a stale deployment times out instead of authorizing migrations", async () => {
  let elapsed = 0;
  let reads = 0;
  await assert.rejects(waitForWorkerVersion(expected, async () => {
    reads += 1;
    return { versionId: old };
  }, { timeoutMs: 10, intervalMs: 5, now: () => elapsed, wait: async (ms) => { elapsed += ms; } }), /Timed out waiting for Worker version/);
  assert.equal(elapsed, 10);
  assert.equal(reads, 3);
});

test("permission and malformed-response errors still fail closed immediately", async () => {
  await assert.rejects(waitForWorkerVersion(expected, async () => { throw new Error("HTTP 403"); }, {
    wait: async () => { assert.fail("must not retry authorization failures"); },
  }), /HTTP 403/);
});
