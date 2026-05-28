package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type fakeSystemReleaseClient struct {
	release     *githubRelease
	fetchDelay  time.Duration
	fetchCount  int32
	downloadFn  func(targetPath string) error
	checksumTxt []byte
}

func (client *fakeSystemReleaseClient) FetchLatestRelease(ctx context.Context) (*githubRelease, error) {
	atomic.AddInt32(&client.fetchCount, 1)
	if client.fetchDelay > 0 {
		select {
		case <-time.After(client.fetchDelay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if client.release == nil {
		return nil, errors.New("missing release")
	}
	return client.release, nil
}

func (client *fakeSystemReleaseClient) DownloadFile(_ context.Context, _ string, targetPath string, _ int64) error {
	if client.downloadFn != nil {
		return client.downloadFn(targetPath)
	}
	return errors.New("download not configured")
}

func (client *fakeSystemReleaseClient) FetchText(_ context.Context, _ string, _ int64) ([]byte, error) {
	return client.checksumTxt, nil
}

func TestSystemVersionComparison(t *testing.T) {
	cases := []struct {
		name    string
		current string
		latest  string
		want    bool
	}{
		{name: "patch update", current: "0.1.0", latest: "0.1.1", want: true},
		{name: "minor update", current: "0.1.9", latest: "0.2.0", want: true},
		{name: "equal stable", current: "0.1.0", latest: "0.1.0", want: false},
		{name: "ignore latest prerelease", current: "0.1.0", latest: "0.2.0-rc.1", want: false},
		{name: "release beats current prerelease", current: "0.2.0-rc.1", latest: "0.2.0", want: true},
		{name: "invalid current is not updateable", current: "dev", latest: "0.2.0", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isNewerSystemVersion(tc.current, tc.latest); got != tc.want {
				t.Fatalf("isNewerSystemVersion(%q, %q) = %v, want %v", tc.current, tc.latest, got, tc.want)
			}
		})
	}
}

func TestSelectSystemUpdateAssets(t *testing.T) {
	archiveName := systemArchiveName("1.2.3")
	archive, checksum, err := selectSystemUpdateAssets([]githubAsset{
		{Name: archiveName, BrowserDownloadURL: "https://github.com/zhiyingzzhou/renewlet/releases/download/v1.2.3/" + archiveName},
		{Name: "checksums.txt", BrowserDownloadURL: "https://github.com/zhiyingzzhou/renewlet/releases/download/v1.2.3/checksums.txt"},
	}, "1.2.3")
	if err != nil {
		t.Fatal(err)
	}
	if archive.Name != archiveName || checksum.Name != "checksums.txt" {
		t.Fatalf("unexpected assets: %#v %#v", archive, checksum)
	}
}

func TestGitHubReleaseRequestUsesVersionedAPIHeadersAndOptionalToken(t *testing.T) {
	t.Setenv(systemUpdateGitHubTokenEnv, "ghp_test")
	var captured *http.Request
	client := &httpSystemReleaseClient{
		apiClient: &http.Client{
			Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
				captured = request
				return &http.Response{
					StatusCode: http.StatusOK,
					Status:     "200 OK",
					Header:     make(http.Header),
					Body: io.NopCloser(strings.NewReader(`{
						"tag_name":"v1.2.3",
						"name":"Renewlet 1.2.3",
						"body":"",
						"published_at":"2026-05-27T00:00:00Z",
						"html_url":"https://github.com/zhiyingzzhou/renewlet/releases/tag/v1.2.3",
						"prerelease":false,
						"draft":false,
						"assets":[]
					}`)),
				}, nil
			}),
		},
	}
	if _, err := client.FetchLatestRelease(context.Background()); err != nil {
		t.Fatal(err)
	}
	if captured == nil {
		t.Fatal("expected request to be captured")
	}
	if got := captured.Header.Get("Accept"); got != "application/vnd.github+json" {
		t.Fatalf("Accept = %q", got)
	}
	if got := captured.Header.Get("X-GitHub-Api-Version"); got != systemUpdateGitHubAPIVersion {
		t.Fatalf("X-GitHub-Api-Version = %q", got)
	}
	if got := captured.Header.Get("User-Agent"); got == "" || !strings.HasPrefix(got, "Renewlet/") {
		t.Fatalf("User-Agent = %q", got)
	}
	if got := captured.Header.Get("Authorization"); got != "Bearer ghp_test" {
		t.Fatalf("Authorization = %q", got)
	}
}

func TestSystemVersionWarningDoesNotExposeGitHubStatus(t *testing.T) {
	service := newSystemUpdateService(&fakeSystemReleaseClient{})
	service.now = func() time.Time { return time.Unix(1_779_820_800, 0) }
	warning := service.versionCheckWarning(localeZhCN, &githubAPIError{
		statusCode:  http.StatusForbidden,
		status:      "403 Forbidden",
		rateLimited: true,
		retryAt:     service.now().Add(time.Hour),
	})

	if strings.Contains(warning, "403") || strings.Contains(warning, "Forbidden") {
		t.Fatalf("warning leaked HTTP status: %q", warning)
	}
	if !strings.Contains(warning, systemUpdateGitHubTokenEnv) {
		t.Fatalf("warning should mention token fallback, got %q", warning)
	}
}

func TestChecksumForArchive(t *testing.T) {
	hash := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	got, err := checksumForArchive("renewlet_1.0.0_linux_amd64.tar.gz", []byte(hash+"  renewlet_1.0.0_linux_amd64.tar.gz\n"))
	if err != nil {
		t.Fatal(err)
	}
	if got != hash {
		t.Fatalf("checksum = %q, want %q", got, hash)
	}
}

func TestExtractRenewletBinaryRejectsPathTraversal(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "bad.tar.gz")
	if err := writeTarGz(archivePath, map[string]string{"../../renewlet": "evil"}); err != nil {
		t.Fatal(err)
	}
	targetPath := filepath.Join(t.TempDir(), "renewlet")
	if err := extractRenewletBinary(archivePath, targetPath); err == nil {
		t.Fatal("expected path traversal archive to be rejected")
	}
}

func TestReplaceRenewletBinaryRestoresOnFailure(t *testing.T) {
	tempDir := t.TempDir()
	binaryPath := filepath.Join(tempDir, "renewlet")
	backupDir := filepath.Join(tempDir, "backups")
	newBinaryPath := filepath.Join(t.TempDir(), "missing-renewlet")
	if err := os.WriteFile(binaryPath, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := replaceRenewletBinary(binaryPath, backupDir, newBinaryPath, "1.0.0"); err == nil {
		t.Fatal("expected replace to fail")
	}
	content, err := os.ReadFile(binaryPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "old" {
		t.Fatalf("binary content = %q, want old", string(content))
	}
}

func TestSystemUpdateRejectsConcurrentRun(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("self-update execution is only supported for linux Docker images")
	}
	release := &githubRelease{
		TagName: "v9.9.9",
		Assets: []githubAsset{
			{Name: systemArchiveName("9.9.9"), BrowserDownloadURL: "https://github.com/zhiyingzzhou/renewlet/releases/download/v9.9.9/" + systemArchiveName("9.9.9")},
			{Name: "checksums.txt", BrowserDownloadURL: "https://github.com/zhiyingzzhou/renewlet/releases/download/v9.9.9/checksums.txt"},
		},
	}
	tempDir := t.TempDir()
	binaryPath := filepath.Join(tempDir, "renewlet")
	if err := os.WriteFile(binaryPath, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("RENEWLET_SELF_UPDATE_ENABLED", "true")
	t.Setenv("RENEWLET_SELF_UPDATE_BINARY", binaryPath)
	t.Setenv("RENEWLET_SELF_UPDATE_BACKUP_DIR", filepath.Join(tempDir, "backups"))
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "1.0.0", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	client := &fakeSystemReleaseClient{release: release, fetchDelay: 200 * time.Millisecond}
	service := newSystemUpdateService(client)
	service.downloadFnForTest("renewlet-new")

	errCh := make(chan error, 2)
	go func() {
		_, err := service.PerformUpdate(context.Background(), localeZhCN)
		errCh <- err
	}()
	time.Sleep(20 * time.Millisecond)
	go func() {
		_, err := service.PerformUpdate(context.Background(), localeZhCN)
		errCh <- err
	}()

	first := <-errCh
	second := <-errCh
	if !(errors.Is(first, errSystemUpdateInProgress) || errors.Is(second, errSystemUpdateInProgress)) {
		t.Fatalf("expected one concurrent update error, got %v and %v", first, second)
	}
}

func (service *systemUpdateService) downloadFnForTest(binaryContent string) {
	if fake, ok := service.client.(*fakeSystemReleaseClient); ok {
		fake.downloadFn = func(targetPath string) error {
			if err := writeTarGz(targetPath, map[string]string{"renewlet": binaryContent}); err != nil {
				return err
			}
			content, err := os.ReadFile(targetPath)
			if err != nil {
				return err
			}
			sum := sha256.Sum256(content)
			fake.checksumTxt = []byte(hex.EncodeToString(sum[:]) + "  " + filepath.Base(targetPath) + "\n")
			return nil
		}
	}
}

func writeTarGz(path string, files map[string]string) error {
	var buffer bytes.Buffer
	gzipWriter := gzip.NewWriter(&buffer)
	tarWriter := tar.NewWriter(gzipWriter)
	for name, content := range files {
		if err := tarWriter.WriteHeader(&tar.Header{
			Name: name,
			Mode: 0o755,
			Size: int64(len(content)),
		}); err != nil {
			return err
		}
		if _, err := tarWriter.Write([]byte(content)); err != nil {
			return err
		}
	}
	if err := tarWriter.Close(); err != nil {
		return err
	}
	if err := gzipWriter.Close(); err != nil {
		return err
	}
	return os.WriteFile(path, buffer.Bytes(), 0o644)
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}
