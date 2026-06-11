import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  cloudBackupErrorDetailsToClipboardText,
  cloudBackupErrorTroubleshootingText,
  type CloudBackupErrorDetailsView,
} from "@/lib/cloud-backup-error-details";
import { useI18n } from "@/i18n/I18nProvider";

interface CloudBackupErrorDetailsDialogProps {
  open: boolean;
  details: CloudBackupErrorDetailsView | null;
  onOpenChange: (open: boolean) => void;
}

type CopyState = "idle" | "copied" | "failed";

export function CloudBackupErrorDetailsDialog({ open, details, onOpenChange }: CloudBackupErrorDetailsDialogProps) {
  const { t } = useI18n();
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const errorDetailsText = cloudBackupErrorTroubleshootingText(details);
  const metadataText = useMemo(() => {
    if (!details) return "";
    return stringifyPretty({
      status: details.providerResponse?.status ?? details.status,
      statusText: details.providerResponse?.statusText ?? null,
      code: details.code,
      reason: details.reason,
      providerMessage: details.providerMessage,
      providerResponse: details.providerResponse,
      providerAttempts: details.providerAttempts,
      diagnostics: details.diagnostics,
    });
  }, [details]);
  // 复制内容和第一屏保持一致：有 HTTP response 就带完整响应，没有则带 SDK/网络诊断，避免关键信息藏在 metadata。
  const copyLabel = copyState === "copied"
    ? t("settings.cloudBackupUpstreamCopied")
    : copyState === "failed"
      ? t("settings.cloudBackupUpstreamCopyFailed")
      : t("settings.cloudBackupUpstreamCopy");

  useEffect(() => {
    if (!open) setCopyState("idle");
  }, [open, details]);

  async function handleCopy() {
    if (!details) return;
    try {
      await navigator.clipboard.writeText(cloudBackupErrorDetailsToClipboardText(details));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        layout="frame"
        className="h-[min(calc(var(--app-viewport-height)-2rem),42rem)] max-h-[min(calc(var(--app-viewport-height)-2rem),42rem)] max-w-4xl gap-0 overflow-hidden border-border bg-card p-0"
        closeLabel={t("common.close")}
      >
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-12 text-left">
          <div className="flex min-w-0 items-start gap-2">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-destructive/30 bg-destructive/10 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base leading-6">{t("settings.cloudBackupUpstreamTitle")}</DialogTitle>
              <DialogDescription className="mt-1 break-words text-xs leading-5">
                {t("settings.cloudBackupUpstreamDescription")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden px-4 py-3">
          <Tabs defaultValue="response" className="flex h-full min-h-0 min-w-0 flex-col" data-testid="cloud-backup-error-details-dialog">
            <TabsList className="h-9 w-full shrink-0 justify-start overflow-x-auto rounded-md bg-secondary/50 p-1 sm:w-auto">
              <TabsTrigger value="response" className="h-7 px-2.5 text-xs">{t("settings.cloudBackupUpstreamResponse")}</TabsTrigger>
              <TabsTrigger value="metadata" className="h-7 px-2.5 text-xs">{t("settings.cloudBackupUpstreamMetadata")}</TabsTrigger>
            </TabsList>
            <TabsContent value="response" className="mt-3 min-h-0 flex-1">
              <CodeBlock
                value={errorDetailsText}
                muted={!errorDetailsText}
              />
            </TabsContent>
            <TabsContent value="metadata" className="mt-3 min-h-0 flex-1">
              <CodeBlock value={metadataText} />
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-4 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-border"
            disabled={!details}
            onClick={() => void handleCopy()}
          >
            {copyState === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copyLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CodeBlock({ value, muted = false }: { value: string; muted?: boolean }) {
  return (
    <pre
      className={[
        "h-full min-h-0 overflow-auto rounded-md border border-border bg-secondary/30 p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words",
        muted ? "text-muted-foreground" : "text-foreground",
      ].join(" ")}
    >
      {value}
    </pre>
  );
}

function stringifyPretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
