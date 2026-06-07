import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, Sparkles, TestTube2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n/I18nProvider";
import { getDisplayErrorMessage } from "@/lib/display-error";
import { cn } from "@/lib/utils";
import type { AiModelListItem, AiRecognitionProvider, AiRecognitionSettings } from "@/lib/api/schemas/ai-recognition";
import {
  getAIThinkingOptions,
  normalizeAIThinkingControl,
  thinkingControlFromOptionId,
  thinkingOptionId,
} from "@/modules/ai-recognition/domain/model-capabilities";
import { getAIRecognitionSettingsBlocker } from "@/modules/ai-recognition/domain/settings-readiness";
import { aiRecognitionService } from "@/services/ai-recognition-service";
import { AIModelCombobox, AIModelModeSwitch } from "./ai-model-combobox";
import { LoadingButtonContent } from "./settings-shared-controls";

const AI_PROVIDERS = ["openai", "gemini", "anthropic", "openai-compatible"] as const satisfies readonly AiRecognitionProvider[];
const MODEL_DEFAULT_THINKING_ID = "model-default";
const AI_PROVIDER_LABEL_KEYS = {
  openai: "aiRecognition.provider.openai",
  gemini: "aiRecognition.provider.gemini",
  anthropic: "aiRecognition.provider.anthropic",
  "openai-compatible": "aiRecognition.provider.openaiCompatible",
} as const;

interface AIModelListState {
  status: "idle" | "loading" | "success" | "error";
  models: AiModelListItem[];
  error: string | null;
  truncated: boolean;
}

const EMPTY_MODEL_LIST_STATE: AIModelListState = {
  status: "idle",
  models: [],
  error: null,
  truncated: false,
};

function canListAIModels(settings: AiRecognitionSettings): boolean {
  if (settings.provider === "openai-compatible") return Boolean(settings.baseUrl.trim());
  return Boolean(settings.apiKey.trim());
}

interface AIRecognitionSettingsSectionProps {
  id: string;
  className?: string;
  settings: AiRecognitionSettings;
  onChange: (settings: AiRecognitionSettings) => void;
}

export function AIRecognitionSettingsSection({
  id,
  className,
  settings,
  onChange,
}: AIRecognitionSettingsSectionProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  const [modelListState, setModelListState] = useState<AIModelListState>(EMPTY_MODEL_LIST_STATE);
  const modelListRequestRef = useRef(0);
  const thinkingOptions = useMemo(
    () => getAIThinkingOptions(settings.provider, settings.model),
    [settings.model, settings.provider],
  );
  const selectedThinkingId = settings.defaultThinkingControl
    ? thinkingOptionId(settings.defaultThinkingControl)
    : MODEL_DEFAULT_THINKING_ID;
  const testBlocker = getAIRecognitionSettingsBlocker(settings);

  useEffect(() => {
    // 模型列表来自第三方 provider，必须随凭证/地址变化失效；旧请求返回较慢时也不能覆盖新配置。
    modelListRequestRef.current += 1;
    setModelListState(EMPTY_MODEL_LIST_STATE);
  }, [settings.apiKey, settings.baseUrl, settings.provider]);

  const update = (patch: Partial<AiRecognitionSettings>) => {
    const next = { ...settings, ...patch };
    next.defaultThinkingControl = normalizeAIThinkingControl(next.provider, next.model, next.defaultThinkingControl);
    onChange(next);
  };

  const handleProviderChange = (provider: AiRecognitionProvider) => {
    update({ provider, defaultThinkingControl: null });
  };

  const handleThinkingChange = (id: string) => {
    update({
      defaultThinkingControl: id === MODEL_DEFAULT_THINKING_ID
        ? null
        : thinkingControlFromOptionId(thinkingOptions, id),
    });
  };

  const handleRefreshModels = async () => {
    const baseUrl = settings.baseUrl.trim();
    const apiKey = settings.apiKey.trim();
    if (settings.provider === "openai-compatible" && !baseUrl) {
      setModelListState({ ...EMPTY_MODEL_LIST_STATE, status: "error", error: t("aiRecognition.baseUrlRequired") });
      return;
    }
    if (settings.provider !== "openai-compatible" && !apiKey) {
      setModelListState({ ...EMPTY_MODEL_LIST_STATE, status: "error", error: t("aiRecognition.apiKeyRequired") });
      return;
    }

    const requestId = modelListRequestRef.current + 1;
    modelListRequestRef.current = requestId;
    setModelListState((current) => ({ ...current, status: "loading", error: null }));
    try {
      const response = await aiRecognitionService.listModels({
        provider: settings.provider,
        baseUrl,
        apiKey,
      });
      if (modelListRequestRef.current !== requestId) return;
      setModelListState({
        status: "success",
        models: response.models,
        error: null,
        truncated: response.truncated,
      });
    } catch (error) {
      if (modelListRequestRef.current !== requestId) return;
      setModelListState({
        ...EMPTY_MODEL_LIST_STATE,
        status: "error",
        error: getDisplayErrorMessage(error, t("aiRecognition.modelListFailedDescription")),
      });
    }
  };

  const handleModelInputModeChange = (modelInputMode: AiRecognitionSettings["modelInputMode"]) => {
    update({ modelInputMode });
    if (
      modelInputMode === "select"
      && canListAIModels(settings)
      && modelListState.status !== "loading"
      && (modelListState.status === "idle" || modelListState.status === "error" || modelListState.models.length === 0)
    ) {
      void handleRefreshModels();
    }
  };

  const handleTestConnection = async () => {
    if (testBlocker) {
      toast({
        title: t("aiRecognition.testBlockedTitle"),
        description: t(testBlocker),
        variant: "destructive",
      });
      return;
    }
    setTesting(true);
    try {
      await aiRecognitionService.testConnection(settings);
      toast({
        title: t("aiRecognition.testSucceeded"),
        description: t("aiRecognition.testSucceededDescription"),
      });
    } catch (error) {
      toast({
        title: t("aiRecognition.testFailed"),
        description: getDisplayErrorMessage(error, t("aiRecognition.testFailedDescription")),
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section id={id} className={cn("rounded-xl border border-border bg-card p-6", className)}>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">{t("aiRecognition.settingsTitle")}</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("aiRecognition.settingsDescription")}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="relative shrink-0 gap-2 border-border"
          onClick={() => void handleTestConnection()}
          disabled={testing}
          aria-busy={testing ? true : undefined}
        >
          <LoadingButtonContent loading={testing} loadingLabel={t("aiRecognition.testing")}>
            <TestTube2 className="h-4 w-4" />
            {t("aiRecognition.testConnection")}
          </LoadingButtonContent>
        </Button>
      </div>

      <div className="grid gap-5">
        <div className="grid items-start gap-5 md:grid-cols-2 md:gap-x-5 md:gap-y-2" data-testid="ai-provider-model-grid">
          <div className="grid gap-2 md:contents" data-testid="ai-provider-field">
            <div className="flex min-h-7 items-end md:order-1" data-testid="ai-provider-label-row">
              <Label htmlFor="ai-provider">{t("aiRecognition.provider")}</Label>
            </div>
            <div className="self-start md:order-3" data-testid="ai-provider-control-row">
              <Select value={settings.provider} onValueChange={(value) => handleProviderChange(value as AiRecognitionProvider)}>
                <SelectTrigger id="ai-provider" className="border-border bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_PROVIDERS.map((provider) => (
                    <SelectItem key={provider} value={provider}>{t(AI_PROVIDER_LABEL_KEYS[provider])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2 md:contents" data-testid="ai-model-field">
            <div className="flex min-h-7 min-w-0 flex-wrap items-end justify-between gap-x-3 gap-y-1 md:order-2" data-testid="ai-model-label-row">
              <Label htmlFor="ai-model">{t("aiRecognition.model")}</Label>
              <AIModelModeSwitch
                mode={settings.modelInputMode}
                onModeChange={handleModelInputModeChange}
              />
            </div>
            <div className="self-start md:order-4" data-testid="ai-model-control-row">
              <AIModelCombobox
                id="ai-model"
                value={settings.model}
                onValueChange={(model) => update({ model })}
                mode={settings.modelInputMode}
                models={modelListState.models}
                status={modelListState.status}
                error={modelListState.error}
                truncated={modelListState.truncated}
                canAutoRefreshModels={canListAIModels(settings)}
                onRequestModels={() => void handleRefreshModels()}
                placeholder={t("aiRecognition.modelPlaceholder")}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="ai-base-url">{t("aiRecognition.baseUrl")}</Label>
            <Input
              id="ai-base-url"
              value={settings.baseUrl}
              onChange={(event) => update({ baseUrl: event.target.value })}
              placeholder={settings.provider === "openai-compatible" ? "https://api.example.com/v1" : t("aiRecognition.baseUrlPlaceholder")}
              className="border-border bg-secondary"
              inputMode="url"
            />
            <p className="text-xs text-muted-foreground">{t("aiRecognition.baseUrlHelp")}</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ai-api-key">{t("aiRecognition.apiKey")}</Label>
            <Input
              id="ai-api-key"
              type="password"
              autoComplete="off"
              value={settings.apiKey}
              onChange={(event) => update({ apiKey: event.target.value })}
              placeholder={settings.provider === "openai-compatible" ? t("aiRecognition.apiKeyOptionalPlaceholder") : "sk-..."}
              className="border-border bg-secondary"
            />
            <p className="text-xs text-muted-foreground">{t("aiRecognition.apiKeyHelp")}</p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-2">
        <Label htmlFor="ai-thinking" className="inline-flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          {t("aiRecognition.defaultThinking")}
        </Label>
        <Select value={selectedThinkingId} onValueChange={handleThinkingChange}>
          <SelectTrigger id="ai-thinking" className="border-border bg-secondary md:max-w-md">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={MODEL_DEFAULT_THINKING_ID}>{t("aiRecognition.thinking.modelDefault")}</SelectItem>
            {thinkingOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs leading-5 text-muted-foreground">
          {thinkingOptions.length > 0
            ? t("aiRecognition.thinkingHelp")
            : t(settings.provider === "openai-compatible" ? "aiRecognition.thinkingUnsupportedCompatible" : "aiRecognition.thinkingUnsupportedModel")}
        </p>
      </div>
    </section>
  );
}
