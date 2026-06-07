package main

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	aiRecognitionMaxTextChars        = 30000
	aiRecognitionMaxImages           = 5
	aiRecognitionMaxImageBytes       = 5 * 1024 * 1024
	aiRecognitionMaxSubscriptions    = 100
	aiRecognitionMultipartOverhead   = 1 << 20
	aiRecognitionThinkingControlMax  = 8 << 10
	aiRecognitionProviderTimeout     = 90 * time.Second
	aiRecognitionMaxProviderResponse = 12000
	aiRecognitionTestProviderTokens  = 2000
	aiRecognitionTestPrompt          = "Renewlet AI connection test: Netflix, 9.99 USD, monthly subscription, website netflix.com."
	aiRecognitionMaxPromptTags       = 200
	aiRecognitionPromptTagPageSize   = 200
)

var (
	errAIRecognitionBodyTooLarge    = errors.New("AI_RECOGNITION_BODY_TOO_LARGE")
	errAIRecognitionInputEmpty      = errors.New("AI_RECOGNITION_INPUT_EMPTY")
	errAIRecognitionNoSubscriptions = errors.New("AI_RECOGNITION_NO_SUBSCRIPTIONS")
	errAIRecognitionProviderInvalid = errors.New("AI_PROVIDER_INVALID")
)

type aiRecognitionSettings struct {
	Provider               string             `json:"provider"`
	Model                  string             `json:"model"`
	ModelInputMode         string             `json:"modelInputMode"`
	BaseURL                string             `json:"baseUrl"`
	APIKey                 string             `json:"apiKey"`
	DefaultThinkingControl *aiThinkingControl `json:"defaultThinkingControl"`
}

type aiThinkingControl struct {
	Provider     string `json:"provider"`
	Effort       string `json:"effort,omitempty"`
	Mode         string `json:"mode,omitempty"`
	Budget       *int   `json:"budget,omitempty"`
	Level        string `json:"level,omitempty"`
	BudgetTokens *int   `json:"budgetTokens,omitempty"`
}

type aiRecognitionInput struct {
	Text            string
	Images          []aiRecognitionImage
	ThinkingControl *aiThinkingControl
	MaxOutputTokens int
}

type aiRecognitionImage struct {
	MediaType string
	DataURL   string
	SizeBytes int
}

type aiRecognizeResponse struct {
	Provider      string                          `json:"provider"`
	Model         string                          `json:"model"`
	Subscriptions []aiRecognizedSubscriptionDraft `json:"subscriptions"`
	Warnings      []string                        `json:"warnings"`
	Diagnostics   aiRecognitionDiagnostics        `json:"diagnostics"`
}

type aiRecognizedSubscriptionDraft struct {
	Name                         string                `json:"name"`
	Price                        *float64              `json:"price"`
	Currency                     *string               `json:"currency"`
	BillingCycle                 *string               `json:"billingCycle"`
	CustomDays                   *int                  `json:"customDays"`
	CustomCycleUnit              *string               `json:"customCycleUnit"`
	OneTimeTermCount             *int                  `json:"oneTimeTermCount"`
	OneTimeTermUnit              *string               `json:"oneTimeTermUnit"`
	Category                     *string               `json:"category"`
	Status                       *string               `json:"status"`
	PaymentMethod                *string               `json:"paymentMethod"`
	StartDate                    *string               `json:"startDate"`
	NextBillingDate              *string               `json:"nextBillingDate"`
	AutoCalculateNextBillingDate *bool                 `json:"autoCalculateNextBillingDate"`
	TrialEndDate                 *string               `json:"trialEndDate"`
	Website                      *aiSuggestedTextField `json:"website"`
	Notes                        *aiSuggestedTextField `json:"notes"`
	Tags                         []string              `json:"tags"`
	ReminderDays                 *int                  `json:"reminderDays"`
	RepeatReminderEnabled        *bool                 `json:"repeatReminderEnabled"`
	RepeatReminderInterval       *string               `json:"repeatReminderInterval"`
	RepeatReminderWindow         *string               `json:"repeatReminderWindow"`
	Confidence                   string                `json:"confidence"`
	Warnings                     []string              `json:"warnings"`
}

type aiSuggestedTextField struct {
	Value  string `json:"value"`
	Source string `json:"source"`
}

type aiRecognitionTestRequest struct {
	Settings aiRecognitionSettings `json:"settings"`
}

func (r *aiRecognitionTestRequest) Validate(locale appLocale) error {
	r.Settings.Provider = strings.TrimSpace(r.Settings.Provider)
	r.Settings.Model = strings.TrimSpace(r.Settings.Model)
	r.Settings.BaseURL = strings.TrimSpace(r.Settings.BaseURL)
	r.Settings.APIKey = strings.TrimSpace(r.Settings.APIKey)
	if !isValidAIRecognitionProvider(r.Settings.Provider) {
		return errors.New(serverText(locale, "common.invalidRequestParameters"))
	}
	if r.Settings.BaseURL != "" && sanitizeAIRecognitionBaseURL(r.Settings.BaseURL) == "" {
		return errors.New(serverText(locale, "common.invalidRequestParameters"))
	}
	if r.Settings.DefaultThinkingControl != nil {
		if err := validateAIThinkingControl(r.Settings.DefaultThinkingControl); err != nil {
			return err
		}
	}
	return nil
}

type aiRecognitionTestResponse struct {
	OK       bool   `json:"ok"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
}

type aiRecognitionErrorResponse struct {
	Message string                    `json:"message"`
	Code    string                    `json:"code"`
	Details aiRecognitionErrorDetails `json:"details"`
}

type aiRecognitionErrorDetails struct {
	Reason          string                   `json:"reason"`
	ProviderMessage *string                  `json:"providerMessage"`
	Diagnostics     aiRecognitionDiagnostics `json:"diagnostics"`
}

type aiRecognitionRunner interface {
	Recognize(ctx context.Context, settings aiRecognitionSettings, input aiRecognitionInput, locale appLocale, timezone string, defaultCurrency string, configContext aiRecognitionConfigContext) (aiRecognizeResponse, error)
}

type goaiRecognitionRunner struct{}

var defaultAIRecognitionRunner aiRecognitionRunner = goaiRecognitionRunner{}

func handleAIRecognizeSubscriptions(app core.App, e *core.RequestEvent) error {
	locale := requestLocale(e.Request)
	if e.Auth == nil {
		return e.UnauthorizedError(serverText(locale, "auth.loginRequired"), nil)
	}
	settings, err := currentUserSettings(app, e.Auth, nil)
	if err != nil {
		return e.BadRequestError(validationErrorMessage(locale, "notification.settingsInvalid", err), err)
	}
	input, err := readAIRecognitionMultipart(e, locale)
	if err != nil {
		if errors.Is(err, errAIRecognitionBodyTooLarge) {
			return e.JSON(http.StatusRequestEntityTooLarge, rateLimitedResponse{
				Code:    "BODY_TOO_LARGE",
				Message: serverText(locale, "common.requestBodyTooLarge"),
			})
		}
		if errors.Is(err, errAIRecognitionInputEmpty) {
			return e.BadRequestError(serverText(locale, "aiRecognition.inputRequired"), err)
		}
		if strings.Contains(err.Error(), "AI_RECOGNITION_IMAGE_TYPE_INVALID") {
			return e.BadRequestError(serverText(locale, "aiRecognition.imageTypeInvalid"), err)
		}
		return e.BadRequestError(validationErrorMessage(locale, "common.invalidRequestBody", err), err)
	}
	if input.ThinkingControl != nil && input.ThinkingControl.Provider != settings.AIRecognition.Provider {
		return e.BadRequestError(serverText(locale, "aiRecognition.thinkingProviderMismatch"), nil)
	}
	if err := validateAIRecognitionSettings(settings.AIRecognition, locale); err != nil {
		return e.BadRequestError(err.Error(), err)
	}
	// 配置项只作为模型上下文和响应归一化依据；新增分类/支付方式仍必须走 import preview/apply 用户确认链路。
	configContext, err := aiRecognitionConfigContextForUser(app, e.Auth.Id, locale)
	if err != nil {
		return e.InternalServerError(serverText(locale, "common.internalError"), err)
	}
	response, err := defaultAIRecognitionRunner.Recognize(
		e.Request.Context(),
		settings.AIRecognition,
		input,
		locale,
		settings.Timezone,
		settings.DefaultCurrency,
		configContext,
	)
	if err != nil {
		if diagnostics := aiRecognitionDiagnosticsFromError(err); diagnostics != nil {
			if errors.Is(err, errAIRecognitionNoSubscriptions) {
				return aiRecognitionJSONError(e, http.StatusBadRequest, serverText(locale, "aiRecognition.noSubscriptions"), "AI_RECOGNITION_EMPTY", "empty", nil, diagnostics)
			}
			if isAIRecognitionSchemaMismatchError(err) {
				return aiRecognitionJSONError(e, http.StatusBadRequest, serverText(locale, "aiRecognition.schemaMismatch"), "AI_RECOGNITION_SCHEMA_MISMATCH", "schema_mismatch", aiRecognitionCauseError(err), diagnostics)
			}
			return aiRecognitionJSONError(e, http.StatusBadRequest, serverText(locale, "aiRecognition.failed"), "AI_RECOGNITION_FAILED", "provider_failed", aiRecognitionCauseError(err), diagnostics)
		}
		if errors.Is(err, errAIRecognitionNoSubscriptions) {
			return e.BadRequestError(serverText(locale, "aiRecognition.noSubscriptions"), nil)
		}
		if isAIRecognitionSchemaMismatchError(err) {
			return e.BadRequestError(serverText(locale, "aiRecognition.schemaMismatch"), nil)
		}
		return e.BadRequestError(serverText(locale, "aiRecognition.failed"), safeAIRecognitionError(err))
	}
	return e.JSON(http.StatusOK, response)
}

func handleAIRecognitionTestConnection(app core.App, e *core.RequestEvent) error {
	locale := requestLocale(e.Request)
	if e.Auth == nil {
		return e.UnauthorizedError(serverText(locale, "auth.loginRequired"), nil)
	}
	body, err := decodeStrictJSON[aiRecognitionTestRequest](e.Request, locale)
	if err != nil {
		return e.BadRequestError(validationErrorMessage(locale, "common.invalidRequestBody", err), err)
	}
	settings := sanitizeAIRecognitionSettings(body.Settings)
	thinkingControl := settings.DefaultThinkingControl
	if thinkingControl != nil && thinkingControl.Provider != settings.Provider {
		thinkingControl = nil
	}
	if err := validateAIRecognitionSettings(settings, locale); err != nil {
		return e.BadRequestError(err.Error(), err)
	}
	input := aiRecognitionInput{
		Text:            aiRecognitionTestPrompt,
		ThinkingControl: thinkingControl,
		MaxOutputTokens: aiRecognitionTestProviderTokens,
	}
	_, err = defaultAIRecognitionRunner.Recognize(
		e.Request.Context(),
		settings,
		input,
		locale,
		"UTC",
		"USD",
		aiRecognitionConfigContext{},
	)
	if err != nil {
		if diagnostics := aiRecognitionDiagnosticsFromError(err); diagnostics != nil {
			if isAIRecognitionSchemaMismatchError(err) {
				return aiRecognitionJSONError(e, http.StatusBadRequest, serverText(locale, "aiRecognition.schemaMismatch"), "AI_RECOGNITION_SCHEMA_MISMATCH", "schema_mismatch", aiRecognitionCauseError(err), diagnostics)
			}
			return aiRecognitionJSONError(e, http.StatusBadRequest, serverText(locale, "aiRecognition.testFailed"), "AI_RECOGNITION_TEST_FAILED", "provider_failed", aiRecognitionCauseError(err), diagnostics)
		}
		if isAIRecognitionSchemaMismatchError(err) {
			return e.BadRequestError(serverText(locale, "aiRecognition.schemaMismatch"), nil)
		}
		return e.BadRequestError(serverText(locale, "aiRecognition.testFailed"), safeAIRecognitionError(err))
	}
	return e.JSON(http.StatusOK, aiRecognitionTestResponse{OK: true, Provider: settings.Provider, Model: settings.Model})
}

func aiRecognitionConfigContextForUser(app core.App, userID string, locale appLocale) (aiRecognitionConfigContext, error) {
	tags, err := aiRecognitionExistingTagsForUser(app, userID)
	if err != nil {
		return aiRecognitionConfigContext{}, err
	}
	record, err := app.FindFirstRecordByFilter("custom_configs", "user = {:user}", dbx.Params{"user": userID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return aiRecognitionConfigContext{Tags: tags}, nil
		}
		return aiRecognitionConfigContext{}, err
	}
	if record == nil {
		return aiRecognitionConfigContext{Tags: tags}, nil
	}
	config, err := customConfigFromValue(record.Get("config"))
	if err != nil {
		return aiRecognitionConfigContext{}, err
	}
	if err := normalizeCustomConfigPayload(&config); err != nil {
		return aiRecognitionConfigContext{}, err
	}
	return aiRecognitionConfigContext{
		Categories:     aiRecognitionConfigOptions(config.Categories, locale),
		PaymentMethods: aiRecognitionConfigOptions(config.PaymentMethods, locale),
		Tags:           tags,
	}, nil
}

func aiRecognitionExistingTagsForUser(app core.App, userID string) ([]string, error) {
	// 这些标签名会进入第三方 AI prompt；只传用户已经持久化的标签文本，不带历史订阅名称、金额或备注。
	tags := []string{}
	seen := map[string]bool{}
	for offset := 0; len(tags) < aiRecognitionMaxPromptTags; offset += aiRecognitionPromptTagPageSize {
		rows, err := app.FindRecordsByFilter("subscriptions", "user = {:user}", "-created", aiRecognitionPromptTagPageSize, offset, dbx.Params{"user": userID})
		if err != nil {
			return nil, err
		}
		for _, record := range rows {
			values, err := normalizeTags(record.Get("tags"))
			if err != nil {
				continue
			}
			for _, tag := range values {
				key := strings.ToLower(strings.TrimSpace(tag))
				if key == "" || seen[key] {
					continue
				}
				seen[key] = true
				tags = append(tags, tag)
				if len(tags) >= aiRecognitionMaxPromptTags {
					return tags, nil
				}
			}
		}
		if len(rows) < aiRecognitionPromptTagPageSize {
			break
		}
	}
	return tags, nil
}

func aiRecognitionConfigOptions(items []customConfigItem, locale appLocale) []aiRecognitionConfigOption {
	out := make([]aiRecognitionConfigOption, 0, len(items))
	for _, item := range items {
		out = append(out, aiRecognitionConfigOption{
			Value: item.Value,
			Label: localizedAIRecognitionConfigLabel(item.Labels, locale),
			ZhCN:  item.Labels.ZhCN,
			EnUS:  item.Labels.EnUS,
		})
	}
	return out
}

func localizedAIRecognitionConfigLabel(labels customConfigLabels, locale appLocale) string {
	if locale == localeEnUS && labels.EnUS != "" {
		return labels.EnUS
	}
	if labels.ZhCN != "" {
		return labels.ZhCN
	}
	return labels.EnUS
}

func aiRecognitionJSONError(e *core.RequestEvent, status int, message string, code string, reason string, err error, diagnostics *aiRecognitionDiagnostics) error {
	return e.JSON(status, aiRecognitionErrorResponse{
		Message: message,
		Code:    code,
		Details: aiRecognitionErrorDetails{
			Reason:          reason,
			ProviderMessage: safeAIRecognitionProviderMessage(err),
			Diagnostics:     *diagnostics,
		},
	})
}
