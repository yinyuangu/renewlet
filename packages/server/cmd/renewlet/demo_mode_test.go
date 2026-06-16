package main

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func newDemoModeTestApp(t *testing.T) (core.App, *core.Record, string) {
	t.Helper()
	// demo 模式测试必须走完整 schema/hooks，让路由和直接 record 写入共享同一套保护。
	t.Setenv(demoModeEnvName, "true")
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	registerRecordHooks(app)
	if err := ensureDemoMode(app); err != nil {
		t.Fatal(err)
	}
	user, err := demoModePolicy.FindUser(app)
	if err != nil {
		t.Fatal(err)
	}
	if user == nil {
		t.Fatal("expected demo user to be created")
	}
	token, err := user.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	return app, user, token
}

func countUserRecords(t *testing.T, app core.App, collection string, userID string) int64 {
	t.Helper()
	total, err := app.CountRecords(collection, dbx.HashExp{"user": userID})
	if err != nil {
		t.Fatal(err)
	}
	return total
}

func TestDemoModeCreatesRepairsSeedsAndDisablesSetup(t *testing.T) {
	app, demo, token := newDemoModeTestApp(t)

	// demo 身份会被启动修复，避免公开演示环境被改成管理员、封禁或弱密码状态。
	if demo.Email() != demoModePolicy.Email || demo.GetString("name") != demoModePolicy.Name {
		t.Fatalf("unexpected demo identity: email=%q name=%q", demo.Email(), demo.GetString("name"))
	}
	if demo.GetString("role") != "user" || demo.GetBool("banned") {
		t.Fatalf("demo user must stay a normal enabled user, role=%q banned=%v", demo.GetString("role"), demo.GetBool("banned"))
	}
	if !demo.ValidatePassword(demoModePolicy.Password) {
		t.Fatal("expected demo password to be restored")
	}

	wantSubscriptions := int64(len(demoSubscriptionSeeds(time.Now())))
	if got := countUserRecords(t, app, "subscriptions", demo.Id); got != wantSubscriptions {
		t.Fatalf("expected %d demo subscriptions, got %d", wantSubscriptions, got)
	}
	if got := countUserRecords(t, app, "settings", demo.Id); got != 1 {
		t.Fatalf("expected one demo settings row, got %d", got)
	}
	if got := countUserRecords(t, app, "custom_configs", demo.Id); got != 1 {
		t.Fatalf("expected one demo custom config row, got %d", got)
	}
	if got := countUserRecords(t, app, "calendar_feeds", demo.Id); got != 0 {
		t.Fatalf("expected demo reset not to pre-generate calendar feeds, got %d", got)
	}
	if got := countUserRecords(t, app, "public_status_pages", demo.Id); got != 0 {
		t.Fatalf("expected demo reset not to pre-generate public status pages, got %d", got)
	}

	// 公开 token 和日历 token 只能由访客显式生成，seed 不能提前创建可分享链接。
	publicStatusCreate := serveTestRequest(t, app, http.MethodPost, "/api/app/public-status-page", `{}`, token)
	if publicStatusCreate.Code != http.StatusOK {
		t.Fatalf("expected demo user to manually generate public status page, got %d: %s", publicStatusCreate.Code, publicStatusCreate.Body.String())
	}
	calendarFeedCreate := serveTestRequest(t, app, http.MethodPost, "/api/app/calendar-feed", `{}`, token)
	if calendarFeedCreate.Code != http.StatusOK {
		t.Fatalf("expected demo user to manually generate calendar feed, got %d: %s", calendarFeedCreate.Code, calendarFeedCreate.Body.String())
	}

	demo.SetPassword("changed-password")
	demo.Set("role", "admin")
	demo.Set("banned", true)
	if err := app.SaveNoValidate(demo); err != nil {
		t.Fatal(err)
	}
	if err := ensureDemoMode(app); err != nil {
		t.Fatal(err)
	}
	repaired, err := demoModePolicy.FindUser(app)
	if err != nil {
		t.Fatal(err)
	}
	if !repaired.ValidatePassword(demoModePolicy.Password) || repaired.GetString("role") != "user" || repaired.GetBool("banned") {
		t.Fatalf("demo repair failed: role=%q banned=%v", repaired.GetString("role"), repaired.GetBool("banned"))
	}

	status := serveTestRequest(t, app, http.MethodGet, "/api/app/status", "", "")
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), `"setupEnabled":false`) || !strings.Contains(status.Body.String(), `"demoMode":true`) {
		t.Fatalf("expected app status to expose disabled setup and demo mode, got %d: %s", status.Code, status.Body.String())
	}
	setupStatus := serveTestRequest(t, app, http.MethodGet, "/api/app/setup", "", "")
	if setupStatus.Code != http.StatusOK || !strings.Contains(setupStatus.Body.String(), `"setupEnabled":false`) {
		t.Fatalf("expected setup to be disabled in demo mode, got %d: %s", setupStatus.Code, setupStatus.Body.String())
	}
	create := serveTestRequest(t, app, http.MethodPost, "/api/app/setup", `{"name":"Admin","email":"admin@example.com","password":"password123"}`, "")
	if create.Code != http.StatusForbidden {
		t.Fatalf("expected setup create to be forbidden in demo mode, got %d: %s", create.Code, create.Body.String())
	}
}

func TestDemoModeResetOnlyTouchesDemoUserData(t *testing.T) {
	app, demo, _ := newDemoModeTestApp(t)
	other, _ := createRouteTestUser(t, app, "demo-isolation")
	createRouteTestSubscription(t, app, demo.Id, map[string]interface{}{"name": "Visitor Added"})
	createRouteTestSubscription(t, app, other.Id, map[string]interface{}{"name": "Other User"})
	if _, err := ensureGlobalCalendarFeed(app, demo.Id); err != nil {
		t.Fatal(err)
	}
	if _, err := ensurePublicStatusPage(app, demo.Id); err != nil {
		t.Fatal(err)
	}

	// reset 只清演示用户资料；普通用户数据隔离是 demo 模式能跑在线环境的前提。
	if err := demoModePolicy.ResetUserData(app, demo, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}

	wantDemoSubscriptions := int64(len(demoSubscriptionSeeds(time.Now())))
	if got := countUserRecords(t, app, "subscriptions", demo.Id); got != wantDemoSubscriptions {
		t.Fatalf("expected demo subscriptions to reset to %d, got %d", wantDemoSubscriptions, got)
	}
	if got := countUserRecords(t, app, "subscriptions", other.Id); got != 1 {
		t.Fatalf("expected other user subscription to remain, got %d", got)
	}
	if got := countUserRecords(t, app, "calendar_feeds", demo.Id); got != 0 {
		t.Fatalf("expected demo reset to delete generated calendar feeds, got %d", got)
	}
	if got := countUserRecords(t, app, "public_status_pages", demo.Id); got != 0 {
		t.Fatalf("expected demo reset to delete generated public status pages, got %d", got)
	}
}

func TestDemoModeAllowsNormalSettingsButProtectsExternalIntegrationSettings(t *testing.T) {
	app, demo, token := newDemoModeTestApp(t)

	// 普通展示设置允许保存，外部通知/AI/备份凭据必须禁止，避免公开演示触发真实第三方调用。
	normal := serveTestRequest(t, app, http.MethodPut, "/api/app/settings", `{"themeMode":"light","monthlyBudget":123}`, token)
	if normal.Code != http.StatusOK {
		t.Fatalf("expected ordinary settings save to succeed, got %d: %s", normal.Code, normal.Body.String())
	}
	settingsRecord, err := app.FindFirstRecordByFilter("settings", "user = {:user}", dbx.Params{"user": demo.Id})
	if err != nil {
		t.Fatal(err)
	}
	settings := settingsFromRecord(settingsRecord)
	if settings.ThemeMode != "light" || settings.MonthlyBudget != 123 {
		t.Fatalf("ordinary settings were not persisted: %#v", settings)
	}

	protected := serveTestRequest(t, app, http.MethodPut, "/api/app/settings", `{"telegramBotToken":"secret"}`, token)
	if protected.Code != http.StatusForbidden {
		t.Fatalf("expected protected settings save to be forbidden, got %d: %s", protected.Code, protected.Body.String())
	}
	settingsRecord, err = app.FindFirstRecordByFilter("settings", "user = {:user}", dbx.Params{"user": demo.Id})
	if err != nil {
		t.Fatal(err)
	}
	if got := settingsFromRecord(settingsRecord).TelegramBotToken; got != "" {
		t.Fatalf("protected setting leaked into storage: %q", got)
	}

	recordSettings := settingsFromRecord(settingsRecord)
	recordSettings.AIRecognition.APIKey = "sk-demo"
	settingsRecord.Set("settings", recordSettings)
	if err := app.Save(settingsRecord); err == nil {
		t.Fatal("expected direct settings record secret mutation to be rejected")
	}

	targets, err := app.FindCollectionByNameOrId("cloud_backup_targets")
	if err != nil {
		t.Fatal(err)
	}
	target := core.NewRecord(targets)
	target.Set("user", demo.Id)
	target.Set("provider", cloudBackupProviderWebDAV)
	if err := app.Save(target); err == nil {
		t.Fatal("expected direct demo cloud backup target write to be rejected")
	}
}

func TestDemoModeProtectsAccountRoutesAndRecordHooks(t *testing.T) {
	app, demo, token := newDemoModeTestApp(t)
	_, adminToken := createRouteTestUser(t, app, "admin")

	password := serveTestRequest(t, app, http.MethodPut, "/api/app/account/password", `{"currentPassword":"renewlet-demo","newPassword":"changed-password"}`, token)
	if password.Code != http.StatusForbidden {
		t.Fatalf("expected demo password route to be forbidden, got %d: %s", password.Code, password.Body.String())
	}

	demo.SetPassword("changed-password")
	if err := app.Save(demo); err == nil {
		t.Fatal("expected direct demo password save to be rejected")
	}
	reloaded, err := demoModePolicy.FindUser(app)
	if err != nil {
		t.Fatal(err)
	}
	reloaded.Set("role", "admin")
	if err := app.Save(reloaded); err == nil {
		t.Fatal("expected direct demo role save to be rejected")
	}
	reloaded, err = demoModePolicy.FindUser(app)
	if err != nil {
		t.Fatal(err)
	}
	// 直接 Save/Delete 和管理员路由都必须被 hook 拦住，不能只保护公开 API。
	if err := app.Delete(reloaded); err == nil {
		t.Fatal("expected demo user delete to be rejected")
	}

	patch := serveTestRequest(t, app, http.MethodPatch, "/api/app/admin/users/"+demo.Id, `{"role":"admin"}`, adminToken)
	if patch.Code != http.StatusForbidden {
		t.Fatalf("expected admin patch of demo user to be forbidden, got %d: %s", patch.Code, patch.Body.String())
	}
	del := serveTestRequest(t, app, http.MethodDelete, "/api/app/admin/users/"+demo.Id, "", adminToken)
	if del.Code != http.StatusForbidden {
		t.Fatalf("expected admin delete of demo user to be forbidden, got %d: %s", del.Code, del.Body.String())
	}
}

func TestDemoModeBlocksExternalSideEffectsButNotNormalUsers(t *testing.T) {
	app, _, token := newDemoModeTestApp(t)

	// 这些入口会触发外发请求或云端状态变化，demo 用户只能浏览，不能替部署者发送真实请求。
	for _, tc := range []struct {
		name   string
		method string
		target string
		body   string
	}{
		{name: "notification test", method: http.MethodPost, target: "/api/app/notifications/test", body: `{}`},
		{name: "notification run", method: http.MethodPost, target: "/api/app/notifications/run", body: `{}`},
		{name: "ai model list", method: http.MethodPost, target: "/api/app/ai/models/list", body: `{}`},
		{name: "ai test", method: http.MethodPost, target: "/api/app/ai/subscriptions/test", body: `{}`},
		{name: "ai recognize", method: http.MethodPost, target: "/api/app/ai/subscriptions/recognize", body: `{}`},
		{name: "ai recognize stream", method: http.MethodPost, target: "/api/app/ai/subscriptions/recognize/stream", body: `{}`},
		{name: "cloud backups list", method: http.MethodGet, target: "/api/app/cloud-backups?provider=webdav"},
		{name: "cloud backup config update", method: http.MethodPut, target: "/api/app/cloud-backup/config", body: `{}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			res := serveTestRequest(t, app, tc.method, tc.target, tc.body, token)
			if res.Code != http.StatusForbidden {
				t.Fatalf("expected demo side effect to be forbidden, got %d: %s", res.Code, res.Body.String())
			}
		})
	}

	_, normalToken := createRouteTestUser(t, app, "normal-side-effect")
	res := serveTestRequest(t, app, http.MethodGet, "/api/app/cloud-backups?provider=webdav", "", normalToken)
	if res.Code == http.StatusForbidden {
		t.Fatalf("normal user should not be blocked by demo guard: %s", res.Body.String())
	}
}

func TestDemoModeEnforcesSubscriptionAndAssetQuota(t *testing.T) {
	original := demoModePolicy
	demoModePolicy.MaxSubscriptions = len(demoSubscriptionSeeds(time.Now()))
	demoModePolicy.MaxAssets = 0
	t.Cleanup(func() { demoModePolicy = original })

	app, _, token := newDemoModeTestApp(t)

	create := serveTestRequest(t, app, http.MethodPost, "/api/app/subscriptions", subscriptionCreateBody("Over Quota"), token)
	if create.Code != http.StatusBadRequest {
		t.Fatalf("expected demo subscription quota to reject create, got %d: %s", create.Code, create.Body.String())
	}
	upload := serveMultipartTestRequest(
		t,
		app,
		"/api/app/assets",
		token,
		map[string]string{"kind": "logo"},
		"file",
		"logo.svg",
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>`,
	)
	if upload.Code != http.StatusBadRequest {
		t.Fatalf("expected demo asset quota to reject upload, got %d: %s", upload.Code, upload.Body.String())
	}
}

func TestDemoModeCronsSkipDemoUser(t *testing.T) {
	app, demo, _ := newDemoModeTestApp(t)

	// 自动续订和通知 cron 都要跳过 demo 用户，避免 seed 数据随时间漂移或产生历史噪声。
	renewal, err := renewAutoSubscriptionsForAllUsers(app, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if renewal.UsersProcessed != 0 || renewal.SubscriptionsUpdated != 0 {
		t.Fatalf("expected renewal maintenance to skip demo user, got %#v", renewal)
	}

	cron, err := runNotificationCron(app, notificationCronOptions{Force: true, DryRun: true, Now: time.Now().UTC()})
	if err != nil {
		t.Fatal(err)
	}
	if cron.Processed != 1 || cron.Skipped != 1 || len(cron.Results) != 1 || cron.Results[0].UserID != demo.Id || cron.Results[0].Reason != "demo_user" {
		t.Fatalf("expected notification cron to skip demo user, got %#v", cron)
	}
}
