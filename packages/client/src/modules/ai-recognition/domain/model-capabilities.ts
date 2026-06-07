import type { MessageKey } from "@/i18n/messages";
import type {
  AiRecognitionProvider,
  AiThinkingControl,
} from "@/lib/api/schemas/ai-recognition";

export interface AIThinkingOption {
  id: string;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  control: AiThinkingControl | null;
}

const OPENAI_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
const ANTHROPIC_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const GEMINI_LEVELS = ["minimal", "low", "medium", "high"] as const;
const GEMINI_BUDGETS = [1024, 4096, 8192] as const;
const CLAUDE_BUDGETS = [1024, 4096, 8192] as const;

export function getAIThinkingOptions(provider: AiRecognitionProvider, model: string): AIThinkingOption[] {
  const normalizedModel = normalizeAIModelIdForCapability(model);
  if (!normalizedModel) return [];
  if (provider === "openai") return getOpenAIThinkingOptions(normalizedModel);
  if (provider === "gemini") return getGeminiThinkingOptions(normalizedModel);
  if (provider === "anthropic") return getAnthropicThinkingOptions(normalizedModel);
  return [];
}

export function normalizeAIModelIdForCapability(model: string): string {
  return model.trim().toLowerCase().replace(/^models\//, "");
}

export function normalizeAIThinkingControl(
  provider: AiRecognitionProvider,
  model: string,
  control: AiThinkingControl | null,
): AiThinkingControl | null {
  if (!control || control.provider !== provider) return null;
  const options = getAIThinkingOptions(provider, model);
  return options.some((option) => option.control && thinkingOptionId(option.control) === thinkingOptionId(control))
    ? control
    : null;
}

export function defaultAIThinkingControl(provider: AiRecognitionProvider, model: string): AiThinkingControl | null {
  return getAIThinkingOptions(provider, model)[0]?.control ?? null;
}

export function thinkingOptionId(control: AiThinkingControl | null): string {
  if (!control) return "off";
  if (control.provider === "openai") return `openai:${control.effort}`;
  if (control.provider === "gemini") {
    if (control.mode === "budget") return `gemini:budget:${control.budget ?? ""}`;
    if (control.mode === "level") return `gemini:level:${control.level ?? ""}`;
    return `gemini:${control.mode}`;
  }
  if (control.mode === "budget") return `anthropic:budget:${control.budgetTokens ?? ""}`;
  return `anthropic:effort:${control.effort ?? ""}`;
}

export function thinkingControlFromOptionId(options: readonly AIThinkingOption[], id: string): AiThinkingControl | null {
  return options.find((option) => option.id === id)?.control ?? null;
}

function getOpenAIThinkingOptions(model: string): AIThinkingOption[] {
  if (!isOpenAIReasoningModel(model)) return [];
  return OPENAI_REASONING_EFFORTS.map((effort) => ({
    id: `openai:${effort}`,
    labelKey: `aiRecognition.thinking.openai.${effort}` as MessageKey,
    descriptionKey: `aiRecognition.thinking.openai.${effort}.description` as MessageKey,
    control: { provider: "openai", effort },
  }));
}

function getGeminiThinkingOptions(model: string): AIThinkingOption[] {
  if (isGeminiLevelModel(model)) {
    return GEMINI_LEVELS.map((level) => ({
      id: `gemini:level:${level}`,
      labelKey: `aiRecognition.thinking.gemini.level.${level}` as MessageKey,
      descriptionKey: `aiRecognition.thinking.gemini.level.${level}.description` as MessageKey,
      control: { provider: "gemini", mode: "level", level },
    }));
  }
  if (!isGeminiBudgetModel(model)) return [];
  const budgetOptions = GEMINI_BUDGETS.map((budget) => ({
    id: `gemini:budget:${budget}`,
    labelKey: `aiRecognition.thinking.budget.${budget}` as MessageKey,
    descriptionKey: "aiRecognition.thinking.gemini.budget.description" as MessageKey,
    control: { provider: "gemini" as const, mode: "budget" as const, budget },
  }));
  if (!isGeminiBudgetToggleModel(model)) return budgetOptions;
  return [
    {
      id: "gemini:off",
      labelKey: "aiRecognition.thinking.off",
      descriptionKey: "aiRecognition.thinking.gemini.off.description",
      control: { provider: "gemini", mode: "off" },
    },
    {
      id: "gemini:dynamic",
      labelKey: "aiRecognition.thinking.gemini.dynamic",
      descriptionKey: "aiRecognition.thinking.gemini.dynamic.description",
      control: { provider: "gemini", mode: "dynamic" },
    },
    ...budgetOptions,
  ];
}

function getAnthropicThinkingOptions(model: string): AIThinkingOption[] {
  const efforts = claudeEffortsForModel(model);
  if (efforts.length > 0) {
    return efforts.map((effort) => ({
      id: `anthropic:effort:${effort}`,
      labelKey: `aiRecognition.thinking.anthropic.${effort}` as MessageKey,
      descriptionKey: `aiRecognition.thinking.anthropic.${effort}.description` as MessageKey,
      control: { provider: "anthropic", mode: "effort", effort },
    }));
  }
  if (!isClaudeBudgetModel(model)) return [];
  return CLAUDE_BUDGETS.map((budgetTokens) => ({
    id: `anthropic:budget:${budgetTokens}`,
    labelKey: `aiRecognition.thinking.budget.${budgetTokens}` as MessageKey,
    descriptionKey: "aiRecognition.thinking.anthropic.budget.description" as MessageKey,
    control: { provider: "anthropic", mode: "budget", budgetTokens },
  }));
}

function isOpenAIReasoningModel(model: string): boolean {
  if (model.includes("chat")) return false;
  return /^(?:o[134](?:-|$)|gpt-5(?:\.|[-]|$))/.test(model);
}

function isGeminiLevelModel(model: string): boolean {
  return /^gemini-(?:3|3\.1|3\.5)(?:-|$)/.test(model);
}

function isGeminiBudgetModel(model: string): boolean {
  return /^gemini-2\.5(?:-|$)/.test(model);
}

function isGeminiBudgetToggleModel(model: string): boolean {
  return /^gemini-2\.5-(?:flash|flash-lite)(?:-|$)/.test(model);
}

function claudeEffortsForModel(model: string): typeof ANTHROPIC_EFFORTS[number][] {
  const match = /^claude-(opus|sonnet|haiku)-4-(\d+)(?:-|$)/.exec(model);
  if (!match) return [];
  const family = match[1];
  const minor = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isFinite(minor) || minor < 6) return [];
  const base: typeof ANTHROPIC_EFFORTS[number][] = ["low", "medium", "high", "max"];
  if (family === "opus" && minor >= 7) {
    return ["low", "medium", "high", "xhigh", "max"];
  }
  return base;
}

function isClaudeBudgetModel(model: string): boolean {
  return /^claude-3-7/.test(model);
}
