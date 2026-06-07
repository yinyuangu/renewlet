import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Circle, FileSearch, Loader2 } from "lucide-react";
import { AIDraftReviewPanel } from "@/components/ai-recognition/ai-draft-review-panel";
import { AIRecognitionInputTabs } from "@/components/ai-recognition/ai-recognition-input-tabs";
import type { AIDraftListItem, AIRecognitionImageItem, AIRecognitionInputMode } from "@/components/ai-recognition/ai-recognition-dialog-types";
import Link from "@/components/router-link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImportPreviewPanel } from "@/components/import-preview-panel";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages";
import { getDisplayErrorMessage } from "@/lib/display-error";
import { todayDateOnlyInTimeZone } from "@/lib/time/date-only";
import {
  AI_RECOGNITION_MAX_IMAGE_BYTES,
  AI_RECOGNITION_MAX_IMAGES,
  AI_RECOGNITION_MAX_TEXT_CHARS,
  type AiRecognizedSubscriptionDraft,
  type AiRecognitionProvider,
  type AiThinkingControl,
} from "@/lib/api/schemas/ai-recognition";
import { cn } from "@/lib/utils";
import type { CustomConfig } from "@/types/config";
import type { AppSettings } from "@/types/subscription";
import {
  type AIThinkingOption,
  getAIThinkingOptions,
  normalizeAIThinkingControl,
  thinkingControlFromOptionId,
  thinkingOptionId,
} from "@/modules/ai-recognition/domain/model-capabilities";
import { getAIRecognitionSettingsBlocker } from "@/modules/ai-recognition/domain/settings-readiness";
import { buildPreparedImportFromAIDrafts } from "@/modules/ai-recognition/domain/ai-recognition-import";
import { getAIDraftBlockingIssues } from "@/modules/ai-recognition/domain/ai-draft-preflight";
import { IMPORT_MESSAGE_CODES } from "@/modules/import-export/domain/import-export-model";
import { useImportPreviewApply } from "@/modules/import-export/application/use-import-preview-apply";
import { aiRecognitionService } from "@/services/ai-recognition-service";

interface AIRecognizeSubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AppSettings;
  config: CustomConfig;
  availableTags?: readonly string[];
}

const NO_THINKING_CONTROL_ID = "no-explicit-thinking";
type AIRecognitionStage = "input" | "draft" | "preview";
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const AI_PROVIDER_LABEL_KEYS: Record<AiRecognitionProvider, MessageKey> = {
  openai: "aiRecognition.provider.openai",
  gemini: "aiRecognition.provider.gemini",
  anthropic: "aiRecognition.provider.anthropic",
  "openai-compatible": "aiRecognition.provider.openaiCompatible",
};
const AI_BLOCKING_IMPORT_WARNING_CODES = new Set<string>([
  IMPORT_MESSAGE_CODES.aiBillingCycleDefaulted,
  IMPORT_MESSAGE_CODES.aiCurrencyDefaulted,
  IMPORT_MESSAGE_CODES.aiCustomCycleDefaulted,
  IMPORT_MESSAGE_CODES.aiDateDefaulted,
  IMPORT_MESSAGE_CODES.aiPriceDefaulted,
]);

export function AIRecognizeSubscriptionDialog({
  open,
  onOpenChange,
  settings,
  config,
  availableTags = [],
}: AIRecognizeSubscriptionDialogProps) {
  const { t } = useI18n();
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const imageItemsRef = useRef<AIRecognitionImageItem[]>([]);
  const imageIdRef = useRef(0);
  const draftIdRef = useRef(0);
  const recognitionRunRef = useRef(0);
  const [inputMode, setInputMode] = useState<AIRecognitionInputMode>("text");
  const [text, setText] = useState("");
  const [images, setImages] = useState<AIRecognitionImageItem[]>([]);
  const [drafts, setDrafts] = useState<AIDraftListItem[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [recognitionWarnings, setRecognitionWarnings] = useState<string[]>([]);
  const [thinkingControl, setThinkingControl] = useState<AiThinkingControl | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [previewingDrafts, setPreviewingDrafts] = useState(false);
  const [stage, setStage] = useState<AIRecognitionStage>("input");
  const [draftsStale, setDraftsStale] = useState(false);
  const today = todayDateOnlyInTimeZone(new Date(), settings.timezone);
  const aiSettings = settings.aiRecognition;
  const settingsBlocker = getAIRecognitionSettingsBlocker(aiSettings);
  const thinkingOptions = useMemo(
    () => getAIThinkingOptions(aiSettings.provider, aiSettings.model),
    [aiSettings.model, aiSettings.provider],
  );
  const selectedThinkingId = thinkingControl ? thinkingOptionId(thinkingControl) : NO_THINKING_CONTROL_ID;
  const {
    prepared,
    preview,
    conflictMode,
    previewFilter,
    skippedIndexes,
    error,
    applying,
    assetProgress,
    applyProgress,
    setError,
    setPreviewFilter,
    resetImportPreview,
    previewPrepared,
    handleConflictModeChange,
    handleLogoChange,
    handleSkipChange,
    handleApply,
  } = useImportPreviewApply({ onApplied: () => handleOpenChange(false) });
  const hasBlockingImportWarnings = prepared ? hasBlockingAIImportWarnings(prepared.warnings) : false;
  const draftBlockingIssuesById = useMemo(
    () => new Map(drafts.map((item) => [item.id, getAIDraftBlockingIssues(item.draft)])),
    [drafts],
  );
  const firstBlockingDraftId = useMemo(
    () => drafts.find((item) => (draftBlockingIssuesById.get(item.id)?.length ?? 0) > 0)?.id ?? null,
    [draftBlockingIssuesById, drafts],
  );
  const hasDraftBlockingIssues = firstBlockingDraftId !== null;
  const activeText = inputMode === "text" ? text.trim() : "";
  const activeImages = inputMode === "image" ? images : [];
  const canGenerate = !settingsBlocker && (activeText.length > 0 || activeImages.length > 0) && !recognizing;
  const workflowExpanded = stage !== "input";
  const inputStageVisible = stage === "input";
  const draftStageVisible = stage === "draft";
  const previewStageVisible = stage === "preview";

  useEffect(() => {
    imageItemsRef.current = images;
  }, [images]);

  useEffect(() => () => revokeImageItems(imageItemsRef.current), []);

  useEffect(() => {
    if (!open) return;
    setThinkingControl(normalizeAIThinkingControl(aiSettings.provider, aiSettings.model, aiSettings.defaultThinkingControl));
  }, [aiSettings.defaultThinkingControl, aiSettings.model, aiSettings.provider, open]);

  function reset() {
    recognitionRunRef.current += 1;
    revokeImageItems(imageItemsRef.current);
    imageItemsRef.current = [];
    imageIdRef.current = 0;
    draftIdRef.current = 0;
    setInputMode("text");
    setText("");
    setImages([]);
    setDrafts([]);
    setSelectedDraftId(null);
    setRecognitionWarnings([]);
    setRecognizing(false);
    setPreviewingDrafts(false);
    setStage("input");
    setDraftsStale(false);
    setError(null);
    resetImportPreview();
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  function addImages(files: File[]) {
    if (files.length === 0) return;
    setError(null);
    const nextImages = [...imageItemsRef.current];
    const previousCount = nextImages.length;
    let nextError: string | null = null;
    for (const file of files) {
      if (nextImages.length >= AI_RECOGNITION_MAX_IMAGES) {
        nextError = t("aiRecognition.imageLimit", { count: AI_RECOGNITION_MAX_IMAGES });
        break;
      }
      if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size > AI_RECOGNITION_MAX_IMAGE_BYTES) {
        nextError = t("aiRecognition.imageInvalid");
        continue;
      }
      nextImages.push({
        id: nextImageId(imageIdRef),
        file,
        thumbnailUrl: createObjectUrl(file),
      });
    }
    imageItemsRef.current = nextImages;
    setImages(nextImages);
    if (nextImages.length !== previousCount) markDraftsStaleFromInputChange();
    if (nextError) setError(nextError);
  }

  function removeImage(id: string) {
    const removed = imageItemsRef.current.find((image) => image.id === id);
    const nextImages = imageItemsRef.current.filter((image) => image.id !== id);
    if (removed) revokeImageItem(removed);
    imageItemsRef.current = nextImages;
    setImages(nextImages);
    if (removed) markDraftsStaleFromInputChange();
  }

  function handleInputModeChange(nextMode: AIRecognitionInputMode) {
    if (nextMode === inputMode) return;
    setInputMode(nextMode);
    markDraftsStaleFromInputChange();
  }

  function handleTextChange(nextText: string) {
    if (nextText === text) return;
    setText(nextText);
    markDraftsStaleFromInputChange();
  }

  function handleThinkingChange(value: string) {
    const nextThinkingControl = value === NO_THINKING_CONTROL_ID ? null : thinkingControlFromOptionId(thinkingOptions, value);
    if (thinkingOptionIdOrNull(nextThinkingControl) === thinkingOptionIdOrNull(thinkingControl)) return;
    setThinkingControl(nextThinkingControl);
    markDraftsStaleFromInputChange();
  }

  function markDraftsStaleFromInputChange() {
    if (drafts.length === 0) return;
    // 输入、图片和思考控制是草稿生成的事实源；返回输入后改动任一项，都必须让旧 preview 失效。
    setDraftsStale(true);
    resetImportPreview();
  }

  function handleBackToInput() {
    setStage("input");
    setError(null);
  }

  function handleBackToDraft() {
    if (drafts.length === 0 || draftsStale) return;
    setStage("draft");
    setError(null);
  }

  const handleRecognize = async () => {
    if (!canGenerate) return;
    const runId = recognitionRunRef.current + 1;
    recognitionRunRef.current = runId;
    setRecognizing(true);
    setError(null);
    setRecognitionWarnings([]);
    resetImportPreview();
    try {
      const response = await aiRecognitionService.recognizeSubscriptions({
        text: inputMode === "text" ? text : "",
        images: inputMode === "image" ? images.map((image) => image.file) : [],
        thinkingControl,
      });
      if (recognitionRunRef.current !== runId) return;
      const nextDrafts = response.subscriptions.map((draft) => ({
        id: nextDraftId(draftIdRef),
        draft,
      }));
      setDrafts(nextDrafts);
      setSelectedDraftId(nextDrafts[0]?.id ?? null);
      setRecognitionWarnings(response.warnings);
      setDraftsStale(false);
      setStage("draft");
    } catch (err) {
      if (recognitionRunRef.current !== runId) return;
      setError(getDisplayErrorMessage(err, t("aiRecognition.recognizeFailedDescription")));
    } finally {
      if (recognitionRunRef.current === runId) setRecognizing(false);
    }
  };

  const handleBuildPreview = async () => {
    if (drafts.length === 0 || draftsStale) return;
    if (firstBlockingDraftId) {
      setSelectedDraftId(firstBlockingDraftId);
      setStage("draft");
      setError(null);
      return;
    }
    setPreviewingDrafts(true);
    setError(null);
    try {
      const preparedImport = buildPreparedImportFromAIDrafts(drafts.map((item) => item.draft), { settings, config, today });
      await previewPrepared(preparedImport, conflictMode);
      setStage("preview");
    } catch (err) {
      setError(getDisplayErrorMessage(err, t("import.previewFailed")));
    } finally {
      setPreviewingDrafts(false);
    }
  };

  function invalidateDraftPreview() {
    // 草稿是导入预览的前端事实源；任何编辑/删除都必须废弃旧 preview，避免确认时写入过期数据。
    resetImportPreview();
  }

  function updateDraft(id: string, patch: Partial<AiRecognizedSubscriptionDraft>) {
    invalidateDraftPreview();
    setDrafts((current) => current.map((item) => (item.id === id ? { ...item, draft: { ...item.draft, ...patch } } : item)));
  }

  function removeDraft(id: string) {
    invalidateDraftPreview();
    const removedIndex = drafts.findIndex((item) => item.id === id);
    const nextDrafts = drafts.filter((item) => item.id !== id);
    const fallback = removedIndex >= 0 ? nextDrafts[Math.min(removedIndex, nextDrafts.length - 1)]?.id ?? null : null;
    setDrafts(nextDrafts);
    setSelectedDraftId((currentSelected) => (currentSelected === id ? fallback : currentSelected));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        layout="frame"
        className={cn(
          "h5-import-dialog-panel overflow-hidden border-border bg-card p-0 sm:max-w-6xl",
          workflowExpanded ? "h5-dialog-frame" : "h5-ai-recognition-input-dialog-frame",
        )}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          textInputRef.current?.focus();
        }}
      >
        <DialogHeader className="shrink-0 border-b border-border bg-card px-4 py-4 pr-12 sm:px-6 sm:pr-14">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary/50 text-muted-foreground">
                <FileSearch className="h-4 w-4" />
              </div>
              <div className="min-w-0 text-left">
                <DialogTitle className="text-lg">{t("aiRecognition.dialogTitle")}</DialogTitle>
                <DialogDescription className="mt-1 max-w-3xl text-left leading-5">{t("aiRecognition.dialogDescription")}</DialogDescription>
              </div>
            </div>
            <AIRecognitionStepper
              steps={[
                { label: t("aiRecognition.stepInput"), active: stage === "input", done: drafts.length > 0 && !draftsStale },
                { label: t("aiRecognition.stepDraft"), active: stage === "draft", done: stage === "preview" },
                { label: t("import.stepPreview"), active: stage === "preview", done: Boolean(preview && preview.summary.errors === 0) },
                { label: t("import.stepApply"), active: Boolean(preview && preview.summary.errors === 0), done: false },
              ]}
              ariaLabel={t("aiRecognition.dialogTitle")}
            />
          </div>
        </DialogHeader>

        <div
          data-testid="ai-recognition-dialog-body"
          className={cn(
            "min-h-0 px-4 py-4 sm:px-6",
            inputStageVisible || draftStageVisible
              ? "flex flex-col gap-4 overflow-hidden"
              : "space-y-4 overflow-y-auto",
          )}
        >
          {settingsBlocker ? (
            <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>{t(settingsBlocker)}</span>
              </div>
              <Button asChild type="button" variant="outline" className="shrink-0 border-border">
                <Link href="/settings#settings-ai-recognition" onClick={() => handleOpenChange(false)}>
                  {t("aiRecognition.openSettings")}
                </Link>
              </Button>
            </div>
          ) : null}

          {inputStageVisible ? (
            <section className="grid min-h-0 flex-1 gap-4 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-stretch lg:overflow-hidden" aria-label={t("aiRecognition.stepInput")}>
              <AIRecognitionInputTabs
                mode={inputMode}
                onModeChange={handleInputModeChange}
                text={text}
                onTextChange={handleTextChange}
                textInputRef={textInputRef}
                images={images}
                disabled={recognizing}
                onAddImages={addImages}
                onRemoveImage={removeImage}
              />
              <AIRecognitionRunSettingsPanel
                provider={aiSettings.provider}
                model={aiSettings.model}
                mode={inputMode}
                textLength={text.length}
                imageCount={images.length}
                thinkingOptions={thinkingOptions}
                selectedThinkingId={selectedThinkingId}
                disabled={recognizing}
                onThinkingChange={handleThinkingChange}
              />
            </section>
          ) : null}

          {inputStageVisible && drafts.length > 0 && draftsStale ? (
            <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("aiRecognition.draftsStale")}</span>
            </div>
          ) : null}

          {error ? (
            <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {recognitionWarnings.length > 0 ? (
            <div className="rounded-lg border border-border bg-secondary/30 p-3 text-xs leading-5 text-muted-foreground">
              {recognitionWarnings.slice(0, 6).map((warning, index) => <p key={`${warning}:${index}`}>{warning}</p>)}
            </div>
          ) : null}

          {draftStageVisible && drafts.length > 0 ? (
            <AIDraftReviewPanel
              drafts={drafts}
              config={config}
              settings={settings}
              availableTags={availableTags}
              draftBlockingIssuesById={draftBlockingIssuesById}
              selectedDraftId={selectedDraftId}
              onSelectedDraftIdChange={setSelectedDraftId}
              onChangeDraft={updateDraft}
              onRemoveDraft={removeDraft}
            />
          ) : null}

          {previewStageVisible && prepared && preview ? (
            <>
              {hasBlockingImportWarnings ? (
                <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t("aiRecognition.blockingWarnings")}</span>
                </div>
              ) : null}
              <ImportPreviewPanel
                prepared={prepared}
                preview={preview}
                conflictMode={conflictMode}
                previewFilter={previewFilter}
                skippedIndexes={skippedIndexes}
                assetProgress={assetProgress}
                applyProgress={applyProgress}
                showImportOptions={false}
                onConflictModeChange={handleConflictModeChange}
                onPreviewFilterChange={setPreviewFilter}
                onLogoChange={handleLogoChange}
                onSkipChange={handleSkipChange}
              />
            </>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t border-border bg-card px-4 py-4 sm:px-6">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>{t("common.cancel")}</Button>
          {inputStageVisible && drafts.length > 0 && !draftsStale ? (
            <Button
              type="button"
              variant="outline"
              className="gap-2 border-border"
              disabled={recognizing}
              onClick={handleBackToDraft}
            >
              {t("aiRecognition.backToDraft")}
            </Button>
          ) : null}
          {inputStageVisible ? (
            <Button
              type="button"
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary-glow"
              disabled={!canGenerate}
              onClick={() => void handleRecognize()}
            >
              {recognizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
              {recognizing ? t("aiRecognition.recognizing") : t(drafts.length > 0 ? "aiRecognition.regenerateDrafts" : "aiRecognition.generateDrafts")}
            </Button>
          ) : draftStageVisible ? (
            <>
              <Button type="button" variant="outline" className="border-border" disabled={previewingDrafts || recognizing} onClick={handleBackToInput}>
                {t("aiRecognition.backToInput")}
              </Button>
              <Button
                type="button"
                className="gap-2"
                onClick={() => void handleBuildPreview()}
                disabled={previewingDrafts || recognizing || drafts.length === 0 || draftsStale || hasDraftBlockingIssues}
              >
                {previewingDrafts ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {t("aiRecognition.previewDrafts")}
              </Button>
            </>
          ) : preview && previewStageVisible ? (
            <>
              <Button type="button" variant="outline" className="border-border" disabled={applying} onClick={handleBackToDraft}>
                {t("aiRecognition.backToDraft")}
              </Button>
              <Button type="button" onClick={() => void handleApply()} disabled={preview.summary.errors > 0 || hasBlockingImportWarnings || applying}>
                {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                {t("aiRecognition.confirmImport")}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              className="gap-2"
              onClick={() => void handleBuildPreview()}
              disabled={previewingDrafts || recognizing || drafts.length === 0 || hasDraftBlockingIssues}
            >
              {previewingDrafts ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {t("aiRecognition.previewDrafts")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AIRecognitionStepper({
  steps,
  ariaLabel,
}: {
  steps: Array<{ label: string; active: boolean; done: boolean }>;
  ariaLabel: string;
}) {
  return (
    <ol className="flex min-w-0 items-center gap-0 overflow-x-auto text-xs text-muted-foreground lg:justify-end" aria-label={ariaLabel}>
      {steps.map((step, index) => (
        <li key={step.label} className="flex min-w-0 items-center">
          <span className={cn(
            "inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1",
            step.active && "text-foreground",
          )}>
            <span className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
              step.done
                ? "border-primary/40 bg-primary/10 text-primary"
                : step.active
                  ? "border-foreground/40 bg-background text-foreground"
                  : "border-border bg-secondary/40 text-muted-foreground",
            )}>
              {step.done ? <Check className="h-3 w-3" /> : step.active ? <Circle className="h-2 w-2 fill-current" /> : index + 1}
            </span>
            <span className="truncate">{step.label}</span>
          </span>
          {index < steps.length - 1 ? <span className="mx-1 h-px w-6 shrink-0 bg-border" /> : null}
        </li>
      ))}
    </ol>
  );
}

function AIRecognitionRunSettingsPanel({
  provider,
  model,
  mode,
  textLength,
  imageCount,
  thinkingOptions,
  selectedThinkingId,
  disabled,
  onThinkingChange,
}: {
  provider: AiRecognitionProvider;
  model: string;
  mode: AIRecognitionInputMode;
  textLength: number;
  imageCount: number;
  thinkingOptions: AIThinkingOption[];
  selectedThinkingId: string;
  disabled: boolean;
  onThinkingChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const inputSummary = mode === "text"
    ? `${textLength}/${AI_RECOGNITION_MAX_TEXT_CHARS}`
    : t("aiRecognition.imageCount", { count: imageCount, max: AI_RECOGNITION_MAX_IMAGES });

  return (
    <aside className="rounded-lg border border-border bg-background p-3" aria-label={t("aiRecognition.settingsTitle")}>
      <div className="border-b border-border pb-3">
        <h3 className="text-sm font-semibold text-foreground">{t("aiRecognition.settingsTitle")}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("aiRecognition.thinkingRunHelp")}</p>
      </div>

      <dl className="grid gap-2 border-b border-border py-3 text-xs">
        <SummaryLine label={t("aiRecognition.provider")} value={t(AI_PROVIDER_LABEL_KEYS[provider])} />
        <SummaryLine label={t("aiRecognition.model")} value={model || t("aiRecognition.draftUnknownValue")} />
        <SummaryLine label={t("aiRecognition.stepInput")} value={inputSummary} />
      </dl>

      <div className="grid gap-2 pt-3">
        <Label htmlFor="ai-recognition-thinking" className="text-xs font-medium text-muted-foreground">
          {t("aiRecognition.thinking")}
        </Label>
        <Select value={selectedThinkingId} disabled={disabled} onValueChange={onThinkingChange}>
          <SelectTrigger id="ai-recognition-thinking" className="h-9 border-border bg-secondary/40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_THINKING_CONTROL_ID}>{t("aiRecognition.thinking.noExplicitControl")}</SelectItem>
            {thinkingOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>{t(option.labelKey)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs leading-5 text-muted-foreground">
          {thinkingOptions.length > 0
            ? t("aiRecognition.thinkingHelp")
            : t(provider === "openai-compatible" ? "aiRecognition.thinkingUnsupportedCompatible" : "aiRecognition.thinkingUnsupportedModel")}
        </p>
      </div>
    </aside>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-foreground" title={value}>{value}</dd>
    </div>
  );
}

function thinkingOptionIdOrNull(control: AiThinkingControl | null): string | null {
  return control ? thinkingOptionId(control) : null;
}

function nextImageId(ref: { current: number }): string {
  ref.current += 1;
  return `ai-image-${ref.current}`;
}

function nextDraftId(ref: { current: number }): string {
  ref.current += 1;
  return `ai-draft-${ref.current}`;
}

function createObjectUrl(file: File): string | null {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  return URL.createObjectURL(file);
}

function revokeImageItem(image: AIRecognitionImageItem) {
  if (image.thumbnailUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(image.thumbnailUrl);
  }
}

function revokeImageItems(images: readonly AIRecognitionImageItem[]) {
  for (const image of images) {
    revokeImageItem(image);
  }
}

function hasBlockingAIImportWarnings(warnings: readonly string[]): boolean {
  return warnings.some((warning) => (
    warning.split("|").some((part) => AI_BLOCKING_IMPORT_WARNING_CODES.has(part))
  ));
}
