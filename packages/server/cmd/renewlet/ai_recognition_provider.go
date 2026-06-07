package main

import (
	"context"
	"encoding/json"

	"github.com/zendev-sh/goai"
	"github.com/zendev-sh/goai/provider"
	"github.com/zendev-sh/goai/provider/anthropic"
	"github.com/zendev-sh/goai/provider/compat"
	"github.com/zendev-sh/goai/provider/google"
	"github.com/zendev-sh/goai/provider/openai"
)

type aiRecognitionGeneration struct {
	result  *goai.ObjectResult[aiGeneratedRecognizeResponse]
	capture aiRecognitionCapture
}

var generateAIRecognitionObjectForRunner = generateAIRecognitionObject

func (goaiRecognitionRunner) Recognize(
	ctx context.Context,
	settings aiRecognitionSettings,
	input aiRecognitionInput,
	locale appLocale,
	timezone string,
	defaultCurrency string,
	configContext aiRecognitionConfigContext,
) (aiRecognizeResponse, error) {
	if err := validateAIRecognitionSettings(settings, locale); err != nil {
		return aiRecognizeResponse{}, err
	}
	model, err := newAIRecognitionModel(settings)
	if err != nil {
		return aiRecognizeResponse{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, aiRecognitionProviderTimeout)
	defer cancel()

	systemPrompt := buildAIRecognitionSystemPrompt()
	userPrompt := buildAIRecognitionUserPrompt(input.Text, timezone, defaultCurrency, len(input.Images), locale, configContext)
	generation, err := generateAIRecognitionObjectForRunner(ctx, model, input, systemPrompt, userPrompt)
	if err != nil {
		if generation.capture.rawModelText == "" {
			generation.capture.rawModelText = aiRecognitionRawTextFromError(err)
		}
		diagnostics := buildAIRecognitionDiagnostics(settings, input, systemPrompt, userPrompt, generation.capture.rawModelText, nil, generation.capture.usage, generation.capture.finishReason, generation.capture.providerMetadata)
		return aiRecognizeResponse{}, &aiRecognitionRunError{cause: err, diagnostics: diagnostics}
	}
	diagnostics := buildAIRecognitionDiagnosticsForGeneration(settings, input, systemPrompt, userPrompt, generation)
	response, err := normalizeAIGeneratedRecognizeResponse(generation.result.Object, settings.Provider, settings.Model, diagnostics, configContext)
	if err != nil {
		return aiRecognizeResponse{}, &aiRecognitionRunError{cause: err, diagnostics: diagnostics}
	}
	if missingNames := missingDescribableAINoteNames(response.Subscriptions); len(missingNames) > 0 {
		repairPrompt := buildAIRecognitionRepairUserPrompt(userPrompt, generation.result.Object, missingNames)
		if repairedGeneration, repairErr := generateAIRecognitionObjectForRunner(ctx, model, input, systemPrompt, repairPrompt); repairErr == nil {
			repairDiagnostics := buildAIRecognitionDiagnosticsForGeneration(settings, input, systemPrompt, repairPrompt, repairedGeneration)
			if repairedResponse, normalizeErr := normalizeAIGeneratedRecognizeResponse(repairedGeneration.result.Object, settings.Provider, settings.Model, repairDiagnostics, configContext); normalizeErr == nil {
				diagnostics = repairDiagnostics
				response = repairedResponse
			}
		}
		response.Diagnostics = diagnostics
		response = fillMissingAINotesWithDynamicFallback(response, locale, configContext)
	}
	return response, nil
}

func generateAIRecognitionObject(ctx context.Context, model provider.LanguageModel, input aiRecognitionInput, systemPrompt string, userPrompt string) (aiRecognitionGeneration, error) {
	capture := aiRecognitionCapture{}
	userParts := []provider.Part{{
		Type: provider.PartText,
		Text: userPrompt,
	}}
	for _, image := range input.Images {
		userParts = append(userParts, provider.Part{
			Type:      provider.PartImage,
			URL:       image.DataURL,
			MediaType: image.MediaType,
			Detail:    "high",
		})
	}
	options := []goai.Option{
		goai.WithSystem(systemPrompt),
		goai.WithMessages(provider.Message{Role: provider.RoleUser, Content: userParts}),
		goai.WithMaxOutputTokens(aiRecognitionOutputTokenLimit(input)),
		goai.WithExplicitSchema(aiRecognitionGeneratedSchema),
		goai.WithSchemaName(aiRecognitionPrompt.SchemaName),
		goai.WithOnStepFinish(func(step goai.StepResult) {
			capture.rawModelText = step.Text
			capture.usage = step.Usage
			capture.finishReason = string(step.FinishReason)
			capture.providerMetadata = step.ProviderMetadata
		}),
	}
	if providerOptions := aiRecognitionProviderOptions(input.ThinkingControl); len(providerOptions) > 0 {
		options = append(options, goai.WithProviderOptions(providerOptions))
	}
	result, err := goai.GenerateObject[aiGeneratedRecognizeResponse](ctx, model, options...)
	return aiRecognitionGeneration{result: result, capture: capture}, err
}

func buildAIRecognitionDiagnosticsForGeneration(settings aiRecognitionSettings, input aiRecognitionInput, systemPrompt string, userPrompt string, generation aiRecognitionGeneration) aiRecognitionDiagnostics {
	return buildAIRecognitionDiagnostics(
		settings,
		input,
		systemPrompt,
		userPrompt,
		firstNonBlank(generation.capture.rawModelText, resultStringFromAIObject(generation.result.Object)),
		generation.result.Object,
		generation.result.Usage,
		string(generation.result.FinishReason),
		generation.result.ProviderMetadata,
	)
}

var aiRecognitionGeneratedSchema = json.RawMessage(`{
  "type": "object",
  "properties": {
    "subscriptions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "price": { "type": ["number", "string", "null"] },
          "currency": { "type": ["string", "null"] },
          "billingCycle": { "type": ["string", "null"] },
          "customDays": { "type": ["integer", "string", "null"] },
          "customCycleUnit": { "type": ["string", "null"] },
          "oneTimeTermCount": { "type": ["integer", "string", "null"] },
          "oneTimeTermUnit": { "type": ["string", "null"] },
          "category": {
            "type": ["string", "null"],
            "description": "Renewlet category value from provided options when possible; otherwise a concise user-facing category only when the service type is obvious."
          },
          "status": { "type": ["string", "null"] },
          "paymentMethod": {
            "type": ["string", "null"],
            "description": "Renewlet payment method value from provided options when possible; otherwise a concise user-facing payment method only when the input explicitly names one."
          },
          "startDate": { "type": ["string", "null"] },
          "nextBillingDate": { "type": ["string", "null"] },
          "autoCalculateNextBillingDate": { "type": ["boolean", "null"] },
          "trialEndDate": { "type": ["string", "null"] },
          "website": {
            "type": ["object", "null"],
            "description": "Official or user-provided website for the subscribed service. Use null when the official site is ambiguous or unknown.",
            "properties": {
              "value": { "type": "string" },
              "source": { "type": "string", "enum": ["input", "suggested"] }
            },
            "required": ["value", "source"],
            "additionalProperties": false
          },
          "notes": {
            "type": "object",
            "description": "Required service/site description decision object. Use value=null and source=none only when the service purpose is truly unknowable from input, domain, service name, category, tags, or high-confidence public knowledge.",
            "properties": {
              "value": {
                "type": ["string", "null"],
                "description": "Concise neutral service/site description. Must be non-null for describable services; not a category, import advice, confirmation reminder, or AI process note."
              },
              "source": { "type": "string", "enum": ["input", "suggested", "none"] }
            },
            "required": ["value", "source"],
            "additionalProperties": false
          },
          "tags": {
            "type": "array",
            "description": "User-facing reusable organization tags. Prefer existing user tags from prompt context; if none fit, generate only stable reusable service/product/domain tags, not one-off order attributes.",
            "items": { "type": "string" },
            "maxItems": 3
          },
          "reminderDays": { "type": ["integer", "string", "null"] },
          "repeatReminderEnabled": { "type": ["boolean", "null"] },
          "repeatReminderInterval": { "type": ["string", "null"] },
          "repeatReminderWindow": { "type": ["string", "null"] },
          "confidence": {
            "type": "string",
            "description": "Use high only when the extracted row can be directly confirmed; use low for ambiguous, partial, or inferred records.",
            "enum": ["high", "low"]
          },
          "warnings": {
            "type": "array",
            "description": "Stable warning codes for uncertain or invalid fields; keep uncertainty out of notes.",
            "items": { "type": "string" }
          }
        },
        "required": [
          "name",
          "price",
          "currency",
          "billingCycle",
          "customDays",
          "customCycleUnit",
          "oneTimeTermCount",
          "oneTimeTermUnit",
          "category",
          "status",
          "paymentMethod",
          "startDate",
          "nextBillingDate",
          "autoCalculateNextBillingDate",
          "trialEndDate",
          "website",
          "notes",
          "tags",
          "reminderDays",
          "repeatReminderEnabled",
          "repeatReminderInterval",
          "repeatReminderWindow",
          "confidence",
          "warnings"
        ],
        "additionalProperties": false
      }
    },
    "warnings": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["subscriptions", "warnings"],
  "additionalProperties": false
}`)

func newAIRecognitionModel(settings aiRecognitionSettings) (provider.LanguageModel, error) {
	settings = sanitizeAIRecognitionSettings(settings)
	switch settings.Provider {
	case "openai":
		options := []openai.Option{openai.WithAPIKey(settings.APIKey)}
		if settings.BaseURL != "" {
			options = append(options, openai.WithBaseURL(settings.BaseURL))
		}
		return openai.Chat(settings.Model, options...), nil
	case "gemini":
		options := []google.Option{google.WithAPIKey(settings.APIKey)}
		if settings.BaseURL != "" {
			options = append(options, google.WithBaseURL(settings.BaseURL))
		}
		return google.Chat(settings.Model, options...), nil
	case "anthropic":
		options := []anthropic.Option{anthropic.WithAPIKey(settings.APIKey)}
		if settings.BaseURL != "" {
			options = append(options, anthropic.WithBaseURL(settings.BaseURL))
		}
		return anthropic.Chat(settings.Model, options...), nil
	case "openai-compatible":
		options := []compat.Option{compat.WithBaseURL(settings.BaseURL)}
		if settings.APIKey != "" {
			options = append(options, compat.WithAPIKey(settings.APIKey))
		}
		return compat.Chat(settings.Model, options...), nil
	default:
		return nil, errAIRecognitionProviderInvalid
	}
}

func aiRecognitionProviderOptions(control *aiThinkingControl) map[string]any {
	if control == nil {
		return nil
	}
	switch control.Provider {
	case "openai":
		return map[string]any{"reasoning_effort": control.Effort}
	case "gemini":
		switch control.Mode {
		case "off":
			return map[string]any{"google": map[string]any{"thinkingConfig": map[string]any{"thinkingBudget": 0}}}
		case "dynamic":
			return map[string]any{"google": map[string]any{"thinkingConfig": map[string]any{"thinkingBudget": -1}}}
		case "budget":
			return map[string]any{"google": map[string]any{"thinkingConfig": map[string]any{"thinkingBudget": *control.Budget}}}
		case "level":
			return map[string]any{"google": map[string]any{"thinkingConfig": map[string]any{"thinkingLevel": control.Level}}}
		}
	case "anthropic":
		if control.Mode == "effort" {
			return map[string]any{"effort": control.Effort}
		}
		if control.Mode == "budget" {
			return map[string]any{"thinking": map[string]any{"type": "enabled", "budgetTokens": *control.BudgetTokens}}
		}
	}
	return nil
}

func aiRecognitionOutputTokenLimit(input aiRecognitionInput) int {
	if input.MaxOutputTokens > 0 {
		return input.MaxOutputTokens
	}
	return aiRecognitionMaxProviderResponse
}

func resultStringFromAIObject(value interface{}) string {
	data, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(data)
}
