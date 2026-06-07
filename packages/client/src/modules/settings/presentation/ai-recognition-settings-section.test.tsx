import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AiRecognitionSettings } from "@/lib/api/schemas/ai-recognition";
import { DEFAULT_SETTINGS } from "@/types/subscription";
import { aiRecognitionService } from "@/services/ai-recognition-service";
import { AIRecognitionSettingsSection } from "./ai-recognition-settings-section";

const mocks = vi.hoisted(() => ({
  listModels: vi.fn(),
  testConnection: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/services/ai-recognition-service", () => ({
  aiRecognitionService: {
    listModels: mocks.listModels,
    testConnection: mocks.testConnection,
  },
}));

vi.mock("@/i18n/I18nProvider", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const messages: Record<string, string> = {
        "aiRecognition.apiKey": "API Key",
        "aiRecognition.apiKeyHelp": "用于访问模型 provider。",
        "aiRecognition.apiKeyOptionalPlaceholder": "可选",
        "aiRecognition.apiKeyRequired": "请先填写 API Key。",
        "aiRecognition.baseUrl": "Base URL",
        "aiRecognition.baseUrlHelp": "兼容 OpenAI 接口时使用。",
        "aiRecognition.baseUrlPlaceholder": "默认地址",
        "aiRecognition.baseUrlRequired": "OpenAI Compatible 需要填写 Base URL。",
        "aiRecognition.defaultThinking": "默认思考控制",
        "aiRecognition.model": "模型",
        "aiRecognition.modelListFailedDescription": "无法获取模型列表，请检查 Base URL 和 API Key，或手动输入模型 ID。",
        "aiRecognition.modelListLoading": "正在获取模型列表...",
        "aiRecognition.modelListTruncated": "模型列表较长，仅显示前 300 个结果；可继续搜索或手动输入。",
        "aiRecognition.modelMode": "模型输入方式",
        "aiRecognition.modelModeManual": "手动输入",
        "aiRecognition.modelModeSelect": "选择模型",
        "aiRecognition.modelPlaceholder": "输入模型",
        "aiRecognition.modelSelectEmpty": "没有可选择的模型。请确认 Base URL / API Key 已填写，或切换到手动输入。",
        "aiRecognition.modelSelectPlaceholder": "选择模型",
        "aiRecognition.modelSelectSearchPlaceholder": "搜索模型",
        "aiRecognition.provider": "模型来源",
        "aiRecognition.provider.anthropic": "Claude",
        "aiRecognition.provider.gemini": "Gemini",
        "aiRecognition.provider.openai": "OpenAI",
        "aiRecognition.provider.openaiCompatible": "OpenAI Compatible",
        "aiRecognition.settingsDescription": "配置用于识别订阅图片、备忘录或表格文本的第三方模型。",
        "aiRecognition.settingsTitle": "AI 识别",
        "aiRecognition.testConnection": "测试连接",
        "aiRecognition.testing": "测试中...",
        "aiRecognition.thinking.modelDefault": "模型默认",
        "aiRecognition.thinkingHelp": "仅展示当前 provider/model 明确支持的官方思考控制。",
        "aiRecognition.thinkingUnsupportedCompatible": "OpenAI Compatible 没有统一 thinking 标准。",
        "aiRecognition.thinkingUnsupportedModel": "当前模型未匹配到官方 thinking 能力。",
      };
      return messages[key] ?? key;
    },
  }),
}));

function renderAIRecognitionSection({
  initialSettings,
  onChange = vi.fn(),
}: {
  initialSettings?: Partial<AiRecognitionSettings>;
  onChange?: (settings: AiRecognitionSettings) => void;
} = {}) {
  function StatefulSection() {
    const [settings, setSettings] = useState<AiRecognitionSettings>({
      ...DEFAULT_SETTINGS.aiRecognition,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      modelInputMode: "manual",
      apiKey: "anthropic-key",
      ...initialSettings,
    });

    return (
      <TooltipProvider delayDuration={0}>
        <AIRecognitionSettingsSection
          id="settings-ai-recognition"
          settings={settings}
          onChange={(nextSettings) => {
            setSettings(nextSettings);
            onChange(nextSettings);
          }}
        />
      </TooltipProvider>
    );
  }

  return render(<StatefulSection />);
}

describe("AIRecognitionSettingsSection model field layout", () => {
  beforeEach(() => {
    mocks.listModels.mockReset();
    mocks.testConnection.mockReset();
    mocks.toast.mockReset();
  });

  it("uses shared label and control rows for provider and model fields", () => {
    renderAIRecognitionSection();

    const fieldGrid = screen.getByTestId("ai-provider-model-grid");
    const providerField = screen.getByTestId("ai-provider-field");
    const modelField = screen.getByTestId("ai-model-field");
    const providerLabelRow = screen.getByTestId("ai-provider-label-row");
    const modelLabelRow = screen.getByTestId("ai-model-label-row");
    const providerControlRow = screen.getByTestId("ai-provider-control-row");
    const modelControlRow = screen.getByTestId("ai-model-control-row");
    const modeSwitch = screen.getByTestId("ai-model-mode-switch");

    expect(fieldGrid).toHaveClass("md:grid-cols-2");
    expect(fieldGrid).toHaveClass("md:gap-y-2");
    expect(providerField).toHaveClass("md:contents");
    expect(modelField).toHaveClass("md:contents");
    expect(providerLabelRow).toHaveClass("min-h-7");
    expect(providerLabelRow).toHaveClass("items-end");
    expect(providerLabelRow).toHaveClass("md:order-1");
    expect(modelLabelRow).toHaveClass("min-h-7");
    expect(modelLabelRow).toHaveClass("items-end");
    expect(modelLabelRow).toHaveClass("md:order-2");
    expect(providerControlRow).toHaveClass("self-start");
    expect(providerControlRow).toHaveClass("md:order-3");
    expect(modelControlRow).toHaveClass("self-start");
    expect(modelControlRow).toHaveClass("md:order-4");
    expect(modeSwitch).not.toHaveClass("absolute");
    expect(within(modelLabelRow).getByText("模型")).toBeInTheDocument();
    expect(within(modelControlRow).getByRole("textbox", { name: "模型" })).toHaveValue("claude-sonnet-4-6");
  });

  it("requests models when switching to select mode with credentials available", async () => {
    const user = userEvent.setup();
    mocks.listModels.mockResolvedValueOnce({ models: [], truncated: false });
    const onChange = vi.fn();
    renderAIRecognitionSection({ onChange });

    await user.click(screen.getByRole("button", { name: "选择模型" }));

    await waitFor(() => {
      expect(aiRecognitionService.listModels).toHaveBeenCalledWith({
        provider: "anthropic",
        baseUrl: "",
        apiKey: "anthropic-key",
      });
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ modelInputMode: "select" }));
  });

  it("keeps provider field structure when model loading fails", async () => {
    const user = userEvent.setup();
    mocks.listModels.mockRejectedValueOnce(new Error("请求体不是有效 JSON"));
    renderAIRecognitionSection();

    const providerControlRow = screen.getByTestId("ai-provider-control-row");
    await user.click(screen.getByRole("button", { name: "选择模型" }));

    expect(await screen.findByText("请求体不是有效 JSON")).toBeInTheDocument();
    expect(providerControlRow).toHaveClass("self-start");
    expect(providerControlRow).toHaveClass("md:order-3");
    expect(screen.getByTestId("ai-model-control-row")).toHaveTextContent("请求体不是有效 JSON");
  });
});
