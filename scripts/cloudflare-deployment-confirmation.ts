import { setTimeout as sleep } from "node:timers/promises";
import { isJsonObject } from "./cloudflare-wrangler-config";
import type { ActiveDeployment } from "./cloudflare-worker-deployment";

/** Bind confirmation to this command's output, never merely to a version different from the old one. */
export function parseDeployedWorkerVersion(output: string, workerName: string): string {
  const invalid = () => new Error("Invalid Wrangler structured deployment output");
  let entries: unknown[];
  try {
    entries = output.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as unknown);
  } catch {
    throw invalid();
  }
  const deployments = entries.filter((entry) => isJsonObject(entry) && entry["type"] === "deploy");
  const entry = deployments[0];
  if (deployments.length !== 1 || !isJsonObject(entry) || entry["version"] !== 1
    || entry["worker_name"] !== workerName || typeof entry["version_id"] !== "string"
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(entry["version_id"])) {
    throw invalid();
  }
  return entry["version_id"];
}

interface ConfirmationOptions {
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

/** Cloudflare's deployment read can lag a successful publish. Retry stale reads, not unsafe responses. */
export async function waitForWorkerVersion(
  expectedVersion: string,
  readActive: () => Promise<ActiveDeployment | undefined>,
  options: ConfirmationOptions = {},
): Promise<ActiveDeployment> {
  const { timeoutMs = 120_000, intervalMs = 5_000, now = Date.now, wait = sleep } = options;
  const deadline = now() + timeoutMs;
  for (;;) {
    // Permission, network, malformed-envelope and split-traffic errors retain fail-closed behavior.
    const active = await readActive();
    if (active?.versionId === expectedVersion) return active;
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error(`Timed out waiting for Worker version ${expectedVersion} at 100% traffic`);
    await wait(Math.min(intervalMs, remaining));
  }
}
