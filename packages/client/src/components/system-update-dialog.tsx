import { AlertCircle, CheckCircle2, ExternalLink, RefreshCw, Rocket, Server, Sparkles } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useSystemUpdate, useSystemVersion } from "@/hooks/use-system-version";
import { useI18n } from "@/i18n/I18nProvider";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { SystemRuntime } from "@/lib/api/schemas/app";
import type { MessageKey } from "@/i18n/messages";

interface SystemUpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const runtimeLabelKeys: Record<SystemRuntime, MessageKey> = {
  cloudflare: "system.runtime.cloudflare",
  docker: "system.runtime.docker",
  source: "system.runtime.source",
};

export function SystemUpdateDialog({ open, onOpenChange }: SystemUpdateDialogProps) {
  const { t, formatDateTime } = useI18n();
  const { toast } = useToast();
  const versionQuery = useSystemVersion(open, open);
  const updateMutation = useSystemUpdate();
  const version = versionQuery.data;
  const releaseDate = useMemo(() => {
    const value = version?.releaseInfo?.publishedAt;
    if (!value) return "";
    return formatDateTime(value, { dateStyle: "medium", timeStyle: "short" });
  }, [formatDateTime, version?.releaseInfo?.publishedAt]);

  const handleUpdate = async () => {
    try {
      const result = await updateMutation.mutateAsync();
      toast({
        title: t("system.updateStartedTitle"),
        description: result.message,
      });
    } catch (error) {
      toast({
        title: t("system.updateFailedTitle"),
        description: error instanceof ApiError ? error.message : t("system.updateFailedDescription"),
        variant: "destructive",
      });
    }
  };

  const canUpdate = Boolean(version?.hasUpdate && version.updateSupported && !updateMutation.isPending && !updateMutation.isSuccess);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {t("system.updateTitle")}
          </DialogTitle>
          <DialogDescription>{t("system.updateDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {versionQuery.isPending ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              {t("system.checking")}
            </div>
          ) : versionQuery.isError ? (
            <StatePanel icon={<AlertCircle className="h-4 w-4" />} tone="danger" title={t("system.checkFailedTitle")} description={t("system.checkFailedDescription")} />
          ) : version ? (
            <>
              <div className="grid gap-3 rounded-lg border border-border bg-secondary/30 p-4 sm:grid-cols-2">
                <InfoItem label={t("system.currentVersion")} value={version.currentVersion} />
                <InfoItem label={t("system.latestVersion")} value={version.latestVersion} />
                <InfoItem label={t("system.runtime")} value={t(runtimeLabelKeys[version.runtime])} />
                <InfoItem label={t("system.buildType")} value={version.build.buildType} />
              </div>

              {version.warning ? (
                <StatePanel icon={<AlertCircle className="h-4 w-4" />} tone="warning" title={t("system.warningTitle")} description={version.warning} />
              ) : null}

              {!version.updateSupported ? (
                <StatePanel icon={<Server className="h-4 w-4" />} tone="neutral" title={t("system.unsupportedTitle")} description={version.unsupportedReason ?? t("system.unsupportedDescription")} />
              ) : version.hasUpdate ? (
                <StatePanel icon={<Rocket className="h-4 w-4" />} tone="success" title={t("system.updateAvailableTitle")} description={t("system.updateAvailableDescription", { version: version.latestVersion })} />
              ) : (
                <StatePanel icon={<CheckCircle2 className="h-4 w-4" />} tone="success" title={t("system.noUpdateTitle")} description={t("system.noUpdateDescription")} />
              )}

              {version.releaseInfo ? (
                <div className="space-y-3 rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium text-foreground">{version.releaseInfo.name || version.releaseInfo.tagName}</div>
                      {releaseDate ? <div className="text-xs text-muted-foreground">{releaseDate}</div> : null}
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <a href={version.releaseInfo.htmlUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" />
                        {t("system.releaseLink")}
                      </a>
                    </Button>
                  </div>
                  {version.releaseInfo.body ? (
                    <p className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-secondary/40 p-3 text-sm text-muted-foreground">
                      {version.releaseInfo.body}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {updateMutation.isSuccess ? (
                <StatePanel icon={<RefreshCw className="h-4 w-4" />} tone="warning" title={t("system.restartTitle")} description={t("system.restartDescription")} />
              ) : null}
            </>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => versionQuery.refetch()} disabled={versionQuery.isFetching || updateMutation.isPending}>
            <RefreshCw className={versionQuery.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {t("system.recheck")}
          </Button>
          <Button onClick={handleUpdate} disabled={!canUpdate}>
            {updateMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            {updateMutation.isPending ? t("system.updating") : t("system.updateNow")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SystemVersionBadge() {
  const { t } = useI18n();
  const versionQuery = useSystemVersion(true, false);
  const version = versionQuery.data;
  const label = version?.hasUpdate ? t("system.badgeUpdate", { version: version.latestVersion }) : t("system.badgeVersion", { version: version?.currentVersion ?? "…" });

  const variant = version?.hasUpdate ? "default" : "outline";
  return (
    <span
      className={cn(
        badgeVariants({ variant }),
        version?.hasUpdate
          ? "max-w-32 cursor-pointer overflow-hidden truncate border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 sm:max-w-none"
          : "max-w-28 cursor-pointer overflow-hidden truncate bg-background/60 text-muted-foreground sm:max-w-none",
      )}
    >
      {label}
    </span>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium text-foreground">{value || "—"}</div>
    </div>
  );
}

function StatePanel({ icon, tone, title, description }: { icon: ReactNode; tone: "danger" | "neutral" | "success" | "warning"; title: string; description: string }) {
  const toneClassName = {
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
    neutral: "border-border bg-secondary/40 text-muted-foreground",
    success: "border-primary/30 bg-primary/10 text-primary",
    warning: "border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  }[tone];

  return (
    <div className={`flex gap-3 rounded-lg border p-4 ${toneClassName}`}>
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        <div className="mt-1 text-sm opacity-90">{description}</div>
      </div>
    </div>
  );
}
