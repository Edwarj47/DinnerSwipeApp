import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { useTransientMessage } from "@/components/useTransientMessage";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { CouponResult, PremiumStatus, SubscriptionPlanStatus, SubscriptionTier } from "@/services/types";

export function SubscriptionPanel() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [status, setStatus] = useTransientMessage();
  const [error, setError] = useState("");
  const [couponTier, setCouponTier] = useState<SubscriptionTier>("basic");
  const subscription = useQuery({
    queryKey: ["subscription-status"],
    queryFn: () => apiFetch<PremiumStatus>("/api/v1/subscription/status"),
    retry: false
  });
  const premiumActive = Boolean(subscription.data?.premium_active ?? subscription.data?.active);
  const basicPlan = useMemo(
    () => subscription.data?.plans?.find((plan: SubscriptionPlanStatus) => plan.tier === "basic"),
    [subscription.data?.plans]
  );
  const premiumPlan = useMemo(
    () => subscription.data?.plans?.find((plan: SubscriptionPlanStatus) => plan.tier === "premium"),
    [subscription.data?.plans]
  );
  const applyCode = useMutation({
    onMutate: () => { setStatus(""); setError(""); },
    mutationFn: () =>
      apiFetch<CouponResult>("/api/v1/subscription/coupon-code", {
        method: "POST",
        body: JSON.stringify({ code, tier: couponTier })
      }),
    onSuccess: async (data) => {
      setCode("");
      setError("");
      setStatus(data.message);
      if (data.subscription) queryClient.setQueryData(["subscription-status"], data.subscription);
      if (data.checkout_url) await Linking.openURL(data.checkout_url);
      await queryClient.invalidateQueries({ queryKey: ["subscription-status"] });
      await queryClient.invalidateQueries({ queryKey: ["premium-status"] });
      await queryClient.invalidateQueries({ queryKey: ["ai-recipe-usage"] });
    },
    onError: (error) => setError(error instanceof Error ? error.message : "Unable to apply code.")
  });

  const startCheckout = useMutation({
    mutationFn: (tier: SubscriptionTier) =>
      apiFetch<{ checkout_url: string }>("/api/v1/subscription/checkout-session", {
        method: "POST",
        body: JSON.stringify({ tier })
      }),
    onSuccess: async (data) => {
      setStatus("Opening checkout.");
      await Linking.openURL(data.checkout_url);
    },
    onError: (error) => setError(error instanceof Error ? error.message : "Unable to start checkout.")
  });

  const manageBilling = useMutation({
    mutationFn: () =>
      apiFetch<{ portal_url: string }>("/api/v1/premium/billing-portal-session", {
        method: "POST"
      }),
    onSuccess: async (data) => {
      setStatus("Opening billing portal.");
      await Linking.openURL(data.portal_url);
    },
    onError: (error) => setError(error instanceof Error ? error.message : "Unable to open billing.")
  });

  const currentTier = subscription.data?.current_tier ?? "none";
  const trialDays = subscription.data?.trial_days_remaining ?? 0;

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.section}>Subscription</Text>
          <Text style={styles.meta}>{tierSummary(currentTier, trialDays)}</Text>
        </View>
        <View style={[styles.statusPill, premiumActive ? styles.activePill : styles.lockedPill]}>
          <Text style={[styles.statusText, premiumActive ? styles.activeText : styles.lockedText]}>
            {currentTier === "none" ? "Inactive" : currentTier}
          </Text>
        </View>
      </View>

      <View style={styles.planList}>
        <PlanCard
          name="Basic"
          plan={basicPlan}
          fallbackPriceCents={subscription.data?.basic_monthly_price_cents ?? 599}
          fallbackDescription="Recipe saving, weekly plans, grocery lists, group voting, and web recipe imports."
          active={Boolean(subscription.data?.basic_active) && !premiumActive}
          badge={premiumActive ? "Included with Premium" : subscription.data?.trial_active ? `${trialDays} trial days left` : subscription.data?.basic_trial_eligible === false ? "Billed monthly" : "Card required for trial"}
          actionLabel={premiumActive ? "Included" : subscription.data?.basic_active ? "Current" : "Start Basic"}
          disabled={Boolean(subscription.data?.basic_active) || !subscription.data?.basic_stripe_configured || startCheckout.isPending}
          onPress={() => startCheckout.mutate("basic")}
        />
        <PlanCard
          name="Premium"
          plan={premiumPlan}
          fallbackPriceCents={subscription.data?.premium_monthly_price_cents ?? 999}
          fallbackDescription="Everything in Basic plus daily macros, planned-meal logging, analytics, and exports."
          active={premiumActive}
          badge="Macro tracking"
          actionLabel={premiumActive ? "Current" : "Upgrade"}
          disabled={premiumActive || !subscription.data?.premium_stripe_configured || startCheckout.isPending}
          onPress={() => startCheckout.mutate("premium")}
        />
      </View>
      <Text style={styles.meta}>Basic includes a private kitchen and one shared group. Premium includes unlimited shared groups.</Text>

      <View style={styles.codeBox}>
        <Text style={styles.codeTitle}>Coupon code</Text>
        <Text style={styles.meta}>Discounts follow the coupon's terms. Free-access coupons do not charge a card.</Text>
        {!subscription.data?.basic_active ? <SegmentedControl accessibilityLabel="Coupon plan" value={couponTier} onChange={setCouponTier}
          options={[{ label: "Basic", value: "basic" }, { label: "Premium", value: "premium" }]} /> : null}
        <View style={styles.actions}>
          <TextInput
            autoCapitalize="none"
            accessibilityLabel="Coupon code"
            value={code}
            onChangeText={setCode}
            placeholder="Coupon code"
            autoCorrect={false}
            placeholderTextColor="#9b928b"
            style={styles.input}
          />
          <Button
            label="Apply"
            icon="ticket"
            variant="primary"
            disabled={applyCode.isPending || code.trim().length < 3}
            onPress={() => applyCode.mutate()}
          />
        </View>
      </View>

      {subscription.data?.billing_management_available ? (
        <Button
          label="Manage billing"
          icon="card"
          disabled={manageBilling.isPending}
          onPress={() => manageBilling.mutate()}
        />
      ) : null}

      {status ? <Text accessibilityLiveRegion="polite" style={{ color: Colors.basil }}>{status}</Text> : null}
      {error || subscription.isError ? <Text accessibilityRole="alert" style={{ color: Colors.danger }}>{error || "Unable to load subscription."}</Text> : null}
    </View>
  );
}
function PlanCard({
  name,
  plan,
  fallbackPriceCents,
  fallbackDescription,
  active,
  badge,
  actionLabel,
  disabled,
  onPress
}: {
  name: string;
  plan?: SubscriptionPlanStatus;
  fallbackPriceCents: number;
  fallbackDescription: string;
  active: boolean;
  badge: string;
  actionLabel: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const price = plan?.monthly_price_cents ?? fallbackPriceCents;
  return (
    <View style={[styles.planCard, active ? styles.planCardActive : null]}>
      <View style={styles.planTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.planName}>{plan?.display_name ?? name}</Text>
          <Text style={styles.planDescription}>{plan?.description ?? fallbackDescription}</Text>
        </View>
        <View style={styles.priceBox}>
          <Text style={styles.price}>${(price / 100).toFixed(2)}</Text>
          <Text style={styles.pricePeriod}>/mo</Text>
        </View>
      </View>
      <View style={styles.planFooter}>
        <Text style={styles.planBadge}>{active ? "Active" : badge}</Text>
        <Button label={actionLabel} icon={active ? "checkmark" : "card"} disabled={disabled} onPress={onPress} />
      </View>
    </View>
  );
}

function tierSummary(currentTier: string, trialDays: number) {
  if (currentTier === "premium") return "Premium is active.";
  if (currentTier === "basic") return "Basic is active. Upgrade anytime for macro tracking.";
  if (currentTier === "trial") {
    return `Basic trial is active. ${trialDays} day${trialDays === 1 ? "" : "s"} left.`;
  }
  return "Start Basic with a card on file or choose Premium for macro tracking.";
}

const styles = StyleSheet.create({
  panel: { gap: 10, marginTop: 12, marginBottom: 8 },
  header: { flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "center" },
  section: { color: Colors.ink, fontWeight: "900", fontSize: 18 },
  meta: { color: Colors.muted, lineHeight: 20 },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  activePill: { backgroundColor: "#e8f5ee" },
  lockedPill: { backgroundColor: Colors.softRed },
  statusText: { fontWeight: "900", textTransform: "capitalize" },
  activeText: { color: Colors.basil },
  lockedText: { color: Colors.tomatoDark },
  planList: { gap: 8 },
  planCard: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 12, gap: 10 },
  planCardActive: { borderColor: Colors.tomato, backgroundColor: Colors.softRed },
  planTop: { flexDirection: "row", gap: 12 },
  planName: { color: Colors.ink, fontWeight: "900", fontSize: 17 },
  planDescription: { color: Colors.muted, lineHeight: 19, marginTop: 3 },
  priceBox: { alignItems: "flex-end", minWidth: 72 },
  price: { color: Colors.ink, fontWeight: "900", fontSize: 18 },
  pricePeriod: { color: Colors.muted, fontWeight: "700", fontSize: 12 },
  planFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  planBadge: { color: Colors.basil, fontWeight: "900", flex: 1 },
  codeBox: { backgroundColor: Colors.softRed, borderRadius: 8, padding: 12, gap: 8 },
  codeTitle: { color: Colors.ink, fontWeight: "900" },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, backgroundColor: Colors.surface, flex: 1, color: Colors.ink },
});
