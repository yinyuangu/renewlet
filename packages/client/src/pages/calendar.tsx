/**
 * 续费日历页（/calendar）。
 *
 * 功能：
 * - 以日历方式展示订阅的 nextBillingDate
 * - 支持从日历点击订阅并进入编辑
 */

import { useMemo, useState } from 'react';
import type { Subscription, SubscriptionDraft } from '@/types/subscription';
import { Header } from '@/components/header';
import { SubscriptionCalendar } from '@/components/subscription-calendar';
import { EditSubscriptionDialog } from '@/components/edit-subscription-dialog';
import { CalendarSkeleton } from '@/components/loading-skeleton';
import { useCreateSubscription, useSubscriptions, useUpdateSubscription } from '@/hooks/use-subscriptions';
import { collectSubscriptionTags } from '@/modules/subscriptions/domain/subscription-filters';
import { useI18n } from '@/i18n/I18nProvider';

/** 日历页组件。 */
const Calendar = () => {
  const subscriptionsQuery = useSubscriptions();
  const subscriptions = subscriptionsQuery.data ?? [];
  const createSubscription = useCreateSubscription();
  const updateSubscription = useUpdateSubscription();
  const { t } = useI18n();
  const availableTags = useMemo(() => collectSubscriptionTags(subscriptions), [subscriptions]);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  /** 从 Header 的新增弹窗提交订阅。 */
  const handleAddSubscription = (newSub: SubscriptionDraft) => {
    createSubscription.mutate(newSub);
  };

  /** 从日历中选择一条订阅进入编辑。 */
  const handleEditSubscription = (subscription: Subscription) => {
    setEditingSubscription(subscription);
    setEditDialogOpen(true);
  };

  /** 保存编辑后的订阅。 */
  const handleSaveSubscription = (updated: Subscription) => {
    updateSubscription.mutate(updated);
    setEditDialogOpen(false);
    setEditingSubscription(null);
  };

  // 与参考项目保持一致：订阅数据未加载完成前展示日历骨架屏。
  if (subscriptionsQuery.isPending) {
    return (
      <div className="min-h-screen bg-background">
        <Header onAddSubscription={handleAddSubscription} availableTags={availableTags} />
        <main className="mx-auto max-w-7xl px-6 py-8">
          <div className="mb-6">
            <div className="h-8 w-32 bg-muted rounded animate-pulse mb-2" />
            <div className="h-4 w-48 bg-muted rounded animate-pulse" />
          </div>
          <CalendarSkeleton />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header onAddSubscription={handleAddSubscription} availableTags={availableTags} />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">{t("calendar.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("calendar.pageSubtitle")}</p>
        </div>

        <SubscriptionCalendar 
          subscriptions={subscriptions} 
          onEditSubscription={handleEditSubscription}
        />
      </main>

      <EditSubscriptionDialog
        subscription={editingSubscription}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSave={handleSaveSubscription}
        availableTags={availableTags}
      />
    </div>
  );
};

export default Calendar;
