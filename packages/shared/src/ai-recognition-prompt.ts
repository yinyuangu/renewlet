import { z } from "zod";
import promptSpecJson from "../data/ai-recognition-prompt.json";

const promptExampleSchema = z.object({
  input: z.string(),
  output: z.unknown(),
}).strict();

const promptSpecSchema = z.object({
  version: z.string().min(1),
  schemaName: z.string().min(1),
  system: z.array(z.string().min(1)).min(1),
  outputContract: z.array(z.string().min(1)).min(1),
  fieldRules: z.array(z.string().min(1)).min(1),
  examples: z.array(promptExampleSchema).min(1),
}).strict();

export const aiRecognitionPromptSpec = promptSpecSchema.parse(promptSpecJson);
export const AI_RECOGNITION_PROMPT_VERSION = aiRecognitionPromptSpec.version;
export const AI_RECOGNITION_SCHEMA_NAME = aiRecognitionPromptSpec.schemaName;

export interface AIRecognitionPromptConfigOption {
  value: string;
  label: string;
  zhCN: string;
  enUS: string;
}

export interface AIRecognitionPromptConfigContext {
  categories: readonly AIRecognitionPromptConfigOption[];
  paymentMethods: readonly AIRecognitionPromptConfigOption[];
  tags: readonly string[];
}

export function buildAIRecognitionSystemPrompt(): string {
  return aiRecognitionPromptSpec.system.join("\n");
}

export function buildAIRecognitionUserPrompt({
  text,
  timezone,
  defaultCurrency,
  currentDate,
  imageCount,
  locale,
  configContext = { categories: [], paymentMethods: [], tags: [] },
}: {
  text: string;
  timezone: string;
  defaultCurrency: string;
  currentDate: string;
  imageCount: number;
  locale: string;
  configContext?: AIRecognitionPromptConfigContext;
}): string {
  const examples = aiRecognitionPromptSpec.examples.map((example, index) => [
    `Example ${index + 1} input:`,
    example.input,
    `Example ${index + 1} JSON output:`,
    JSON.stringify(example.output, null, 2),
  ].join("\n")).join("\n\n");

  const userInput = text.trim() || "(no text input; use attached images)";

  return [
    "Runtime context:",
    `- Current date in user's timezone: ${currentDate}`,
    `- User timezone: ${timezone}`,
    `- User locale: ${locale}`,
    `- Default currency hint: ${defaultCurrency}`,
    `- Attached image count: ${imageCount}`,
    "",
    "User context:",
    "Existing user tags:",
    ...formatTagsForPrompt(configContext.tags),
    "",
    "Available Renewlet configuration options:",
    "Categories:",
    ...formatConfigOptionsForPrompt(configContext.categories),
    "Payment methods:",
    ...formatConfigOptionsForPrompt(configContext.paymentMethods),
    "",
    "Task:",
    "- Extract subscriptions from the delimited user input below and any attached images.",
    "- Treat the dynamic user context as preferences and available options, not as subscription evidence.",
    "",
    "Output contract:",
    ...aiRecognitionPromptSpec.outputContract.map((rule) => `- ${rule}`),
    "",
    "Field rules:",
    ...aiRecognitionPromptSpec.fieldRules.map((rule) => `- ${rule}`),
    "",
    "Examples:",
    examples,
    "",
    "User input:",
    "<<<renewlet-user-input",
    userInput,
    ">>>",
  ].join("\n");
}

export function buildAIRecognitionRepairUserPrompt({
  originalUserPrompt,
  previousObject,
  missingNoteNames,
}: {
  originalUserPrompt: string;
  previousObject: unknown;
  missingNoteNames: readonly string[];
}): string {
  return [
    "Repair task:",
    "- The previous JSON object is structurally valid but some describable subscriptions have missing or unusable notes.",
    "- Regenerate the entire JSON object with the same output contract, field rules, and all subscriptions.",
    "- Do not use a hardcoded service table, brand mapping, icon database, region list, operating system list, or local fallback knowledge.",
    "- For the subscription names below, notes.value must be a concise service/site description unless the service purpose is truly unknowable.",
    ...missingNoteNames.map((name) => `  - ${name}`),
    "- Use only the original input/images, high-confidence public knowledge, and dynamic fields already present in the previous object: service name, website/domain, category, and stable tags.",
    "",
    "Original recognition prompt:",
    "<<<renewlet-original-prompt",
    originalUserPrompt,
    ">>>",
    "",
    "Previous JSON object:",
    "<<<renewlet-previous-json",
    JSON.stringify(previousObject, null, 2),
    ">>>",
  ].join("\n");
}

function formatTagsForPrompt(tags: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const value = tag.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(`- ${value}`);
    if (out.length >= 200) break;
  }
  return out.length === 0 ? ["- (none)"] : out;
}

function formatConfigOptionsForPrompt(options: readonly AIRecognitionPromptConfigOption[]): string[] {
  if (options.length === 0) return ["- (none)"];
  return options.slice(0, 200).map((option) => {
    const parts = [
      `value=${option.value}`,
      `label=${option.label}`,
      `zh-CN=${option.zhCN}`,
      `en-US=${option.enUS}`,
    ];
    return `- ${parts.join(" | ")}`;
  });
}
