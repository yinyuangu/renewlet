import { AlertCircle, Check, Download, ExternalLink, RefreshCw, RotateCw, Server, X } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSystemRestart, useSystemUpdate, useSystemVersion } from "@/hooks/use-system-version";
import { useI18n } from "@/i18n/I18nProvider";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { SystemDeployment } from "@/lib/api/schemas/app";
import type { MessageKey } from "@/i18n/messages";

interface SystemUpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const deploymentLabelKeys: Record<SystemDeployment, MessageKey> = {
  cloudflare: "system.runtime.cloudflare",
  docker: "system.runtime.docker",
  source: "system.runtime.source",
};

const RESTART_COUNTDOWN_SECONDS = 8;
const HEALTH_RETRY_COUNT = 5;
const HEALTH_RETRY_DELAY_MS = 1_000;
const CLOUDFLARE_DEPLOY_GUIDE_URL = "https://github.com/zhiyingzzhou/renewlet/blob/main/docs/cloudflare-workers-deploy.md";

export const systemRestartBrowser = {
  reload() {
    window.location.reload();
  },
};

/**
 * 管理员版本弹窗。
 *
 * 状态链：检查 Release -> 下载替换二进制 -> needsRestart -> 显式重启 -> 轮询 health -> 刷新页面。
 * Cloudflare/source 运行面只展示版本信息和不支持原因，不提供执行入口。
 * 前端只消费 deployment/updateMode/updateSupported，不能再从 buildType 反推部署能力。
 */
export function SystemUpdateDialog({ open, onOpenChange }: SystemUpdateDialogProps) {
  const { t } = useI18n();
  const versionQuery = useSystemVersion(true, open);
  const updateMutation = useSystemUpdate();
  const restartMutation = useSystemRestart();
  const version = versionQuery.data;
  const [updateError, setUpdateError] = useState("");
  const [restartCountdown, setRestartCountdown] = useState(0);

  const canUpdate = Boolean(version?.hasUpdate && version.updateSupported && !updateMutation.isPending && !updateMutation.isSuccess);
  const isRestarting = restartMutation.isPending || restartCountdown > 0;
  const showCompletedRestart = updateMutation.isSuccess && updateMutation.data?.needsRestart;

  const resetUpdateState = useCallback(() => {
    setUpdateError("");
    setRestartCountdown(0);
    updateMutation.reset();
    restartMutation.reset();
  }, [restartMutation, updateMutation]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    if (!showCompletedRestart && !isRestarting) {
      resetUpdateState();
    }
    onOpenChange(false);
  }, [isRestarting, onOpenChange, resetUpdateState, showCompletedRestart]);

  const handleRefresh = useCallback(() => {
    resetUpdateState();
    void versionQuery.refetch();
  }, [resetUpdateState, versionQuery]);

  const handleUpdate = useCallback(async () => {
    if (!canUpdate) return;
    setUpdateError("");
    try {
      await updateMutation.mutateAsync();
    } catch (error) {
      setUpdateError(error instanceof ApiError ? error.message : t("system.updateFailedDescription"));
    }
  }, [canUpdate, t, updateMutation]);

  const checkServiceAndReload = useCallback(async () => {
    for (let index = 0; index < HEALTH_RETRY_COUNT; index += 1) {
      try {
        const response = await fetch("/api/app/health", { cache: "no-cache" });
        if (response.ok) {
          systemRestartBrowser.reload();
          return;
        }
      } catch {
        // 旧进程退出到新进程拉起之间会短暂断连；这里静默等待下一轮健康检查。
      }
      if (index < HEALTH_RETRY_COUNT - 1) {
        await new Promise((resolve) => setTimeout(resolve, HEALTH_RETRY_DELAY_MS));
      }
    }
    systemRestartBrowser.reload();
  }, []);

  const handleRestart = useCallback(async () => {
    if (isRestarting) return;
    setRestartCountdown(RESTART_COUNTDOWN_SECONDS);
    try {
      await restartMutation.mutateAsync();
    } catch {
      // restart 请求可能在服务退出时被浏览器标记为失败；前端仍继续等待 health 恢复。
    }
    const interval = window.setInterval(() => {
      setRestartCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(interval);
          void checkServiceAndReload();
          return 0;
        }
        return current - 1;
      });
    }, 1_000);
  }, [checkServiceAndReload, isRestarting, restartMutation]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={t("system.openUpdateDialog")}
        >
          <SystemVersionBadge />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        mobileTitle={t("system.currentVersion")}
        mobileCloseLabel={t("common.close")}
        mobilePresentation="anchored"
        className="w-[min(calc(100vw-2rem),20rem)] rounded-xl border-border bg-card p-0 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-foreground">{t("system.currentVersion")}</span>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleRefresh}
            disabled={versionQuery.isFetching || updateMutation.isPending || isRestarting}
            aria-label={t("system.recheck")}
            title={t("system.recheck")}
          >
            <RefreshCw className={cn("h-4 w-4", versionQuery.isFetching ? "animate-spin" : "")} />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {versionQuery.isPending ? (
            <div className="flex flex-col items-center justify-center gap-2 py-7 text-primary">
              <RefreshCw className="h-6 w-6 animate-spin" />
              <span className="text-sm font-medium">{t("system.checking")}</span>
            </div>
          ) : versionQuery.isError ? (
            <StatePanel icon={<AlertCircle className="h-4 w-4" />} tone="danger" title={t("system.checkFailedTitle")} description={t("system.checkFailedDescription")} />
          ) : version ? (
            <>
              <VersionHero
                currentVersion={version.currentVersion}
                hasUpdate={version.hasUpdate}
                statusText={!version.checkSucceeded ? t("system.checkDeferredTitle") : version.hasUpdate ? `${t("system.latestVersion")}: v${version.latestVersion}` : t("system.noUpdateTitle")}
              />

              {updateError ? (
                <div className="space-y-3">
                  <StatePanel icon={<X className="h-4 w-4" />} tone="danger" title={t("system.updateFailedTitle")} description={updateError} />
                  <Button className="w-full" variant="destructive" onClick={handleUpdate} disabled={updateMutation.isPending}>
                    {t("system.retry")}
                  </Button>
                </div>
              ) : showCompletedRestart ? (
                <div className="space-y-3">
                  <StatePanel icon={<Check className="h-4 w-4" />} tone="success" title={t("system.updateComplete")} description={t("system.restartRequired")} />
                  <Button className="w-full" onClick={handleRestart} disabled={isRestarting}>
                    <RotateCw className={cn("h-4 w-4", isRestarting ? "animate-spin" : "")} />
                    {isRestarting ? (
                      <>
                        <span>{t("system.restarting")}</span>
                        {restartCountdown > 0 ? <span className="tabular-nums">({restartCountdown}s)</span> : null}
                      </>
                    ) : (
                      t("system.restartNow")
                    )}
                  </Button>
                </div>
              ) : !version.checkSucceeded ? (
                <StatePanel icon={<AlertCircle className="h-4 w-4" />} tone="warning" title={t("system.checkDeferredTitle")} description={version.warning ?? t("system.checkDeferredDescription")} />
              ) : !version.updateSupported ? (
                <div className="space-y-3">
                  <StatePanel icon={<Server className="h-4 w-4" />} tone="neutral" title={t("system.unsupportedTitle")} description={version.unsupportedReason ?? t("system.unsupportedDescription")} />
                  {version.updateMode === "cloudflare-deploy" ? <ReleaseLink href={CLOUDFLARE_DEPLOY_GUIDE_URL} label={t("system.cloudflareDeployGuide")} /> : null}
                  {version.releaseInfo?.htmlUrl ? <ReleaseLink href={version.releaseInfo.htmlUrl} label={t("system.releaseLink")} /> : null}
                </div>
              ) : version.hasUpdate ? (
                <div className="space-y-3">
                  <StatePanel icon={<Download className="h-4 w-4" />} tone="warning" title={t("system.updateAvailableTitle")} description={t("system.updateAvailableDescription", { version: version.latestVersion })} />
                  <Button className="w-full" onClick={handleUpdate} disabled={!canUpdate}>
                    {updateMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {updateMutation.isPending ? t("system.updating") : t("system.updateNow")}
                  </Button>
                  {version.releaseInfo?.htmlUrl ? <ReleaseLink href={version.releaseInfo.htmlUrl} label={t("system.viewChangelog")} /> : null}
                </div>
              ) : (
                <div className="space-y-3">
                  <StatePanel icon={<Check className="h-4 w-4" />} tone="success" title={t("system.noUpdateTitle")} description={t("system.noUpdateDescription")} />
                  {version.releaseInfo?.htmlUrl ? <ReleaseLink href={version.releaseInfo.htmlUrl} label={t("system.releaseLink")} /> : null}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <InfoItem label={t("system.runtime")} value={t(deploymentLabelKeys[version.deployment])} />
                <InfoItem label={t("system.buildType")} value={version.build.buildType} />
              </div>
            </>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function SystemVersionBadge() {
  const { t } = useI18n();
  const versionQuery = useSystemVersion(true, false);
  const version = versionQuery.data;
  const label = version?.hasUpdate ? t("system.badgeUpdate", { version: version.latestVersion }) : t("system.badgeVersion", { version: version?.currentVersion ?? "..." });

  return (
    <span
      className={cn(
        "inline-flex h-7 max-w-32 cursor-pointer items-center gap-1.5 overflow-hidden rounded-lg border px-2.5 text-xs font-medium transition-colors sm:max-w-none",
        version?.hasUpdate
          ? "border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
          : "border-border bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      <span className="truncate">{label}</span>
      {version?.hasUpdate ? (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
        </span>
      ) : null}
    </span>
  );
}

function VersionHero({ currentVersion, hasUpdate, statusText }: { currentVersion: string; hasUpdate: boolean; statusText: string }) {
  return (
    <div className="text-center">
      <div className="inline-flex min-w-0 items-center justify-center gap-2">
        <span className="truncate text-3xl font-bold tracking-normal text-foreground">v{currentVersion}</span>
        {!hasUpdate ? (
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Check className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>
      <p className="mt-1 truncate text-sm text-muted-foreground">{statusText}</p>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-secondary/40 px-2.5 py-2">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate font-medium text-foreground">{value || "-"}</div>
    </div>
  );
}

function ReleaseLink({ href, label }: { href: string; label: string }) {
  return (
    <a className="flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground" href={href} target="_blank" rel="noreferrer">
      {label}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

function StatePanel({ icon, tone, title, description }: { icon: ReactNode; tone: "danger" | "info" | "neutral" | "success" | "warning"; title: string; description: string }) {
  const toneClassName = {
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
    info: "border-sky-300/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    neutral: "border-border bg-secondary/40 text-muted-foreground",
    success: "border-primary/30 bg-primary/10 text-primary",
    warning: "border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  }[tone];

  return (
    <div className={`flex items-center gap-3 rounded-lg border p-3 ${toneClassName}`}>
      <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background/60">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{title}</div>
        <div className="mt-0.5 text-xs opacity-90">{description}</div>
      </div>
    </div>
  );
}
