package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const (
	aiModelListTimeout       = 15 * time.Second
	aiModelListResponseBytes = 1 << 20
	aiModelListMaxModels     = 300
)

type aiModelListRequest struct {
	Provider string `json:"provider"`
	BaseURL  string `json:"baseUrl"`
	APIKey   string `json:"apiKey"`
}

func (r *aiModelListRequest) Validate(locale appLocale) error {
	r.Provider = strings.TrimSpace(r.Provider)
	r.BaseURL = strings.TrimSpace(r.BaseURL)
	r.APIKey = strings.TrimSpace(r.APIKey)
	if !isValidAIRecognitionProvider(r.Provider) {
		return errors.New(serverText(locale, "common.invalidRequestParameters"))
	}
	if r.BaseURL != "" && sanitizeAIRecognitionBaseURL(r.BaseURL) == "" {
		return errors.New(serverText(locale, "common.invalidRequestParameters"))
	}
	if r.Provider == "openai-compatible" && r.BaseURL == "" {
		return errors.New(serverText(locale, "aiRecognition.baseUrlRequired"))
	}
	if r.Provider != "openai-compatible" && r.APIKey == "" {
		return errors.New(serverText(locale, "aiRecognition.apiKeyRequired"))
	}
	return nil
}

type aiModelCapabilities struct {
	TextInput        *bool `json:"textInput"`
	ImageInput       *bool `json:"imageInput"`
	StructuredOutput *bool `json:"structuredOutput"`
	Thinking         *bool `json:"thinking"`
}

type aiModelListItem struct {
	ID               string              `json:"id"`
	DisplayName      *string             `json:"displayName"`
	CreatedAt        *string             `json:"createdAt"`
	OwnedBy          *string             `json:"ownedBy"`
	InputTokenLimit  *int                `json:"inputTokenLimit"`
	OutputTokenLimit *int                `json:"outputTokenLimit"`
	Capabilities     aiModelCapabilities `json:"capabilities"`
}

type aiModelListResponse struct {
	Provider  string            `json:"provider"`
	Models    []aiModelListItem `json:"models"`
	Truncated bool              `json:"truncated"`
}

type aiModelListErrorResponse struct {
	Message string                  `json:"message"`
	Code    string                  `json:"code"`
	Details aiModelListErrorDetails `json:"details"`
}

type aiModelListErrorDetails struct {
	Reason          string  `json:"reason"`
	ProviderMessage *string `json:"providerMessage"`
}

type aiModelListEndpoint struct {
	URL     string
	Headers http.Header
}

type aiModelListHTTPError struct {
	status  int
	code    string
	reason  string
	message *string
}

func (e *aiModelListHTTPError) Error() string {
	if e.message != nil {
		return *e.message
	}
	return e.reason
}

var aiModelListHTTPClient = &http.Client{Timeout: aiModelListTimeout}

func handleAIModelsList(app core.App, e *core.RequestEvent) error {
	locale := requestLocale(e.Request)
	if e.Auth == nil {
		return e.UnauthorizedError(serverText(locale, "auth.loginRequired"), nil)
	}
	body, err := decodeStrictJSON[aiModelListRequest](e.Request, locale)
	if err != nil {
		return e.BadRequestError(validationErrorMessage(locale, "common.invalidRequestBody", err), err)
	}
	response, err := listAIModels(e.Request.Context(), body, locale)
	if err != nil {
		var httpErr *aiModelListHTTPError
		if errors.As(err, &httpErr) {
			return e.JSON(httpErr.status, aiModelListErrorResponse{
				Message: serverText(locale, "aiRecognition.modelListFailed"),
				Code:    httpErr.code,
				Details: aiModelListErrorDetails{Reason: httpErr.reason, ProviderMessage: httpErr.message},
			})
		}
		return e.JSON(http.StatusBadRequest, aiModelListErrorResponse{
			Message: serverText(locale, "aiRecognition.modelListFailed"),
			Code:    "AI_MODEL_LIST_FAILED",
			Details: aiModelListErrorDetails{Reason: "provider_failed", ProviderMessage: safeAIModelListProviderMessage(err)},
		})
	}
	return e.JSON(http.StatusOK, response)
}

func listAIModels(ctx context.Context, input aiModelListRequest, locale appLocale) (aiModelListResponse, error) {
	endpoint, err := buildAIModelListEndpoint(input)
	if err != nil {
		return aiModelListResponse{}, err
	}
	raw, err := fetchAIModelListJSON(ctx, endpoint, locale)
	if err != nil {
		return aiModelListResponse{}, err
	}
	models := normalizeAIModelList(input.Provider, raw)
	truncated := len(models) > aiModelListMaxModels
	if truncated {
		models = models[:aiModelListMaxModels]
	}
	return aiModelListResponse{Provider: input.Provider, Models: models, Truncated: truncated}, nil
}

func buildAIModelListEndpoint(input aiModelListRequest) (aiModelListEndpoint, error) {
	headers := http.Header{"Accept": []string{"application/json"}}
	switch input.Provider {
	case "openai":
		headers.Set("Authorization", "Bearer "+input.APIKey)
		return aiModelListEndpoint{URL: appendAIModelListPath(firstNonBlank(input.BaseURL, "https://api.openai.com/v1")), Headers: headers}, nil
	case "gemini":
		headers.Set("x-goog-api-key", input.APIKey)
		return aiModelListEndpoint{URL: appendAIModelListPath(firstNonBlank(input.BaseURL, "https://generativelanguage.googleapis.com/v1beta")), Headers: headers}, nil
	case "anthropic":
		headers.Set("x-api-key", input.APIKey)
		headers.Set("anthropic-version", "2023-06-01")
		return aiModelListEndpoint{URL: appendAIModelListPath(firstNonBlank(input.BaseURL, "https://api.anthropic.com/v1")), Headers: headers}, nil
	case "openai-compatible":
		if input.APIKey != "" {
			headers.Set("Authorization", "Bearer "+input.APIKey)
		}
		return aiModelListEndpoint{URL: appendAIModelListPath(input.BaseURL), Headers: headers}, nil
	default:
		return aiModelListEndpoint{}, errAIRecognitionProviderInvalid
	}
}

func appendAIModelListPath(baseURL string) string {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return baseURL
	}
	path := strings.TrimRight(parsed.Path, "/")
	if strings.HasSuffix(path, "/models") {
		parsed.Path = path
	} else {
		parsed.Path = path + "/models"
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func fetchAIModelListJSON(ctx context.Context, endpoint aiModelListEndpoint, locale appLocale) (map[string]interface{}, error) {
	ctx, cancel := context.WithTimeout(ctx, aiModelListTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.URL, nil)
	if err != nil {
		return nil, err
	}
	for key, values := range endpoint.Headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}
	// 模型列表刷新是用户显式动作；第三方凭证只参与服务端代理请求，不写库、不回传浏览器。
	response, err := aiModelListHTTPClient.Do(request)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
			return nil, &aiModelListHTTPError{status: http.StatusRequestTimeout, code: "AI_MODEL_LIST_TIMEOUT", reason: "timeout"}
		}
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	body, err := readAIModelListResponseBody(response.Body, locale)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := redactAIModelListSecrets(string(body))
		return nil, &aiModelListHTTPError{
			status:  response.StatusCode,
			code:    "AI_MODEL_LIST_FAILED",
			reason:  fmt.Sprintf("http_%d", response.StatusCode),
			message: stringPtr(trimMaxRunes(message, 1000)),
		}
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		message := redactAIModelListSecrets(string(body))
		return nil, &aiModelListHTTPError{
			status:  http.StatusBadRequest,
			code:    "AI_MODEL_LIST_INVALID_JSON",
			reason:  "invalid_json",
			message: stringPtr(trimMaxRunes(message, 1000)),
		}
	}
	return raw, nil
}

func readAIModelListResponseBody(reader io.Reader, locale appLocale) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, aiModelListResponseBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > aiModelListResponseBytes {
		return nil, &aiModelListHTTPError{
			status:  http.StatusRequestEntityTooLarge,
			code:    "AI_MODEL_LIST_RESPONSE_TOO_LARGE",
			reason:  "response_too_large",
			message: stringPtr(serverText(locale, "common.requestBodyTooLarge")),
		}
	}
	return data, nil
}

func normalizeAIModelList(provider string, raw map[string]interface{}) []aiModelListItem {
	var models []aiModelListItem
	switch provider {
	case "gemini":
		models = normalizeGeminiModelList(raw)
	case "anthropic":
		models = normalizeAnthropicModelList(raw)
	default:
		models = normalizeOpenAIShapeModelList(raw)
	}
	return dedupeAIModelList(models)
}

func normalizeOpenAIShapeModelList(raw map[string]interface{}) []aiModelListItem {
	items := arrayFromMap(raw, "data")
	models := make([]aiModelListItem, 0, len(items))
	for _, item := range items {
		record := mapFromValue(item)
		id := stringFromMap(record, "id")
		if id == "" {
			continue
		}
		models = append(models, newAIModelListItem(aiModelListItem{
			ID:          id,
			DisplayName: optionalFirstNonBlank(stringFromMap(record, "display_name"), stringFromMap(record, "displayName")),
			CreatedAt:   optionalEpochSecondsISO(numberFromMap(record, "created")),
			OwnedBy:     optionalFirstNonBlank(stringFromMap(record, "owned_by"), stringFromMap(record, "ownedBy")),
		}))
	}
	return models
}

func normalizeGeminiModelList(raw map[string]interface{}) []aiModelListItem {
	items := arrayFromMap(raw, "models")
	models := make([]aiModelListItem, 0, len(items))
	for _, item := range items {
		record := mapFromValue(item)
		methods := stringSliceFromMap(record, "supportedGenerationMethods")
		if len(methods) > 0 && !containsString(methods, "generateContent") {
			continue
		}
		id := firstNonBlank(stringFromMap(record, "baseModelId"), strings.TrimPrefix(stringFromMap(record, "name"), "models/"))
		if id == "" {
			continue
		}
		textInput := true
		model := newAIModelListItem(aiModelListItem{
			ID:               id,
			DisplayName:      optionalFirstNonBlank(stringFromMap(record, "displayName")),
			InputTokenLimit:  optionalPositiveInt(numberFromMap(record, "inputTokenLimit")),
			OutputTokenLimit: optionalPositiveInt(numberFromMap(record, "outputTokenLimit")),
			Capabilities: aiModelCapabilities{
				TextInput: &textInput,
				Thinking:  optionalThinkingCapability(record["thinking"]),
			},
		})
		models = append(models, model)
	}
	return models
}

func normalizeAnthropicModelList(raw map[string]interface{}) []aiModelListItem {
	items := arrayFromMap(raw, "data")
	models := make([]aiModelListItem, 0, len(items))
	for _, item := range items {
		record := mapFromValue(item)
		id := stringFromMap(record, "id")
		if id == "" {
			continue
		}
		capabilities := mapFromValue(record["capabilities"])
		models = append(models, newAIModelListItem(aiModelListItem{
			ID:          id,
			DisplayName: optionalFirstNonBlank(stringFromMap(record, "display_name"), stringFromMap(record, "displayName")),
			CreatedAt:   optionalFirstNonBlank(stringFromMap(record, "created_at"), stringFromMap(record, "createdAt")),
			OwnedBy:     optionalFirstNonBlank(stringFromMap(record, "type")),
			Capabilities: aiModelCapabilities{
				TextInput:  optionalBoolFromMap(capabilities, "text"),
				ImageInput: optionalBoolFromMap(capabilities, "vision"),
				Thinking:   optionalBoolFromMap(capabilities, "thinking"),
			},
		}))
	}
	return models
}

func newAIModelListItem(item aiModelListItem) aiModelListItem {
	item.ID = strings.TrimSpace(item.ID)
	item.Capabilities = aiModelCapabilities{
		TextInput:        item.Capabilities.TextInput,
		ImageInput:       item.Capabilities.ImageInput,
		StructuredOutput: item.Capabilities.StructuredOutput,
		Thinking:         item.Capabilities.Thinking,
	}
	return item
}

func dedupeAIModelList(models []aiModelListItem) []aiModelListItem {
	out := make([]aiModelListItem, 0, len(models))
	seen := map[string]struct{}{}
	for _, model := range models {
		key := strings.ToLower(model.ID)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, model)
	}
	return out
}

func mapFromValue(value interface{}) map[string]interface{} {
	if data, ok := value.(map[string]interface{}); ok {
		return data
	}
	return map[string]interface{}{}
}

func arrayFromMap(value map[string]interface{}, key string) []interface{} {
	if data, ok := value[key].([]interface{}); ok {
		return data
	}
	return nil
}

func stringFromMap(value map[string]interface{}, key string) string {
	if data, ok := value[key].(string); ok {
		return strings.TrimSpace(data)
	}
	return ""
}

func numberFromMap(value map[string]interface{}, key string) float64 {
	if data, ok := value[key].(float64); ok {
		return data
	}
	return 0
}

func stringSliceFromMap(value map[string]interface{}, key string) []string {
	raw, ok := value[key].([]interface{})
	if !ok {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
			out = append(out, strings.TrimSpace(text))
		}
	}
	return out
}

func optionalBoolFromMap(value map[string]interface{}, key string) *bool {
	if data, ok := value[key].(bool); ok {
		return &data
	}
	return nil
}

func optionalThinkingCapability(value interface{}) *bool {
	if data, ok := value.(bool); ok {
		return &data
	}
	if value != nil {
		data := true
		return &data
	}
	return nil
}

func optionalPositiveInt(value float64) *int {
	if value <= 0 {
		return nil
	}
	out := int(value)
	return &out
}

func optionalEpochSecondsISO(value float64) *string {
	if value <= 0 {
		return nil
	}
	text := time.Unix(int64(value), 0).UTC().Format(time.RFC3339)
	return &text
}

func optionalFirstNonBlank(values ...string) *string {
	value := firstNonBlank(values...)
	if value == "" {
		return nil
	}
	return &value
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func safeAIModelListProviderMessage(err error) *string {
	if err == nil {
		return nil
	}
	message := trimMaxRunes(redactAIModelListSecrets(err.Error()), 1000)
	if message == "" {
		return nil
	}
	return &message
}

func redactAIModelListSecrets(value string) string {
	return redactAIRecognitionSecrets(value)
}

func trimMaxRunes(value string, maxLength int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= maxLength {
		return string(runes)
	}
	return string(runes[:maxLength])
}

func stringPtr(value string) *string {
	return &value
}
