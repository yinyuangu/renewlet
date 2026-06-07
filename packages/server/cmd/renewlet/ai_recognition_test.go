package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/zendev-sh/goai"
	"github.com/zendev-sh/goai/provider"
)

func TestAIRecognitionProviderOptions(t *testing.T) {
	budget := 4096
	budgetTokens := 8192
	tests := []struct {
		name    string
		control *aiThinkingControl
		want    map[string]any
	}{
		{
			name:    "openai reasoning effort",
			control: &aiThinkingControl{Provider: "openai", Effort: "high"},
			want:    map[string]any{"reasoning_effort": "high"},
		},
		{
			name:    "gemini off thinking budget",
			control: &aiThinkingControl{Provider: "gemini", Mode: "off"},
			want:    map[string]any{"google": map[string]any{"thinkingConfig": map[string]any{"thinkingBudget": 0}}},
		},
		{
			name:    "gemini fixed thinking budget",
			control: &aiThinkingControl{Provider: "gemini", Mode: "budget", Budget: &budget},
			want:    map[string]any{"google": map[string]any{"thinkingConfig": map[string]any{"thinkingBudget": 4096}}},
		},
		{
			name:    "anthropic effort",
			control: &aiThinkingControl{Provider: "anthropic", Mode: "effort", Effort: "xhigh"},
			want:    map[string]any{"effort": "xhigh"},
		},
		{
			name:    "anthropic legacy budget tokens",
			control: &aiThinkingControl{Provider: "anthropic", Mode: "budget", BudgetTokens: &budgetTokens},
			want:    map[string]any{"thinking": map[string]any{"type": "enabled", "budgetTokens": 8192}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := aiRecognitionProviderOptions(tt.control)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("provider options mismatch: got %#v want %#v", got, tt.want)
			}
		})
	}
}

func TestGoAIRecognitionRunnerRepairsMissingNotes(t *testing.T) {
	restore := stubAIRecognitionGeneration(t, []aiGeneratedRecognizeResponse{
		aiGeneratedResponseForTest(aiGeneratedDraftForTest(
			"HostDZire CloudVPS",
			aiGeneratedNotesField{Value: nil, Source: "none"},
			[]string{"VPS", "云主机"},
		)),
		aiGeneratedResponseForTest(aiGeneratedDraftForTest(
			"HostDZire CloudVPS",
			aiGeneratedNotesField{Value: stringRef("HostDZire CloudVPS 是提供 VPS 和云主机相关产品或服务的订阅服务。"), Source: "suggested"},
			[]string{"VPS", "云主机"},
		)),
	})
	defer restore()

	response, err := goaiRecognitionRunner{}.Recognize(
		context.Background(),
		aiRecognitionSettings{Provider: "openai", Model: "gpt-5.1", APIKey: "sk-test"},
		aiRecognitionInput{Text: "HostDZire CloudVPS 15元 1个月", MaxOutputTokens: 12000},
		localeZhCN,
		"Asia/Shanghai",
		"CNY",
		aiRecognitionConfigContext{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.Subscriptions[0].Notes == nil || response.Subscriptions[0].Notes.Value != "HostDZire CloudVPS 是提供 VPS 和云主机相关产品或服务的订阅服务。" {
		t.Fatalf("repair notes not preserved: %#v", response.Subscriptions[0].Notes)
	}
	if !strings.Contains(response.Diagnostics.Prompt.User.Value, "Repair task:") {
		t.Fatalf("diagnostics should describe repair prompt, got %s", response.Diagnostics.Prompt.User.Value)
	}
}

func TestGoAIRecognitionRunnerFallsBackWhenRepairStillMissesNotes(t *testing.T) {
	missing := aiGeneratedResponseForTest(aiGeneratedDraftForTest(
		"HostDZire CloudVPS",
		aiGeneratedNotesField{Value: nil, Source: "none"},
		[]string{"VPS", "云主机"},
	))
	restore := stubAIRecognitionGeneration(t, []aiGeneratedRecognizeResponse{missing, missing})
	defer restore()

	response, err := goaiRecognitionRunner{}.Recognize(
		context.Background(),
		aiRecognitionSettings{Provider: "openai", Model: "gpt-5.1", APIKey: "sk-test"},
		aiRecognitionInput{Text: "HostDZire CloudVPS 15元 1个月", MaxOutputTokens: 12000},
		localeZhCN,
		"Asia/Shanghai",
		"CNY",
		aiRecognitionConfigContext{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.Subscriptions[0].Notes == nil || response.Subscriptions[0].Notes.Value != "HostDZire CloudVPS 是提供 VPS、云主机相关产品或服务的订阅服务。" {
		t.Fatalf("fallback notes not generated from dynamic fields: %#v", response.Subscriptions[0].Notes)
	}
	if slices.Contains(response.Subscriptions[0].Warnings, "AI_WARNING_NOTES_MISSING") {
		t.Fatalf("fallback should not expose missing-notes warning: %#v", response.Subscriptions[0].Warnings)
	}
}

func TestReadAIRecognitionMultipartThinkingControl(t *testing.T) {
	missing := readAIRecognitionMultipartForTest(t, map[string]string{"text": "dmit 15元 1个月"})
	if missing.ThinkingControl != nil {
		t.Fatalf("missing thinkingControl field should not apply defaults, got %#v", missing.ThinkingControl)
	}

	explicitNull := readAIRecognitionMultipartForTest(t, map[string]string{
		"text":            "dmit 15元 1个月",
		"thinkingControl": "null",
	})
	if explicitNull.ThinkingControl != nil {
		t.Fatalf("explicit null thinkingControl should stay nil, got %#v", explicitNull.ThinkingControl)
	}

	explicitControl := readAIRecognitionMultipartForTest(t, map[string]string{
		"text":            "dmit 15元 1个月",
		"thinkingControl": `{"provider":"openai","effort":"high"}`,
	})
	if explicitControl.ThinkingControl == nil || explicitControl.ThinkingControl.Provider != "openai" || explicitControl.ThinkingControl.Effort != "high" {
		t.Fatalf("explicit thinkingControl was not parsed: %#v", explicitControl.ThinkingControl)
	}
}

func TestReadAIRecognitionMultipartImageLimit(t *testing.T) {
	fiveImages, err := readAIRecognitionMultipartImagesForTest(5)
	if err != nil {
		t.Fatal(err)
	}
	if len(fiveImages.Images) != 5 {
		t.Fatalf("expected five images, got %#v", fiveImages.Images)
	}

	if _, err := readAIRecognitionMultipartImagesForTest(6); !errors.Is(err, errAIRecognitionBodyTooLarge) {
		t.Fatalf("expected body too large for sixth image, got %v", err)
	}
}

func TestSanitizeAIRecognitionSettingsModelInputMode(t *testing.T) {
	if got := sanitizeAIRecognitionSettings(aiRecognitionSettings{Provider: "openai", ModelInputMode: ""}).ModelInputMode; got != "select" {
		t.Fatalf("empty model input mode should default to select, got %q", got)
	}
	if got := sanitizeAIRecognitionSettings(aiRecognitionSettings{Provider: "openai", ModelInputMode: "manual"}).ModelInputMode; got != "manual" {
		t.Fatalf("manual model input mode should be preserved, got %q", got)
	}
	if got := sanitizeAIRecognitionSettings(aiRecognitionSettings{Provider: "openai", ModelInputMode: "unknown"}).ModelInputMode; got != "select" {
		t.Fatalf("invalid model input mode should fall back to select, got %q", got)
	}
}

func TestSafeAIRecognitionErrorRedactsSecrets(t *testing.T) {
	err := safeAIRecognitionError(errors.New("provider failed sk-testsecret123 AIza123456789 sk-ant-secret123 Bearer abc.def.ghi eyJabc.def.ghi authorization: secret-token-12345"))
	message := err.Error()
	for _, secret := range []string{"sk-testsecret123", "AIza123456789", "sk-ant-secret123", "Bearer abc.def.ghi", "eyJabc.def.ghi", "secret-token-12345"} {
		if strings.Contains(message, secret) {
			t.Fatalf("secret %q leaked in %q", secret, message)
		}
	}
	if got := strings.Count(message, "[redacted]"); got != 6 {
		t.Fatalf("redaction count mismatch: got %d in %q", got, message)
	}
}

func TestAIRecognitionPromptUsesSharedJSONContract(t *testing.T) {
	systemPrompt := buildAIRecognitionSystemPrompt()
	configContext := aiRecognitionConfigContext{
		Categories: []aiRecognitionConfigOption{{
			Value: "hosting_domains",
			Label: "域名与托管",
			ZhCN:  "域名与托管",
			EnUS:  "Domains & Hosting",
		}},
		PaymentMethods: []aiRecognitionConfigOption{{
			Value: "crypto",
			Label: "加密货币",
			ZhCN:  "加密货币",
			EnUS:  "Crypto",
		}},
		Tags: []string{"VPS", "云服务器"},
	}
	userPrompt := buildAIRecognitionUserPrompt("sample service 15元 1个月", "Asia/Shanghai", "CNY", 2, localeZhCN, configContext)
	for _, want := range []string{
		"Return exactly one JSON object",
		"Do not return Markdown",
		"Do generate useful service and website metadata",
		"Examples show output shape and decision patterns only",
	} {
		if !strings.Contains(systemPrompt, want) {
			t.Fatalf("system prompt missing %q:\n%s", want, systemPrompt)
		}
	}
	for _, want := range []string{
		`Top-level JSON must be {"subscriptions": [], "warnings": []}.`,
		"Runtime context:",
		"- Attached image count: 2",
		"- User locale: zh-CN",
		"User context:",
		"Task:",
		"Examples:",
		"<<<renewlet-user-input",
		"Existing user tags:",
		"- VPS",
		"value=hosting_domains",
		"value=crypto",
		"provided category values exactly",
		"website with the canonical https URL",
		"notes must always be an object",
		"notes.value must be non-null for describable services",
		"dynamic evidence from this request",
		"Prefer Existing user tags when they fit.",
		"stable and reusable across multiple subscriptions",
		"Do not use one-off order attributes as tags",
		"Example Cloud Backup",
		"Team Docs Workspace",
		`"price": 12`,
		`"currency": "USD"`,
		`"billingCycle": "annual"`,
		`"value": "https://backup.example.com"`,
		`"source": "none"`,
	} {
		if !strings.Contains(userPrompt, want) {
			t.Fatalf("user prompt missing %q:\n%s", want, userPrompt)
		}
	}
	for _, forbidden := range []string{
		"apple 50刀 1年",
		"youtube 15刀 1年",
		"locvps 15元 1个月",
		"dmit 15元 1个月",
		"https://www.apple.com/",
		"YouTube 是 Google 旗下的视频分享和流媒体平台。",
		"LOCVPS 是面向 VPS、云服务器和服务器托管的主机服务商。",
		"DMIT 是提供 VPS、云服务器和网络线路服务的主机商。",
	} {
		if strings.Contains(userPrompt, forbidden) {
			t.Fatalf("user prompt should not contain brand mapping example %q:\n%s", forbidden, userPrompt)
		}
	}
}

func TestAIRecognitionGeneratedSchemaRequiresCompleteDraftFields(t *testing.T) {
	var schema struct {
		Properties map[string]struct {
			Items struct {
				Required   []string `json:"required"`
				Properties map[string]struct {
					Description string   `json:"description"`
					Type        any      `json:"type"`
					Enum        []string `json:"enum"`
					MaxItems    int      `json:"maxItems"`
					Properties  map[string]struct {
						Description string   `json:"description"`
						Type        any      `json:"type"`
						Enum        []string `json:"enum"`
					} `json:"properties"`
				} `json:"properties"`
			} `json:"items"`
		} `json:"properties"`
		Required []string `json:"required"`
	}
	if err := json.Unmarshal(aiRecognitionGeneratedSchema, &schema); err != nil {
		t.Fatal(err)
	}
	subscriptionRequired := schema.Properties["subscriptions"].Items.Required
	for _, field := range []string{"name", "price", "currency", "billingCycle", "website", "notes", "tags", "confidence", "warnings"} {
		if !slices.Contains(subscriptionRequired, field) {
			t.Fatalf("generated subscription schema should require %q, got %#v", field, subscriptionRequired)
		}
	}
	if !slices.Contains(schema.Required, "warnings") {
		t.Fatalf("top-level schema should require warnings, got %#v", schema.Required)
	}
	tagsSchema := schema.Properties["subscriptions"].Items.Properties["tags"]
	if tagsSchema.MaxItems != 3 || !strings.Contains(tagsSchema.Description, "reusable organization tags") {
		t.Fatalf("generated tags schema should describe reusable tags and cap at 3, got %#v", tagsSchema)
	}
	notesSchema := schema.Properties["subscriptions"].Items.Properties["notes"]
	notesType, _ := json.Marshal(notesSchema.Type)
	if strings.Contains(string(notesType), "null") {
		t.Fatalf("generated notes object should not be nullable, got %s", notesType)
	}
	if !slices.Contains(notesSchema.Properties["source"].Enum, "none") {
		t.Fatalf("generated notes source should include none, got %#v", notesSchema.Properties["source"].Enum)
	}
	for field, want := range map[string]string{
		"website":       "Official or user-provided website",
		"notes":         "service/site description",
		"category":      "Renewlet category value",
		"paymentMethod": "Renewlet payment method value",
		"confidence":    "directly confirmed",
		"warnings":      "Stable warning codes",
	} {
		if !strings.Contains(schema.Properties["subscriptions"].Items.Properties[field].Description, want) {
			t.Fatalf("generated %s schema should describe %q, got %#v", field, want, schema.Properties["subscriptions"].Items.Properties[field])
		}
	}
}

func TestAIRecognitionExistingTagsForUser(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	user, _ := createRouteTestUser(t, app, "ai-tags")
	other, _ := createRouteTestUser(t, app, "ai-tags-other")
	saveSubscriptionRecord(t, app, user.Id, []string{" VPS ", "云服务器", "vps"}, "Host")
	saveSubscriptionRecord(t, app, other.Id, []string{"Other"}, "Other Host")

	tags, err := aiRecognitionExistingTagsForUser(app, user.Id)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(tags, []string{"VPS", "云服务器"}) {
		t.Fatalf("expected current user tags with case-insensitive prompt dedupe, got %#v", tags)
	}
}

func TestAIRecognitionDiagnosticsRedactsSecretsAndImageData(t *testing.T) {
	diagnostics := buildAIRecognitionDiagnostics(
		aiRecognitionSettings{Provider: "openai", Model: "gpt-5.1"},
		aiRecognitionInput{
			Text: "dmit 15元 1个月 sk-testsecret123",
			Images: []aiRecognitionImage{{
				MediaType: "image/png",
				DataURL:   "data:image/png;base64,SHOULD_NOT_LEAK",
				SizeBytes: 12,
			}},
			MaxOutputTokens: 12000,
		},
		"Return JSON only",
		"authorization: secret-token-12345",
		`{"subscriptions":[],"warnings":[],"apiKey":"sk-testsecret123"}`,
		map[string]any{"subscriptions": []any{}, "warnings": []any{}},
		map[string]any{"inputTokens": 1},
		"stop",
		map[string]any{"openai": map[string]any{"authorization": "Bearer abc.def.ghi"}},
	)
	data, err := json.Marshal(diagnostics)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, leaked := range []string{"sk-testsecret123", "secret-token-12345", "Bearer abc.def.ghi", "SHOULD_NOT_LEAK", "data:image/png;base64"} {
		if strings.Contains(text, leaked) {
			t.Fatalf("diagnostics leaked %q in %s", leaked, text)
		}
	}
	if diagnostics.Request.Images[0].SizeBytes != 12 || diagnostics.Request.Images[0].MediaType != "image/png" {
		t.Fatalf("image metadata not preserved: %#v", diagnostics.Request.Images)
	}
	if diagnostics.Output.RawModelText == nil || !strings.Contains(diagnostics.Output.RawModelText.Value, "[redacted]") {
		t.Fatalf("raw model text was not redacted: %#v", diagnostics.Output.RawModelText)
	}
}

func TestNormalizeAIRecognizeResponse(t *testing.T) {
	price := -1.0
	currency := "usd"
	billingCycle := "bad"
	date := "2026-99-99"
	response, err := normalizeAIRecognizeResponse(aiRecognizeResponse{
		Subscriptions: []aiRecognizedSubscriptionDraft{{
			Name:            "  Netflix  ",
			Price:           &price,
			Currency:        &currency,
			BillingCycle:    &billingCycle,
			StartDate:       &date,
			NextBillingDate: &date,
			Confidence:      "unknown",
			Warnings:        []string{"", "manual warning", "manual warning"},
		}},
		Diagnostics: testAIRecognitionDiagnostics(),
	}, "openai", "gpt-5.1", aiRecognitionConfigContext{})
	if err != nil {
		t.Fatal(err)
	}
	draft := response.Subscriptions[0]
	if response.Provider != "openai" || response.Model != "gpt-5.1" {
		t.Fatalf("provider/model not attached: %#v", response)
	}
	if draft.Name != "Netflix" || draft.Price != nil || draft.BillingCycle != nil || draft.Confidence != "low" {
		t.Fatalf("draft was not normalized: %#v", draft)
	}
	if draft.Currency == nil || *draft.Currency != "USD" {
		t.Fatalf("currency should normalize to USD: %#v", draft.Currency)
	}
	if !slices.Contains(draft.Warnings, "AI_WARNING_PRICE_INVALID") || !slices.Contains(draft.Warnings, "AI_WARNING_DATE_INVALID:startDate") {
		t.Fatalf("expected validation warnings, got %#v", draft.Warnings)
	}
}

func TestNormalizeAIGeneratedRecognizeResponse(t *testing.T) {
	currency := "元"
	billingCycle := "1个月"
	category := "数字服务"
	paymentMethod := "Crypto"
	website := aiSuggestedTextField{Value: "https://www.apple.com/", Source: "suggested"}
	notesValue := "DMIT 是提供 VPS、云服务器和网络线路服务的主机商。"
	notes := aiGeneratedNotesField{Value: &notesValue, Source: "suggested"}
	configContext := aiRecognitionConfigContext{
		Categories: []aiRecognitionConfigOption{{
			Value: "digital_services",
			Label: "数字服务",
			ZhCN:  "数字服务",
			EnUS:  "Digital services",
		}},
		PaymentMethods: []aiRecognitionConfigOption{{
			Value: "crypto",
			Label: "加密货币",
			ZhCN:  "加密货币",
			EnUS:  "Crypto",
		}},
		Tags: []string{"数字服务", "云服务"},
	}
	response, err := normalizeAIGeneratedRecognizeResponse(aiGeneratedRecognizeResponse{
		Subscriptions: []aiGeneratedSubscriptionDraft{{
			Name:          "dmit",
			Price:         "15元",
			Currency:      &currency,
			BillingCycle:  &billingCycle,
			Category:      &category,
			PaymentMethod: &paymentMethod,
			Website:       &website,
			Notes:         &notes,
			Tags:          []string{"数字服务", "数字服务", "  云服务  "},
		}},
		Warnings: []string{},
	}, "openai", "gpt-5.1", testAIRecognitionDiagnostics(), configContext)
	if err != nil {
		t.Fatal(err)
	}
	draft := response.Subscriptions[0]
	if response.Provider != "openai" || response.Model != "gpt-5.1" {
		t.Fatalf("provider/model not attached: %#v", response)
	}
	if draft.Name != "dmit" || draft.Price == nil || *draft.Price != 15 {
		t.Fatalf("generated draft price not normalized: %#v", draft)
	}
	if draft.Currency == nil || *draft.Currency != "CNY" {
		t.Fatalf("currency should normalize to CNY: %#v", draft.Currency)
	}
	if draft.BillingCycle == nil || *draft.BillingCycle != "monthly" {
		t.Fatalf("billing cycle should normalize to monthly: %#v", draft.BillingCycle)
	}
	if draft.Category == nil || *draft.Category != "digital_services" || draft.PaymentMethod == nil || *draft.PaymentMethod != "crypto" || draft.Website == nil || draft.Website.Source != "suggested" || draft.Notes == nil || draft.Notes.Source != "suggested" {
		t.Fatalf("suggested metadata should be preserved: %#v", draft)
	}
	if !reflect.DeepEqual(draft.Tags, []string{"数字服务", "云服务"}) {
		t.Fatalf("tags should be compacted: %#v", draft.Tags)
	}
}

func TestNormalizeAITagsReusesExistingAndKeepsStableGeneratedTags(t *testing.T) {
	response, err := normalizeAIRecognizeResponse(aiRecognizeResponse{
		Subscriptions: []aiRecognizedSubscriptionDraft{{
			Name:       "HostDZire IN CloudVPS #5 (FAT32 Special)",
			Tags:       []string{"vps", "孟买", "Debian 12"},
			Confidence: "high",
		}},
		Diagnostics: testAIRecognitionDiagnostics(),
	}, "openai", "gpt-5.1", aiRecognitionConfigContext{Tags: []string{"VPS", "云服务器"}})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(response.Subscriptions[0].Tags, []string{"VPS"}) {
		t.Fatalf("expected existing tag reuse and one-off attribute filtering, got %#v", response.Subscriptions[0].Tags)
	}

	response, err = normalizeAIRecognizeResponse(aiRecognizeResponse{
		Subscriptions: []aiRecognizedSubscriptionDraft{{
			Name:       "DMIT",
			Tags:       []string{"VPS", "云服务器", "Debian 12"},
			Confidence: "high",
		}},
		Diagnostics: testAIRecognitionDiagnostics(),
	}, "openai", "gpt-5.1", aiRecognitionConfigContext{})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(response.Subscriptions[0].Tags, []string{"VPS", "云服务器"}) {
		t.Fatalf("expected stable generated tags to remain, got %#v", response.Subscriptions[0].Tags)
	}

	response, err = normalizeAIRecognizeResponse(aiRecognizeResponse{
		Subscriptions: []aiRecognizedSubscriptionDraft{{
			Name:       "HostDZire IN CloudVPS #5 (FAT32 Special)",
			Tags:       []string{"孟买", "Debian 12", "FAT32 Special"},
			Confidence: "high",
		}},
		Diagnostics: testAIRecognitionDiagnostics(),
	}, "openai", "gpt-5.1", aiRecognitionConfigContext{})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Subscriptions[0].Tags) != 0 {
		t.Fatalf("expected one-off generated attributes to be dropped, got %#v", response.Subscriptions[0].Tags)
	}
}

func TestNormalizeAINotesDropsRecognitionProcessText(t *testing.T) {
	notes := aiSuggestedTextField{Value: "输入没有提供官网或更多上下文，AI 未能高置信识别该服务。", Source: "suggested"}
	response, err := normalizeAIRecognizeResponse(aiRecognizeResponse{
		Subscriptions: []aiRecognizedSubscriptionDraft{{
			Name:       "unknown app",
			Notes:      &notes,
			Warnings:   []string{"AI_WARNING_WEBSITE_UNCERTAIN"},
			Confidence: "low",
		}},
		Diagnostics: testAIRecognitionDiagnostics(),
	}, "openai", "gpt-5.1", aiRecognitionConfigContext{})
	if err != nil {
		t.Fatal(err)
	}
	draft := response.Subscriptions[0]
	if draft.Notes != nil {
		t.Fatalf("process note should be dropped: %#v", draft.Notes)
	}
	if !slices.Contains(draft.Warnings, "AI_WARNING_WEBSITE_UNCERTAIN") {
		t.Fatalf("warning should be preserved: %#v", draft.Warnings)
	}
}

func TestNormalizeAINotesRemovesRenewletAdvice(t *testing.T) {
	notes := aiSuggestedTextField{Value: "LOCVPS 提供 VPS、云服务器和服务器托管相关服务，适合记录主机或服务器套餐订阅。", Source: "suggested"}
	response, err := normalizeAIRecognizeResponse(aiRecognizeResponse{
		Subscriptions: []aiRecognizedSubscriptionDraft{{
			Name:       "locvps",
			Notes:      &notes,
			Confidence: "high",
		}},
		Diagnostics: testAIRecognitionDiagnostics(),
	}, "openai", "gpt-5.1", aiRecognitionConfigContext{})
	if err != nil {
		t.Fatal(err)
	}
	draft := response.Subscriptions[0]
	if draft.Notes == nil || draft.Notes.Value != "LOCVPS 提供 VPS、云服务器和服务器托管服务" {
		t.Fatalf("service note should remove Renewlet-facing advice: %#v", draft.Notes)
	}
}

func TestFillMissingAINotesWithDynamicFallback(t *testing.T) {
	website := aiSuggestedTextField{Value: "https://hostdzire.com/", Source: "suggested"}
	response, err := normalizeAIRecognizeResponse(aiRecognizeResponse{
		Subscriptions: []aiRecognizedSubscriptionDraft{{
			Name:       "HostDZire CloudVPS",
			Website:    &website,
			Notes:      nil,
			Tags:       []string{"VPS", "云主机"},
			Warnings:   []string{"AI_WARNING_NOTES_MISSING"},
			Confidence: "high",
		}},
		Diagnostics: testAIRecognitionDiagnostics(),
	}, "openai", "gpt-5.1", aiRecognitionConfigContext{})
	if err != nil {
		t.Fatal(err)
	}
	response = fillMissingAINotesWithDynamicFallback(response, localeZhCN, aiRecognitionConfigContext{})
	draft := response.Subscriptions[0]
	if draft.Notes == nil || draft.Notes.Value != "HostDZire CloudVPS 是提供 VPS、云主机相关产品或服务的订阅服务。" || draft.Notes.Source != "suggested" {
		t.Fatalf("missing notes should get dynamic fallback: %#v", draft.Notes)
	}
	if slices.Contains(draft.Warnings, "AI_WARNING_NOTES_MISSING") {
		t.Fatalf("fallback should remove stale missing-notes warning, got %#v", draft.Warnings)
	}
}

func TestNormalizeAIConfigValueKeepsUnknownNamesForImportCreation(t *testing.T) {
	category := "Cloud lab"
	response, err := normalizeAIRecognizeResponse(aiRecognizeResponse{
		Subscriptions: []aiRecognizedSubscriptionDraft{{
			Name:       "Lab",
			Category:   &category,
			Confidence: "high",
		}},
		Diagnostics: testAIRecognitionDiagnostics(),
	}, "openai", "gpt-5.1", aiRecognitionConfigContext{
		Categories: []aiRecognitionConfigOption{{
			Value: "hosting_domains",
			Label: "域名与托管",
			ZhCN:  "域名与托管",
			EnUS:  "Domains & Hosting",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := response.Subscriptions[0].Category; got == nil || *got != "Cloud lab" {
		t.Fatalf("unknown category should be preserved for import config creation, got %#v", got)
	}
}

func TestAIRecognitionSchemaMismatchError(t *testing.T) {
	for _, err := range []error{
		errors.New("No object generated: response did not match schema."),
		errors.New("parsing structured output: invalid character 'o' looking for beginning of value (raw: ok)"),
	} {
		if !isAIRecognitionSchemaMismatchError(err) {
			t.Fatalf("expected schema mismatch error for %q", err.Error())
		}
	}
}

func testAIRecognitionDiagnostics() aiRecognitionDiagnostics {
	return buildAIRecognitionDiagnostics(
		aiRecognitionSettings{Provider: "openai", Model: "gpt-5.1"},
		aiRecognitionInput{Text: "dmit 15元 1个月", MaxOutputTokens: 12000},
		"Return JSON only",
		"Extract subscriptions",
		`{"subscriptions":[],"warnings":[]}`,
		map[string]any{"subscriptions": []any{}, "warnings": []any{}},
		map[string]any{"inputTokens": 1, "outputTokens": 1},
		"stop",
		map[string]any{"openai": map[string]any{"id": "resp_1"}},
	)
}

func readAIRecognitionMultipartForTest(t *testing.T, fields map[string]string) aiRecognitionInput {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for name, value := range fields {
		if err := writer.WriteField(name, value); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/app/ai/subscriptions/recognize", &body)
	req.Header.Set("content-type", writer.FormDataContentType())
	input, err := readAIRecognitionMultipart(&core.RequestEvent{
		Event: router.Event{
			Request:  req,
			Response: httptest.NewRecorder(),
		},
	}, localeZhCN)
	if err != nil {
		t.Fatal(err)
	}
	return input
}

func readAIRecognitionMultipartImagesForTest(count int) (aiRecognitionInput, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for index := 0; index < count; index++ {
		header := textproto.MIMEHeader{}
		header.Set("Content-Disposition", `form-data; name="images[]"; filename="image.png"`)
		header.Set("Content-Type", "image/png")
		part, err := writer.CreatePart(header)
		if err != nil {
			return aiRecognitionInput{}, err
		}
		if _, err := part.Write([]byte{0x89, 0x50, 0x4e, 0x47}); err != nil {
			return aiRecognitionInput{}, err
		}
	}
	if err := writer.Close(); err != nil {
		return aiRecognitionInput{}, err
	}
	req := httptest.NewRequest(http.MethodPost, "/api/app/ai/subscriptions/recognize", &body)
	req.Header.Set("content-type", writer.FormDataContentType())
	return readAIRecognitionMultipart(&core.RequestEvent{
		Event: router.Event{
			Request:  req,
			Response: httptest.NewRecorder(),
		},
	}, localeZhCN)
}

func stubAIRecognitionGeneration(t *testing.T, responses []aiGeneratedRecognizeResponse) func() {
	t.Helper()
	previous := generateAIRecognitionObjectForRunner
	index := 0
	generateAIRecognitionObjectForRunner = func(_ context.Context, _ provider.LanguageModel, _ aiRecognitionInput, _ string, _ string) (aiRecognitionGeneration, error) {
		t.Helper()
		if index >= len(responses) {
			t.Fatalf("unexpected AI generation call %d", index+1)
		}
		response := responses[index]
		index++
		return aiRecognitionGeneration{
			result: &goai.ObjectResult[aiGeneratedRecognizeResponse]{Object: response},
			capture: aiRecognitionCapture{
				rawModelText: resultStringFromAIObject(response),
				finishReason: "stop",
			},
		}, nil
	}
	return func() {
		generateAIRecognitionObjectForRunner = previous
	}
}

func aiGeneratedResponseForTest(draft aiGeneratedSubscriptionDraft) aiGeneratedRecognizeResponse {
	return aiGeneratedRecognizeResponse{
		Subscriptions: []aiGeneratedSubscriptionDraft{draft},
		Warnings:      []string{},
	}
}

func aiGeneratedDraftForTest(name string, notes aiGeneratedNotesField, tags []string) aiGeneratedSubscriptionDraft {
	currency := "CNY"
	billingCycle := "monthly"
	status := "active"
	return aiGeneratedSubscriptionDraft{
		Name:                         name,
		Price:                        15,
		Currency:                     &currency,
		BillingCycle:                 &billingCycle,
		CustomDays:                   nil,
		CustomCycleUnit:              nil,
		OneTimeTermCount:             nil,
		OneTimeTermUnit:              nil,
		Category:                     nil,
		Status:                       &status,
		PaymentMethod:                nil,
		StartDate:                    nil,
		NextBillingDate:              nil,
		AutoCalculateNextBillingDate: boolRef(true),
		TrialEndDate:                 nil,
		Website:                      &aiSuggestedTextField{Value: "https://hostdzire.com/", Source: "suggested"},
		Notes:                        &notes,
		Tags:                         tags,
		ReminderDays:                 nil,
		RepeatReminderEnabled:        nil,
		RepeatReminderInterval:       nil,
		RepeatReminderWindow:         nil,
		Confidence:                   "high",
		Warnings:                     []string{},
	}
}

func stringRef(value string) *string {
	return &value
}

func boolRef(value bool) *bool {
	return &value
}
