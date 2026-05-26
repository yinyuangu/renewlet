package main

import (
	"archive/tar"
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

func newSystemUpdateService(client systemReleaseClient) *systemUpdateService {
	return &systemUpdateService{
		client:      client,
		now:         time.Now,
		exit:        os.Exit,
		restartWait: 800 * time.Millisecond,
	}
}

func (service *systemUpdateService) CheckVersion(ctx context.Context, locale appLocale, force bool) (*systemVersionResponse, error) {
	if !force {
		if cached := service.cachedVersion(); cached != nil {
			return cached, nil
		}
	}

	response := service.baseVersionResponse(locale)
	release, err := service.fetchLatestRelease(ctx)
	if err != nil {
		if cached := service.cachedVersion(); cached != nil {
			cached.Warning = tr(locale, "版本检查暂时失败，正在展示缓存结果："+err.Error(), "Version check failed; showing cached result: "+err.Error())
			return cached, nil
		}
		response.Warning = err.Error()
		return response, nil
	}

	response.ReleaseInfo = release.dto
	response.LatestVersion = release.dto.Version
	response.HasUpdate = isNewerSystemVersion(Version, release.dto.Version)
	service.storeVersion(response)
	return cloneSystemVersionResponse(response, false), nil
}

func (service *systemUpdateService) PerformUpdate(ctx context.Context, locale appLocale) (*systemUpdateResponse, error) {
	if !service.beginUpdate() {
		return nil, systemUpdateError{kind: errSystemUpdateInProgress, message: tr(locale, "已有系统更新正在执行", "A system update is already running")}
	}
	defer service.endUpdate()

	capability := selfUpdateCapability(locale)
	if !capability.supported {
		return nil, systemUpdateError{kind: errSystemUpdateUnsupported, message: capability.unsupportedReason}
	}
	release, err := service.fetchLatestRelease(ctx)
	if err != nil {
		return nil, err
	}
	if !isNewerSystemVersion(Version, release.dto.Version) {
		return nil, systemUpdateError{kind: errSystemUpdateNoUpdate, message: tr(locale, "当前已经是最新版本", "Renewlet is already up to date")}
	}

	archiveAsset, checksumAsset, err := selectSystemUpdateAssets(release.assets, release.dto.Version)
	if err != nil {
		return nil, err
	}
	if err := validateTrustedDownloadURL(archiveAsset.BrowserDownloadURL); err != nil {
		return nil, fmt.Errorf("invalid archive URL: %w", err)
	}
	if err := validateTrustedDownloadURL(checksumAsset.BrowserDownloadURL); err != nil {
		return nil, fmt.Errorf("invalid checksum URL: %w", err)
	}

	tempDir, err := os.MkdirTemp(filepath.Dir(capability.binaryPath), ".renewlet-update-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tempDir)

	archivePath := filepath.Join(tempDir, archiveAsset.Name)
	if err := service.client.DownloadFile(ctx, archiveAsset.BrowserDownloadURL, archivePath, systemUpdateMaxArchiveBytes); err != nil {
		return nil, err
	}
	checksumText, err := service.client.FetchText(ctx, checksumAsset.BrowserDownloadURL, systemUpdateMaxChecksumBytes)
	if err != nil {
		return nil, err
	}
	if int64(len(checksumText)) > systemUpdateMaxChecksumBytes {
		return nil, errors.New("checksums.txt is too large")
	}
	if err := verifySystemUpdateChecksum(archivePath, archiveAsset.Name, checksumText); err != nil {
		return nil, err
	}

	newBinaryPath := filepath.Join(tempDir, "renewlet.new")
	if err := extractRenewletBinary(archivePath, newBinaryPath); err != nil {
		return nil, err
	}
	if err := replaceRenewletBinary(capability.binaryPath, capability.backupDir, newBinaryPath, Version); err != nil {
		return nil, err
	}

	service.clearCache()
	return &systemUpdateResponse{
		OK:             true,
		CurrentVersion: Version,
		TargetVersion:  release.dto.Version,
		NeedsRestart:   true,
		Message:        tr(locale, "更新已完成，Renewlet 将自动重启。", "Update completed. Renewlet will restart automatically."),
	}, nil
}

func (service *systemUpdateService) ScheduleRestart() {
	if envBool("RENEWLET_SELF_UPDATE_DISABLE_EXIT", false) {
		return
	}
	go func() {
		// 响应已经写回浏览器后再退出；Docker restart 策略负责把新二进制作为唯一运行面拉起。
		time.Sleep(service.restartWait)
		service.exit(0)
	}()
}

func (service *systemUpdateService) baseVersionResponse(locale appLocale) *systemVersionResponse {
	capability := selfUpdateCapability(locale)
	return &systemVersionResponse{
		CurrentVersion:    Version,
		LatestVersion:     Version,
		HasUpdate:         false,
		Runtime:           capability.runtime,
		UpdateSupported:   capability.supported,
		UnsupportedReason: capability.unsupportedReason,
		ReleaseInfo:       nil,
		Cached:            false,
		Build: systemBuildInfo{
			Version:   Version,
			Commit:    Commit,
			BuildTime: BuildTime,
			BuildType: BuildType,
		},
	}
}

func (service *systemUpdateService) fetchLatestRelease(ctx context.Context) (*fetchedSystemRelease, error) {
	release, err := service.client.FetchLatestRelease(ctx)
	if err != nil {
		return nil, err
	}
	version, parsed, ok := parseSystemVersion(release.TagName)
	if !ok || parsed.prerelease != "" || release.Prerelease || release.Draft {
		return nil, fmt.Errorf("latest GitHub release is not a stable Renewlet release")
	}
	assets := make([]systemReleaseAssetDTO, 0, len(release.Assets))
	for _, asset := range release.Assets {
		assets = append(assets, systemReleaseAssetDTO{Name: asset.Name, Size: asset.Size})
	}
	return &fetchedSystemRelease{
		dto: &systemReleaseInfoDTO{
			TagName:     release.TagName,
			Version:     version,
			Name:        release.Name,
			Body:        release.Body,
			PublishedAt: release.PublishedAt,
			HTMLURL:     release.HTMLURL,
			Assets:      assets,
		},
		assets: release.Assets,
	}, nil
}

func (service *systemUpdateService) cachedVersion() *systemVersionResponse {
	service.cacheMu.Lock()
	defer service.cacheMu.Unlock()
	if service.cacheValue == nil || !service.now().Before(service.cacheExpiry) {
		return nil
	}
	return cloneSystemVersionResponse(service.cacheValue, true)
}

func (service *systemUpdateService) storeVersion(response *systemVersionResponse) {
	service.cacheMu.Lock()
	defer service.cacheMu.Unlock()
	service.cacheValue = cloneSystemVersionResponse(response, false)
	service.cacheExpiry = service.now().Add(systemUpdateCacheTTL)
}

func (service *systemUpdateService) clearCache() {
	service.cacheMu.Lock()
	defer service.cacheMu.Unlock()
	service.cacheValue = nil
	service.cacheExpiry = time.Time{}
}

func (service *systemUpdateService) beginUpdate() bool {
	service.updateMu.Lock()
	defer service.updateMu.Unlock()
	if service.updateInFlight {
		return false
	}
	service.updateInFlight = true
	return true
}

func (service *systemUpdateService) endUpdate() {
	service.updateMu.Lock()
	defer service.updateMu.Unlock()
	service.updateInFlight = false
}

func selfUpdateCapability(locale appLocale) systemUpdateCapability {
	binaryPath := strings.TrimSpace(os.Getenv("RENEWLET_SELF_UPDATE_BINARY"))
	if binaryPath == "" {
		binaryPath = defaultSelfUpdateBinaryPath
	}
	backupDir := strings.TrimSpace(os.Getenv("RENEWLET_SELF_UPDATE_BACKUP_DIR"))
	if backupDir == "" {
		backupDir = defaultSelfUpdateBackupDir
	}
	if !envBool("RENEWLET_SELF_UPDATE_ENABLED", false) {
		return systemUpdateCapability{
			runtime:           "source",
			supported:         false,
			unsupportedReason: tr(locale, "当前部署不支持页面内一键更新，请使用原部署方式手动升级。", "This deployment does not support in-app updates. Upgrade it with the original deployment method."),
			binaryPath:        binaryPath,
			backupDir:         backupDir,
		}
	}
	if runtime.GOOS != "linux" {
		return systemUpdateCapability{
			runtime:           "docker",
			supported:         false,
			unsupportedReason: tr(locale, "页面内一键更新只支持 Linux Docker 镜像。", "In-app updates are only supported for the Linux Docker image."),
			binaryPath:        binaryPath,
			backupDir:         backupDir,
		}
	}
	if fileInfo, err := os.Lstat(binaryPath); err != nil || !fileInfo.Mode().IsRegular() {
		return systemUpdateCapability{
			runtime:           "docker",
			supported:         false,
			unsupportedReason: tr(locale, "未找到可替换的 Docker 运行二进制，请先用 docker compose pull && docker compose up -d 升级一次。", "The Docker self-update binary was not found. Run docker compose pull && docker compose up -d once first."),
			binaryPath:        binaryPath,
			backupDir:         backupDir,
		}
	}
	if BuildType != "release" {
		return systemUpdateCapability{
			runtime:           "docker",
			supported:         false,
			unsupportedReason: tr(locale, "当前不是 Release 构建，请使用源码或镜像方式升级。", "This is not a release build. Upgrade it from source or Docker image instead."),
			binaryPath:        binaryPath,
			backupDir:         backupDir,
		}
	}
	return systemUpdateCapability{
		runtime:    "docker",
		supported:  true,
		binaryPath: binaryPath,
		backupDir:  backupDir,
	}
}

func selectSystemUpdateAssets(assets []githubAsset, version string) (githubAsset, githubAsset, error) {
	archiveName := systemArchiveName(version)
	var archiveAsset *githubAsset
	var checksumAsset *githubAsset
	for index := range assets {
		asset := &assets[index]
		switch asset.Name {
		case archiveName:
			archiveAsset = asset
		case "checksums.txt":
			checksumAsset = asset
		}
	}
	if archiveAsset == nil {
		return githubAsset{}, githubAsset{}, fmt.Errorf("no compatible release asset found for %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	if checksumAsset == nil {
		return githubAsset{}, githubAsset{}, errors.New("checksums.txt is missing from the release")
	}
	return *archiveAsset, *checksumAsset, nil
}

func verifySystemUpdateChecksum(archivePath string, archiveName string, checksumText []byte) error {
	expected, err := checksumForArchive(archiveName, checksumText)
	if err != nil {
		return err
	}
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return err
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if !strings.EqualFold(actual, expected) {
		return fmt.Errorf("checksum mismatch for %s", archiveName)
	}
	return nil
}

func checksumForArchive(archiveName string, checksumText []byte) (string, error) {
	scanner := bufio.NewScanner(strings.NewReader(string(checksumText)))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		hash := strings.ToLower(strings.TrimSpace(fields[0]))
		name := checksumEntryName(fields[len(fields)-1])
		if name != archiveName {
			continue
		}
		if len(hash) != sha256.Size*2 {
			return "", fmt.Errorf("invalid checksum for %s", archiveName)
		}
		if _, err := hex.DecodeString(hash); err != nil {
			return "", fmt.Errorf("invalid checksum for %s", archiveName)
		}
		return hash, nil
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return "", fmt.Errorf("checksum for %s not found", archiveName)
}

func extractRenewletBinary(archivePath string, targetPath string) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()
	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)
	found := false
	for {
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
		name := filepath.Clean(header.Name)
		if filepath.IsAbs(name) || strings.HasPrefix(name, ".."+string(filepath.Separator)) || name == ".." {
			return fmt.Errorf("unsafe archive path %q", header.Name)
		}
		if header.Typeflag != tar.TypeReg || filepath.Base(name) != "renewlet" {
			continue
		}
		if found {
			return errors.New("release archive contains multiple renewlet binaries")
		}
		target, err := os.OpenFile(targetPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o755)
		if err != nil {
			return err
		}
		if _, err := copyLimited(target, tarReader, systemUpdateMaxArchiveBytes); err != nil {
			_ = target.Close()
			return err
		}
		if err := target.Sync(); err != nil {
			_ = target.Close()
			return err
		}
		if err := target.Close(); err != nil {
			return err
		}
		found = true
	}
	if !found {
		return errors.New("renewlet binary not found in release archive")
	}
	return os.Chmod(targetPath, 0o755)
}

func replaceRenewletBinary(binaryPath string, backupDir string, newBinaryPath string, currentVersion string) error {
	if !filepath.IsAbs(binaryPath) || !filepath.IsAbs(backupDir) {
		return errors.New("self-update paths must be absolute")
	}
	fileInfo, err := os.Lstat(binaryPath)
	if err != nil {
		return err
	}
	if !fileInfo.Mode().IsRegular() {
		return errors.New("self-update target must be the real binary, not a symlink or directory")
	}
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		return err
	}
	backupPath := filepath.Join(backupDir, "renewlet."+safeBackupVersion(currentVersion))
	_ = os.Remove(backupPath)
	if err := os.Rename(binaryPath, backupPath); err != nil {
		return fmt.Errorf("backup current binary: %w", err)
	}
	if err := os.Rename(newBinaryPath, binaryPath); err != nil {
		if restoreErr := os.Rename(backupPath, binaryPath); restoreErr != nil {
			return fmt.Errorf("replace binary: %w; restore failed: %v", err, restoreErr)
		}
		return fmt.Errorf("replace binary: %w", err)
	}
	_ = os.Chmod(binaryPath, 0o755)
	return nil
}

func copyLimited(writer io.Writer, reader io.Reader, maxBytes int64) (int64, error) {
	limited := io.LimitReader(reader, maxBytes+1)
	written, err := io.Copy(writer, limited)
	if err != nil {
		return written, err
	}
	if written > maxBytes {
		return written, errors.New("payload is too large")
	}
	return written, nil
}
