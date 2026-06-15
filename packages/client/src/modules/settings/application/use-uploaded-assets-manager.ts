import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import { assetInUseDetailsSchema, type AssetInUseDetails, type UploadedAsset } from "@/lib/api/schemas/media";
import { useToast } from "@/hooks/use-toast";
import {
  invalidateUploadedAssetsQueries,
  removeUploadedAssetFromQueryCache,
  useUploadedAssetsByKind,
} from "@/hooks/use-uploaded-assets";
import { assetService } from "@/services/asset-service";
import { getDisplayErrorMessage } from "@/lib/display-error";
import { useI18n } from "@/i18n/I18nProvider";

interface UploadedAssetKindController {
  assets: UploadedAsset[];
  error: Error | null;
  hasLoaded: boolean;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

interface AssetDeleteError {
  assetId: string;
  message: string;
}

export interface UploadedAssetsManagerController {
  logo: UploadedAssetKindController;
  icon: UploadedAssetKindController;
  deleteError: AssetDeleteError | null;
  deletingAssetId: string | null;
  deleteAsset: (asset: UploadedAsset) => Promise<boolean>;
}

export function useUploadedAssetsManager(): UploadedAssetsManagerController {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const logo = useUploadedAssetsByKind("logo", { enabled: true });
  const icon = useUploadedAssetsByKind("icon", { enabled: true });
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<AssetDeleteError | null>(null);

  const deleteAsset = useCallback(async (asset: UploadedAsset) => {
    if (deletingAssetId) return false;
    setDeletingAssetId(asset.id);
    setDeleteError(null);
    try {
      await assetService.delete(asset.id);
      removeUploadedAssetFromQueryCache(queryClient, asset);
      await invalidateUploadedAssetsQueries(queryClient, asset.kind);
      toast({
        title: t("settings.uploadedIconsDeleteSuccess"),
        description: t("settings.uploadedIconsDeleteSuccessDescription", { name: assetLabel(asset, t("settings.uploadedIconsUnnamedAsset")) }),
      });
      return true;
    } catch (error: unknown) {
      const fallback = t("settings.uploadedIconsDeleteFailedDescription");
      const message = assetDeleteErrorMessage(error, fallback, t);
      setDeleteError({ assetId: asset.id, message });
      toast({
        title: t("settings.uploadedIconsDeleteFailed"),
        description: message,
        variant: "destructive",
      });
      return false;
    } finally {
      setDeletingAssetId(null);
    }
  }, [deletingAssetId, queryClient, t, toast]);

  return {
    logo,
    icon,
    deleteError,
    deletingAssetId,
    deleteAsset,
  };
}

function assetInUseDetails(error: unknown): AssetInUseDetails | null {
  if (!(error instanceof ApiError) || error.code !== "ASSET_IN_USE") return null;
  const payload = error.details;
  const parsed = assetInUseDetailsSchema.safeParse(isApiErrorBody(payload) ? payload.details : null);
  return parsed.success ? parsed.data : null;
}

function assetDeleteErrorMessage(
  error: unknown,
  fallback: string,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const details = assetInUseDetails(error);
  if (details) {
    if (details.subscriptionLogoCount > 0 && details.paymentMethodIconCount > 0) {
      return t("settings.uploadedIconsDeleteBlockedByBoth", {
        subscriptionCount: details.subscriptionLogoCount,
        paymentMethodCount: details.paymentMethodIconCount,
      });
    }
    if (details.paymentMethodIconCount > 0) {
      return t("settings.uploadedIconsDeleteBlockedByPaymentMethods", { count: details.paymentMethodIconCount });
    }
    return t("settings.uploadedIconsDeleteBlockedBySubscriptions", { count: details.subscriptionLogoCount });
  }
  return getDisplayErrorMessage(error, fallback);
}

function assetLabel(asset: UploadedAsset, fallback: string): string {
  return asset.originalName?.trim() || fallback;
}

function isApiErrorBody(value: unknown): value is { details: unknown } {
  return value !== null && typeof value === "object" && !Array.isArray(value) && "details" in value;
}
