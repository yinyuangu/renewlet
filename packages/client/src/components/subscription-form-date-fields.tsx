import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { FieldError } from "@/components/ui/field-error";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n/I18nProvider";
import { dateOnlyToLocalDate, dateToDateOnly } from "@/lib/time/date-only";
import { cn } from "@/lib/utils";
import type { SubscriptionFormErrors, SubscriptionFormFieldUpdater } from "@/components/subscription-form-fields-model";
import type { SubscriptionFormState } from "@/types/subscription-form";

interface SubscriptionFormDateFieldsProps {
  id: (name: string) => string;
  formData: SubscriptionFormState;
  update: SubscriptionFormFieldUpdater;
  errors: SubscriptionFormErrors;
}

export function SubscriptionFormDateFields({ id, formData, update, errors }: SubscriptionFormDateFieldsProps) {
  const { t, formatDateOnly } = useI18n();
  const [startDatePickerOpen, setStartDatePickerOpen] = useState(false);
  const [nextBillingDatePickerOpen, setNextBillingDatePickerOpen] = useState(false);
  const startDateId = id("startDate");
  const startDateLabelId = id("startDate-label");
  const startDateValueId = id("startDate-value");
  const nextBillingDateId = id("nextBillingDate");
  const nextBillingDateLabelId = id("nextBillingDate-label");
  const nextBillingDateValueId = id("nextBillingDate-value");
  const selectedStartDate = formData.startDate ? dateOnlyToLocalDate(formData.startDate) : undefined;
  const selectedNextBillingDate = formData.nextBillingDate ? dateOnlyToLocalDate(formData.nextBillingDate) : undefined;
  // 当非法到期日被清空后，打开到期日历应落在开始日所在月份，让下一个合法选择直接可见。
  const nextBillingDateCalendarMonth = selectedNextBillingDate ?? selectedStartDate;

  return (
    <div className="grid gap-4 rounded-lg border border-border bg-secondary/30 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Label className="text-base font-medium">{t("subscription.section.dates")}</Label>
        <div className="flex items-center gap-2">
          <Label htmlFor={id("autoCalculate")} className="text-sm text-muted-foreground cursor-pointer">
            {t("subscription.autoCalculate")}
          </Label>
          <Switch
            id={id("autoCalculate")}
            checked={formData.autoCalculate}
            disabled={formData.billingCycle === "one-time"}
            onCheckedChange={(checked) => update("autoCalculate", checked)}
          />
        </div>
      </div>

      <div className="grid items-start gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label id={startDateLabelId} htmlFor={startDateId}>
            {t("subscription.field.startDate")}
          </Label>
          <Popover open={startDatePickerOpen} onOpenChange={setStartDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                id={startDateId}
                variant="outline"
                aria-labelledby={`${startDateLabelId} ${startDateValueId}`}
                aria-invalid={Boolean(errors.dates)}
                aria-describedby={errors.dates ? id("dates-error") : undefined}
                className={cn(
                  "w-full justify-start text-left font-normal border-border bg-secondary",
                  !formData.startDate && "text-muted-foreground",
                  errors.dates && "border-destructive focus-visible:ring-destructive/40",
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                <span id={startDateValueId}>
                  {formData.startDate ? formatDateOnly(formData.startDate, "full") : t("subscription.placeholder.date")}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-auto p-0 border-border bg-card"
              align="start"
              mobileDetent="compact"
              mobileKind="calendar"
            >
              <Calendar
                mode="single"
                {...(selectedStartDate ? { selected: selectedStartDate, defaultMonth: selectedStartDate } : {})}
                onSelect={(date) => {
                  update("startDate", date ? dateToDateOnly(date) : undefined);
                  setStartDatePickerOpen(false);
                }}
                autoFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="grid gap-2">
          <Label id={nextBillingDateLabelId} htmlFor={nextBillingDateId}>
            {t("subscription.field.nextBillingDate")}
          </Label>
          <Popover open={nextBillingDatePickerOpen} onOpenChange={setNextBillingDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                id={nextBillingDateId}
                variant="outline"
                disabled={formData.autoCalculate}
                aria-labelledby={`${nextBillingDateLabelId} ${nextBillingDateValueId}`}
                aria-invalid={Boolean(errors.dates)}
                aria-describedby={errors.dates ? id("dates-error") : undefined}
                className={cn(
                  "w-full justify-start text-left font-normal border-border bg-secondary",
                  !formData.nextBillingDate && "text-muted-foreground",
                  formData.autoCalculate && "opacity-60",
                  errors.dates && "border-destructive focus-visible:ring-destructive/40",
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                <span id={nextBillingDateValueId}>
                  {formData.nextBillingDate
                    ? formatDateOnly(formData.nextBillingDate, "full")
                    : t("subscription.placeholder.date")}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-auto p-0 border-border bg-card"
              align="start"
              mobileDetent="compact"
              mobileKind="calendar"
            >
              <Calendar
                mode="single"
                {...(selectedNextBillingDate ? { selected: selectedNextBillingDate } : {})}
                {...(nextBillingDateCalendarMonth ? { defaultMonth: nextBillingDateCalendarMonth } : {})}
                // DayPicker 的 before 是排他边界：禁用开始日前的日期，同时保留“同一天到期”这个合法选择。
                {...(selectedStartDate ? { disabled: { before: selectedStartDate } } : {})}
                onSelect={(date) => {
                  update("nextBillingDate", date ? dateToDateOnly(date) : undefined);
                  setNextBillingDatePickerOpen(false);
                }}
                autoFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          {formData.autoCalculate && (
            <p className="text-xs text-muted-foreground">{t("subscription.autoCalculateHelp")}</p>
          )}
          {formData.billingCycle === "one-time" && (
            <p className="text-xs text-muted-foreground">{t("subscription.oneTimeDateHelp")}</p>
          )}
        </div>
      </div>
      <FieldError id={id("dates-error")} message={errors.dates} />
    </div>
  );
}
