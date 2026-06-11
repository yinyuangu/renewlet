package main

// 云备份上游响应只随当前认证错误返回给操作者；不能写入 last_error、日志、导出或备份包。
import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
)

const cloudBackupProviderResponseBodyMaxBytes = 64 << 10

type cloudBackupProviderResponse struct {
	Status        *int              `json:"status"`
	StatusText    *string           `json:"statusText"`
	Headers       map[string]string `json:"headers"`
	Body          *string           `json:"body"`
	BodyTruncated bool              `json:"bodyTruncated"`
}

type cloudBackupErrorDetails struct {
	Reason           string                       `json:"reason"`
	ProviderMessage  *string                      `json:"providerMessage"`
	ProviderResponse *cloudBackupProviderResponse `json:"providerResponse"`
	ProviderAttempts []cloudBackupProviderAttempt `json:"providerAttempts,omitempty"`
	Diagnostics      map[string]string            `json:"diagnostics,omitempty"`
}

type cloudBackupProviderAttempt struct {
	Provider         string                       `json:"provider"`
	Code             string                       `json:"code"`
	Reason           string                       `json:"reason"`
	ProviderMessage  *string                      `json:"providerMessage"`
	ProviderResponse *cloudBackupProviderResponse `json:"providerResponse"`
}

type cloudBackupErrorResponse struct {
	Message string                   `json:"message"`
	Code    string                   `json:"code"`
	Details *cloudBackupErrorDetails `json:"details,omitempty"`
}

type cloudBackupRemoteError struct {
	code    string
	details *cloudBackupErrorDetails
}

func (err *cloudBackupRemoteError) Error() string {
	if err == nil {
		return ""
	}
	return err.code
}

func cloudBackupRemoteHTTPError(code string, response *http.Response, secrets ...string) error {
	return &cloudBackupRemoteError{
		code:    code,
		details: cloudBackupRemoteErrorDetails(code, response, secrets),
	}
}

func cloudBackupRemoteHTTPErrorFromProviderResponse(code string, response *cloudBackupProviderResponse) error {
	return &cloudBackupRemoteError{
		code:    code,
		details: cloudBackupRemoteErrorDetailsFromProviderResponse(code, response),
	}
}

func cloudBackupRemoteHTTPErrorFromProviderResponseWithDiagnostics(code string, response *cloudBackupProviderResponse, diagnostics map[string]string) error {
	details := cloudBackupRemoteErrorDetailsFromProviderResponse(code, response)
	details.Diagnostics = sanitizedCloudBackupDiagnostics(diagnostics)
	return &cloudBackupRemoteError{
		code:    code,
		details: details,
	}
}

func cloudBackupProviderAttemptsError(code string, reason string, message string, attempts []cloudBackupProviderAttempt) error {
	return &cloudBackupRemoteError{
		code: code,
		details: &cloudBackupErrorDetails{
			Reason:           reason,
			ProviderMessage:  optionalCloudBackupString(message),
			ProviderAttempts: attempts,
		},
	}
}

func cloudBackupProviderAttemptFromError(provider string, fallbackCode string, fallbackReason string, err error) cloudBackupProviderAttempt {
	if remoteErr := cloudBackupRemoteErrorFrom(err); remoteErr != nil {
		attempt := cloudBackupProviderAttempt{Provider: provider, Code: remoteErr.code, Reason: fallbackReason}
		if remoteErr.details != nil {
			attempt.Reason = remoteErr.details.Reason
			attempt.ProviderMessage = remoteErr.details.ProviderMessage
			attempt.ProviderResponse = remoteErr.details.ProviderResponse
		}
		return attempt
	}
	return cloudBackupProviderAttempt{
		Provider:        provider,
		Code:            fallbackCode,
		Reason:          fallbackReason,
		ProviderMessage: optionalCloudBackupString(err.Error()),
	}
}

func cloudBackupLocalErrorDetails(err error) *cloudBackupErrorDetails {
	return &cloudBackupErrorDetails{
		Reason:           "local_sdk_error",
		ProviderMessage:  optionalCloudBackupString(err.Error()),
		ProviderResponse: nil,
	}
}

func cloudBackupLocalErrorDetailsWithDiagnostics(err error, diagnostics map[string]string) *cloudBackupErrorDetails {
	details := cloudBackupLocalErrorDetails(err)
	details.Diagnostics = sanitizedCloudBackupDiagnostics(diagnostics)
	return details
}

func cloudBackupRemoteErrorDetails(code string, response *http.Response, secrets []string) *cloudBackupErrorDetails {
	providerResponse := cloudBackupProviderResponseFromHTTPResponse(response, secrets)
	return cloudBackupRemoteErrorDetailsFromProviderResponse(code, providerResponse)
}

func cloudBackupRemoteErrorDetailsFromProviderResponse(code string, providerResponse *cloudBackupProviderResponse) *cloudBackupErrorDetails {
	message := code
	if providerResponse != nil && providerResponse.Body != nil {
		message = *providerResponse.Body
	} else if providerResponse != nil && providerResponse.StatusText != nil {
		message = *providerResponse.StatusText
	}
	status := 0
	if providerResponse != nil && providerResponse.Status != nil {
		status = *providerResponse.Status
	}
	return &cloudBackupErrorDetails{
		Reason:           "http_" + strconv.Itoa(status),
		ProviderMessage:  optionalCloudBackupString(message),
		ProviderResponse: providerResponse,
	}
}

func cloudBackupProviderResponseFromHTTPResponse(response *http.Response, secrets []string) *cloudBackupProviderResponse {
	providerResponse, _ := cloudBackupProviderResponseAndBodyFromHTTPResponse(response, secrets)
	return providerResponse
}

func cloudBackupProviderResponseAndBodyFromHTTPResponse(response *http.Response, secrets []string) (*cloudBackupProviderResponse, string) {
	if response == nil {
		return nil, ""
	}
	body, truncated := readCloudBackupProviderResponseBody(response.Body)
	status := response.StatusCode
	return &cloudBackupProviderResponse{
		Status:        &status,
		StatusText:    optionalCloudBackupHTTPStatusText(response),
		Headers:       cloudBackupProviderResponseHeaders(response.Header, secrets),
		Body:          optionalCloudBackupRawString(redactCloudBackupSecrets(body, secrets)),
		BodyTruncated: truncated,
	}, body
}

func readCloudBackupProviderResponseBody(reader io.Reader) (string, bool) {
	if reader == nil {
		return "", false
	}
	data, err := io.ReadAll(io.LimitReader(reader, cloudBackupProviderResponseBodyMaxBytes+1))
	if err != nil {
		return "", false
	}
	if len(data) > cloudBackupProviderResponseBodyMaxBytes {
		return string(data[:cloudBackupProviderResponseBodyMaxBytes]), true
	}
	return string(data), false
}

func cloudBackupProviderResponseHeaders(headers http.Header, secrets []string) map[string]string {
	if len(headers) == 0 {
		return nil
	}
	out := make(map[string]string, len(headers))
	for key, values := range headers {
		name := strings.TrimSpace(key)
		value := redactCloudBackupSecrets(strings.TrimSpace(strings.Join(values, ", ")), secrets)
		if name == "" || value == "" || !safeCloudBackupProviderResponseHeader(name) {
			continue
		}
		out[name] = value
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func safeCloudBackupProviderResponseHeader(key string) bool {
	normalized := strings.ToLower(strings.TrimSpace(key))
	if normalized == "authorization" || normalized == "cookie" || normalized == "set-cookie" {
		return false
	}
	return !strings.Contains(normalized, "secret") &&
		!strings.Contains(normalized, "token") &&
		!strings.Contains(normalized, "credential") &&
		!strings.Contains(normalized, "signature") &&
		!strings.Contains(normalized, "accesskey") &&
		!strings.Contains(normalized, "access-key")
}

func optionalCloudBackupHTTPStatusText(response *http.Response) *string {
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
	return optionalCloudBackupString(text)
}

func optionalCloudBackupString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func optionalCloudBackupRawString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func redactCloudBackupSecrets(value string, secrets []string) string {
	out := value
	for _, secret := range normalizedCloudBackupSecrets(secrets) {
		out = strings.ReplaceAll(out, secret, "[redacted]")
	}
	return out
}

func normalizedCloudBackupSecrets(secrets []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, secret := range secrets {
		secret = strings.TrimSpace(secret)
		if len(secret) < 4 || seen[secret] {
			continue
		}
		seen[secret] = true
		out = append(out, secret)
	}
	return out
}

func sanitizedCloudBackupDiagnostics(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	out := map[string]string{}
	for key, value := range values {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key == "" || value == "" || !safeCloudBackupProviderResponseHeader(key) {
			continue
		}
		if len(value) > 512 {
			value = value[:512]
		}
		out[key] = value
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func cloudBackupRemoteErrorFrom(err error) *cloudBackupRemoteError {
	var remoteErr *cloudBackupRemoteError
	if errors.As(err, &remoteErr) {
		return remoteErr
	}
	return nil
}
