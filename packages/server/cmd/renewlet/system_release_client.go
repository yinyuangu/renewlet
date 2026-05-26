package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
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
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "Renewlet/"+Version)
	response, err := client.apiClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("GitHub release API returned %s", response.Status)
	}
	var release githubRelease
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
