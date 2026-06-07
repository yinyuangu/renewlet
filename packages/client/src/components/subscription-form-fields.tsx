import { memo, useCallback, useMemo } from "react";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { compareDateOnly } from "@/lib/time/date-only";
import { LogoPicker } from "@/components/logo-picker";
import { SubscriptionFormDateFields } from "@/components/subscription-form-date-fields";
import { SubscriptionPaymentMethodSelect } from "@/components/subscription-payment-method-select";
import { SubscriptionTagInput } from "@/components/subscription-tag-input";
import type {
  BillingCycle,
  RepeatReminderInterval,
  RepeatReminderWindow,
  SubscriptionStatus,
} from "@/types/subscription";
import {
  DISABLED_REMINDER_DAYS,
  INHERIT_REMINDER_DAYS,
  CURRENCY_OPTIONS,
  CUSTOM_CYCLE_UNITS,
  CYCLE_LABELS,
  REMINDER_DAYS_OPTIONS,
  REPEAT_REMINDER_INTERVAL_OPTIONS,
  REPEAT_REMINDER_SENTENCE_INTERVAL_LABELS,
  REPEAT_REMINDER_WINDOW_OPTIONS,
} from "@/types/subscription";
import type { SubscriptionFormReminderType, SubscriptionFormState } from "@/types/subscription-form";
import { createCurrencySelectOptions } from "@/lib/searchable-options";
import { toReminderDays } from "@/lib/subscription-form";
import { customCycleUnitLabelKey } from "@/lib/subscription-billing";
import { useI18n } from "@/i18n/I18nProvider";
import { localizedLabel } from "@/i18n/locales";
import { errorFieldByFormKey, type SubscriptionFormErrors, type SubscriptionFormFieldsProps } from "@/components/subscription-form-fields-model";

export type { SubscriptionFormReminderType };
export type { SubscriptionFormState };
export type { SubscriptionFormErrors, SubscriptionFormFieldsProps };

export const SubscriptionFormFields = memo(function SubscriptionFormFields({
  idPrefix,
  config,
  formData,
  setFormData,
  availableTags = [],
  showLogoField = true,
  onLogoUploadStatusChange,
  onFieldChange,
  errors = {},
  onClearFieldError,
  notificationReminderDays,
}: SubscriptionFormFieldsProps) {
  const { t, locale, label } = useI18n();

  const update = useCallback(<K extends keyof SubscriptionFormState>(key: K, value: SubscriptionFormState[K]) => {
    setFormData((prev) => {
      if (key === "billingCycle") {
        const nextBillingCycle = value as BillingCycle;
        return {
          ...prev,
          billingCycle: nextBillingCycle,
          customDays: nextBillingCycle === "custom" ? prev.customDays : "",
          customCycleUnit: nextBillingCycle === "custom" ? prev.customCycleUnit : "day",
          oneTimeMode: nextBillingCycle === "one-time" ? "term" : prev.oneTimeMode,
          oneTimeTermCount: nextBillingCycle === "one-time" ? prev.oneTimeTermCount || "1" : prev.oneTimeTermCount,
          oneTimeTermUnit: nextBillingCycle === "one-time" ? prev.oneTimeTermUnit || "month" : prev.oneTimeTermUnit,
          // 一次性购买不会自动滚动续费；固定服务期的到期日由弹窗 effect 按服务时长计算。
          autoCalculate: nextBillingCycle === "one-time" ? false : prev.autoCalculate,
          nextBillingDate: nextBillingCycle === "one-time" ? prev.startDate : prev.nextBillingDate,
        };
      }
      if (key === "startDate") {
        const nextStartDate = value as SubscriptionFormState["startDate"];
        return {
          ...prev,
          startDate: nextStartDate,
          // 开始日后移后，原手动到期日可能变成非法值；清空比静默改成同一天更能保留用户意图。
          // 比较保持在 DateOnly 字符串语义内，避免本地 Date 时区换算导致跨天误判。
          nextBillingDate:
            prev.billingCycle === "one-time"
              ? nextStartDate
              : nextStartDate &&
                  prev.nextBillingDate &&
                  compareDateOnly(prev.nextBillingDate, nextStartDate) < 0
                ? undefined
                : prev.nextBillingDate,
        };
      }
      return { ...prev, [key]: value };
    });
    const errorField = errorFieldByFormKey[key];
    if (errorField) onClearFieldError?.(errorField);
    if (key === "billingCycle") {
      onClearFieldError?.("customDays");
      onClearFieldError?.("oneTimeTerm");
    }
    // onFieldChange 是外层识别“用户明确修改过某字段”的钩子，例如新增订阅默认货币同步策略。
    // 这里保持泛型 key/value 绑定，避免调用方把字段和值的类型拆散。
    onFieldChange?.(key, value);
  }, [onClearFieldError, onFieldChange, setFormData]);

  const id = (name: string) => `${idPrefix}${name}`;
  const categoryId = id("category");

  // 货币选项受“设置 → 货币管理（启用/禁用）”控制：
  // - 默认只展示 enabled=true 的货币
  // - 若当前值是“已禁用货币”（例如历史订阅数据），仍展示一个不可选项用于回显，避免选择器空白
  const currencyOptions = useMemo(
    () =>
      createCurrencySelectOptions({
        currencies: config.currencies,
        currencyOptions: CURRENCY_OPTIONS,
        includeDisabledCurrent: formData.currency,
        locale,
      }),
    [config.currencies, formData.currency, locale],
  );
  const statusLabel = config.statuses.find((status) => status.value === formData.status)?.labels;
  const categoryLabel = config.categories.find((category) => category.value === formData.category)?.labels;
  const paymentMethodLabel =
    config.paymentMethods.find((method) => method.value === formData.paymentMethod)?.labels;
  const repeatReminderSentenceInterval = label(REPEAT_REMINDER_SENTENCE_INTERVAL_LABELS[formData.repeatReminderInterval]);
  const repeatReminderWindowHours =
    formData.repeatReminderWindow === "full" ? null : Number.parseInt(formData.repeatReminderWindow, 10);
  const isReminderDisabled = formData.reminderType === "disabled";
  const reminderDaysForPreview = isReminderDisabled || formData.reminderType === "inherit"
    ? notificationReminderDays
    : toReminderDays(formData);
  const repeatReminderPreview =
    repeatReminderWindowHours === null || reminderDaysForPreview * 24 <= repeatReminderWindowHours
      ? t("subscription.repeatReminderPreview.afterFirst", { interval: repeatReminderSentenceInterval })
      : t("subscription.repeatReminderPreview.finalWindow", { hours: repeatReminderWindowHours });

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={id("name")}>{t("subscription.field.name")}</Label>
        <Input
          id={id("name")} name={id("name")} enterKeyHint="next"
          placeholder={t("subscription.placeholder.name")}
          value={formData.name}
          onChange={(e) => update("name", e.target.value)}
          required
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? id("name-error") : undefined}
          className="border-border bg-secondary"
        />
        <FieldError id={id("name-error")} message={errors.name} />
      </div>

      {showLogoField ? (
        <LogoPicker
          value={formData.logo}
          onChange={(logo) => update("logo", logo)}
          onUploadStatusChange={onLogoUploadStatusChange}
          serviceName={formData.name}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={id("price")}>{t("subscription.field.price")}</Label>
          <NumericInput
            id={id("price")} name={id("price")}
            allowNegative={false}
            allowedDecimalSeparators={[".", "。"]}
            inputMode="decimal" enterKeyHint="next"
            placeholder="0.00"
            thousandSeparator
            value={formData.price}
            onRawValueChange={(value: string) => update("price", value)}
            required
            aria-invalid={Boolean(errors.price)}
            aria-describedby={errors.price ? id("price-error") : undefined}
            className="border-border bg-secondary"
          />
          <FieldError id={id("price-error")} message={errors.price} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={id("currency")}>{t("subscription.field.currency")}</Label>
          <SearchableSelect
            value={formData.currency}
            onValueChange={(value) => update("currency", value)}
            options={currencyOptions}
            placeholder={t("subscription.placeholder.currency")}
            searchPlaceholder={t("subscription.search.currency")}
            emptyMessage={t("subscription.empty.currency")}
            className={cn(
              "border-border bg-secondary",
              errors.currency && "border-destructive focus:ring-destructive/40",
            )}
            aria-label={t("subscription.placeholder.currency")}
            aria-invalid={Boolean(errors.currency)}
            aria-describedby={errors.currency ? id("currency-error") : undefined}
          />
          <FieldError id={id("currency-error")} message={errors.currency} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={id("status")}>{t("subscription.field.status")}</Label>
          <Select value={formData.status} onValueChange={(value) => update("status", value as SubscriptionStatus)}>
            <SelectTrigger className="border-border bg-secondary" tooltipContent={statusLabel ? label(statusLabel) : formData.status}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {config.statuses.map((status) => (
                <SelectItem key={status.id} value={status.value}>
                  {label(status.labels)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor={categoryId}>{t("subscription.field.category")}</Label>
          <Select value={formData.category} onValueChange={(value) => update("category", value)}>
            <SelectTrigger className="border-border bg-secondary" tooltipContent={categoryLabel ? label(categoryLabel) : formData.category}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {config.categories.map((category) => (
                <SelectItem key={category.id} value={category.value}>
                  {label(category.labels)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={id("cycle")}>{t("subscription.field.billingCycle")}</Label>
          <Select
            value={formData.billingCycle}
            onValueChange={(value) => update("billingCycle", value as BillingCycle)}
          >
            <SelectTrigger
              id={id("cycle")}
              className={cn(
                "border-border bg-secondary",
                errors.billingCycle && "border-destructive focus:ring-destructive/40",
              )}
              aria-label={t("subscription.field.billingCycle")}
              aria-invalid={Boolean(errors.billingCycle)}
              aria-describedby={errors.billingCycle ? id("billingCycle-error") : undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CYCLE_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {localizedLabel(label, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError id={id("billingCycle-error")} message={errors.billingCycle} />
        </div>

        {formData.billingCycle === "custom" ? (
          <div className="grid gap-2">
            <Label htmlFor={id("customDays")}>{t("subscription.field.customCycle")}</Label>
            <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_5rem] items-center gap-2" data-testid="custom-cycle-inline-control">
              <span className="whitespace-nowrap text-sm text-muted-foreground">{t("subscription.customCycleEvery")}</span>
              <NumericInput
                id={id("customDays")} name={id("customDays")}
                allowNegative={false}
                decimalScale={0}
                inputMode="numeric" enterKeyHint="next"
                placeholder={t("subscription.customCycleCountPlaceholder")}
                value={formData.customDays}
                onRawValueChange={(value: string) => update("customDays", value)}
                aria-invalid={Boolean(errors.customDays)}
                aria-describedby={errors.customDays ? id("customDays-error") : undefined}
                className="min-w-0 border-border bg-secondary"
              />
              <Select
                value={formData.customCycleUnit}
                onValueChange={(value) => update("customCycleUnit", value as SubscriptionFormState["customCycleUnit"])}
              >
                <SelectTrigger
                  id={id("customCycleUnit")}
                  className="h-10 min-w-0 overflow-hidden border-border bg-secondary px-2"
                  aria-label={t("subscription.field.customCycleUnit")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOM_CYCLE_UNITS.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {t(customCycleUnitLabelKey(unit))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <FieldError id={id("customDays-error")} message={errors.customDays} />
          </div>
        ) : formData.billingCycle === "one-time" ? (
          <div className="grid gap-2">
            <Label>{t("subscription.field.oneTimeMode")}</Label>
            <div className="grid grid-cols-2 rounded-md border border-border bg-secondary p-1" role="group" aria-label={t("subscription.field.oneTimeMode")}>
              {(["term", "buyout"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={cn(
                    "min-h-8 rounded-sm px-2 text-sm font-medium transition-colors",
                    formData.oneTimeMode === mode
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-pressed={formData.oneTimeMode === mode}
                  onClick={() => update("oneTimeMode", mode)}
                >
                  {mode === "term" ? t("subscription.oneTimeMode.term") : t("subscription.oneTimeMode.buyout")}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor={id("paymentMethod")}>{t("subscription.field.paymentMethod")}</Label>
            <SubscriptionPaymentMethodSelect
              value={formData.paymentMethod}
              methods={config.paymentMethods}
              labelFor={label}
              placeholder={t("subscription.placeholder.paymentMethod")}
              tooltipContent={paymentMethodLabel ? label(paymentMethodLabel) : undefined}
              onValueChange={(value) => update("paymentMethod", value)}
            />
          </div>
        )}
      </div>

      {formData.billingCycle === "one-time" && formData.oneTimeMode === "term" ? (
        <div className="grid gap-2">
          <Label htmlFor={id("oneTimeTermCount")}>{t("subscription.field.oneTimeTerm")}</Label>
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_5rem] items-center gap-2" data-testid="one-time-term-inline-control">
            <span className="whitespace-nowrap text-sm text-muted-foreground">{t("subscription.oneTimeTermFor")}</span>
            <NumericInput
              id={id("oneTimeTermCount")} name={id("oneTimeTermCount")}
              allowNegative={false}
              decimalScale={0}
              inputMode="numeric" enterKeyHint="next"
              placeholder={t("subscription.customCycleCountPlaceholder")}
              value={formData.oneTimeTermCount}
              onRawValueChange={(value: string) => update("oneTimeTermCount", value)}
              aria-invalid={Boolean(errors.oneTimeTerm)}
              aria-describedby={errors.oneTimeTerm ? id("oneTimeTerm-error") : undefined}
              className="min-w-0 border-border bg-secondary"
            />
            <Select
              value={formData.oneTimeTermUnit}
              onValueChange={(value) => update("oneTimeTermUnit", value as SubscriptionFormState["oneTimeTermUnit"])}
            >
              <SelectTrigger
                id={id("oneTimeTermUnit")}
                className="h-10 min-w-0 overflow-hidden border-border bg-secondary px-2"
                aria-label={t("subscription.field.oneTimeTermUnit")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOM_CYCLE_UNITS.map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {t(customCycleUnitLabelKey(unit))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">{t("subscription.oneTimeTermHelp")}</p>
          <FieldError id={id("oneTimeTerm-error")} message={errors.oneTimeTerm} />
        </div>
      ) : null}

      {(formData.billingCycle === "custom" || formData.billingCycle === "one-time") && (
        <div className="grid gap-2">
          <Label htmlFor={id("paymentMethod")}>{t("subscription.field.paymentMethod")}</Label>
          <SubscriptionPaymentMethodSelect
            value={formData.paymentMethod}
            methods={config.paymentMethods}
            labelFor={label}
            placeholder={t("subscription.placeholder.paymentMethod")}
            tooltipContent={paymentMethodLabel ? label(paymentMethodLabel) : undefined}
            onValueChange={(value) => update("paymentMethod", value)}
          />
        </div>
      )}

      <SubscriptionFormDateFields id={id} formData={formData} update={update} errors={errors} />

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Label>{t("subscription.field.reminder")}</Label>
          {!isReminderDisabled && (
            <div className="flex items-center gap-2">
              <Label htmlFor={id("repeatReminderEnabled")} className="text-sm text-muted-foreground cursor-pointer">
                {t("subscription.repeatReminder")}
              </Label>
              <Switch
                id={id("repeatReminderEnabled")}
                checked={formData.repeatReminderEnabled}
                onCheckedChange={(checked) => update("repeatReminderEnabled", checked)}
              />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Select
            value={formData.reminderType === "custom" ? "custom" : formData.reminderType === "disabled" ? String(DISABLED_REMINDER_DAYS) : formData.reminderType === "inherit" ? String(INHERIT_REMINDER_DAYS) : formData.reminderDays}
            onValueChange={(value) => {
              if (value === "custom") {
                update("reminderType", "custom");
              } else if (value === String(DISABLED_REMINDER_DAYS)) {
                update("reminderType", "disabled");
                update("reminderDays", String(DISABLED_REMINDER_DAYS));
                update("repeatReminderEnabled", false);
              } else if (value === String(INHERIT_REMINDER_DAYS)) {
                update("reminderType", "inherit");
                update("reminderDays", String(INHERIT_REMINDER_DAYS));
              } else {
                update("reminderType", "preset");
                update("reminderDays", value);
              }
            }}
          >
            <SelectTrigger
              className={cn(
                "w-full border-border bg-secondary sm:flex-1",
                errors.reminderDays && "border-destructive focus:ring-destructive/40",
              )}
              aria-invalid={Boolean(errors.reminderDays)}
              aria-describedby={errors.reminderDays ? id("reminder-error") : undefined}
              aria-label={t("subscription.field.reminder")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={String(DISABLED_REMINDER_DAYS)}>
                {t("subscription.reminderDisabled")}
              </SelectItem>
              <SelectItem value={String(INHERIT_REMINDER_DAYS)}>
                {t("subscription.reminderInherit", { days: notificationReminderDays })}
              </SelectItem>
              {REMINDER_DAYS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value.toString()}>
                  {label(option.labels)}
                </SelectItem>
              ))}
              <SelectItem value="custom">{t("subscription.reminderCustom")}</SelectItem>
            </SelectContent>
          </Select>

          {formData.reminderType === "custom" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">{t("subscription.reminderBefore")}</span>
              <NumericInput
                name={id("customReminderDays")} allowNegative={false}
                decimalScale={0}
                inputMode="numeric" enterKeyHint="next"
                placeholder={t("subscription.daysPlaceholder")}
                value={formData.customReminderDays}
                onRawValueChange={(value: string) => update("customReminderDays", value)}
                aria-invalid={Boolean(errors.reminderDays)}
                aria-describedby={errors.reminderDays ? id("reminder-error") : undefined}
                className="w-20 border-border bg-secondary"
              />
              <span className="text-sm text-muted-foreground">{t("subscription.daysUnit")}</span>
            </div>
          )}
        </div>
        <FieldError id={id("reminder-error")} message={errors.reminderDays} />

        {!isReminderDisabled && formData.repeatReminderEnabled && (
          <div className="grid gap-3 rounded-lg border border-border bg-secondary/30 p-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={id("repeatReminderInterval")}>{t("subscription.repeatReminderInterval")}</Label>
              <Select
                value={formData.repeatReminderInterval}
                onValueChange={(value) => update("repeatReminderInterval", value as RepeatReminderInterval)}
              >
                <SelectTrigger id={id("repeatReminderInterval")} className="border-border bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPEAT_REMINDER_INTERVAL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {label(option.labels)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={id("repeatReminderWindow")}>{t("subscription.repeatReminderWindow")}</Label>
              <Select
                value={formData.repeatReminderWindow}
                onValueChange={(value) => update("repeatReminderWindow", value as RepeatReminderWindow)}
              >
                <SelectTrigger id={id("repeatReminderWindow")} className="border-border bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPEAT_REMINDER_WINDOW_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {label(option.labels)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">{repeatReminderPreview}</p>
          </div>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={id("website")}>{t("subscription.field.website")}</Label>
        <Input
          id={id("website")} name={id("website")} type="url" inputMode="url" enterKeyHint="next" autoCapitalize="none" spellCheck={false}
          placeholder="https://example.com"
          value={formData.website}
          onChange={(e) => update("website", e.target.value)}
          aria-invalid={Boolean(errors.website)}
          aria-describedby={errors.website ? id("website-error") : undefined}
          className="border-border bg-secondary"
        />
        <FieldError id={id("website-error")} message={errors.website} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={id("notes")}>{t("subscription.field.notes")}</Label>
        <Input
          id={id("notes")} name={id("notes")} enterKeyHint="done"
          placeholder={t("subscription.placeholder.notes")}
          value={formData.notes}
          onChange={(e) => update("notes", e.target.value)}
          className="border-border bg-secondary"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={id("tags")}>{t("subscription.field.tags")}</Label>
        <SubscriptionTagInput
          id={id("tags")}
          value={formData.tags}
          onChange={(tags) => update("tags", tags)}
          suggestions={availableTags}
          error={errors.tags}
          errorId={id("tags-error")}
          onClearError={() => onClearFieldError?.("tags")}
        />
      </div>
    </>
  );
});
