import { SubscriptionTier } from "@/services/types";

export type PlanPickerProps = {
  value: SubscriptionTier;
  onChange: (tier: SubscriptionTier) => void;
  basicPrice: number;
  premiumPrice: number;
  disabled?: boolean;
};

export const planFeatures: Record<SubscriptionTier, string[]> = {
  basic: [
    "Save and import your recipes",
    "Weekly meal plans and grocery lists",
    "Group voting and shared meal choices"
  ],
  premium: [
    "Everything in Basic",
    "Daily macros from meals or manual entries",
    "Macro targets, trends, and data exports"
  ]
};

export function monthlyPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}/month`;
}
