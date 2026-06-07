package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

func readAIRecognitionMultipart(e *core.RequestEvent, locale appLocale) (aiRecognitionInput, error) {
	maxBodyBytes := int64(aiRecognitionMaxTextChars*4 + aiRecognitionMaxImages*aiRecognitionMaxImageBytes + aiRecognitionMultipartOverhead)
	e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, maxBodyBytes)
	reader, err := e.Request.MultipartReader()
	if err != nil {
		return aiRecognitionInput{}, err
	}
	var input aiRecognitionInput
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			if strings.Contains(err.Error(), "request body too large") {
				return aiRecognitionInput{}, errAIRecognitionBodyTooLarge
			}
			return aiRecognitionInput{}, err
		}
		if err := readAIRecognitionPart(part, &input, locale); err != nil {
			return aiRecognitionInput{}, err
		}
	}
	input.Text = strings.TrimSpace(input.Text)
	if len([]rune(input.Text)) > aiRecognitionMaxTextChars {
		return aiRecognitionInput{}, errAIRecognitionBodyTooLarge
	}
	if input.Text == "" && len(input.Images) == 0 {
		return aiRecognitionInput{}, errAIRecognitionInputEmpty
	}
	return input, nil
}

func readAIRecognitionPart(part *multipart.Part, input *aiRecognitionInput, locale appLocale) error {
	defer func() { _ = part.Close() }()
	switch part.FormName() {
	case "text":
		data, err := readLimitedPartBytes(part, aiRecognitionMaxTextChars*4)
		if err != nil {
			return err
		}
		input.Text = string(data)
	case "thinkingControl":
		data, err := readLimitedPartBytes(part, aiRecognitionThinkingControlMax)
		if err != nil {
			return err
		}
		control, err := parseAIThinkingControl(data, locale)
		if err != nil {
			return err
		}
		input.ThinkingControl = control
	case "images", "images[]":
		if len(input.Images) >= aiRecognitionMaxImages {
			return errAIRecognitionBodyTooLarge
		}
		data, err := readLimitedPartBytes(part, aiRecognitionMaxImageBytes)
		if err != nil {
			return err
		}
		if len(data) == 0 {
			return nil
		}
		mediaType, err := normalizeAIRecognitionImageType(part.Header.Get("Content-Type"), data)
		if err != nil {
			return err
		}
		input.Images = append(input.Images, aiRecognitionImage{
			MediaType: mediaType,
			DataURL:   fmt.Sprintf("data:%s;base64,%s", mediaType, base64.StdEncoding.EncodeToString(data)),
			SizeBytes: len(data),
		})
	case "":
		return errors.New("AI_RECOGNITION_MULTIPART_FIELD_INVALID")
	default:
		return errors.New("AI_RECOGNITION_MULTIPART_FIELD_INVALID")
	}
	return nil
}

func readLimitedPartBytes(reader io.Reader, maxBytes int) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, int64(maxBytes)+1))
	if err != nil {
		if strings.Contains(err.Error(), "request body too large") {
			return nil, errAIRecognitionBodyTooLarge
		}
		return nil, err
	}
	if len(data) > maxBytes {
		return nil, errAIRecognitionBodyTooLarge
	}
	return data, nil
}

func normalizeAIRecognitionImageType(header string, data []byte) (string, error) {
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(header, ";")[0]))
	if isAllowedAIRecognitionImageType(contentType) {
		return contentType, nil
	}
	detected := strings.ToLower(http.DetectContentType(data[:minInt(len(data), 512)]))
	if isAllowedAIRecognitionImageType(detected) {
		return detected, nil
	}
	return "", errors.New("AI_RECOGNITION_IMAGE_TYPE_INVALID")
}

func isAllowedAIRecognitionImageType(value string) bool {
	return value == "image/png" || value == "image/jpeg" || value == "image/webp"
}

func parseAIThinkingControl(data []byte, locale appLocale) (*aiThinkingControl, error) {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" || trimmed == "null" {
		return nil, nil
	}
	control, err := decodeStrictJSONFromBytes[aiThinkingControl]([]byte(trimmed), locale, false)
	if err != nil {
		return nil, err
	}
	if err := validateAIThinkingControl(&control); err != nil {
		return nil, err
	}
	return &control, nil
}

func validateAIThinkingControl(control *aiThinkingControl) error {
	if control == nil {
		return nil
	}
	switch control.Provider {
	case "openai":
		if !slices.Contains([]string{"none", "minimal", "low", "medium", "high", "xhigh"}, control.Effort) {
			return errors.New("AI_THINKING_CONTROL_INVALID")
		}
	case "gemini":
		switch control.Mode {
		case "off", "dynamic":
			return nil
		case "budget":
			if control.Budget == nil || *control.Budget < 1 || *control.Budget > 32768 {
				return errors.New("AI_THINKING_CONTROL_INVALID")
			}
		case "level":
			if !slices.Contains([]string{"minimal", "low", "medium", "high"}, control.Level) {
				return errors.New("AI_THINKING_CONTROL_INVALID")
			}
		default:
			return errors.New("AI_THINKING_CONTROL_INVALID")
		}
	case "anthropic":
		switch control.Mode {
		case "effort":
			if !slices.Contains([]string{"low", "medium", "high", "xhigh", "max"}, control.Effort) {
				return errors.New("AI_THINKING_CONTROL_INVALID")
			}
		case "budget":
			if control.BudgetTokens == nil || *control.BudgetTokens < 1024 || *control.BudgetTokens > 64000 {
				return errors.New("AI_THINKING_CONTROL_INVALID")
			}
		default:
			return errors.New("AI_THINKING_CONTROL_INVALID")
		}
	default:
		return errors.New("AI_THINKING_CONTROL_INVALID")
	}
	return nil
}

func sanitizeAIRecognitionSettings(settings aiRecognitionSettings) aiRecognitionSettings {
	settings.Provider = strings.TrimSpace(settings.Provider)
	if !isValidAIRecognitionProvider(settings.Provider) {
		settings.Provider = "openai"
	}
	settings.Model = strings.TrimSpace(settings.Model)
	settings.ModelInputMode = strings.TrimSpace(settings.ModelInputMode)
	if settings.ModelInputMode != "manual" {
		settings.ModelInputMode = "select"
	}
	settings.BaseURL = sanitizeAIRecognitionBaseURL(settings.BaseURL)
	settings.APIKey = strings.TrimSpace(settings.APIKey)
	if settings.DefaultThinkingControl != nil {
		if err := validateAIThinkingControl(settings.DefaultThinkingControl); err != nil || settings.DefaultThinkingControl.Provider != settings.Provider {
			settings.DefaultThinkingControl = nil
		}
	}
	return settings
}

func isValidAIRecognitionProvider(value string) bool {
	return value == "openai" || value == "gemini" || value == "anthropic" || value == "openai-compatible"
}

func sanitizeAIRecognitionBaseURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return ""
	}
	return value
}

func validateAIRecognitionSettings(settings aiRecognitionSettings, locale appLocale) error {
	settings = sanitizeAIRecognitionSettings(settings)
	if settings.Model == "" {
		return errors.New(serverText(locale, "aiRecognition.modelRequired"))
	}
	if settings.Provider == "openai-compatible" {
		if settings.BaseURL == "" {
			return errors.New(serverText(locale, "aiRecognition.baseUrlRequired"))
		}
		return nil
	}
	if settings.APIKey == "" {
		return errors.New(serverText(locale, "aiRecognition.apiKeyRequired"))
	}
	return nil
}
