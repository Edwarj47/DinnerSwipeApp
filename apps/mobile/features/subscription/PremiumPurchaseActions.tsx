import { Text, View } from "react-native";
import { Button } from "@/components/Button";
import { useThemeColors } from "@/components/theme";
import { PremiumStatus } from "@/services/types";
import { useNativeBilling } from "./NativeBillingProvider";
import { SubscriptionDisclosures } from "./SubscriptionDisclosures";

export function PremiumPurchaseActions({ status }: { status?: PremiumStatus }) {
  const billing = useNativeBilling();
  const colors = useThemeColors();
  const canBuy = !!status && !status.premium_active && !status.welcome_active && !status.welcome_eligible
    && !status.external_subscription_active;
  return <View style={{ gap: 8 }}>
    <Text style={{ color: colors.ink }}>Premium {billing.price ? `${billing.price}/month` : "subscription unavailable"}</Text>
    <Text style={{ color: colors.muted }}>Basic stays free.</Text>
    <SubscriptionDisclosures />
    <Button label="Subscribe to Premium" icon="card" variant="primary"
      disabled={!canBuy || !billing.available || billing.busy} onPress={() => { void billing.buy(); }} />
    <Button label="Restore purchases" icon="refresh" disabled={billing.busy || !billing.canRestore}
      onPress={() => { void billing.restore(); }} />
    {status?.native_provider ? <Button label="Manage store subscription" icon="card" disabled={billing.busy || !billing.canRestore}
      onPress={() => { void billing.manage(); }} /> : null}
    {status?.source === "stripe" ? <Text style={{ color: colors.muted }}>Your existing subscription is managed where you purchased it.</Text> : null}
    {billing.message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.muted }}>{billing.message}</Text> : null}
    {!billing.available ? <Button label="Retry store connection" icon="refresh" onPress={billing.retry} /> : null}
  </View>;
}
