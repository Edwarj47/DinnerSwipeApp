import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { useThemeColors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { PremiumStatus } from "@/services/types";
import { PremiumPurchaseActions } from "./PremiumPurchaseActions";

export function SubscriptionPanel() {
  const colors = useThemeColors();
  const subscription = useQuery({ queryKey: ["subscription-status"],
    queryFn: () => apiFetch<PremiumStatus>("/api/v1/subscription/status"), retry: false });
  const status = subscription.isError ? undefined : subscription.data;
  return <View style={{ gap: 10, marginVertical: 12 }}>
    <Text style={{ color: colors.ink, fontWeight: "900", fontSize: 18 }}>Subscription</Text>
    <Text style={{ color: colors.ink }}>Basic FREE</Text>
    <Text style={{ color: colors.muted }}>Recipe saving, weekly plans, groceries and group voting.</Text>
    {status?.welcome_active ? <Text style={{ color: colors.muted }}>
      Complimentary Premium: {status.welcome_days_remaining ?? 0} days left. No card or automatic charge.
      {status.welcome_ends_at ? ` Ends ${new Date(status.welcome_ends_at).toLocaleDateString()}. Basic stays free afterwards.` : ""}
    </Text> : <Text style={{ color: colors.muted }}>{status?.premium_active ? "Premium is active." : "Premium adds macro tracking, analytics and unlimited shared groups."}</Text>}
    <PremiumPurchaseActions status={status} />
    {subscription.isError ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>Unable to check Premium access.</Text> : null}
  </View>;
}
