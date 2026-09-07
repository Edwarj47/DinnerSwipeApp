import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { PremiumStatus, WeeklyPlan } from "@/services/types";

type WeeklySlot = WeeklyPlan["slots"][number];
type SlotPatch = Partial<Omit<WeeklySlot, "id" | "recipe_name" | "recipe_photo_url" | "recipe_total_minutes" | "recipe_difficulty">>;

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SLOT_TYPES: { label: string; value: WeeklySlot["slot_type"] }[] = [
  { label: "Meal", value: "meal" },
  { label: "Leftovers", value: "leftovers" },
  { label: "Out", value: "dining_out" },
  { label: "Flex", value: "flexible" }
];

export default function WeekScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [expandedSlotId, setExpandedSlotId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["weekly-plan"], queryFn: () => apiFetch<WeeklyPlan>("/api/v1/weekly-plans/current") });
  const subscription = useQuery({ queryKey: ["subscription-status"], queryFn: () => apiFetch<PremiumStatus>("/api/v1/subscription/status"), retry: false });
  const sortedSlots = useMemo(() => [...(data?.slots ?? [])].sort((a, b) => a.sort_order - b.sort_order), [data?.slots]);
  const dayOptions = useMemo(() => (data ? weekDates(data.week_start) : []), [data]);
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/weekly-plans/current/slots/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setStatus("Meal removed.");
      await invalidatePlan(queryClient);
    }
  });
  const update = useMutation({
    mutationFn: ({ slot, patch }: { slot: WeeklySlot; patch: SlotPatch }) =>
      apiFetch(`/api/v1/weekly-plans/current/slots/${slot.id}`, { method: "PUT", body: JSON.stringify(patch) }),
    onSuccess: async () => {
      setStatus("Plan updated.");
      await invalidatePlan(queryClient);
    }
  });
  const move = useMutation({
    mutationFn: async ({ slot, direction }: { slot: WeeklySlot; direction: -1 | 1 }) => {
      const currentIndex = sortedSlots.findIndex((item) => item.id === slot.id);
      const target = sortedSlots[currentIndex + direction];
      if (!target) return;
      await Promise.all([
        apiFetch(`/api/v1/weekly-plans/current/slots/${slot.id}`, { method: "PUT", body: JSON.stringify({ sort_order: target.sort_order }) }),
        apiFetch(`/api/v1/weekly-plans/current/slots/${target.id}`, { method: "PUT", body: JSON.stringify({ sort_order: slot.sort_order }) })
      ]);
    },
    onSuccess: async () => {
      setStatus("Slot moved.");
      await invalidatePlan(queryClient);
    }
  });
  const regenerate = useMutation({
    mutationFn: () => apiFetch("/api/v1/grocery-lists/current/regenerate", { method: "POST" }),
    onSuccess: async () => {
      setStatus("Grocery list regenerated.");
      await queryClient.invalidateQueries({ queryKey: ["grocery"] });
    }
  });
  const confirmMeal = useMutation({
    mutationFn: ({ slot, mealStatus }: { slot: WeeklySlot; mealStatus: "ate" | "skipped" }) =>
      apiFetch("/api/v1/macros/confirmations", {
        method: "POST",
        body: JSON.stringify({
          recipe_id: slot.recipe_id,
          weekly_plan_slot_id: slot.id,
          meal_date: slot.slot_date,
          status: mealStatus,
          servings_consumed: slot.servings
        })
      }),
    onSuccess: async () => {
      setStatus("Meal logged.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["macro-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["macro-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["macro-analytics"] })
      ]);
    },
    onError: (error) => setStatus(String(error))
  });
  const startPremiumCheckout = useMutation({
    mutationFn: () =>
      apiFetch<{ checkout_url: string }>("/api/v1/subscription/checkout-session", {
        method: "POST",
        body: JSON.stringify({ tier: "premium" })
      }),
    onSuccess: async (data) => {
      setStatus("Opening Premium checkout.");
      await Linking.openURL(data.checkout_url);
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : String(error))
  });
  const plannedCount = sortedSlots.filter((slot) => slot.slot_type === "meal" && slot.recipe_id).length;
  const premiumActive = Boolean(subscription.data?.premium_active ?? subscription.data?.active);
  const premiumCheckoutReady = Boolean(subscription.data?.premium_stripe_configured);

  return (
    <Screen>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>This Week</Text>
          <Text style={styles.subtitle}>{isLoading ? "Loading plan..." : `${plannedCount} planned - ${data?.meal_target ?? 0} dinner slots`}</Text>
        </View>
        <Button label="Groceries" icon="basket" onPress={() => {
          regenerate.mutate();
          router.push("/grocery");
        }} />
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.min(100, ((plannedCount || 0) / Math.max(1, data?.meal_target ?? 1)) * 100)}%` }]} />
      </View>
      {status ? <Text style={styles.status}>{status}</Text> : null}
      {!premiumActive ? (
        <View style={styles.premiumBanner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.premiumTitle}>Premium macro tracking is managed from Profile.</Text>
            <Text style={styles.premiumNote}>
              Upgrade when you want meal confirmations, macro targets, and weekly nutrition totals.
            </Text>
          </View>
          <Button
            label={premiumCheckoutReady ? "Subscribe" : "Profile"}
            icon={premiumCheckoutReady ? "card" : "person-circle"}
            variant="primary"
            disabled={startPremiumCheckout.isPending}
            onPress={() => {
              if (premiumCheckoutReady) {
                startPremiumCheckout.mutate();
                return;
              }
              router.push({ pathname: "/profile", params: { section: "premium" } });
            }}
          />
        </View>
      ) : null}
      <View style={styles.list}>
        {sortedSlots.map((slot, index) => {
          const isExpanded = expandedSlotId === slot.id;
          return (
            <View key={slot.id} style={[styles.row, isExpanded ? styles.rowExpanded : null]}>
              <View style={styles.cardTop}>
                <View style={styles.slotBadge}>
                  <Text style={styles.slotBadgeText}>{index + 1}</Text>
                </View>
                {slot.recipe_photo_url ? <Image source={{ uri: slot.recipe_photo_url }} style={styles.thumb} contentFit="cover" /> : <View style={styles.emptyThumb} />}
                <View style={styles.slotMain}>
                  <Text style={styles.day}>{slot.slot_date ? formatAssignedDate(slot.slot_date) : "Unassigned"}</Text>
                  <Text style={styles.meal}>{slot.recipe_name ?? slotLabel(slot.slot_type)}</Text>
                  <Text style={styles.meta}>
                    Serves {slot.servings} - {slot.is_locked ? "kept" : "open to changes"}
                    {slot.recipe_total_minutes ? ` - ${slot.recipe_total_minutes} min` : ""}
                  </Text>
                </View>
                <Button
                  label={slot.recipe_id ? (isExpanded ? "Done" : "Edit") : "Find"}
                  icon={slot.recipe_id ? (isExpanded ? "checkmark" : "create") : "search"}
                  variant={slot.recipe_id ? "secondary" : "primary"}
                  onPress={() => {
                    if (!slot.recipe_id) {
                      openSlotPicker(router, slot, "Pick dinner");
                      return;
                    }
                    setExpandedSlotId(isExpanded ? null : slot.id);
                  }}
                />
              </View>
              {isExpanded ? (
                <>
                  <View style={styles.days}>
                    <Pressable accessibilityRole="button" onPress={() => update.mutate({ slot, patch: { slot_date: null } })} style={[styles.dayChip, !slot.slot_date && styles.activeChip]}>
                      <Text style={[styles.dayChipText, !slot.slot_date && styles.activeChipText]}>Any</Text>
                    </Pressable>
                    {dayOptions.map((day, dayIndex) => (
                      <Pressable key={day.iso} accessibilityRole="button" accessibilityLabel={`Assign to ${day.label}`} onPress={() => update.mutate({ slot, patch: { slot_date: day.iso } })} style={[styles.dayChip, slot.slot_date === day.iso && styles.activeChip]}>
                        <Text style={[styles.dayChipText, slot.slot_date === day.iso && styles.activeChipText]}>{DAYS[dayIndex]}</Text>
                        <Text style={[styles.dateText, slot.slot_date === day.iso && styles.activeChipText]}>{day.short}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.typeRow}>
                    {SLOT_TYPES.map((item) => (
                      <Pressable key={item.value} accessibilityRole="button" onPress={() => update.mutate({ slot, patch: { slot_type: item.value } })} style={[styles.typeButton, slot.slot_type === item.value && styles.typeActive]}>
                        <Text style={[styles.typeText, slot.slot_type === item.value && styles.typeTextActive]}>{item.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.controls}>
                    <View style={styles.stepper}>
                      <Button label="-" icon="remove" onPress={() => update.mutate({ slot, patch: { servings: Math.max(1, slot.servings - 1) } })} />
                      <Text style={styles.servings}>{slot.servings}</Text>
                      <Button label="+" icon="add" onPress={() => update.mutate({ slot, patch: { servings: slot.servings + 1 } })} />
                    </View>
                    <Button label={slot.is_locked ? "Unlock" : "Keep"} icon={slot.is_locked ? "lock-open" : "lock-closed"} onPress={() => update.mutate({ slot, patch: { is_locked: !slot.is_locked } })} />
                    <Button label="Up" icon="arrow-up" onPress={() => move.mutate({ slot, direction: -1 })} />
                    <Button label="Down" icon="arrow-down" onPress={() => move.mutate({ slot, direction: 1 })} />
                  </View>
                  <Text style={styles.lockHint}>
                    {slot.is_locked
                      ? "Kept meals stay fixed for future auto-pick or group-match replacement tools."
                      : "Open meals can be changed now and by future auto-pick tools."}
                  </Text>
                  <View style={styles.actions}>
                    {slot.recipe_id && premiumActive ? (
                      <>
                        <Button label="Ate" icon="checkmark-circle" variant="primary" disabled={confirmMeal.isPending} onPress={() => confirmMeal.mutate({ slot, mealStatus: "ate" })} />
                        <Button label="Skipped" icon="close-circle" disabled={confirmMeal.isPending} onPress={() => confirmMeal.mutate({ slot, mealStatus: "skipped" })} />
                      </>
                    ) : null}
                    {slot.recipe_id ? <Button label="Remove" icon="trash" variant="danger" onPress={() => remove.mutate(slot.id)} /> : null}
                    <Button label="Replace" icon="swap-horizontal" onPress={() => openSlotPicker(router, slot, slot.recipe_name ?? "this dinner")} />
                  </View>
                </>
              ) : null}
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

async function invalidatePlan(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["weekly-plan"] }),
    queryClient.invalidateQueries({ queryKey: ["grocery"] })
  ]);
}

function weekDates(weekStart: string) {
  const [year, month, day] = weekStart.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  return Array.from({ length: 7 }, (_, index) => {
    const value = new Date(start);
    value.setUTCDate(start.getUTCDate() + index);
    const iso = value.toISOString().slice(0, 10);
    return { iso, label: DAYS[index], short: `${value.getUTCMonth() + 1}/${value.getUTCDate()}` };
  });
}

function formatAssignedDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${DAYS[date.getUTCDay() === 0 ? 6 : date.getUTCDay() - 1]} ${month}/${day}`;
}

function slotLabel(type: WeeklySlot["slot_type"]) {
  if (type === "dining_out") return "Dining out";
  if (type === "leftovers") return "Leftovers";
  if (type === "flexible") return "Flexible dinner";
  return "Choose a meal";
}

function openSlotPicker(router: ReturnType<typeof useRouter>, slot: WeeklySlot, replaceName: string) {
  router.push({
    pathname: "/",
    params: {
      replace_slot_id: slot.id,
      replace_name: replaceName
    }
  });
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  title: { fontSize: 32, fontWeight: "900", color: Colors.ink },
  subtitle: { color: Colors.muted },
  progressTrack: { height: 8, backgroundColor: Colors.border, borderRadius: 999, overflow: "hidden", marginBottom: 10 },
  progressFill: { height: "100%", backgroundColor: Colors.tomato, borderRadius: 999 },
  status: { color: Colors.basil, fontWeight: "800", marginBottom: 10 },
  premiumBanner: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: Colors.surface, borderColor: Colors.border, borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 10 },
  premiumTitle: { color: Colors.ink, fontWeight: "900" },
  premiumNote: { color: Colors.muted, lineHeight: 19, fontSize: 13, marginTop: 3 },
  list: { gap: 10 },
  row: { backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, padding: 12, gap: 12 },
  rowExpanded: { borderColor: "#f0b6b2" },
  cardTop: { flexDirection: "row", gap: 10, alignItems: "center" },
  slotBadge: { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.tomato, alignItems: "center", justifyContent: "center" },
  slotBadgeText: { color: "#fff", fontWeight: "900" },
  thumb: { width: 58, height: 58, borderRadius: 8, backgroundColor: Colors.border },
  emptyThumb: { width: 58, height: 58, borderRadius: 8, backgroundColor: Colors.softRed, borderColor: Colors.border, borderWidth: 1 },
  slotMain: { flex: 1, minWidth: 0 },
  day: { color: Colors.basil, fontWeight: "800", fontSize: 12, textTransform: "uppercase" },
  meal: { color: Colors.ink, fontSize: 18, fontWeight: "800", textTransform: "capitalize" },
  meta: { color: Colors.muted, marginTop: 2 },
  days: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dayChip: { minWidth: 44, minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  activeChip: { backgroundColor: Colors.tomato, borderColor: Colors.tomato },
  dayChipText: { color: Colors.ink, fontWeight: "900", fontSize: 12 },
  dateText: { color: Colors.muted, fontSize: 11, marginTop: 1 },
  activeChipText: { color: "#fff" },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, backgroundColor: Colors.softRed, borderRadius: 8, padding: 4 },
  typeButton: { flexGrow: 1, minHeight: 38, borderRadius: 7, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  typeActive: { backgroundColor: Colors.surface },
  typeText: { color: Colors.muted, fontWeight: "900" },
  typeTextActive: { color: Colors.tomato },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  servings: { minWidth: 28, textAlign: "center", color: Colors.ink, fontWeight: "900", fontSize: 18 },
  lockHint: { color: Colors.muted, lineHeight: 19, fontSize: 13 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 }
});
