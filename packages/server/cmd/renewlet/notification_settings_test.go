package main

import (
	"encoding/json"
	"testing"
)

func TestSettingsFromValueRecoversUnsupportedPersistedLocale(t *testing.T) {
	settings, err := settingsFromValue(json.RawMessage(`{"locale":"fr-FR","monthlyBudget":2333}`))
	if err != nil {
		t.Fatal(err)
	}
	if settings.Locale != string(localeEnUS) || settings.MonthlyBudget != 2333 {
		t.Fatalf("expected persisted settings to recover locale only, got %#v", settings)
	}
}

func TestMergeSettingsForWriteRejectsUnsupportedLocale(t *testing.T) {
	if _, err := mergeSettingsForWrite(defaultAppSettings(), json.RawMessage(`{"locale":"fr-FR"}`)); err == nil {
		t.Fatal("expected unsupported locale write to fail")
	}
}
