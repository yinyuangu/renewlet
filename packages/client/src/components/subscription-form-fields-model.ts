import type { Dispatch, SetStateAction } from "react";
import type { UploadStatus as LogoUploadStatus } from "@/components/logo-picker";
import type { CustomConfig } from "@/types/config";
import type { SubscriptionFormState } from "@/types/subscription-form";

export interface SubscriptionFormFieldsProps {
  idPrefix: string;
  config: CustomConfig;
  formData: SubscriptionFormState;
  setFormData: Dispatch<SetStateAction<SubscriptionFormState>>;
  availableTags?: readonly string[] | undefined;
  onLogoUploadStatusChange: (status: LogoUploadStatus) => void;
  onFieldChange?: <K extends keyof SubscriptionFormState>(key: K, value: SubscriptionFormState[K]) => void;
  errors?: SubscriptionFormErrors | undefined;
  onClearFieldError?: ((field: keyof SubscriptionFormErrors) => void) | undefined;
  notificationReminderDays: number;
}

export type SubscriptionFormErrors = Partial<Record<
  "name" | "price" | "dates" | "customDays" | "reminderDays" | "website" | "tags",
  string
>>;

export type SubscriptionFormFieldUpdater = <K extends keyof SubscriptionFormState>(
  key: K,
  value: SubscriptionFormState[K],
) => void;

export const errorFieldByFormKey: Partial<Record<keyof SubscriptionFormState, keyof SubscriptionFormErrors>> = {
  name: "name",
  price: "price",
  billingCycle: "customDays",
  customDays: "customDays",
  startDate: "dates",
  nextBillingDate: "dates",
  reminderType: "reminderDays",
  reminderDays: "reminderDays",
  customReminderDays: "reminderDays",
  website: "website",
  tags: "tags",
} satisfies Partial<Record<keyof SubscriptionFormState, keyof SubscriptionFormErrors>>;
