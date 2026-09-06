import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import {
  MacroSummary,
  MacroTarget,
  PremiumStatus,
  SubscriptionPlanStatus,
  SubscriptionTier
} from "@/services/types";

export function PremiumMacroPanel() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [goal, setGoal] = useState("");
  const subscription = useQuery({
    queryKey: ["subscription-status"],
    queryFn: () => apiFetch<PremiumStatus>("/api/v1/subscription/status"),
    retry: false
  });
  const premiumActive = Boolean(subscription.data?.premium_active ?? subscription.data?.active);
  const summary = useQuery({
    queryKey: ["macro-summary"],
    queryFn: () => apiFetch<MacroSummary>("/api/v1/macros/summary?days=7"),
    enabled: premiumActive,
    retry: false
  });
  const targets = useQuery({
    queryKey: ["macro-targets"],
    queryFn: () => apiFetch<MacroTarget>("/api/v1/macros/targets"),
    enabled: premiumActive,
    retry: false
  });
  const basicPlan = useMemo(
    () => subscription.data?.plans.find((plan: SubscriptionPlanStatus) => plan.tier === "basic"),
    [subscription.data?.plans]
  );
  const premiumPlan = useMemo(
    () => subscription.data?.plans.find((plan: SubscriptionPlanStatus) => plan.tier === "premium"),
    [subscription.data?.plans]
  );

  useEffect(() => {
    if (!targets.data) return;
    setCalories(valueToInput(targets.data.daily_calories));
    setProtein(valueToInput(targets.data.daily_protein_g));
    setCarbs(valueToInput(targets.data.daily_carbs_g));
    setFat(valueToInput(targets.data.daily_fat_g));
    setGoal(targets.data.goal ?? "");
  }, [targets.data]);

  const applyCode = useMutation({
    mutationFn: () =>
      apiFetch<PremiumStatus>("/api/v1/subscription/waiver-code", {
        method: "POST",
        body: JSON.stringify({ code })
      }),
    onSuccess: async (data) => {
      setCode("");
      setStatus(data.premium_active ? "Premium access unlocked." : "Basic access unlocked.");
      await refreshPremium(queryClient);
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : "Unable to apply code.")
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
    onError: (error) => setStatus(error instanceof Error ? error.message : "Unable to start checkout.")
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
    onError: (error) => setStatus(error instanceof Error ? error.message : "Unable to open billing.")
  });

  const saveTargets = useMutation({
    mutationFn: () =>
      apiFetch<MacroTarget>("/api/v1/macros/targets", {
        method: "PUT",
        body: JSON.stringify({
          daily_calories: inputToNumber(calories),
          daily_protein_g: inputToNumber(protein),
          daily_carbs_g: inputToNumber(carbs),
          daily_fat_g: inputToNumber(fat),
          goal: goal.trim() || null
        })
      }),
    onSuccess: async () => {
      setStatus("Macro targets saved.");
      await refreshPremium(queryClient);
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : "Unable to save targets.")
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
          badge={subscription.data?.trial_active ? `${trialDays} trial days left` : "First month free"}
          actionLabel={subscription.data?.basic_active ? "Current" : "Subscribe Basic"}
          disabled={Boolean(subscription.data?.basic_active) || !subscription.data?.basic_stripe_configured || startCheckout.isPending}
          onPress={() => startCheckout.mutate("basic")}
        />
        <PlanCard
          name="Premium"
          plan={premiumPlan}
          fallbackPriceCents={subscription.data?.premium_monthly_price_cents ?? 999}
          fallbackDescription="Everything in Basic plus macro targets, meal confirmations, and weekly nutrition summaries."
          active={premiumActive}
          badge="Macro tracking"
          actionLabel={premiumActive ? "Current" : "Upgrade"}
          disabled={premiumActive || !subscription.data?.premium_stripe_configured || startCheckout.isPending}
          onPress={() => startCheckout.mutate("premium")}
        />
      </View>

      <View style={styles.codeBox}>
        <Text style={styles.codeTitle}>Testing access code</Text>
        <View style={styles.actions}>
          <TextInput
            autoCapitalize="none"
            accessibilityLabel="Subscription access code"
            value={code}
            onChangeText={setCode}
            placeholder="Access code"
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

      <View style={styles.divider} />
      <Text style={styles.section}>Premium macros</Text>
      {!premiumActive ? (
        <View style={styles.lockedBox}>
          <Text style={styles.lockedTitle}>Upgrade to track macros.</Text>
          <Text style={styles.meta}>
            Premium will track meals you confirm you ate or skipped and compare them to your
            targets. Automatic nutrition extraction is not part of this MVP yet.
          </Text>
          {Platform.OS !== "web" ? (
            <Text style={styles.meta}>
              Native app-store subscription flow will be added before public iOS or Android sales.
            </Text>
          ) : null}
        </View>
      ) : (
        <>
          <View style={styles.metrics}>
            <Metric label="Meals" value={String(summary.data?.eaten_meals ?? 0)} />
            <Metric label="Protein" value={`${summary.data?.totals.protein_g ?? 0}g`} />
            <Metric label="Calories" value={String(summary.data?.totals.calories ?? 0)} />
          </View>
          <View style={styles.grid}>
            <TextInput accessibilityLabel="Daily calories target" value={calories} onChangeText={setCalories} keyboardType="number-pad" placeholder="Calories" style={[styles.input, styles.gridInput]} />
            <TextInput accessibilityLabel="Daily protein target" value={protein} onChangeText={setProtein} keyboardType="decimal-pad" placeholder="Protein g" style={[styles.input, styles.gridInput]} />
            <TextInput accessibilityLabel="Daily carbs target" value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" placeholder="Carbs g" style={[styles.input, styles.gridInput]} />
            <TextInput accessibilityLabel="Daily fat target" value={fat} onChangeText={setFat} keyboardType="decimal-pad" placeholder="Fat g" style={[styles.input, styles.gridInput]} />
          </View>
          <TextInput accessibilityLabel="Macro goal" value={goal} onChangeText={setGoal} placeholder="Goal" style={styles.input} />
          <Button
            label="Save targets"
            icon="save"
            variant="primary"
            disabled={saveTargets.isPending}
            onPress={() => saveTargets.mutate()}
          />
        </>
      )}
      {summary.data?.unmatched_meals ? <Text style={styles.meta}>{summary.data.unmatched_meals} meals need macro review.</Text> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

async function refreshPremium(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["subscription-status"] }),
    queryClient.invalidateQueries({ queryKey: ["premium-status"] }),
    queryClient.invalidateQueries({ queryKey: ["macro-summary"] }),
    queryClient.invalidateQueries({ queryKey: ["macro-targets"] })
  ]);
}

function tierSummary(currentTier: string, trialDays: number) {
  if (currentTier === "premium") return "Premium is active.";
  if (currentTier === "basic") return "Basic is active. Upgrade anytime for macro tracking.";
  if (currentTier === "trial") {
    return `Basic trial is active. ${trialDays} day${trialDays === 1 ? "" : "s"} left.`;
  }
  return "Choose Basic to keep using the app or Premium for macro tracking.";
}

function valueToInput(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function inputToNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value.trim() ? parsed : null;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, padding: 14, gap: 12, marginBottom: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "center" },
  section: { color: Colors.ink, fontWeight: "900", fontSize: 18 },
  meta: { color: Colors.muted, lineHeight: 20 },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  activePill: { backgroundColor: "#e8f5ee" },
  lockedPill: { backgroundColor: Colors.softRed },
  statusText: { fontWeight: "900", textTransform: "capitalize" },
  activeText: { color: Colors.basil },
  lockedText: { color: Colors.tomatoDark },
  planList: { gap: 10 },
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
  actions: { flexDirection: "row", gap: 10, flexWrap: "wrap", alignItems: "center" },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, backgroundColor: Colors.surface, flex: 1 },
  divider: { height: 1, backgroundColor: Colors.border },
  lockedBox: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 12, gap: 6 },
  lockedTitle: { color: Colors.ink, fontWeight: "900" },
  metrics: { flexDirection: "row", gap: 8 },
  metric: { flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 10 },
  metricValue: { color: Colors.ink, fontWeight: "900", fontSize: 18 },
  metricLabel: { color: Colors.muted, fontWeight: "800", fontSize: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gridInput: { flex: 1, minWidth: 118 },
  status: { color: Colors.basil, fontWeight: "700" }
});
