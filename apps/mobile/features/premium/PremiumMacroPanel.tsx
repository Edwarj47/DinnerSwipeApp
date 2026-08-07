import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { MacroSummary, MacroTarget, PremiumStatus } from "@/services/types";

export function PremiumMacroPanel() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [goal, setGoal] = useState("");
  const premium = useQuery({
    queryKey: ["premium-status"],
    queryFn: () => apiFetch<PremiumStatus>("/api/v1/premium/status"),
    retry: false
  });
  const summary = useQuery({
    queryKey: ["macro-summary"],
    queryFn: () => apiFetch<MacroSummary>("/api/v1/macros/summary?days=7"),
    retry: false
  });
  const targets = useQuery({
    queryKey: ["macro-targets"],
    queryFn: () => apiFetch<MacroTarget>("/api/v1/macros/targets"),
    retry: false
  });
  useEffect(() => {
    if (!targets.data) return;
    setCalories(valueToInput(targets.data.daily_calories));
    setProtein(valueToInput(targets.data.daily_protein_g));
    setCarbs(valueToInput(targets.data.daily_carbs_g));
    setFat(valueToInput(targets.data.daily_fat_g));
    setGoal(targets.data.goal ?? "");
  }, [targets.data]);
  const applyCode = useMutation({
    mutationFn: () => apiFetch<PremiumStatus>("/api/v1/premium/waiver-code", { method: "POST", body: JSON.stringify({ code }) }),
    onSuccess: async () => {
      setCode("");
      setStatus("Premium unlocked.");
      await refreshPremium(queryClient);
    },
    onError: (error) => setStatus(String(error))
  });
  const startCheckout = useMutation({
    mutationFn: () => apiFetch<{ checkout_url: string }>("/api/v1/premium/checkout-session", { method: "POST" }),
    onSuccess: async (data) => {
      setStatus("Opening checkout.");
      await Linking.openURL(data.checkout_url);
    },
    onError: (error) => setStatus(String(error))
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
    onError: (error) => setStatus(String(error))
  });
  const premiumActive = Boolean(premium.data?.active);
  const price = `$${(premium.data?.monthly_price_cents ?? 999) / 100}/mo`;
  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View>
          <Text style={styles.section}>Premium macros</Text>
          <Text style={styles.price}>{premiumActive ? "Active" : price}</Text>
        </View>
        <View style={[styles.statusPill, premiumActive ? styles.activePill : styles.lockedPill]}>
          <Text style={[styles.statusText, premiumActive ? styles.activeText : styles.lockedText]}>
            {premiumActive ? premium.data?.source ?? "premium" : "locked"}
          </Text>
        </View>
      </View>
      <View style={styles.metrics}>
        <Metric label="Meals" value={String(summary.data?.eaten_meals ?? 0)} />
        <Metric label="Protein" value={`${summary.data?.totals.protein_g ?? 0}g`} />
        <Metric label="Calories" value={String(summary.data?.totals.calories ?? 0)} />
      </View>
      {!premiumActive ? (
        <>
          <TextInput autoCapitalize="none" accessibilityLabel="Premium waiver code" value={code} onChangeText={setCode} placeholder="Waiver code" style={styles.input} />
          <View style={styles.actions}>
            <Button label="Apply code" icon="ticket" variant="primary" disabled={applyCode.isPending || code.trim().length < 3} onPress={() => applyCode.mutate()} />
            <Button label="Subscribe" icon="card" disabled={!premium.data?.stripe_configured || startCheckout.isPending} onPress={() => startCheckout.mutate()} />
          </View>
        </>
      ) : (
        <>
          <View style={styles.grid}>
            <TextInput accessibilityLabel="Daily calories target" value={calories} onChangeText={setCalories} keyboardType="number-pad" placeholder="Calories" style={[styles.input, styles.gridInput]} />
            <TextInput accessibilityLabel="Daily protein target" value={protein} onChangeText={setProtein} keyboardType="decimal-pad" placeholder="Protein g" style={[styles.input, styles.gridInput]} />
            <TextInput accessibilityLabel="Daily carbs target" value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" placeholder="Carbs g" style={[styles.input, styles.gridInput]} />
            <TextInput accessibilityLabel="Daily fat target" value={fat} onChangeText={setFat} keyboardType="decimal-pad" placeholder="Fat g" style={[styles.input, styles.gridInput]} />
          </View>
          <TextInput accessibilityLabel="Macro goal" value={goal} onChangeText={setGoal} placeholder="Goal" style={styles.input} />
          <Button label="Save targets" icon="save" variant="primary" disabled={saveTargets.isPending} onPress={() => saveTargets.mutate()} />
        </>
      )}
      {summary.data?.unmatched_meals ? <Text style={styles.meta}>{summary.data.unmatched_meals} meals need macro review.</Text> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}
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
    queryClient.invalidateQueries({ queryKey: ["premium-status"] }),
    queryClient.invalidateQueries({ queryKey: ["macro-summary"] }),
    queryClient.invalidateQueries({ queryKey: ["macro-targets"] })
  ]);
}

function valueToInput(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function inputToNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value.trim() ? parsed : null;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, padding: 14, gap: 10, marginBottom: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "center" },
  section: { color: Colors.ink, fontWeight: "900", fontSize: 18 },
  price: { color: Colors.muted, fontWeight: "800", marginTop: 2 },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  activePill: { backgroundColor: "#e8f5ee" },
  lockedPill: { backgroundColor: Colors.softRed },
  statusText: { fontWeight: "900", textTransform: "capitalize" },
  activeText: { color: Colors.basil },
  lockedText: { color: Colors.tomatoDark },
  metrics: { flexDirection: "row", gap: 8 },
  metric: { flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 10 },
  metricValue: { color: Colors.ink, fontWeight: "900", fontSize: 18 },
  metricLabel: { color: Colors.muted, fontWeight: "800", fontSize: 12 },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12 },
  actions: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gridInput: { flex: 1, minWidth: 118 },
  meta: { color: Colors.muted, lineHeight: 20 },
  status: { color: Colors.basil, fontWeight: "700" }
});
