package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func withAIModelListTestServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(handler)
	previousClient := aiModelListHTTPClient
	aiModelListHTTPClient = server.Client()
	t.Cleanup(func() {
		aiModelListHTTPClient = previousClient
		server.Close()
	})
	return server
}

func TestAIModelListOpenAIShape(t *testing.T) {
	server := withAIModelListTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer sk-test-secret" {
			t.Fatalf("unexpected authorization header: %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"gpt-5.1","created":1780000000,"owned_by":"openai"},{"id":"gpt-5.1"}]}`))
	})

	response, err := listAIModels(context.Background(), aiModelListRequest{
		Provider: "openai",
		BaseURL:  server.URL + "/v1",
		APIKey:   "sk-test-secret",
	}, localeZhCN)
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Models) != 1 || response.Models[0].ID != "gpt-5.1" {
		t.Fatalf("unexpected models: %#v", response.Models)
	}
	if response.Models[0].OwnedBy == nil || *response.Models[0].OwnedBy != "openai" {
		t.Fatalf("owner not parsed: %#v", response.Models[0])
	}
}

func TestAIModelListGeminiShape(t *testing.T) {
	server := withAIModelListTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("x-goog-api-key"); got != "AIza-test-secret" {
			t.Fatalf("unexpected Gemini key header: %q", got)
		}
		_, _ = w.Write([]byte(`{"models":[{"name":"models/gemini-2.5-pro","baseModelId":"gemini-2.5-pro","displayName":"Gemini 2.5 Pro","inputTokenLimit":1048576,"outputTokenLimit":65536,"supportedGenerationMethods":["generateContent"],"thinking":true},{"name":"models/text-embedding","supportedGenerationMethods":["embedContent"]}]}`))
	})

	response, err := listAIModels(context.Background(), aiModelListRequest{
		Provider: "gemini",
		BaseURL:  server.URL + "/v1beta",
		APIKey:   "AIza-test-secret",
	}, localeZhCN)
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Models) != 1 || response.Models[0].ID != "gemini-2.5-pro" {
		t.Fatalf("unexpected Gemini models: %#v", response.Models)
	}
	if response.Models[0].Capabilities.Thinking == nil || !*response.Models[0].Capabilities.Thinking {
		t.Fatalf("thinking capability not parsed: %#v", response.Models[0].Capabilities)
	}
}

func TestAIModelListAnthropicAndCompatible(t *testing.T) {
	server := withAIModelListTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "" {
			t.Fatalf("compatible request should not send empty auth header")
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"custom-model"}]}`))
	})

	response, err := listAIModels(context.Background(), aiModelListRequest{
		Provider: "openai-compatible",
		BaseURL:  server.URL + "/v1/",
		APIKey:   "",
	}, localeZhCN)
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Models) != 1 || response.Models[0].ID != "custom-model" {
		t.Fatalf("unexpected compatible models: %#v", response.Models)
	}
}

func TestAIModelListProviderErrorRedactsSecrets(t *testing.T) {
	server := withAIModelListTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`invalid sk-test-secret`))
	})

	_, err := listAIModels(context.Background(), aiModelListRequest{
		Provider: "openai",
		BaseURL:  server.URL + "/v1",
		APIKey:   "sk-test-secret",
	}, localeZhCN)
	var httpErr *aiModelListHTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("expected aiModelListHTTPError, got %#v", err)
	}
	if httpErr.message == nil || !strings.Contains(*httpErr.message, "[redacted]") || strings.Contains(*httpErr.message, "sk-test-secret") {
		t.Fatalf("provider message was not redacted: %#v", httpErr.message)
	}
}

func TestAIModelListTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(50 * time.Millisecond)
	}))
	previousClient := aiModelListHTTPClient
	aiModelListHTTPClient = &http.Client{Timeout: time.Millisecond}
	t.Cleanup(func() {
		aiModelListHTTPClient = previousClient
		server.Close()
	})

	_, err := listAIModels(context.Background(), aiModelListRequest{
		Provider: "openai",
		BaseURL:  server.URL + "/v1",
		APIKey:   "sk-test-secret",
	}, localeZhCN)
	var httpErr *aiModelListHTTPError
	if !errors.As(err, &httpErr) || httpErr.code != "AI_MODEL_LIST_TIMEOUT" {
		t.Fatalf("expected timeout error, got %#v", err)
	}
}
