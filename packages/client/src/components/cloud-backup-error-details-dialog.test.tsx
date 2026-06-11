import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CloudBackupErrorDetailsDialog } from "./cloud-backup-error-details-dialog";
import type { CloudBackupErrorDetailsView } from "@/lib/cloud-backup-error-details";

// 弹窗测试保护“第一屏错误详情”契约：有 HTTP response 展示 status/headers/body；无 response 时展示 SDK/网络 diagnostics。
vi.mock("@/i18n/I18nProvider", () => ({
  useI18n: () => ({
    t: (key: string) => ({
      "common.close": "关闭",
      "settings.cloudBackupUpstreamTitle": "云存储错误详情",
      "settings.cloudBackupUpstreamDescription": "当前错误的连接信息和远端 HTTP 响应。",
      "settings.cloudBackupUpstreamResponse": "错误详情",
      "settings.cloudBackupUpstreamMetadata": "元数据",
      "settings.cloudBackupUpstreamCopy": "复制错误详情",
      "settings.cloudBackupUpstreamCopied": "已复制",
      "settings.cloudBackupUpstreamCopyFailed": "复制失败",
    }[key] ?? key),
  }),
}));

function renderDialog(details: CloudBackupErrorDetailsView) {
  return render(<CloudBackupErrorDetailsDialog open details={details} onOpenChange={vi.fn()} />);
}

function details(overrides: Partial<CloudBackupErrorDetailsView>): CloudBackupErrorDetailsView {
  return {
    message: "云备份连接测试失败",
    status: 400,
    code: "CLOUD_BACKUP_TEST_FAILED",
    reason: "local_sdk_error",
    providerMessage: null,
    providerResponse: null,
    providerAttempts: [],
    diagnostics: null,
    payload: null,
    ...overrides,
  };
}

function stubClipboard() {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

describe("CloudBackupErrorDetailsDialog", () => {
  it("shows HTTP status, headers and empty body in the first error details view", async () => {
    const writeText = stubClipboard();
    renderDialog(details({
      reason: "http_401",
      providerMessage: "Unauthorized",
      providerResponse: {
        status: 401,
        statusText: "Unauthorized",
        headers: { "content-length": "0", server: "openresty/1.21.4.1" },
        body: null,
        bodyTruncated: false,
      },
    }));

    expect(screen.getByRole("dialog", { name: "云存储错误详情" })).toBeInTheDocument();
    expect(screen.getByText(/HTTP 401 Unauthorized/)).toBeInTheDocument();
    expect(screen.getByText(/content-length: 0/)).toBeInTheDocument();
    expect(screen.getByText(/server: openresty\/1\.21\.4\.1/)).toBeInTheDocument();
    expect(screen.getByText(/<empty body>/)).toBeInTheDocument();
    expect(screen.queryByText(/message:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/云备份连接测试失败/)).not.toBeInTheDocument();
    expect(screen.queryByText("当前错误没有收到上游 HTTP 响应。")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "复制错误详情" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("HTTP 401 Unauthorized"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("<empty body>"));
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining("message:"));
  });

  it("shows raw body and truncation marker for HTTP parse failures", () => {
    renderDialog(details({
      reason: "xml_parse_error",
      providerMessage: "invalid xml",
      providerResponse: {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/xml" },
        body: "<ListBucketResult>",
        bodyTruncated: true,
      },
    }));

    expect(screen.getByText(/HTTP 200 OK/)).toBeInTheDocument();
    expect(screen.getByText(/<ListBucketResult>/)).toBeInTheDocument();
    expect(screen.getByText(/<body truncated>/)).toBeInTheDocument();
    expect(screen.queryByText(/message:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/云备份连接测试失败/)).not.toBeInTheDocument();
  });

  it("groups multiple provider attempts without mixing WebDAV and S3 responses", async () => {
    renderDialog(details({
      message: "云备份下载失败",
      code: "CLOUD_BACKUP_DOWNLOAD_FAILED",
      reason: "provider_attempts_failed",
      providerMessage: "No configured cloud backup target returned a valid snapshot.",
      providerAttempts: [
        {
          provider: "webdav",
          code: "CLOUD_BACKUP_WEBDAV_NOT_FOUND",
          reason: "http_404",
          providerMessage: "<d:error>missing</d:error>",
          providerResponse: {
            status: 404,
            statusText: "Not Found",
            headers: { "content-type": "application/xml" },
            body: "<d:error>missing</d:error>",
            bodyTruncated: false,
          },
        },
        {
          provider: "s3",
          code: "CLOUD_BACKUP_S3_GET_FAILED",
          reason: "http_403",
          providerMessage: "<Error><Code>AccessDenied</Code></Error>",
          providerResponse: {
            status: 403,
            statusText: "Forbidden",
            headers: { "content-type": "application/xml" },
            body: "<Error><Code>AccessDenied</Code></Error>",
            bodyTruncated: false,
          },
        },
      ],
    }));

    expect(screen.getByText(/# WEBDAV CLOUD_BACKUP_WEBDAV_NOT_FOUND/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 404 Not Found/)).toBeInTheDocument();
    expect(screen.getByText(/# S3 CLOUD_BACKUP_S3_GET_FAILED/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 403 Forbidden/)).toBeInTheDocument();
    expect(screen.queryByText(/message:/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "元数据" }));
    expect(screen.getByText(/providerAttempts/)).toBeInTheDocument();
    expect(screen.getByText(/CLOUD_BACKUP_S3_GET_FAILED/)).toBeInTheDocument();
  });

  it("shows local SDK diagnostics in the first view when no HTTP response exists", async () => {
    const writeText = stubClipboard();
    renderDialog(details({
      providerMessage: "internal error; reference = abc123 (attempted host: https://cloudstorage.iam.storage.dev)",
      diagnostics: {
        attemptedHost: "https://cloudstorage.iam.storage.dev",
        configuredEndpoint: "https://iam.storage.dev",
        endpointMode: "serviceEndpoint",
        operation: "list",
        signingRegion: "auto",
      },
    }));

    expect(screen.getByText(/internal error; reference = abc123/)).toBeInTheDocument();
    expect(screen.getByText(/attemptedHost: https:\/\/cloudstorage\.iam\.storage\.dev/)).toBeInTheDocument();
    expect(screen.getByText(/configuredEndpoint: https:\/\/iam\.storage\.dev/)).toBeInTheDocument();
    expect(screen.getByText(/endpointMode: serviceEndpoint/)).toBeInTheDocument();
    expect(screen.getByText(/operation: list/)).toBeInTheDocument();
    expect(screen.getByText(/signingRegion: auto/)).toBeInTheDocument();
    expect(screen.queryByText(/当前错误没有收到上游 HTTP 响应。/)).not.toBeInTheDocument();
    expect(screen.queryByText(/message:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/云备份连接测试失败/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "复制错误详情" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("internal error; reference = abc123"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("attemptedHost: https://cloudstorage.iam.storage.dev"));
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining("message:"));
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining("当前错误没有收到上游 HTTP 响应。"));
  });
});
