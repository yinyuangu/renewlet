package main

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	systemUpdateRepository       = "zhiyingzzhou/renewlet"
	systemUpdateGitHubAPIVersion = "2026-03-10"
	systemUpdateGitHubTokenEnv   = "RENEWLET_GITHUB_TOKEN"
	systemUpdateCacheTTL         = 20 * time.Minute
	systemUpdateAPITimeout       = 15 * time.Second
	systemUpdateDownloadTimeout  = 2 * time.Minute
	systemUpdateMaxArchiveBytes  = 200 * 1024 * 1024
	systemUpdateMaxChecksumBytes = 2 * 1024 * 1024
	defaultSelfUpdateBinaryPath  = "/opt/renewlet/current/renewlet"
	defaultSelfUpdateBackupDir   = "/opt/renewlet/backups"
)

var (
	errSystemUpdateUnsupported = errors.New("system update unsupported")
	errSystemUpdateNoUpdate    = errors.New("system update no update")
	errSystemUpdateInProgress  = errors.New("system update in progress")
	errSystemNoStableRelease   = errors.New("system update no stable release")

	defaultSystemUpdateService = newSystemUpdateService(defaultSystemReleaseClient())
)

type systemUpdateError struct {
	kind    error
	message string
}

func (e systemUpdateError) Error() string {
	return e.message
}

func (e systemUpdateError) Is(target error) bool {
	return target == e.kind
}

type systemReleaseClient interface {
	FetchLatestRelease(ctx context.Context) (*githubRelease, error)
	DownloadFile(ctx context.Context, sourceURL string, targetPath string, maxBytes int64) error
	FetchText(ctx context.Context, sourceURL string, maxBytes int64) ([]byte, error)
}

type systemUpdateService struct {
	client      systemReleaseClient
	now         func() time.Time
	exit        func(int)
	restartWait time.Duration

	cacheMu     sync.Mutex
	cacheValue  *systemVersionResponse
	cacheExpiry time.Time

	updateMu       sync.Mutex
	updateInFlight bool
}

type githubRelease struct {
	TagName     string        `json:"tag_name"`
	Name        string        `json:"name"`
	Body        string        `json:"body"`
	PublishedAt string        `json:"published_at"`
	HTMLURL     string        `json:"html_url"`
	Prerelease  bool          `json:"prerelease"`
	Draft       bool          `json:"draft"`
	Assets      []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

type githubAPIError struct {
	statusCode  int
	status      string
	message     string
	rateLimited bool
	retryAt     time.Time
}

func (e *githubAPIError) Error() string {
	if strings.TrimSpace(e.message) == "" {
		return "GitHub release API returned " + e.status
	}
	return "GitHub release API returned " + e.status + ": " + e.message
}

type fetchedSystemRelease struct {
	dto    *systemReleaseInfoDTO
	assets []githubAsset
}

type systemUpdateCapability struct {
	runtime           string
	supported         bool
	unsupportedReason string
	binaryPath        string
	backupDir         string
}

type semanticVersion struct {
	major      int
	minor      int
	patch      int
	prerelease string
}

type httpSystemReleaseClient struct {
	apiClient      *http.Client
	downloadClient *http.Client
}
