package main

import (
	"errors"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

var (
	aiSecretPattern   = regexp.MustCompile(`(?i)(sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:api[_-]?key|authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token)["'\s:=]+[A-Za-z0-9._~+/=-]{8,})`)
	aiCurrencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)
	aiNumberPattern   = regexp.MustCompile(`-?\d+(?:\.\d+)?`)
)

var aiRecognitionProcessNoteFragments = []string{
	"ai根据",
	"ai建议",
	"ai未能",
	"ai无法",
	"ai生成",
	"ai猜测",
	"输入没有",
	"输入未",
	"用户输入",
	"原文",
	"图片未",
	"图像未",
	"表格未",
	"无法确定",
	"不能确定",
	"不确定",
	"未能确定",
	"未能高置信识别",
	"无法识别",
	"未明确",
	"未提供",
	"没有提供",
	"请确认",
	"需要确认",
	"确认后",
	"低置信",
	"高置信识别",
	"模型返回",
	"模型输出",
	"模型无法",
	"aigenerated",
	"aiguessed",
	"theinputdoesnot",
	"inputdoesnot",
	"inputdidnot",
	"notprovided",
	"notspecified",
	"uncertain",
	"cannotdetermine",
	"cantdetermine",
	"pleaseconfirm",
	"lowconfidence",
	"modeloutput",
	"modelreturned",
}

var aiRecognitionNoteDropClauseFragments = []string{
	"适合记录",
	"可用于记录",
	"用于记录",
	"便于记录",
	"方便记录",
	"订阅管理",
	"套餐订阅",
	"请确认",
	"需要确认",
	"导入",
	"renewlet",
	"suitableforrecording",
	"canbeusedtorecord",
	"usedtorecord",
	"subscriptionmanagement",
	"pleaseconfirm",
	"import",
}

var aiRecognitionNoteMarketingFragments = []string{
	"优质",
	"领先",
	"专业",
	"全方位",
	"一站式",
	"可靠",
	"高性能",
	"稳定",
	"premium",
	"leading",
	"professional",
	"comprehensive",
	"all-in-one",
}

type aiGeneratedRecognizeResponse struct {
	Subscriptions []aiGeneratedSubscriptionDraft `json:"subscriptions"`
	Warnings      []string                       `json:"warnings"`
}

type aiGeneratedSubscriptionDraft struct {
	Name                         string                 `json:"name"`
	Price                        interface{}            `json:"price"`
	Currency                     *string                `json:"currency"`
	BillingCycle                 *string                `json:"billingCycle"`
	CustomDays                   interface{}            `json:"customDays"`
	CustomCycleUnit              *string                `json:"customCycleUnit"`
	OneTimeTermCount             interface{}            `json:"oneTimeTermCount"`
	OneTimeTermUnit              *string                `json:"oneTimeTermUnit"`
	Category                     *string                `json:"category"`
	Status                       *string                `json:"status"`
	PaymentMethod                *string                `json:"paymentMethod"`
	StartDate                    *string                `json:"startDate"`
	NextBillingDate              *string                `json:"nextBillingDate"`
	AutoCalculateNextBillingDate *bool                  `json:"autoCalculateNextBillingDate"`
	TrialEndDate                 *string                `json:"trialEndDate"`
	Website                      *aiSuggestedTextField  `json:"website"`
	Notes                        *aiGeneratedNotesField `json:"notes"`
	Tags                         []string               `json:"tags"`
	ReminderDays                 interface{}            `json:"reminderDays"`
	RepeatReminderEnabled        *bool                  `json:"repeatReminderEnabled"`
	RepeatReminderInterval       *string                `json:"repeatReminderInterval"`
	RepeatReminderWindow         *string                `json:"repeatReminderWindow"`
	Confidence                   string                 `json:"confidence"`
	Warnings                     []string               `json:"warnings"`
}

type aiGeneratedNotesField struct {
	Value  *string `json:"value"`
	Source string  `json:"source"`
}

func normalizeAIGeneratedRecognizeResponse(raw aiGeneratedRecognizeResponse, providerName string, model string, diagnostics aiRecognitionDiagnostics, configContext aiRecognitionConfigContext) (aiRecognizeResponse, error) {
	response := aiRecognizeResponse{
		Warnings:      raw.Warnings,
		Subscriptions: make([]aiRecognizedSubscriptionDraft, 0, len(raw.Subscriptions)),
		Diagnostics:   diagnostics,
	}
	for _, draft := range raw.Subscriptions {
		response.Subscriptions = append(response.Subscriptions, aiGeneratedDraftToRecognized(draft))
	}
	return normalizeAIRecognizeResponse(response, providerName, model, configContext)
}

func aiGeneratedDraftToRecognized(draft aiGeneratedSubscriptionDraft) aiRecognizedSubscriptionDraft {
	warnings := append([]string{}, draft.Warnings...)
	recognized := aiRecognizedSubscriptionDraft{
		Name:                         draft.Name,
		Currency:                     normalizeAIGeneratedCurrency(draft.Currency),
		BillingCycle:                 normalizeAIGeneratedBillingCycle(draft.BillingCycle),
		CustomCycleUnit:              draft.CustomCycleUnit,
		OneTimeTermUnit:              draft.OneTimeTermUnit,
		Category:                     draft.Category,
		Status:                       draft.Status,
		PaymentMethod:                draft.PaymentMethod,
		StartDate:                    draft.StartDate,
		NextBillingDate:              draft.NextBillingDate,
		AutoCalculateNextBillingDate: draft.AutoCalculateNextBillingDate,
		TrialEndDate:                 draft.TrialEndDate,
		Website:                      draft.Website,
		Notes:                        aiGeneratedNotesToSuggestedField(draft.Notes),
		Tags:                         draft.Tags,
		RepeatReminderEnabled:        draft.RepeatReminderEnabled,
		RepeatReminderInterval:       draft.RepeatReminderInterval,
		RepeatReminderWindow:         draft.RepeatReminderWindow,
		Confidence:                   draft.Confidence,
		Warnings:                     warnings,
	}
	if price, ok, valid := parseAIGeneratedNumber(draft.Price); ok {
		recognized.Price = &price
	} else if !valid {
		recognized.Warnings = append(recognized.Warnings, "AI_WARNING_PRICE_INVALID")
	}
	recognized.CustomDays = parseAIGeneratedPositiveInt(draft.CustomDays, maxReminderDays, "AI_WARNING_CUSTOM_DAYS_INVALID", &recognized.Warnings)
	recognized.OneTimeTermCount = parseAIGeneratedPositiveInt(draft.OneTimeTermCount, maxReminderDays, "AI_WARNING_ONE_TIME_TERM_COUNT_INVALID", &recognized.Warnings)
	recognized.ReminderDays = parseAIGeneratedBoundedInt(draft.ReminderDays, disabledReminderDays, maxReminderDays, "AI_WARNING_REMINDER_DAYS_INVALID", &recognized.Warnings)
	return recognized
}

func aiGeneratedNotesToSuggestedField(field *aiGeneratedNotesField) *aiSuggestedTextField {
	if field == nil || field.Source == "none" || field.Value == nil {
		return nil
	}
	source := strings.TrimSpace(field.Source)
	if source != "input" && source != "suggested" {
		source = "suggested"
	}
	return &aiSuggestedTextField{Value: *field.Value, Source: source}
}

func normalizeAIRecognizeResponse(raw aiRecognizeResponse, providerName string, model string, configContext aiRecognitionConfigContext) (aiRecognizeResponse, error) {
	raw.Provider = providerName
	raw.Model = model
	raw.Warnings = compactAIWarnings(raw.Warnings, 20)
	if len(raw.Subscriptions) > aiRecognitionMaxSubscriptions {
		raw.Subscriptions = raw.Subscriptions[:aiRecognitionMaxSubscriptions]
		raw.Warnings = append(raw.Warnings, "AI_WARNING_TOO_MANY_SUBSCRIPTIONS_TRUNCATED")
	}
	subscriptions := make([]aiRecognizedSubscriptionDraft, 0, len(raw.Subscriptions))
	for _, draft := range raw.Subscriptions {
		normalized, ok := normalizeAISubscriptionDraft(draft, configContext)
		if ok {
			subscriptions = append(subscriptions, normalized)
		} else {
			raw.Warnings = append(raw.Warnings, "AI_WARNING_EMPTY_SUBSCRIPTION_SKIPPED")
		}
	}
	raw.Subscriptions = subscriptions
	raw.Warnings = compactAIWarnings(raw.Warnings, 20)
	if len(raw.Subscriptions) == 0 {
		return raw, errAIRecognitionNoSubscriptions
	}
	return raw, nil
}

func normalizeAISubscriptionDraft(draft aiRecognizedSubscriptionDraft, configContext aiRecognitionConfigContext) (aiRecognizedSubscriptionDraft, bool) {
	draft.Name = trimMax(draft.Name, 120)
	if draft.Name == "" {
		return draft, false
	}
	draft.Warnings = compactAIWarnings(draft.Warnings, 12)
	if draft.Price != nil && (*draft.Price < 0 || *draft.Price > 1_000_000_000) {
		draft.Price = nil
		draft.Warnings = append(draft.Warnings, "AI_WARNING_PRICE_INVALID")
	}
	draft.Currency = normalizeAIOptionalCurrency(draft.Currency, &draft.Warnings)
	draft.BillingCycle = normalizeAIOptionalEnum(draft.BillingCycle, isValidBillingCycle, "AI_WARNING_BILLING_CYCLE_INVALID", &draft.Warnings)
	draft.CustomCycleUnit = normalizeAIOptionalEnum(draft.CustomCycleUnit, isValidCustomCycleUnit, "AI_WARNING_CUSTOM_CYCLE_UNIT_INVALID", &draft.Warnings)
	draft.OneTimeTermUnit = normalizeAIOptionalEnum(draft.OneTimeTermUnit, isValidCustomCycleUnit, "AI_WARNING_ONE_TIME_TERM_UNIT_INVALID", &draft.Warnings)
	draft.Category = normalizeAIConfigValue(draft.Category, configContext.Categories)
	draft.Status = normalizeAIOptionalEnum(draft.Status, isValidSubscriptionStatus, "AI_WARNING_STATUS_INVALID", &draft.Warnings)
	draft.PaymentMethod = normalizeAIConfigValue(draft.PaymentMethod, configContext.PaymentMethods)
	draft.StartDate = normalizeAIOptionalDate(draft.StartDate, "startDate", &draft.Warnings)
	draft.NextBillingDate = normalizeAIOptionalDate(draft.NextBillingDate, "nextBillingDate", &draft.Warnings)
	draft.TrialEndDate = normalizeAIOptionalDate(draft.TrialEndDate, "trialEndDate", &draft.Warnings)
	draft.Website = normalizeAISuggestedField(draft.Website, 5000)
	draft.Notes = normalizeAINotesField(draft.Notes, 5000)
	draft.Tags = normalizeAITags(draft.Tags, draft.Name, configContext.Tags)
	if draft.ReminderDays != nil && (*draft.ReminderDays < disabledReminderDays || *draft.ReminderDays > maxReminderDays) {
		draft.ReminderDays = nil
		draft.Warnings = append(draft.Warnings, "AI_WARNING_REMINDER_DAYS_INVALID")
	}
	draft.RepeatReminderInterval = normalizeAIOptionalEnum(draft.RepeatReminderInterval, isValidRepeatReminderInterval, "AI_WARNING_REPEAT_INTERVAL_INVALID", &draft.Warnings)
	draft.RepeatReminderWindow = normalizeAIOptionalEnum(draft.RepeatReminderWindow, isValidRepeatReminderWindow, "AI_WARNING_REPEAT_WINDOW_INVALID", &draft.Warnings)
	if draft.Confidence != "high" {
		draft.Confidence = "low"
	}
	draft.Warnings = compactAIWarnings(draft.Warnings, 12)
	return draft, true
}

func missingDescribableAINoteNames(subscriptions []aiRecognizedSubscriptionDraft) []string {
	names := []string{}
	for _, draft := range subscriptions {
		if draft.Notes == nil && isDescribableForAINotes(draft) {
			names = append(names, draft.Name)
			if len(names) >= 20 {
				break
			}
		}
	}
	return names
}

func isDescribableForAINotes(draft aiRecognizedSubscriptionDraft) bool {
	return draft.Website != nil || draft.Category != nil || len(draft.Tags) > 0 || draft.Confidence == "high"
}

func fillMissingAINotesWithDynamicFallback(response aiRecognizeResponse, locale appLocale, configContext aiRecognitionConfigContext) aiRecognizeResponse {
	for index := range response.Subscriptions {
		draft := &response.Subscriptions[index]
		if draft.Notes != nil || !isDescribableForAINotes(*draft) {
			continue
		}
		note := buildDynamicAIFallbackNote(*draft, locale, configContext)
		if note == "" {
			continue
		}
		draft.Notes = &aiSuggestedTextField{Value: note, Source: "suggested"}
		filtered := []string{}
		for _, warning := range draft.Warnings {
			if warning != "AI_WARNING_NOTES_MISSING" {
				filtered = append(filtered, warning)
			}
		}
		draft.Warnings = compactAIWarnings(filtered, 12)
	}
	return response
}

func buildDynamicAIFallbackNote(draft aiRecognizedSubscriptionDraft, locale appLocale, configContext aiRecognitionConfigContext) string {
	labels := dynamicAINoteLabels(draft, configContext)
	var raw string
	if len(labels) > 0 {
		if locale == localeZhCN {
			raw = draft.Name + " 是提供 " + strings.Join(labels, "、") + "相关产品或服务的订阅服务。"
		} else {
			raw = draft.Name + " is a subscription service related to " + strings.Join(labels, ", ") + "."
		}
	} else {
		raw = dynamicAIWebsiteFallbackNote(draft, locale)
	}
	field := normalizeAINotesField(&aiSuggestedTextField{Value: raw, Source: "suggested"}, 5000)
	if field == nil {
		return ""
	}
	return field.Value
}

func dynamicAINoteLabels(draft aiRecognizedSubscriptionDraft, configContext aiRecognitionConfigContext) []string {
	labels := []string{}
	seen := map[string]bool{}
	add := func(value string) {
		label := trimMax(value, 80)
		key := aiRecognitionConfigMatchKey(label)
		if label == "" || key == "" || key == aiRecognitionConfigMatchKey(draft.Name) || seen[key] {
			return
		}
		seen[key] = true
		labels = append(labels, label)
	}
	for _, tag := range draft.Tags {
		add(tag)
	}
	if draft.Category != nil {
		if option := findAIRecognitionConfigOption(configContext.Categories, *draft.Category); option != nil {
			add(option.Label)
		} else {
			add(*draft.Category)
		}
	}
	if len(labels) > 3 {
		return labels[:3]
	}
	return labels
}

func dynamicAIWebsiteFallbackNote(draft aiRecognizedSubscriptionDraft, locale appLocale) string {
	if draft.Website == nil {
		return ""
	}
	host := aiRecognitionHostname(draft.Website.Value)
	if host == "" {
		return ""
	}
	if locale == localeZhCN {
		return draft.Name + " 是与 " + host + " 相关的在线服务。"
	}
	return draft.Name + " is an online service associated with " + host + "."
}

func aiRecognitionHostname(value string) string {
	text := strings.TrimSpace(value)
	if text == "" {
		return ""
	}
	if !strings.HasPrefix(text, "http://") && !strings.HasPrefix(text, "https://") {
		text = "https://" + text
	}
	parsed, err := url.Parse(text)
	if err != nil || parsed.Hostname() == "" {
		return ""
	}
	return strings.TrimPrefix(parsed.Hostname(), "www.")
}

func normalizeAIOptionalEnum(value *string, valid func(string) bool, warning string, warnings *[]string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	if !valid(trimmed) {
		*warnings = append(*warnings, warning)
		return nil
	}
	return &trimmed
}

func normalizeAIOptionalCurrency(value *string, warnings *[]string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.ToUpper(strings.TrimSpace(*value))
	if trimmed == "" {
		return nil
	}
	switch trimmed {
	case "元", "人民币", "RMB", "YUAN", "￥", "¥":
		trimmed = "CNY"
	}
	if !aiCurrencyPattern.MatchString(trimmed) {
		*warnings = append(*warnings, "AI_WARNING_CURRENCY_INVALID")
		return nil
	}
	return &trimmed
}

func normalizeAIOptionalDate(value *string, field string, warnings *[]string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	if !isValidDateOnly(trimmed) {
		*warnings = append(*warnings, "AI_WARNING_DATE_INVALID:"+field)
		return nil
	}
	return &trimmed
}

func normalizeAISuggestedField(field *aiSuggestedTextField, maxLen int) *aiSuggestedTextField {
	if field == nil {
		return nil
	}
	value := trimMax(field.Value, maxLen)
	if value == "" {
		return nil
	}
	source := strings.TrimSpace(field.Source)
	if source != "input" && source != "suggested" {
		source = "suggested"
	}
	return &aiSuggestedTextField{Value: value, Source: source}
}

func normalizeAINotesField(field *aiSuggestedTextField, maxLen int) *aiSuggestedTextField {
	normalized := normalizeAISuggestedField(field, maxLen)
	if normalized == nil {
		return nil
	}
	// AI 备注会进入订阅长期备注；这里兜底清掉识别过程和产品内视角，保留真实服务/网站简介。
	if isAIRecognitionProcessNote(normalized.Value) {
		return nil
	}
	value := stripAIRecognitionAdviceClauses(normalized.Value)
	if value == "" || isAIRecognitionProcessNote(value) || isAIRecognitionMarketingNote(value) {
		return nil
	}
	normalized.Value = trimMax(cleanAIRecognitionServiceDescription(value), maxLen)
	if normalized.Value == "" {
		return nil
	}
	return normalized
}

func isAIRecognitionProcessNote(value string) bool {
	key := aiRecognitionNoteMatchKey(value)
	if key == "" {
		return false
	}
	for _, fragment := range aiRecognitionProcessNoteFragments {
		if strings.Contains(key, fragment) {
			return true
		}
	}
	return false
}

func aiRecognitionNoteMatchKey(value string) string {
	var builder strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(value)) {
		if unicode.IsSpace(r) {
			continue
		}
		builder.WriteRune(r)
	}
	return builder.String()
}

func stripAIRecognitionAdviceClauses(value string) string {
	clauses := splitAIRecognitionNoteClauses(value)
	kept := []string{}
	for _, clause := range clauses {
		text := strings.TrimSpace(clause)
		if text == "" || aiRecognitionNoteContainsFragment(text, aiRecognitionNoteDropClauseFragments) {
			continue
		}
		kept = append(kept, text)
	}
	return strings.TrimSpace(strings.Join(kept, "，"))
}

func splitAIRecognitionNoteClauses(value string) []string {
	clauses := []string{}
	var builder strings.Builder
	for _, r := range value {
		if strings.ContainsRune("，,。.!?！？；;", r) {
			clauses = append(clauses, builder.String())
			builder.Reset()
			continue
		}
		builder.WriteRune(r)
	}
	clauses = append(clauses, builder.String())
	return clauses
}

func isAIRecognitionMarketingNote(value string) bool {
	return aiRecognitionNoteContainsFragment(value, aiRecognitionNoteMarketingFragments)
}

func aiRecognitionNoteContainsFragment(value string, fragments []string) bool {
	key := aiRecognitionNoteMatchKey(value)
	if key == "" {
		return false
	}
	for _, fragment := range fragments {
		if strings.Contains(key, fragment) {
			return true
		}
	}
	return false
}

func cleanAIRecognitionServiceDescription(value string) string {
	text := strings.ReplaceAll(value, "相关服务", "服务")
	text = strings.ReplaceAll(text, "等服务服务", "等服务")
	text = strings.ReplaceAll(text, "服务服务", "服务")
	return strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
}

func normalizeAITags(tags []string, subscriptionName string, existingTags []string) []string {
	out := []string{}
	seen := map[string]bool{}
	existing := aiRecognitionExistingTagMap(existingTags)
	serviceKey := aiRecognitionTagMatchKey(subscriptionName)
	for _, tag := range tags {
		value := trimMax(tag, 40)
		key := aiRecognitionTagMatchKey(value)
		if value == "" || seen[key] {
			continue
		}
		if existingValue, ok := existing[key]; ok {
			value = existingValue
		} else if !isUsefulAIGeneratedTag(value, key, serviceKey) {
			continue
		}
		seen[key] = true
		out = append(out, value)
		if len(out) >= 3 {
			break
		}
	}
	return out
}

func aiRecognitionExistingTagMap(tags []string) map[string]string {
	out := map[string]string{}
	for _, tag := range tags {
		value := trimMax(tag, 40)
		key := aiRecognitionTagMatchKey(value)
		if key != "" {
			if _, exists := out[key]; !exists {
				out[key] = value
			}
		}
	}
	return out
}

func aiRecognitionTagMatchKey(value string) string {
	return aiRecognitionConfigMatchKey(value)
}

func isUsefulAIGeneratedTag(value string, key string, serviceKey string) bool {
	if key == "" || (serviceKey != "" && key == serviceKey) {
		return false
	}
	runeCount := len([]rune(value))
	if runeCount < 2 || runeCount > 20 {
		return false
	}
	lower := strings.ToLower(strings.TrimSpace(value))
	if strings.Contains(lower, "://") || strings.HasPrefix(lower, "www.") || strings.ContainsAny(value, "#()（）[]【】/\\|:：") {
		return false
	}
	if aiNumberPattern.MatchString(value) || aiRecognitionLooksLikeBillingTag(lower) || aiRecognitionLooksLikeOrderAttributeTag(lower) {
		return false
	}
	if aiRecognitionIsShortHanTag(value) {
		return false
	}
	return true
}

func aiRecognitionLooksLikeBillingTag(value string) bool {
	for _, fragment := range []string{"usd", "cny", "rmb", "eur", "gbp", "jpy", "¥", "￥", "$", "月", "年", "weekly", "monthly", "annual", "账单", "价格", "付款", "支付", "扣费", "续费"} {
		if strings.Contains(value, fragment) {
			return true
		}
	}
	return false
}

func aiRecognitionLooksLikeOrderAttributeTag(value string) bool {
	for _, fragment := range []string{"special", "promo", "promotion", "plan", "套餐", "促销", "机房", "节点", "区域", "地区", "线路", "location", "region", "datacenter"} {
		if strings.Contains(value, fragment) {
			return true
		}
	}
	return false
}

func aiRecognitionIsShortHanTag(value string) bool {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > 2 {
		return false
	}
	for _, r := range runes {
		if !unicode.Is(unicode.Han, r) {
			return false
		}
	}
	return len(runes) > 0
}

func compactAIWarnings(warnings []string, maxCount int) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, warning := range warnings {
		value := trimMax(warning, 240)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
		if len(out) >= maxCount {
			break
		}
	}
	return out
}

func trimOptionalString(value *string, maxLen int) *string {
	if value == nil {
		return nil
	}
	trimmed := trimMax(*value, maxLen)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func normalizeAIConfigValue(value *string, options []aiRecognitionConfigOption) *string {
	trimmed := trimOptionalString(value, 80)
	if trimmed == nil {
		return nil
	}
	if matched := findAIRecognitionConfigOption(options, *trimmed); matched != nil {
		value := matched.Value
		return &value
	}
	return trimmed
}

func findAIRecognitionConfigOption(options []aiRecognitionConfigOption, text string) *aiRecognitionConfigOption {
	key := aiRecognitionConfigMatchKey(text)
	if key == "" {
		return nil
	}
	for index := range options {
		option := &options[index]
		if aiRecognitionConfigMatchKey(option.Value) == key ||
			aiRecognitionConfigMatchKey(option.Label) == key ||
			aiRecognitionConfigMatchKey(option.ZhCN) == key ||
			aiRecognitionConfigMatchKey(option.EnUS) == key {
			return option
		}
	}
	return nil
}

func aiRecognitionConfigMatchKey(value string) string {
	var builder strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(value)) {
		if unicode.IsSpace(r) || strings.ContainsRune("_-—–/\\|&+，,、.。:：()（）[]【】", r) {
			continue
		}
		builder.WriteRune(r)
	}
	return builder.String()
}

func trimMax(value string, maxLen int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > maxLen {
		runes = runes[:maxLen]
	}
	return string(runes)
}

func safeAIRecognitionError(err error) error {
	if err == nil {
		return nil
	}
	message := redactAIRecognitionSecrets(err.Error())
	if len([]rune(message)) > 500 {
		message = string([]rune(message)[:500])
	}
	return errors.New(message)
}

func safeAIRecognitionProviderMessage(err error) *string {
	if err == nil {
		return nil
	}
	message := safeAIRecognitionError(err).Error()
	return &message
}

func redactAIRecognitionSecrets(value string) string {
	return aiSecretPattern.ReplaceAllString(value, "[redacted]")
}

func normalizeAIGeneratedCurrency(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	upper := strings.ToUpper(trimmed)
	switch upper {
	case "元", "人民币", "RMB", "YUAN", "￥", "¥":
		upper = "CNY"
	}
	return &upper
}

func normalizeAIGeneratedBillingCycle(value *string) *string {
	if value == nil {
		return nil
	}
	text := strings.ToLower(strings.TrimSpace(*value))
	if text == "" || isValidBillingCycle(text) {
		if text == "" {
			return nil
		}
		return &text
	}
	compact := strings.Join(strings.Fields(text), "")
	var mapped string
	switch {
	case strings.Contains(compact, "week") || strings.Contains(compact, "周"):
		mapped = "weekly"
	case strings.Contains(compact, "quarter") || strings.Contains(compact, "季"):
		mapped = "quarterly"
	case strings.Contains(compact, "semi") || strings.Contains(compact, "half") || strings.Contains(compact, "半年"):
		mapped = "semi-annual"
	case strings.Contains(compact, "year") || strings.Contains(compact, "annual") || strings.Contains(compact, "年"):
		mapped = "annual"
	case strings.Contains(compact, "month") || strings.Contains(compact, "月"):
		mapped = "monthly"
	case strings.Contains(compact, "one-time") || strings.Contains(compact, "lifetime") || strings.Contains(compact, "一次") || strings.Contains(compact, "买断"):
		mapped = "one-time"
	}
	if mapped == "" {
		return value
	}
	return &mapped
}

func parseAIGeneratedPositiveInt(value interface{}, max int, warning string, warnings *[]string) *int {
	parsed, ok, valid := parseAIGeneratedInt(value)
	if !ok {
		if !valid {
			*warnings = append(*warnings, warning)
		}
		return nil
	}
	if parsed <= 0 || parsed > max {
		*warnings = append(*warnings, warning)
		return nil
	}
	return &parsed
}

func parseAIGeneratedBoundedInt(value interface{}, min int, max int, warning string, warnings *[]string) *int {
	parsed, ok, valid := parseAIGeneratedInt(value)
	if !ok {
		if !valid {
			*warnings = append(*warnings, warning)
		}
		return nil
	}
	if parsed < min || parsed > max {
		*warnings = append(*warnings, warning)
		return nil
	}
	return &parsed
}

func parseAIGeneratedInt(value interface{}) (int, bool, bool) {
	number, ok, valid := parseAIGeneratedNumber(value)
	if !ok {
		return 0, false, valid
	}
	return int(number), true, true
}

func parseAIGeneratedNumber(value interface{}) (float64, bool, bool) {
	switch typed := value.(type) {
	case nil:
		return 0, false, true
	case float64:
		return typed, true, true
	case float32:
		return float64(typed), true, true
	case int:
		return float64(typed), true, true
	case int64:
		return float64(typed), true, true
	case string:
		text := strings.ReplaceAll(strings.TrimSpace(typed), ",", "")
		if text == "" {
			return 0, false, true
		}
		match := aiNumberPattern.FindString(text)
		if match == "" {
			return 0, false, false
		}
		parsed, err := strconv.ParseFloat(match, 64)
		if err != nil {
			return 0, false, false
		}
		return parsed, true, true
	default:
		return 0, false, false
	}
}

func isAIRecognitionSchemaMismatchError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(aiRecognitionCauseError(err).Error())
	return strings.Contains(message, "no object generated") ||
		strings.Contains(message, "did not match schema") ||
		strings.Contains(message, "schema validation") ||
		strings.Contains(message, "invalid object") ||
		strings.Contains(message, "parsing structured output") ||
		strings.Contains(message, "cannot unmarshal")
}
