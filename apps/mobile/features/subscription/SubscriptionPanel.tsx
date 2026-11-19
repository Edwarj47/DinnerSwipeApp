import { useMutation, useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { Button } from "@/components/Button";
import { useThemeColors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { PremiumStatus } from "@/services/types";
import { PremiumPurchaseActions } from "./PremiumPurchaseActions";

export function SubscriptionPanel() {
  const colors = useThemeColors();
  const subscription = useQuery({ queryKey: ["subscription-status"],
    queryFn: () => apiFetch<PremiumStatus>("/api/v1/subscription/status"), retry: false });
  const status = subscription.isError ? undefined : subscription.data;
  const resend = useMutation({ mutationFn: () => apiFetch<{ sent: boolean }>("/api/v1/auth/resend-verification", { method: "POST" }) });
  return <View style={{ gap: 10, marginVertical: 12 }}>
    <Text style={{ color: colors.ink }}>Basic FREE</Text>
    <Text style={{ color: colors.muted }}>Recipe saving, weekly plans, groceries and group voting.</Text>
    {status?.welcome_active ? <Text style={{ color: colors.muted }}>
      Complimentary Premium: {status.welcome_days_remaining ?? 0} days left. No card or automatic charge.
      {status.welcome_ends_at ? ` Ends ${new Date(status.welcome_ends_at).toLocaleDateString()}. Basic stays free afterwards.` : ""}
    </Text> : <Text style={{ color: colors.muted }}>{status?.premium_active ? "Premium is active." : "Premium adds macro tracking, analytics and unlimited shared groups."}</Text>}
    {status?.welcome_eligible ? <View style={{ gap: 8 }}>
      <Text style={{ color: colors.ink, fontWeight: "700" }}>30 days of Premium, on us</Text>
      <Text style={{ color: colors.muted }}>No card. No automatic charge.</Text>
      {status.welcome_requires_verification ? <>
        <Text style={{ color: colors.muted }}>Verify your email to activate complimentary Premium. Basic stays available.</Text>
        <Button label="Resend verification email" icon="mail" disabled={resend.isPending} onPress={() => resend.mutate()} />
      </> : <Text style={{ color: colors.muted }}>Your complimentary access is being prepared.</Text>}
    </View> : null}
    {resend.isSuccess ? <Text accessibilityLiveRegion="polite" style={{ color: colors.muted }}>{resend.data.sent ? "Verification email sent." : "We could not send a verification email. Try again later or contact support."}</Text> : null}
    {resend.isError ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{resend.error instanceof Error ? resend.error.message : "Unable to send verification email."}</Text> : null}
    <PremiumPurchaseActions status={status} />
    {subscription.isError ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>Unable to check Premium access.</Text> : null}
  </View>;
}
