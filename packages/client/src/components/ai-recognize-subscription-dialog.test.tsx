import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { AiRecognizedSubscriptionDraft, AiRecognizeResponse } from "@/lib/api/schemas/ai-recognition";
import type { ImportPreviewResponse } from "@/lib/api/schemas/import-export";
import type { PreparedImport } from "@/modules/import-export/domain/import-export-model";
import { DEFAULT_CUSTOM_CONFIG } from "@/types/config";
import { DEFAULT_SETTINGS, type AppSettings } from "@/types/subscription";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AIRecognizeSubscriptionDialog } from "./ai-recognize-subscription-dialog";

const mocks = vi.hoisted(() => ({
  recognizeSubscriptions: vi.fn(),
  previewPrepared: vi.fn(),
  resetImportPreview: vi.fn(),
  setError: vi.fn(),
  handleConflictModeChange: vi.fn(),
  handleLogoChange: vi.fn(),
  handleSkipChange: vi.fn(),
  handleApply: vi.fn(),
  importPreviewPanel: vi.fn(),
  previewState: {
    prepared: null as unknown,
    preview: null as unknown,
  },
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
}));

vi.mock("@/services/ai-recognition-service", () => ({
  aiRecognitionService: {
    recognizeSubscriptions: mocks.recognizeSubscriptions,
  },
}));

vi.mock("@/modules/import-export/application/use-import-preview-apply", () => ({
  useImportPreviewApply: () => ({
    prepared: mocks.previewState.prepared,
    preview: mocks.previewState.preview,
    conflictMode: "skip",
    previewFilter: "all",
    skippedIndexes: new Set<number>(),
    error: null,
    applying: false,
    assetProgress: null,
    applyProgress: null,
    setError: mocks.setError,
    setPreviewFilter: vi.fn(),
    resetImportPreview: mocks.resetImportPreview,
    previewPrepared: mocks.previewPrepared,
    handleConflictModeChange: mocks.handleConflictModeChange,
    handleLogoChange: mocks.handleLogoChange,
    handleSkipChange: mocks.handleSkipChange,
    handleApply: mocks.handleApply,
  }),
}));

vi.mock("@/components/import-preview-panel", () => ({
  ImportPreviewPanel: (props: { showImportOptions?: boolean }) => {
    mocks.importPreviewPanel(props);
    return <div data-testid="import-preview-panel" />;
  },
}));

vi.mock("@/components/ui/virtualized-list", () => ({
  VirtualizedList: ({
    count,
    renderItem,
    testId,
  }: {
    count: number;
    renderItem: (index: number, virtualItem: VirtualItem) => ReactNode;
    testId?: string;
  }) => (
    <div data-testid={testId}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index}>
          {renderItem(index, {
            index,
            key: index,
            start: index * 112,
            size: 112,
            end: (index + 1) * 112,
            lane: 0,
          })}
        </div>
      ))}
    </div>
  ),
}));

function configuredSettings(): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    aiRecognition: {
      provider: "openai",
      model: "gpt-5-mini",
      modelInputMode: "select",
      baseUrl: "",
      apiKey: "sk-test",
      defaultThinkingControl: null,
    },
  };
}

function makeDraft(overrides: Partial<AiRecognizedSubscriptionDraft> = {}): AiRecognizedSubscriptionDraft {
  return {
    name: "Apple Music",
    price: 50,
    currency: "USD",
    billingCycle: "annual",
    customDays: null,
    customCycleUnit: null,
    oneTimeTermCount: null,
    oneTimeTermUnit: null,
    category: "music",
    status: "active",
    paymentMethod: null,
    startDate: "2026-01-01",
    nextBillingDate: "2027-01-01",
    autoCalculateNextBillingDate: true,
    trialEndDate: null,
    website: { value: "https://www.apple.com/", source: "suggested" },
    notes: { value: "Apple subscription, service needs user confirmation.", source: "suggested" },
    tags: ["Apple", "Music"],
    reminderDays: null,
    repeatReminderEnabled: null,
    repeatReminderInterval: null,
    repeatReminderWindow: null,
    confidence: "high",
    warnings: [],
    ...overrides,
  };
}

function makeResponse(subscriptions: AiRecognizedSubscriptionDraft[]): AiRecognizeResponse {
  return {
    provider: "openai",
    model: "gpt-5-mini",
    subscriptions,
    warnings: [],
    diagnostics: {
      schemaVersion: "1",
      promptVersion: "test",
      schemaName: "test",
      prompt: {
        system: { value: "", truncated: false },
        user: { value: "", truncated: false },
      },
      output: {
        rawModelText: null,
        rawObjectJson: null,
      },
      request: {
        provider: "openai",
        model: "gpt-5-mini",
        thinkingControl: null,
        maxOutputTokens: 4096,
        textCharCount: 0,
        images: [],
      },
      response: {
        usage: null,
        finishReason: null,
        providerMetadata: null,
      },
    },
  };
}

function makePreview(): ImportPreviewResponse {
  return {
    summary: {
      total: 1,
      creates: 1,
      replaces: 0,
      skips: 0,
      errors: 0,
      warnings: 0,
    },
    items: [
      {
        index: 0,
        name: "Apple Music",
        source: "ai",
        sourceId: "apple-music",
        action: "create",
        warnings: [],
        errors: [],
      },
    ],
    includesSettings: false,
    includesCustomConfig: false,
  };
}

function renderDialog(settings: AppSettings = configuredSettings()) {
  return render(
    <TooltipProvider delayDuration={0}>
      <AIRecognizeSubscriptionDialog
        open
        onOpenChange={vi.fn()}
        settings={settings}
        config={DEFAULT_CUSTOM_CONFIG}
        availableTags={["Work", "Streaming"]}
      />
    </TooltipProvider>,
  );
}

function clipboardDataWithItems(items: Array<{ file: File; kind?: string; type?: string }>): DataTransfer {
  return {
    items: items.map(({ file, kind = "file", type = file.type }) => ({
      kind,
      type,
      getAsFile: () => file,
    })),
    files: [],
  } as unknown as DataTransfer;
}

function clipboardDataWithFiles(files: File[]): DataTransfer {
  return {
    items: [],
    files,
  } as unknown as DataTransfer;
}

describe("AIRecognizeSubscriptionDialog", () => {
  beforeEach(() => {
    mocks.recognizeSubscriptions.mockReset();
    mocks.previewPrepared.mockReset();
    mocks.resetImportPreview.mockReset();
    mocks.setError.mockReset();
    mocks.importPreviewPanel.mockReset();
    mocks.previewState.prepared = null;
    mocks.previewState.preview = null;
    mocks.createObjectURL.mockReset();
    mocks.revokeObjectURL.mockReset();
    mocks.previewPrepared.mockImplementation(async (prepared: PreparedImport) => {
      mocks.previewState.prepared = prepared;
      mocks.previewState.preview = makePreview();
    });
    mocks.createObjectURL.mockImplementation((file: File) => `blob:${file.name}`);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: mocks.createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: mocks.revokeObjectURL,
    });
  });

  it("输入阶段不渲染草稿列表和导入预览", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog");
    const body = screen.getByTestId("ai-recognition-dialog-body");

    expect(screen.getByRole("tab", { name: "文本" })).toBeInTheDocument();
    const dialogDescription = screen.getByText("使用已配置的 AI 模型生成可编辑订阅草稿，确认后再导入。");
    expect(dialogDescription).not.toHaveTextContent("粘贴备忘录");
    expect(dialogDescription).not.toHaveTextContent("上传图片");
    expect(screen.getByText("支持纯文本、CSV/TSV 和表格复制文本；.xlsx 文件请先复制内容。")).toBeInTheDocument();
    expect(dialog).toHaveClass("h5-ai-recognition-input-dialog-frame");
    expect(dialog).not.toHaveClass("h-fit");
    expect(body).toHaveClass("overflow-hidden");
    expect(body).not.toHaveClass("overflow-y-auto");
    expect(screen.queryByTestId("ai-draft-virtualized-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("import-preview-panel")).not.toBeInTheDocument();
  });

  it("图片输入区只展示一次标题和说明", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "图片" }));

    const imagePanel = screen.getByTestId("ai-recognition-image-panel");
    expect(screen.getAllByText("上传订阅图片")).toHaveLength(1);
    expect(screen.getAllByText("点击、拖拽或粘贴添加 PNG、JPG、WebP 图片，最多 5 张。")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /添加图片/ })).toBeInTheDocument();
    expect(within(imagePanel).getByText("0/5 张图片")).toBeInTheDocument();
    expect(screen.queryByText(/已选择/)).not.toBeInTheDocument();
    expect(screen.queryByText("还没有选择图片。")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无图片")).not.toBeInTheDocument();
  });

  it("文本和图片输入区共用稳定内部滚动区域", async () => {
    const user = userEvent.setup();
    const firstImage = new File(["one"], "one.png", { type: "image/png" });
    const secondImage = new File(["two"], "two.png", { type: "image/png" });
    renderDialog();

    const body = screen.getByTestId("ai-recognition-dialog-body");
    const textarea = screen.getByPlaceholderText("粘贴记事本、备忘录或从 Excel 复制出的订阅列表...");
    await user.type(textarea, "apple 50刀 1年\nnetflix 10刀 1个月");

    expect(screen.getByTestId("ai-recognition-text-panel")).toHaveClass("grid-rows-[minmax(0,1fr)_auto]");
    expect(textarea).toHaveClass("h-full", "min-h-0", "resize-none");
    expect(body).toHaveClass("overflow-hidden");

    await user.click(screen.getByRole("tab", { name: "图片" }));
    expect(body).toHaveClass("overflow-hidden");
    expect(screen.getByTestId("ai-recognition-image-panel")).toHaveClass("min-h-0", "overflow-hidden");
    expect(screen.getByTestId("ai-recognition-image-scrollport")).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
    expect(screen.queryByTestId("ai-draft-virtualized-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("import-preview-panel")).not.toBeInTheDocument();

    await user.upload(screen.getByLabelText("添加订阅图片"), [firstImage, secondImage]);
    expect(within(screen.getByTestId("ai-recognition-image-panel")).getByRole("button", { name: /继续添加/ })).toBeInTheDocument();
    expect(within(screen.getByTestId("ai-recognition-image-panel")).getByText("2/5 张图片")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览图片 one.png" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览图片 two.png" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveClass("h5-ai-recognition-input-dialog-frame");
  });

  it("图片 tab 支持粘贴剪贴板图片并复用图片墙预览", async () => {
    const user = userEvent.setup();
    const pastedImage = new File(["pasted"], "clipboard.png", { type: "image/png" });
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "图片" }));
    const pasteAccepted = fireEvent.paste(screen.getByTestId("ai-recognition-image-panel"), {
      clipboardData: clipboardDataWithItems([{ file: pastedImage }]),
    });

    expect(pasteAccepted).toBe(false);
    expect(mocks.createObjectURL).toHaveBeenCalledWith(pastedImage);
    expect(screen.getByRole("button", { name: "预览图片 clipboard.png" })).toBeInTheDocument();
  });

  it("图片 tab 粘贴可 fallback 到 clipboardData.files", async () => {
    const user = userEvent.setup();
    const pastedImage = new File(["fallback"], "fallback.webp", { type: "image/webp" });
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "图片" }));
    fireEvent.paste(screen.getByTestId("ai-recognition-image-panel"), {
      clipboardData: clipboardDataWithFiles([pastedImage]),
    });

    expect(mocks.createObjectURL).toHaveBeenCalledWith(pastedImage);
    expect(screen.getByRole("button", { name: "预览图片 fallback.webp" })).toBeInTheDocument();
  });

  it("粘贴多张图片时沿用现有数量上限和错误提示", async () => {
    const user = userEvent.setup();
    const pastedImages = Array.from({ length: 6 }, (_, index) => (
      new File([`image-${index + 1}`], `image-${index + 1}.png`, { type: "image/png" })
    ));
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "图片" }));
    fireEvent.paste(screen.getByTestId("ai-recognition-image-panel"), {
      clipboardData: clipboardDataWithItems(pastedImages.map((file) => ({ file }))),
    });

    expect(screen.getByRole("button", { name: "预览图片 image-1.png" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览图片 image-5.png" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "预览图片 image-6.png" })).not.toBeInTheDocument();
    expect(within(screen.getByTestId("ai-recognition-image-panel")).getByRole("button", { name: /已达上限/ })).toBeDisabled();
    expect(mocks.setError).toHaveBeenCalledWith("最多上传 5 张图片。");
  });

  it("文本 tab 和非图片剪贴板内容不会触发图片上传", async () => {
    const user = userEvent.setup();
    const image = new File(["pasted"], "clipboard.png", { type: "image/png" });
    const textFile = new File(["plain"], "note.txt", { type: "text/plain" });
    renderDialog();

    const textarea = screen.getByPlaceholderText("粘贴记事本、备忘录或从 Excel 复制出的订阅列表...");
    const textTabPasteAccepted = fireEvent.paste(textarea, {
      clipboardData: clipboardDataWithItems([{ file: image }]),
    });
    expect(textTabPasteAccepted).toBe(true);
    expect(mocks.createObjectURL).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: "图片" }));
    const imageTabPasteAccepted = fireEvent.paste(screen.getByTestId("ai-recognition-image-panel"), {
      clipboardData: clipboardDataWithItems([{ file: textFile }]),
    });
    expect(imageTabPasteAccepted).toBe(true);
    expect(mocks.createObjectURL).not.toHaveBeenCalled();
  });

  it("识别 loading 禁用状态下粘贴图片不会追加图片", async () => {
    const user = userEvent.setup();
    const firstImage = new File(["first"], "first.png", { type: "image/png" });
    const pastedImage = new File(["pasted"], "disabled.png", { type: "image/png" });
    let resolveRecognition: (response: AiRecognizeResponse) => void = () => undefined;
    mocks.recognizeSubscriptions.mockReturnValue(new Promise<AiRecognizeResponse>((resolve) => {
      resolveRecognition = resolve;
    }));
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "图片" }));
    await user.upload(screen.getByLabelText("添加订阅图片"), firstImage);
    await user.click(screen.getByRole("button", { name: "生成订阅草稿" }));
    fireEvent.paste(screen.getByTestId("ai-recognition-image-panel"), {
      clipboardData: clipboardDataWithItems([{ file: pastedImage }]),
    });

    expect(screen.queryByRole("button", { name: "预览图片 disabled.png" })).not.toBeInTheDocument();
    expect(mocks.createObjectURL).toHaveBeenCalledTimes(1);

    resolveRecognition(makeResponse([makeDraft()]));
  });

  it("草稿阶段由内部工作区滚动，外层弹窗 body 不滚动", async () => {
    const user = userEvent.setup();
    mocks.recognizeSubscriptions.mockResolvedValue(makeResponse([makeDraft()]));
    renderDialog();

    await user.type(screen.getByPlaceholderText("粘贴记事本、备忘录或从 Excel 复制出的订阅列表..."), "apple 50刀 1年");
    await user.click(screen.getByRole("button", { name: "生成订阅草稿" }));

    await screen.findByText("Apple Music");
    const body = screen.getByTestId("ai-recognition-dialog-body");
    expect(body).toHaveClass("overflow-hidden");
    expect(body).not.toHaveClass("overflow-y-auto");
    expect(screen.getByTestId("ai-draft-list-scrollport")).toHaveClass("overflow-y-auto");
    expect(screen.getByTestId("ai-draft-editor-scrollport")).toHaveClass("lg:overflow-y-auto");
  });

  it("草稿缺少日期时在草稿阶段拦截导入预览", async () => {
    const user = userEvent.setup();
    mocks.recognizeSubscriptions.mockResolvedValue(makeResponse([
      makeDraft({
        startDate: null,
        nextBillingDate: null,
      }),
    ]));
    renderDialog();

    await user.type(screen.getByPlaceholderText("粘贴记事本、备忘录或从 Excel 复制出的订阅列表..."), "apple 50刀 1年");
    await user.click(screen.getByRole("button", { name: "生成订阅草稿" }));

    expect(await screen.findByText("1 条草稿还有 1 个必填项待补全，补全后才能生成导入预览。")).toBeInTheDocument();
    const startDateButton = document.getElementById("ai-draft-1-startDate");
    const nextBillingDateButton = document.getElementById("ai-draft-1-nextBillingDate");
    if (!(startDateButton instanceof HTMLButtonElement) || !(nextBillingDateButton instanceof HTMLButtonElement)) {
      throw new Error("AI draft date buttons were not rendered");
    }
    expect(startDateButton).toHaveAttribute("aria-invalid", "true");
    expect(startDateButton).toHaveAttribute("aria-describedby", "ai-draft-1-dates-error");
    expect(startDateButton.parentElement).toHaveTextContent("请选择开始日期和续费或到期日期。");
    expect(nextBillingDateButton).toHaveAttribute("aria-invalid", "false");
    expect(nextBillingDateButton).not.toHaveAttribute("aria-describedby");
    expect(screen.getByRole("button", { name: "生成导入预览" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "生成导入预览" }));
    expect(mocks.previewPrepared).not.toHaveBeenCalled();
  });

  it("可用当前表单默认值确认 AI 未返回的货币和周期", async () => {
    const user = userEvent.setup();
    mocks.recognizeSubscriptions.mockResolvedValue(makeResponse([
      makeDraft({
        currency: null,
        billingCycle: null,
        nextBillingDate: "2026-07-01",
      }),
    ]));
    renderDialog();

    await user.type(screen.getByPlaceholderText("粘贴记事本、备忘录或从 Excel 复制出的订阅列表..."), "apple 50刀 1年");
    await user.click(screen.getByRole("button", { name: "生成订阅草稿" }));

    expect(await screen.findByText("1 条草稿还有 2 个必填项待补全，补全后才能生成导入预览。")).toBeInTheDocument();
    expect(screen.getAllByText("请确认货币。").length).toBeGreaterThan(0);
    expect(screen.getAllByText("请确认扣费周期。").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "生成导入预览" })).toBeDisabled();

    await user.click(screen.getAllByRole("button", { name: "使用当前值" })[0]!);
    await waitFor(() => expect(screen.queryByText("请确认货币。")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "生成导入预览" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "生成导入预览" }));

    await waitFor(() => expect(mocks.previewPrepared).toHaveBeenCalledTimes(1));
    const prepared = mocks.previewPrepared.mock.calls[0]?.[0] as PreparedImport;
    expect(prepared.payload.subscriptions[0]?.currency).toBe("CNY");
    expect(prepared.payload.subscriptions[0]?.billingCycle).toBe("monthly");
  });

  it("文本模式只提交文本，不混入已保留的图片", async () => {
    const user = userEvent.setup();
    const image = new File(["image"], "subscriptions.png", { type: "image/png" });
    mocks.recognizeSubscriptions.mockResolvedValue(makeResponse([makeDraft()]));
    renderDialog();

    await user.click(screen.getByRole("tab", { name: "图片" }));
    await user.upload(screen.getByLabelText("添加订阅图片"), image);
    await user.click(screen.getByRole("tab", { name: "文本" }));
    await user.type(screen.getByPlaceholderText("粘贴记事本、备忘录或从 Excel 复制出的订阅列表..."), "apple 50刀 1年");
    await user.click(screen.getByRole("button", { name: "生成订阅草稿" }));

    await waitFor(() => expect(mocks.recognizeSubscriptions).toHaveBeenCalledTimes(1));
    expect(mocks.recognizeSubscriptions).toHaveBeenCalledWith({
      text: "apple 50刀 1年",
      images: [],
      thinkingControl: null,
    });
  });

  it("图片模式只提交图片，并在删除缩略图时释放 object URL", async () => {
    const user = userEvent.setup();
    const image = new File(["image"], "subscriptions.png", { type: "image/png" });
    mocks.recognizeSubscriptions.mockResolvedValue(makeResponse([makeDraft()]));
    renderDialog();

    await user.type(screen.getByPlaceholderText("粘贴记事本、备忘录或从 Excel 复制出的订阅列表..."), "apple 50刀 1年");
    await user.click(screen.getByRole("tab", { name: "图片" }));
    await user.upload(screen.getByLabelText("添加订阅图片"), image);
    await user.click(screen.getByRole("button", { name: "移除图片" }));
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:subscriptions.png");

    await user.upload(screen.getByLabelText("添加订阅图片"), image);
    await user.click(screen.getByRole("button", { name: "生成订阅草稿" }));

    await waitFor(() => expect(mocks.recognizeSubscriptions).toHaveBeenCalledTimes(1));
    expect(mocks.recognizeSubscriptions).toHaveBeenCalledWith({
      text: "",
      images: [image],
      thinkingControl: null,
    });
  });

  it("按当前模型的思考控制选项传入本次识别请求", async () => {
    const user = userEvent.setup();
    mocks.recognizeSubscriptions.mockResolvedValue(makeResponse([makeDraft()]));
    const settings = configuredSettings();
    renderDialog({
      ...settings,
      aiRecognition: {
        ...settings.aiRecognition,
        defaultThinkingControl: { provider: "openai", effort: "high" },
      },
    });

    expect(screen.getByRole("combobox", { name: "思考控制" })).toHaveTextContent("High");
    await user.type(screen.getByPlaceholderText("粘贴记事本、备忘录或从 Excel 复制出的订阅列表..."), "apple 50刀 1年");
    await user.click(screen.getByRole("button", { name: "生成订阅草稿" }));

    await waitFor(() => expect(mocks.recognizeSubscriptions).toHaveBeenCalledTimes(1));
    expect(mocks.recognizeSubscriptions).toHaveBeenCalledWith({
      text: "apple 50刀 1年",
      images: [],
      thinkingControl: { provider: "openai", effort: "high" },
    });
  });

  it("支持筛选、编辑选中草稿并复用导入预览构建", async () => {
    const user = userEvent.setup();
    mocks.recognizeSubscriptions.mockResolvedValue(makeResponse([
      makeDraft(),
      makeDraft({
        name: "Netflix",
        price: null,
        currency: "USD",
        billingCycle: "monthly",
        category: "streaming",
        website: { value: "https://www.netflix.com/", source: "suggested" },
        tags: ["Streaming"],
        confidence: "low",
        warnings: ["AI_WARNING_PRICE_UNCERTAIN"],
      }),
    ]));
    renderDialog();

    await user.type(screen.getByPlaceholderText("粘贴记事本、备忘录或从 Excel 复制出的订阅列表..."), "apple 50刀 1年\nnetflix 1个月");
    await user.click(screen.getByRole("button", { name: "生成订阅草稿" }));

    await screen.findByText("Netflix");
    await user.click(screen.getByRole("button", { name: "缺核心字段" }));
    expect(screen.queryByText("Apple Music")).not.toBeInTheDocument();

    const nameInput = await screen.findByDisplayValue("Netflix");
    await user.clear(nameInput);
    await user.type(nameInput, "Netflix Premium");
    const priceInput = screen.getByLabelText("价格");
    await user.clear(priceInput);
    await user.type(priceInput, "66");
    await waitFor(() => expect(screen.getByRole("button", { name: "生成导入预览" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "生成导入预览" }));

    await waitFor(() => expect(mocks.previewPrepared).toHaveBeenCalledTimes(1));
    const prepared = mocks.previewPrepared.mock.calls[0]?.[0] as PreparedImport;
    expect(prepared.payload.source).toBe("ai");
    expect(prepared.payload.subscriptions.some((subscription) => subscription.name === "Netflix Premium")).toBe(true);
  });

  it("草稿阶段可以返回输入，修改输入后需要重新生成草稿", async () => {
    const user = userEvent.setup();
    mocks.recognizeSubscriptions
      .mockResolvedValueOnce(makeResponse([makeDraft()]))
      .mockResolvedValueOnce(makeResponse([makeDraft({ name: "Spotify" })]));
    renderDialog();

    const textarea = screen.getByPlaceholderText("粘贴记事本、备忘录或从 Excel 复制出的订阅列表...");
    await user.type(textarea, "apple 50刀 1年");
    await user.click(screen.getByRole("button", { name: "生成订阅草稿" }));
    await screen.findByText("Apple Music");

    await user.click(screen.getByRole("button", { name: "返回输入" }));
    expect(screen.getByDisplayValue("apple 50刀 1年")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-draft-virtualized-list")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回草稿" })).toBeInTheDocument();

    const returnedTextarea = screen.getByPlaceholderText("粘贴记事本、备忘录或从 Excel 复制出的订阅列表...");
    await user.type(returnedTextarea, "\nspotify 10刀 1个月");
    expect(screen.getByText("输入已变更，请重新生成草稿后再预览。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回草稿" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新生成草稿" }));

    await screen.findByText("Spotify");
    expect(mocks.recognizeSubscriptions).toHaveBeenCalledTimes(2);
  });

  it("草稿编辑器不把 AI 返回的新配置名塞进下拉，导入预览仍会创建新项", async () => {
    const user = userEvent.setup();
    mocks.recognizeSubscriptions.mockResolvedValue(makeResponse([
      makeDraft({
        category: "Cloud lab",
        paymentMethod: "Personal card",
        tags: ["Apple"],
      }),
    ]));
    renderDialog();

    await user.type(screen.getByPlaceholderText("粘贴记事本、备忘录或从 Excel 复制出的订阅列表..."), "apple 50刀 1年");
    await user.click(screen.getByRole("button", { name: "生成订阅草稿" }));

    expect(await screen.findByRole("combobox", { name: "选择货币" })).toBeInTheDocument();
    expect(screen.queryByText("Cloud lab")).not.toBeInTheDocument();
    expect(screen.queryByText("Personal card")).not.toBeInTheDocument();
    expect(screen.getByText("Apple")).toBeInTheDocument();

    const priceInput = screen.getByLabelText("价格");
    await user.clear(priceInput);
    await user.type(priceInput, "66");
    await waitFor(() => expect(screen.getByRole("button", { name: "生成导入预览" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "生成导入预览" }));

    await waitFor(() => expect(mocks.previewPrepared).toHaveBeenCalledTimes(1));
    const prepared = mocks.previewPrepared.mock.calls[0]?.[0] as PreparedImport;
    expect(prepared.payload.subscriptions[0]?.price).toBe(66);
    expect(prepared.payload.customConfig?.categories.some((item) => item.labels["zh-CN"] === "Cloud lab")).toBe(true);
    expect(prepared.payload.customConfig?.paymentMethods.some((item) => item.labels["zh-CN"] === "Personal card")).toBe(true);
  });

  it("AI 识别预览隐藏通用导入设置并静默使用 skip 冲突策略", async () => {
    const user = userEvent.setup();
    mocks.recognizeSubscriptions.mockResolvedValue(makeResponse([makeDraft()]));
    renderDialog();

    await user.type(screen.getByPlaceholderText("粘贴记事本、备忘录或从 Excel 复制出的订阅列表..."), "apple 50刀 1年");
    await user.click(screen.getByRole("button", { name: "生成订阅草稿" }));
    await screen.findByText("Apple Music");
    await user.click(screen.getByRole("button", { name: "生成导入预览" }));

    expect(await screen.findByTestId("import-preview-panel")).toBeInTheDocument();
    expect(mocks.previewPrepared).toHaveBeenCalledWith(expect.anything(), "skip");
    expect(mocks.importPreviewPanel).toHaveBeenLastCalledWith(expect.objectContaining({ showImportOptions: false }));
  });
});
