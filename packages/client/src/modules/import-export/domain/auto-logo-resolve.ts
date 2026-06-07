import { mediaCandidateService } from "@/services/media-candidate-service";
import type { MediaCandidate } from "@/lib/api/schemas/media";
import { updatePreparedSubscriptionLogos } from "./wallos-import";
import type { ImportLogoAutoMatch, PreparedImport } from "./import-export-model";

const AUTO_LOGO_RESOLVE_BATCH_SIZE = 100;

/**
 * 自动 Logo 只写入高置信内置候选。
 *
 * favicon/domain 候选仍留在“修改 Logo”里手动选择，避免 AI/导入批量预览把弱推断 URL 写进 payload。
 */
export async function resolveAutoLogosForPreparedImport(nextPrepared: PreparedImport): Promise<PreparedImport> {
  const assetIndexes = new Set(nextPrepared.assets.map((asset) => asset.subscriptionIndex));
  const items = nextPrepared.payload.subscriptions.flatMap((subscription, index) => {
    if (subscription.logo || assetIndexes.has(index)) return [];
    return [{ id: String(index), name: subscription.name, ...(subscription.website ? { website: subscription.website } : {}) }];
  });
  if (items.length === 0) return nextPrepared;

  const logoOverrides = new Map<number, string | null>();
  const autoMatches: ImportLogoAutoMatch[] = [];
  try {
    for (let index = 0; index < items.length; index += AUTO_LOGO_RESOLVE_BATCH_SIZE) {
      const chunk = items.slice(index, index + AUTO_LOGO_RESOLVE_BATCH_SIZE);
      const response = await mediaCandidateService.resolve({
        kind: "logo",
        mode: "auto",
        items: chunk,
        limit: 1,
      });
      for (const item of response.items) {
        const candidate = item.autoCandidate;
        const subscriptionIndex = Number.parseInt(item.id, 10);
        if (!isAutoAssignableImportLogo(candidate) || !Number.isInteger(subscriptionIndex)) continue;
        logoOverrides.set(subscriptionIndex, candidate.url);
        autoMatches.push({
          subscriptionIndex,
          label: candidate.label,
          provider: candidate.provider,
          url: candidate.url,
        });
      }
    }
  } catch {
    return nextPrepared;
  }
  return updatePreparedSubscriptionLogos(nextPrepared, logoOverrides, autoMatches);
}

function isAutoAssignableImportLogo(candidate: MediaCandidate | null | undefined): candidate is MediaCandidate {
  return Boolean(
    candidate?.autoAssignable
      && candidate.source === "builtIn"
      && (candidate.confidence === "exact" || candidate.confidence === "strong"),
  );
}
