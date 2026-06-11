package main

// ai_provider_response.go 收敛 AI provider 原始响应回显契约。
//
// 该结构只随当前认证错误响应返回给前端，不写日志、不入库、不进导出；request headers/API key 仍不可回显。
import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/zendev-sh/goai"
)

type aiProviderResponse struct {
	Status        *int              `json:"status"`
	StatusText    *string           `json:"statusText"`
	Headers       map[string]string `json:"headers"`
	Body          *string           `json:"body"`
	BodyTruncated bool              `json:"bodyTruncated"`
}

func aiProviderResponseFromHTTPResponse(response *http.Response, body string) *aiProviderResponse {
	if response == nil {
		return nil
	}
	status := response.StatusCode
	return &aiProviderResponse{
		Status:        &status,
		StatusText:    optionalAIProviderHTTPStatusText(response),
		Headers:       aiProviderResponseHeaders(response.Header),
		Body:          optionalAIProviderBody(body),
		BodyTruncated: false,
	}
}

func aiProviderResponseFromError(err error) *aiProviderResponse {
	if err == nil {
		return nil
	}
	var apiErr *goai.APIError
	if errors.As(err, &apiErr) {
		status := apiErr.StatusCode
		return &aiProviderResponse{
			Status:        optionalAIProviderStatus(status),
			StatusText:    optionalAIProviderString(http.StatusText(status)),
			Headers:       aiProviderResponseHeaderMap(apiErr.ResponseHeaders),
			Body:          optionalAIProviderBody(apiErr.ResponseBody),
			BodyTruncated: false,
		}
	}
	var overflowErr *goai.ContextOverflowError
	if errors.As(err, &overflowErr) {
		return &aiProviderResponse{
			Status:        nil,
			StatusText:    nil,
			Headers:       nil,
			Body:          optionalAIProviderBody(overflowErr.ResponseBody),
			BodyTruncated: false,
		}
	}
	return nil
}

func aiProviderResponseHeaders(headers http.Header) map[string]string {
	if len(headers) == 0 {
		return nil
	}
	out := make(map[string]string, len(headers))
	for key, values := range headers {
		name := strings.TrimSpace(key)
		value := strings.TrimSpace(strings.Join(values, ", "))
		if name == "" || value == "" {
			continue
		}
		out[name] = value
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func aiProviderResponseHeaderMap(headers map[string]string) map[string]string {
	if len(headers) == 0 {
		return nil
	}
	out := make(map[string]string, len(headers))
	for key, value := range headers {
		name := strings.TrimSpace(key)
		text := strings.TrimSpace(value)
		if name == "" || text == "" {
			continue
		}
		out[name] = text
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func optionalAIProviderStatus(status int) *int {
	if status < 100 || status > 599 {
		return nil
	}
	return &status
}

func optionalAIProviderString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func optionalAIProviderHTTPStatusText(response *http.Response) *string {
	text := strings.TrimSpace(response.Status)
	prefix := strings.TrimSpace(response.Status[:min(len(response.Status), 3)])
	if prefix == strconv.Itoa(response.StatusCode) {
		if len(response.Status) > 3 {
			text = strings.TrimSpace(response.Status[3:])
		} else {
			text = ""
		}
	}
	if text == "" {
		text = http.StatusText(response.StatusCode)
	}
	return optionalAIProviderString(text)
}

func optionalAIProviderBody(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
