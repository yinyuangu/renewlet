import { z } from "zod";
import { okResponseSchema } from "./common";

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  time: z.string().min(1),
}).strict();

export const setupStatusResponseSchema = z.object({
  setupRequired: z.boolean(),
  setupEnabled: z.boolean(),
}).strict();

export const setupCreateResponseSchema = okResponseSchema;

export const passwordResetStatusResponseSchema = z.object({
  enabled: z.boolean(),
}).strict();

export const systemRuntimeSchema = z.enum(["docker", "cloudflare", "source"]);

export const systemBuildInfoSchema = z.object({
  version: z.string().min(1),
  commit: z.string(),
  buildTime: z.string(),
  buildType: z.string().min(1),
}).strict();

export const systemReleaseAssetSchema = z.object({
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
}).strict();

export const systemReleaseInfoSchema = z.object({
  tagName: z.string().min(1),
  version: z.string().min(1),
  name: z.string(),
  body: z.string(),
  publishedAt: z.string(),
  htmlUrl: z.string().min(1),
  assets: z.array(systemReleaseAssetSchema),
}).strict();

export const systemVersionResponseSchema = z.object({
  currentVersion: z.string().min(1),
  latestVersion: z.string().min(1),
  hasUpdate: z.boolean(),
  checkSucceeded: z.boolean(),
  runtime: systemRuntimeSchema,
  updateSupported: z.boolean(),
  unsupportedReason: z.string().optional(),
  releaseInfo: systemReleaseInfoSchema.nullable(),
  cached: z.boolean(),
  warning: z.string().optional(),
  build: systemBuildInfoSchema,
}).strict();

export const systemUpdateResponseSchema = z.object({
  ok: z.literal(true),
  currentVersion: z.string().min(1),
  targetVersion: z.string().min(1),
  needsRestart: z.boolean(),
  message: z.string().min(1),
}).strict();

export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>;
export type PasswordResetStatusResponse = z.infer<typeof passwordResetStatusResponseSchema>;
export type SystemRuntime = z.infer<typeof systemRuntimeSchema>;
export type SystemVersionResponse = z.infer<typeof systemVersionResponseSchema>;
export type SystemUpdateResponse = z.infer<typeof systemUpdateResponseSchema>;
