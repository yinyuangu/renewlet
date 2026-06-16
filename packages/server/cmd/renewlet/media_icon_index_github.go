package main

// media_icon_index_github.go 负责内置图标 provider 的 GitHub 版本探测。
//
// 架构位置：
//   - 管理员显式 check/refresh 才会触发这里的 GitHub 请求。
//   - active 索引仍保存在 PocketBase media_icon_indexes；版本探测失败不能清空旧索引。
//   - RENEWLET_GITHUB_TOKEN 只作为后端出站 header，任何错误响应都必须脱敏后再回显。
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// checkLatestBuiltInIconProviderVersion 读取缓存状态并按 ETag 探测 provider 最新 commit。
// not modified 时复用已保存 latest，避免共享出口重复消耗 GitHub API 配额。
func checkLatestBuiltInIconProviderVersion(ctx context.Context, app core.App, provider string) (*builtInIconProviderVersionResponse, string, error) {
	record, _ := findMediaIconIndexRecord(app)
	state := providerStatesFromRecord(record)[provider]
	version, etag, notModified, err := fetchLatestBuiltInIconProviderVersion(ctx, provider, state.ETag)
	if err != nil {
		return nil, "", err
	}
	if notModified && state.Latest != nil {
		return state.Latest, etag, nil
	}
	if version == nil {
		return nil, "", errors.New("latest provider version is unavailable")
	}
	return version, etag, nil
}

// fetchLatestBuiltInIconProviderVersion 只读取 GitHub metadata，不下载/托管 registry SVG 内容。
// TheSVG 的 latest release tag 只是展示辅助，active 版本仍以 commit SHA 为准。
func fetchLatestBuiltInIconProviderVersion(ctx context.Context, provider string, etag string) (*builtInIconProviderVersionResponse, string, bool, error) {
	config, ok := mediaResolverBuiltInProviderConfig(provider)
	if !ok {
		return nil, "", false, fmt.Errorf("unknown built-in icon provider: %s", provider)
	}
	commitURL := strings.TrimRight(builtInIconGitHubAPIBase, "/") + "/repos/" + config.Owner + "/" + config.Repo + "/commits/" + config.Branch
	var commit struct {
		SHA    string `json:"sha"`
		Commit struct {
			Committer struct {
				Date string `json:"date"`
			} `json:"committer"`
		} `json:"commit"`
	}
	nextETag, notModified, err := fetchGitHubJSON(ctx, commitURL, etag, &commit)
	if err != nil {
		return nil, nextETag, false, err
	}
	if notModified {
		return nil, nextETag, true, nil
	}
	if commit.SHA == "" {
		return nil, nextETag, false, errors.New("GitHub commit response missing sha")
	}
	shortSHA := commit.SHA
	if len(shortSHA) > 7 {
		shortSHA = shortSHA[:7]
	}
	version := &builtInIconProviderVersionResponse{
		SourceRef:          commit.SHA,
		DisplayVersion:     shortSHA,
		CommitSHA:          stringPtrOrNil(commit.SHA),
		CommitShortSHA:     stringPtrOrNil(shortSHA),
		CommitDate:         stringPtrOrNil(commit.Commit.Committer.Date),
		ReleaseTag:         nil,
		ReleasePublishedAt: nil,
	}
	if config.LatestRelease {
		tag, publishedAt := fetchLatestBuiltInIconRelease(ctx, config.Owner, config.Repo)
		if tag != "" {
			version.ReleaseTag = &tag
		}
		if publishedAt != "" {
			version.ReleasePublishedAt = &publishedAt
		}
	}
	return version, nextETag, false, nil
}

// fetchGitHubJSON 执行有界 GitHub JSON 请求。
// 响应体大小和 token 脱敏都在这里收敛，避免 provider check 把限流页或凭据带进前端详情。
func fetchGitHubJSON(ctx context.Context, url string, etag string, target any) (string, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", false, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "Renewlet/"+Version)
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	if token := strings.TrimSpace(os.Getenv("RENEWLET_GITHUB_TOKEN")); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{Timeout: builtInIconGitHubFetchTimeout}
	res, err := client.Do(req)
	if err != nil {
		secrets := []string{}
		if token := strings.TrimSpace(os.Getenv("RENEWLET_GITHUB_TOKEN")); token != "" {
			secrets = append(secrets, token)
		}
		return "", false, createUpstreamNetworkError("GitHub", err, secrets)
	}
	defer res.Body.Close()
	nextETag := res.Header.Get("ETag")
	if res.StatusCode == http.StatusNotModified {
		return nextETag, true, nil
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nextETag, false, gitHubVersionCheckHTTPError(res)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, builtInIconRegistryJSONLimitBytes+1))
	if err != nil {
		return nextETag, false, err
	}
	if len(data) > builtInIconRegistryJSONLimitBytes {
		return nextETag, false, errors.New("GitHub version check response too large")
	}
	if err := json.Unmarshal(data, target); err != nil {
		return nextETag, false, err
	}
	return nextETag, false, nil
}

// gitHubVersionCheckHTTPError 将 GitHub 限流/拒绝访问转换为可展示但不持久化的上游错误详情。
func gitHubVersionCheckHTTPError(res *http.Response) error {
	secrets := []string{}
	if token := strings.TrimSpace(os.Getenv("RENEWLET_GITHUB_TOKEN")); token != "" {
		secrets = append(secrets, token)
	}
	providerResponse, _, err := captureUpstreamProviderResponse(res, secrets)
	if err != nil {
		return err
	}
	providerMessage := upstreamProviderMessage(providerResponse)
	if res.StatusCode == http.StatusTooManyRequests || (res.StatusCode == http.StatusForbidden && res.Header.Get("X-RateLimit-Remaining") == "0") {
		message := fmt.Sprintf("GitHub API rate limited (HTTP %d). Configure RENEWLET_GITHUB_TOKEN for a higher limit", res.StatusCode)
		if retryHint := gitHubRateLimitRetryHint(res); retryHint != "" {
			message = fmt.Sprintf("GitHub API rate limited (HTTP %d). %s Configure RENEWLET_GITHUB_TOKEN for a higher limit", res.StatusCode, retryHint)
		}
		return newUpstreamOperationError(message, createUpstreamErrorDetails(providerResponse, fallbackText(providerMessage, message)))
	}
	if res.StatusCode == http.StatusForbidden {
		message := "GitHub API access denied (HTTP 403). Configure RENEWLET_GITHUB_TOKEN or retry later"
		return newUpstreamOperationError(message, createUpstreamErrorDetails(providerResponse, fallbackText(providerMessage, message)))
	}
	return createUpstreamHTTPError("GitHub", res, providerResponse, fallbackText(providerMessage, fmt.Sprintf("GitHub version check HTTP %d", res.StatusCode)))
}

// gitHubRateLimitRetryHint 只使用 GitHub 标准限流头构造短提示，不解析错误 body 中可能包含的额外信息。
func gitHubRateLimitRetryHint(res *http.Response) string {
	if retryAfter := strings.TrimSpace(res.Header.Get("Retry-After")); retryAfter != "" {
		return "Retry after " + retryAfter + "s."
	}
	resetRaw := strings.TrimSpace(res.Header.Get("X-RateLimit-Reset"))
	if resetRaw == "" {
		return ""
	}
	resetUnix, err := strconv.ParseInt(resetRaw, 10, 64)
	if err != nil || resetUnix <= 0 {
		return ""
	}
	return "Retry after " + time.Unix(resetUnix, 0).UTC().Format(time.RFC3339) + "."
}

// fetchLatestBuiltInIconRelease 仅作为展示补充；失败时静默回落 commit metadata，不能阻断 provider check。
func fetchLatestBuiltInIconRelease(ctx context.Context, owner string, repo string) (string, string) {
	url := strings.TrimRight(builtInIconGitHubAPIBase, "/") + "/repos/" + owner + "/" + repo + "/releases/latest"
	var release struct {
		TagName     string `json:"tag_name"`
		PublishedAt string `json:"published_at"`
	}
	_, _, err := fetchGitHubJSON(ctx, url, "", &release)
	if err != nil {
		return "", ""
	}
	return strings.TrimSpace(release.TagName), strings.TrimSpace(release.PublishedAt)
}

// builtInIconProviderGitHubConfig 是 shared media resolver 配置在 Go 侧的最小 GitHub 投影。
type builtInIconProviderGitHubConfig struct {
	Owner         string
	Repo          string
	Branch        string
	LatestRelease bool
}

// mediaResolverBuiltInProviderConfig 从生成期 media resolver 配置读取 provider 对应的 GitHub 来源。
func mediaResolverBuiltInProviderConfig(provider string) (builtInIconProviderGitHubConfig, bool) {
	for _, item := range mediaResolverCfg.BuiltInProviders {
		if item.Provider == provider {
			return builtInIconProviderGitHubConfig{
				Owner:         item.GitHub.Owner,
				Repo:          item.GitHub.Repo,
				Branch:        item.GitHub.Branch,
				LatestRelease: item.GitHub.LatestRelease,
			}, true
		}
	}
	return builtInIconProviderGitHubConfig{}, false
}
