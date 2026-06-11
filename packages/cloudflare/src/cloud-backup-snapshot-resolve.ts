import {
  type CloudBackupProvider,
  type CloudBackupProviderAttempt,
  type CloudBackupSnapshotManifest,
} from "@renewlet/shared/schemas/cloud-backup";
import {
  CloudBackupRemoteError,
  sha256Hex,
  type CloudBackupRemoteClient,
} from "./cloud-backup-remote";

export type CloudBackupTarget = {
  provider: CloudBackupProvider;
  client: CloudBackupRemoteClient;
};

export async function downloadCloudBackupFromTargets(targets: CloudBackupTarget[], id: string): Promise<{ content: Uint8Array; manifest: CloudBackupSnapshotManifest }> {
  const attempts: CloudBackupProviderAttempt[] = [];
  for (const target of targets) {
    try {
      const result = await target.client.download(id);
      // 缺 provider 的下载可以自动试目标，但每个候选都必须通过 manifest+sha256 才能进入导入预览。
      if (!(await verifySnapshotBytes(result.content, result.manifest))) {
        attempts.push(cloudBackupProviderAttemptFromError(target.provider, "CLOUD_BACKUP_CHECKSUM_FAILED", "checksum_failed", new Error("CLOUD_BACKUP_CHECKSUM_FAILED")));
        continue;
      }
      return result;
    } catch (error) {
      attempts.push(cloudBackupProviderAttemptFromError(target.provider, "CLOUD_BACKUP_DOWNLOAD_FAILED", "internal", error));
    }
  }
  throw cloudBackupProviderAttemptsError(
    "CLOUD_BACKUP_DOWNLOAD_FAILED",
    "provider_attempts_failed",
    "No configured cloud backup target returned a valid snapshot. Check providerAttempts for upstream responses.",
    attempts,
  );
}

export async function deleteCloudBackupFromTargets(targets: CloudBackupTarget[], id: string): Promise<void> {
  const matches: CloudBackupTarget[] = [];
  const attempts: CloudBackupProviderAttempt[] = [];
  let failedList = false;
  for (const target of targets) {
    try {
      const manifests = await target.client.list();
      if (manifests.some((manifest) => manifest.id === id)) {
        matches.push(target);
        attempts.push({
          provider: target.provider,
          code: "CLOUD_BACKUP_SNAPSHOT_FOUND",
          reason: "found",
          providerMessage: "Snapshot exists in this provider.",
        });
      } else {
        attempts.push({
          provider: target.provider,
          code: "CLOUD_BACKUP_SNAPSHOT_NOT_FOUND",
          reason: "not_found",
          providerMessage: "Snapshot was not listed by this provider.",
        });
      }
    } catch (error) {
      failedList = true;
      attempts.push(cloudBackupProviderAttemptFromError(target.provider, "CLOUD_BACKUP_LIST_FAILED", "internal", error));
    }
  }
  if (matches.length === 1 && !failedList) {
    await matches[0]!.client.delete(id);
    return;
  }
  if (matches.length > 0) {
    // 缺 provider 的删除只有在唯一目标可证明时才执行；双目标命中或目标状态未知都必须让调用方显式指定。
    throw cloudBackupProviderAttemptsError(
      "CLOUD_BACKUP_PROVIDER_REQUIRED",
      "provider_required",
      "Snapshot may exist in multiple cloud backup targets. Use provider=webdav or provider=s3.",
      attempts,
    );
  }
  throw cloudBackupProviderAttemptsError(
    "CLOUD_BACKUP_DELETE_FAILED",
    "provider_attempts_failed",
    "No configured cloud backup target listed this snapshot. Check providerAttempts for upstream responses.",
    attempts,
  );
}

async function verifySnapshotBytes(content: Uint8Array, manifest: CloudBackupSnapshotManifest): Promise<boolean> {
  if (manifest.kind !== "renewlet-cloud-backup-snapshot" || manifest.schemaVersion !== 1) return false;
  if (manifest.sizeBytes !== content.length) return false;
  return (await sha256Hex(content)) === manifest.sha256.toLowerCase();
}

function cloudBackupProviderAttemptsError(code: string, reason: string, message: string, attempts: CloudBackupProviderAttempt[]): CloudBackupRemoteError {
  return new CloudBackupRemoteError(code, {
    reason,
    providerMessage: message,
    providerAttempts: attempts,
  });
}

function cloudBackupProviderAttemptFromError(provider: CloudBackupProvider, fallbackCode: string, fallbackReason: string, error: unknown): CloudBackupProviderAttempt {
  if (error instanceof CloudBackupRemoteError) {
    return {
      provider,
      code: error.code,
      reason: error.details?.reason ?? fallbackReason,
      providerMessage: error.details?.providerMessage ?? null,
      providerResponse: error.details?.providerResponse ?? null,
    };
  }
  return {
    provider,
    code: fallbackCode,
    reason: fallbackReason,
    providerMessage: error instanceof Error ? error.message : String(error),
  };
}
