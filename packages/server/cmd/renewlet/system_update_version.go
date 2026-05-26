package main

import (
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

func parseSystemVersion(rawVersion string) (string, semanticVersion, bool) {
	version := strings.TrimPrefix(strings.TrimSpace(rawVersion), "v")
	mainPart := version
	prerelease := ""
	if dash := strings.Index(mainPart, "-"); dash >= 0 {
		prerelease = mainPart[dash+1:]
		mainPart = mainPart[:dash]
	}
	parts := strings.Split(mainPart, ".")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return "", semanticVersion{}, false
	}
	major, errMajor := strconv.Atoi(parts[0])
	minor, errMinor := strconv.Atoi(parts[1])
	patch, errPatch := strconv.Atoi(parts[2])
	if errMajor != nil || errMinor != nil || errPatch != nil || major < 0 || minor < 0 || patch < 0 {
		return "", semanticVersion{}, false
	}
	return version, semanticVersion{major: major, minor: minor, patch: patch, prerelease: prerelease}, true
}

func isNewerSystemVersion(current string, latest string) bool {
	_, currentVersion, currentOK := parseSystemVersion(current)
	_, latestVersion, latestOK := parseSystemVersion(latest)
	if !currentOK || !latestOK || latestVersion.prerelease != "" {
		return false
	}
	if latestVersion.major != currentVersion.major {
		return latestVersion.major > currentVersion.major
	}
	if latestVersion.minor != currentVersion.minor {
		return latestVersion.minor > currentVersion.minor
	}
	if latestVersion.patch != currentVersion.patch {
		return latestVersion.patch > currentVersion.patch
	}
	return currentVersion.prerelease != ""
}

func systemArchiveName(version string) string {
	return "renewlet_" + version + "_" + runtime.GOOS + "_" + runtime.GOARCH + ".tar.gz"
}

func safeBackupVersion(version string) string {
	value := strings.TrimSpace(version)
	if value == "" {
		return strconv.FormatInt(time.Now().Unix(), 10)
	}
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_", " ", "_")
	return replacer.Replace(value)
}

func cloneSystemVersionResponse(response *systemVersionResponse, cached bool) *systemVersionResponse {
	if response == nil {
		return nil
	}
	clone := *response
	clone.Cached = cached
	if response.ReleaseInfo != nil {
		release := *response.ReleaseInfo
		release.Assets = append([]systemReleaseAssetDTO(nil), response.ReleaseInfo.Assets...)
		clone.ReleaseInfo = &release
	}
	return &clone
}

func checksumEntryName(value string) string {
	return strings.TrimPrefix(filepath.Base(strings.TrimPrefix(value, "*")), "./")
}
