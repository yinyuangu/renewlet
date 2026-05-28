package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

func defaultSystemReleaseClient() systemReleaseClient {
	return &httpSystemReleaseClient{
		apiClient: &http.Client{Timeout: systemUpdateAPITimeout},
		downloadClient: &http.Client{
			Timeout: systemUpdateDownloadTimeout,
			CheckRedirect: func(request *http.Request, via []*http.Request) error {
				if len(via) >= 5 {
					return errors.New("too many redirects")
				}
				// GitHub Release 会跳到对象存储；每一跳都重验 host，避免可信首跳被开放重定向带出边界。
				return validateTrustedDownloadURL(request.URL.String())
			},
		},
	}
}

func (client *httpSystemReleaseClient) FetchLatestRelease(ctx context.Context) (*githubRelease, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/repos/"+systemUpdateRepository+"/releases/latest", nil)
	if err != nil {
		return nil, err
	}
	applyGitHubAPIHeaders(request)
	response, err := client.apiClient.Do(request)
	if err != nil {
		return nil, classifyGitHubNetworkError(err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, newGitHubAPIError(response)
	}
	var release githubRelease
	// Release API 是外部输入，限制 body 避免版本检查被异常响应拖垮常驻进程。
	decoder := json.NewDecoder(io.LimitReader(response.Body, 4<<20))
	if err := decoder.Decode(&release); err != nil {
		return nil, err
	}
	return &release, nil
}

func (client *httpSystemReleaseClient) DownloadFile(ctx context.Context, sourceURL string, targetPath string, maxBytes int64) error {
	if err := validateTrustedDownloadURL(sourceURL); err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", "Renewlet/"+Version)
	response, err := client.downloadClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("download returned %s", response.Status)
	}
	if response.ContentLength > maxBytes {
		return fmt.Errorf("download is too large")
	}
	// 下载产物先落 0600 临时文件；替换前不让同机其它用户读到半成品 binary 或 checksum 线索。
	target, err := os.OpenFile(targetPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer target.Close()
	if _, err := copyLimited(target, response.Body, maxBytes); err != nil {
		return err
	}
	return target.Sync()
}

func (client *httpSystemReleaseClient) FetchText(ctx context.Context, sourceURL string, maxBytes int64) ([]byte, error) {
	if err := validateTrustedDownloadURL(sourceURL); err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "Renewlet/"+Version)
	response, err := client.downloadClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("download returned %s", response.Status)
	}
	return io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
}

func validateTrustedDownloadURL(rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return err
	}
	if parsed.Scheme != "https" || parsed.User != nil {
		return errors.New("download URL must be https without userinfo")
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "github.com" || strings.HasSuffix(host, ".github.com") {
		return nil
	}
	if host == "githubusercontent.com" || strings.HasSuffix(host, ".githubusercontent.com") {
		return nil
	}
	return fmt.Errorf("download host %q is not trusted", host)
}

func applyGitHubAPIHeaders(request *http.Request) {
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", systemUpdateGitHubAPIVersion)
	request.Header.Set("User-Agent", "Renewlet/"+Version)
	if token := strings.TrimSpace(os.Getenv(systemUpdateGitHubTokenEnv)); token != "" {
		// GitHub 匿名 REST API 每 IP 共享低额度；管理员可配置只读 token 把版本检查从共享出口限流中解耦。
		request.Header.Set("Authorization", "Bearer "+token)
	}
}

func newGitHubAPIError(response *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	message := githubErrorMessage(body)
	apiError := &githubAPIError{
		statusCode:  response.StatusCode,
		status:      response.Status,
		message:     message,
		rateLimited: isGitHubRateLimited(response, message),
		retryAt:     githubRetryAt(response.Header, time.Now()),
	}
	return apiError
}

func githubErrorMessage(body []byte) string {
	var payload struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &payload); err == nil {
		return strings.TrimSpace(payload.Message)
	}
	return strings.TrimSpace(string(body))
}

func isGitHubRateLimited(response *http.Response, message string) bool {
	if response.StatusCode == http.StatusTooManyRequests {
		return true
	}
	if response.StatusCode != http.StatusForbidden {
		return false
	}
	if strings.EqualFold(response.Header.Get("X-RateLimit-Remaining"), "0") {
		return true
	}
	if strings.TrimSpace(response.Header.Get("Retry-After")) != "" {
		return true
	}
	normalizedMessage := strings.ToLower(message)
	return strings.Contains(normalizedMessage, "rate limit") || strings.Contains(normalizedMessage, "abuse")
}

func githubRetryAt(header http.Header, now time.Time) time.Time {
	if retryAfter := strings.TrimSpace(header.Get("Retry-After")); retryAfter != "" {
		if seconds, err := strconv.Atoi(retryAfter); err == nil && seconds > 0 {
			return now.Add(time.Duration(seconds) * time.Second)
		}
		if at, err := http.ParseTime(retryAfter); err == nil {
			return at
		}
	}
	if reset := strings.TrimSpace(header.Get("X-RateLimit-Reset")); reset != "" {
		if seconds, err := strconv.ParseInt(reset, 10, 64); err == nil && seconds > 0 {
			return time.Unix(seconds, 0)
		}
	}
	return time.Time{}
}

func classifyGitHubNetworkError(err error) error {
	if err == nil {
		return nil
	}
	var netError net.Error
	if errors.Is(err, io.EOF) || errors.As(err, &netError) {
		return &githubAPIError{message: err.Error()}
	}
	return err
}
