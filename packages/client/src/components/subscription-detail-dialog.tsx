/**
 * 订阅详情弹窗。
 *
 * 架构位置：列表、仪表盘和日历共用这一份只读详情，编辑仍交回页面级 CRUD 控制器。
 * 注意：金额、周期、状态和提醒标签必须继续复用订阅 domain 常量，避免不同入口展示口径分叉。
 */
import { useState, type ReactNode } from "react";
import { Drawer } from "vaul";
import { CalendarPlus, Edit2, ExternalLink, X } from "lucide-react";
import type { Subscription, SubscriptionStatus } from "@/types/subscription";
import {
  CYCLE_LABELS,
  DEFAULT_NOTIFICATION_REMINDER_DAYS,
  INHERIT_REMINDER_DAYS,
  STATUS_LABELS,
} from "@/types/subscription";
import { AddToCalendarDialog } from "@/components/add-to-calendar-dialog";
import { SubscriptionLogo } from "@/components/subscription-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCustomConfig } from "@/contexts/CustomConfigContext";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSettings } from "@/hooks/use-settings";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import type { DateOnly } from "@/lib/time/date-only";
import { getEffectiveSubscriptionStatus } from "@/modules/subscriptions/domain/subscription-status";

const DEFAULT_LOGO_FALLBACK_COLOR = "hsl(var(--primary))";

const statusBadgeClassNames = {
  trial: "border-warning/20 bg-warning/10 text-warning",
  active: "border-success/20 bg-success/10 text-success",
  expired: "border-destructive/20 bg-destructive/10 text-destructive",
  paused: "border-muted bg-muted text-muted-foreground",
  cancelled: "border-destructive/20 bg-destructive/10 text-destructive",
} satisfies Record<SubscriptionStatus, string>;

interface SubscriptionDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription: Subscription | null;
  onEditSubscription?: (subscription: Subscription) => void;
  today: DateOnly | string;
}

interface SubscriptionDetailContentProps {
  subscription: Subscription;
  today: DateOnly | string;
  onClose: () => void;
  onEditSubscription?: (subscription: Subscription) => void;
  onAddToCalendar: () => void;
}

function DetailRow({
  label,
  children,
  alignStart = false,
}: {
  label: string;
  children: ReactNode;
  alignStart?: boolean;
}) {
  return (
    <div className={cn("grid gap-1 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]", alignStart ? "items-start" : "items-center")}>
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0 text-foreground sm:text-right">{children}</div>
    </div>
  );
}

function SubscriptionDetailContent({
  subscription,
  today,
  onClose,
  onEditSubscription,
  onAddToCalendar,
}: SubscriptionDetailContentProps) {
  const { config } = useCustomConfig();
  const { data: settings } = useSettings();
  const { t, label, formatDateOnly, formatCurrency } = useI18n();
  const category = config.categories.find((item) => item.value === subscription.category);
  const paymentMethod = subscription.paymentMethod
    ? config.paymentMethods.find((item) => item.value === subscription.paymentMethod)
    : undefined;
  const categoryColor = category?.color ?? DEFAULT_LOGO_FALLBACK_COLOR;
  const effectiveStatus = getEffectiveSubscriptionStatus(subscription, today);
  const inheritedReminderDays = settings?.notificationReminderDays ?? DEFAULT_NOTIFICATION_REMINDER_DAYS;
  const nextBillingLabel =
    subscription.billingCycle === "one-time"
      ? t("subscription.detail.purchaseDate")
      : t("subscription.detail.nextBilling");
  const reminderLabel = subscription.reminderDays === INHERIT_REMINDER_DAYS
    ? t("subscription.card.reminderInherit", { days: inheritedReminderDays })
    : t("reminder.days", { days: subscription.reminderDays });

  const handleEdit = () => {
    if (!onEditSubscription) return;
    // 详情和编辑都是 modal；先关详情再交给页面打开编辑，避免两个焦点陷阱同时存在。
    onClose();
    onEditSubscription(subscription);
  };

  return (
    <div className="grid gap-5">
      <div className="flex items-start gap-3">
        <SubscriptionLogo
          name={subscription.name}
          logo={subscription.logo}
          fallbackColor={categoryColor}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold text-foreground">{subscription.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {category ? label(category.labels) : subscription.category}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-secondary/50 p-4">
        <div className="min-w-0">
          <p className="truncate text-2xl font-bold text-foreground">
            {formatCurrency(subscription.price, subscription.currency)}
          </p>
          <p className="text-sm text-muted-foreground">
            {label(CYCLE_LABELS[subscription.billingCycle])}
          </p>
        </div>
        <Badge variant="outline" className={cn("shrink-0", statusBadgeClassNames[effectiveStatus])}>
          {label(STATUS_LABELS[effectiveStatus])}
        </Badge>
      </div>

      <div className="grid gap-3">
        <DetailRow label={t("subscription.detail.category")}>
          <span className="break-words">{category ? label(category.labels) : subscription.category}</span>
        </DetailRow>
        {subscription.paymentMethod ? (
          <DetailRow label={t("subscription.field.paymentMethod")}>
            <span className="break-words">{paymentMethod ? label(paymentMethod.labels) : subscription.paymentMethod}</span>
          </DetailRow>
        ) : null}
        <DetailRow label={nextBillingLabel}>
          {formatDateOnly(subscription.nextBillingDate, "full")}
        </DetailRow>
        <DetailRow label={t("subscription.detail.startDate")}>
          {formatDateOnly(subscription.startDate, "full")}
        </DetailRow>
        {subscription.trialEndDate ? (
          <DetailRow label={t("subscription.detail.trialEndDate")}>
            {formatDateOnly(subscription.trialEndDate, "full")}
          </DetailRow>
        ) : null}
        <DetailRow label={t("subscription.detail.reminder")}>
          {reminderLabel}
        </DetailRow>
        {subscription.tags.length > 0 ? (
          <DetailRow label={t("subscription.field.tags")} alignStart>
            <div className="flex flex-wrap gap-1 sm:justify-end">
              {subscription.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="max-w-full truncate text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          </DetailRow>
        ) : null}
        {subscription.website ? (
          <DetailRow label={t("subscription.field.website")}>
            <a
              href={subscription.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center justify-end gap-1 text-primary hover:underline"
            >
              <span className="truncate">{subscription.website}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </a>
          </DetailRow>
        ) : null}
        {subscription.notes ? (
          <div className="grid gap-2 border-t border-border pt-3">
            <p className="text-sm text-muted-foreground">{t("subscription.field.notes")}</p>
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-secondary/40 p-3 text-sm leading-6 text-foreground">
              {subscription.notes}
            </div>
          </div>
        ) : null}
      </div>

      <div className={cn("grid gap-2 pt-1", onEditSubscription ? "sm:grid-cols-[1fr_1.35fr_1fr]" : "sm:grid-cols-2")}>
        <Button variant="outline" className="border-border" onClick={onClose}>
          {t("common.close")}
        </Button>
        <Button variant="outline" className="border-border" onClick={onAddToCalendar}>
          <CalendarPlus className="h-4 w-4" />
          {t("subscription.addToCalendar")}
        </Button>
        {onEditSubscription ? (
          <Button className="bg-primary text-primary-foreground hover:bg-primary-glow" onClick={handleEdit}>
            <Edit2 className="h-4 w-4" />
            {t("common.edit")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function SubscriptionDetailDialog({
  open,
  onOpenChange,
  subscription,
  onEditSubscription,
  today,
}: SubscriptionDetailDialogProps) {
  const isMobile = useMediaQuery("(max-width: 639px)");
  const { t } = useI18n();
  const [showAddToCalendarDialog, setShowAddToCalendarDialog] = useState(false);
  const [calendarSubscription, setCalendarSubscription] = useState<Subscription | null>(null);
  const description = subscription
    ? t("subscription.detailDescription", { name: subscription.name })
    : t("subscription.detailFallbackDescription");
  const closeDetail = () => onOpenChange(false);
  const openAddToCalendar = () => {
    if (!subscription) return;
    // 添加到日历会先关闭详情；保留当前订阅快照，避免父级关闭动画清理 selected id 后子弹窗丢数据。
    setCalendarSubscription(subscription);
    setShowAddToCalendarDialog(true);
    closeDetail();
  };
  const handleAddToCalendarOpenChange = (nextOpen: boolean) => {
    setShowAddToCalendarDialog(nextOpen);
    if (!nextOpen) {
      setCalendarSubscription(null);
    }
  };

  return (
    <>
      {isMobile ? (
        <Drawer.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
          {open ? (
            <Drawer.Portal>
              <Drawer.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
              <Drawer.Content className="h5-drawer-panel fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[calc(var(--app-viewport-height)-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-lg border border-border bg-card text-card-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4">
                <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-muted" />
                <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
                  <div className="min-w-0">
                    <Drawer.Title className="truncate text-base font-semibold text-foreground">
                      {subscription?.name ?? t("subscription.detailFallbackTitle")}
                    </Drawer.Title>
                    <Drawer.Description className="sr-only">{description}</Drawer.Description>
                  </div>
                  <Drawer.Close asChild>
                    <Button variant="ghost" size="icon" className="-mr-2 -mt-2 h-9 w-9 text-muted-foreground">
                      <X className="h-4 w-4" />
                      <span className="sr-only">{t("common.close")}</span>
                    </Button>
                  </Drawer.Close>
                </div>
                {subscription ? (
                  <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                    <SubscriptionDetailContent
                      subscription={subscription}
                      today={today}
                      onClose={closeDetail}
                      onAddToCalendar={openAddToCalendar}
                      {...(onEditSubscription ? { onEditSubscription } : {})}
                    />
                  </div>
                ) : null}
              </Drawer.Content>
            </Drawer.Portal>
          ) : null}
        </Drawer.Root>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="max-h-[calc(var(--app-viewport-height)-3rem)] overflow-hidden border-border bg-card p-0 sm:max-w-lg">
            <div className="grid min-h-0 gap-4 overflow-y-auto p-6">
              <DialogHeader>
                <DialogTitle className="sr-only">
                  {subscription?.name ?? t("subscription.detailFallbackTitle")}
                </DialogTitle>
                <DialogDescription className="sr-only">{description}</DialogDescription>
              </DialogHeader>
              {subscription ? (
                <SubscriptionDetailContent
                  subscription={subscription}
                  today={today}
                  onClose={closeDetail}
                  onAddToCalendar={openAddToCalendar}
                  {...(onEditSubscription ? { onEditSubscription } : {})}
                />
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      )}
      {showAddToCalendarDialog ? (
        <AddToCalendarDialog
          open={showAddToCalendarDialog}
          onOpenChange={handleAddToCalendarOpenChange}
          subscription={calendarSubscription}
        />
      ) : null}
    </>
  );
}

export type { SubscriptionDetailDialogProps };
