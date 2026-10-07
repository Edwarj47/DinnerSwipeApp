import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, ViewStyle } from "react-native";

import { Button } from "@/components/Button";
import { useTransientMessage } from "@/components/useTransientMessage";
import { Screen } from "@/components/Screen";
import { Colors } from "@/components/theme";
import { apiFetch as remoteFetch } from "@/services/api";
import { useSpace } from "@/features/groups/useSpace";
import { SpaceSelector } from "@/features/groups/SpaceSelector";
import { PremiumStatus, UserProfile, WeeklyPlan } from "@/services/types";
import { shouldConfirmPlanReset } from "@/services/profilePreferences";
import { WeekDrag, WeekDragHandle, WeekDropDay, WeekDropMeal } from "@/features/planner/WeekDrag";
import { reorderDaySlots } from "@/features/planner/weekDrop";
import { DaySelection } from "@/features/planner/DaySelection";
import { RecipePicker } from "@/features/recipes/RecipePicker";
import { RecipePhoto } from "@/features/recipes/RecipePhoto";
import { usePlannerStore } from "@/stores/plannerStore";
import { plannerContextKey, useCurrentWeek } from "@/features/planner/useCurrentWeek";
import { TourTarget } from "@/features/onboarding/TourTarget";
import { todayISO } from "@/features/premium/macroDates";

type WeeklySlot = WeeklyPlan["slots"][number];
type SlotPatch = Partial<Omit<WeeklySlot, "id" | "recipe_name" | "recipe_photo_url" | "recipe_total_minutes" | "recipe_difficulty">>;

export default function WeekScreen() {
  const space = useSpace();
  return <WeekContent key={space.key} />;
}

function WeekContent() {
  const space = useSpace();
  const apiFetch = <T,>(path: string, init?: RequestInit) => init ? remoteFetch<T>(space.path(path), init) : remoteFetch<T>(space.path(path));
  const [portion, setPortion] = useState(1);
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();
  const compact = width < 360 || (width < 480 && fontScale > 1.2);
  const queryClient = useQueryClient();
  const [statusIsError, setStatusIsError] = useState(false);
  const [status, setStatus] = useTransientMessage(statusIsError);
  const [expandedSlotId, setExpandedSlotId] = useState<string | null>(null);
  const [resetScope, setResetScope] = useState<{ date: string | null; label: string } | null>(null);
  const [addDay, setAddDay] = useState<{ iso: string; label: string } | null>(null);
  const [duplicateSlot, setDuplicateSlot] = useState<WeeklySlot | null>(null);
  const { data, isLoading, error, refetch } = useCurrentWeek();
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => apiFetch<UserProfile>("/api/v1/profile"), retry: false });
  const subscription = useQuery({ queryKey: ["subscription-status"], queryFn: () => apiFetch<PremiumStatus>("/api/v1/subscription/status"), retry: false });
  const sortedSlots = useMemo(() => [...(data?.slots ?? [])].sort((a, b) => a.sort_order - b.sort_order), [data?.slots]);
  const dayOptions = useMemo(() => (data ? weekDates(data.week_start) : []), [data]);
  const groups = [...dayOptions, { iso: "", label: "Unscheduled", short: "" }].map(day => ({
    ...day, slots: sortedSlots.filter(slot => (slot.slot_date ?? "") === day.iso && (slot.recipe_id || slot.slot_type !== "flexible"))
  }));
  function showError(error: unknown) {
    setStatusIsError(true);
    setStatus(error instanceof Error ? error.message : "Unable to update this week. Try again.");
  }
  const addMeal = useMutation({
    mutationFn: ({ recipeId, date }: { recipeId: string; date: string | null }) => apiFetch<WeeklyPlan>("/api/v1/weekly-plans/current/slots", {
      method: "POST", body: JSON.stringify({ recipe_id: recipeId, slot_date: date })
    }),
    onSuccess: async plan => {
      queryClient.setQueryData(plan.household_id ? ["weekly-plan", plan.household_id] : ["weekly-plan"], plan);
      setAddDay(null);
      setStatusIsError(false);
      setStatus("Meal added.");
      await invalidatePlan(queryClient);
    },
    onError: showError
  });
  const duplicateMeal = useMutation({
    mutationFn: ({ slot, date }: { slot: WeeklySlot; date: string | null }) => apiFetch<WeeklyPlan>("/api/v1/weekly-plans/current/slots", {
      method: "POST", body: JSON.stringify({ recipe_id: slot.recipe_id, slot_date: date, servings: slot.servings })
    }),
    onSuccess: async (plan, { date }) => {
      queryClient.setQueryData(plan.household_id ? ["weekly-plan", plan.household_id] : ["weekly-plan"], plan);
      setDuplicateSlot(null);
      setExpandedSlotId(null);
      setStatusIsError(false);
      const day = dayOptions.find(day => day.iso === date);
      setStatus(day ? `Meal duplicated to ${day.label}.` : "Meal duplicated to Unscheduled.");
      await invalidatePlan(queryClient);
    },
    onError: showError
  });
  const reset = useMutation({
    mutationFn: (scope: { date: string | null; label: string }) => apiFetch<WeeklyPlan>("/api/v1/weekly-plans/current/reset", {
      method: "POST", body: JSON.stringify({ slot_date: scope.date })
    }),
    onSuccess: async (plan, scope) => {
      const returnedIds = (data?.slots ?? []).filter((slot: WeeklySlot) => !scope.date || slot.slot_date === scope.date).flatMap((slot: WeeklySlot) => slot.recipe_id ? [slot.recipe_id] : []);
      usePlannerStore.getState().returnToDiscover(returnedIds, plannerContextKey(plan));
      queryClient.setQueryData(plan.household_id ? ["weekly-plan", plan.household_id] : ["weekly-plan"], plan);
      setResetScope(null);
      setExpandedSlotId(null);
      setStatusIsError(false);
      setStatus(`${scope.label} reset. Meals returned to Discover.`);
      await invalidatePlan(queryClient);
    },
    onError: showError
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<WeeklyPlan>(`/api/v1/weekly-plans/current/slots/${id}`, { method: "DELETE" }),
    onSuccess: async (plan, id) => {
      const recipeId = data?.slots.find((slot: WeeklySlot) => slot.id === id)?.recipe_id;
      if (recipeId) usePlannerStore.getState().returnToDiscover([recipeId], plannerContextKey(plan));
      queryClient.setQueryData(plan.household_id ? ["weekly-plan", plan.household_id] : ["weekly-plan"], plan);
      setExpandedSlotId(null);
      setStatusIsError(false);
      setStatus("Meal removed.");
      await invalidatePlan(queryClient);
    },
    onError: showError
  });
  const update = useMutation({
    mutationFn: ({ slot, patch }: { slot: WeeklySlot; patch: SlotPatch }) =>
      apiFetch<WeeklyPlan>(`/api/v1/weekly-plans/current/slots/${slot.id}`, { method: "PUT", body: JSON.stringify(patch) }),
    onSuccess: async (plan) => {
      queryClient.setQueryData(plan.household_id ? ["weekly-plan", plan.household_id] : ["weekly-plan"], plan);
      setStatusIsError(false);
      setStatus("Plan updated.");
      await invalidatePlan(queryClient);
    },
    onError: showError
  });
  const confirmMeal = useMutation({
    mutationFn: ({ slot, mealStatus }: { slot: WeeklySlot; mealStatus: "ate" | "skipped" }) =>
      apiFetch("/api/v1/macros/confirmations", {
        method: "POST",
        body: JSON.stringify({
          recipe_id: slot.recipe_id,
          weekly_plan_slot_id: slot.id,
          meal_date: slot.slot_date ?? todayISO(),
          status: mealStatus,
          servings_consumed: space.groupId ? portion : slot.servings
        })
      }),
    onSuccess: async (_, { slot, mealStatus }) => {
      setExpandedSlotId(null);
      setStatusIsError(false);
      const day = dayOptions.find(day => day.iso === slot.slot_date);
      setStatus(mealStatus === "ate"
        ? day ? `Added to ${day.label}'s macro entries.` : "Added to today's macro entries."
        : "Logged as skipped. No nutrition added.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["macro-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["macro-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["macro-analytics"] })
      ]);
    },
    onError: showError
  });
  const startPremiumCheckout = useMutation({
    mutationFn: () =>
      apiFetch<{ checkout_url: string }>("/api/v1/subscription/checkout-session", {
        method: "POST",
        body: JSON.stringify({ tier: "premium" })
      }),
    onSuccess: async (data) => {
      setStatusIsError(false);
      setStatus("Opening Premium checkout.");
      await Linking.openURL(data.checkout_url);
    },
    onError: showError
  });
  const plannedCount = sortedSlots.filter((slot) => slot.slot_type === "meal" && slot.recipe_id).length;
  const premiumActive = Boolean(subscription.data?.premium_active ?? subscription.data?.active);
  const premiumCheckoutReady = Boolean(subscription.data?.premium_stripe_configured);
  const reorder = useMutation({
    mutationFn: (ids: string[]) => apiFetch<WeeklyPlan>("/api/v1/weekly-plans/current/reorder", {
      method: "POST", body: JSON.stringify({ ordered_slot_ids: ids })
    }),
    onSuccess: async plan => {
      queryClient.setQueryData(plan.household_id ? ["weekly-plan", plan.household_id] : ["weekly-plan"], plan);
      setStatusIsError(false); setStatus("Meal order updated.");
      await invalidatePlan(queryClient);
    },
    onError: async error => { showError(error); await refetch(); }
  });
  const busy = reset.isPending || update.isPending || remove.isPending || addMeal.isPending || reorder.isPending || confirmMeal.isPending || duplicateMeal.isPending;

  function requestReset(scope: { date: string | null; label: string }) {
    if (busy) return;
    if (profile.isError || shouldConfirmPlanReset(profile.data)) setResetScope(scope);
    else reset.mutate(scope);
  }

  return (
    <Screen scroll={false} contentWidth={960}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>This Week</Text>
          <Text style={styles.subtitle}>{isLoading ? "Loading plan..." : `${plannedCount} ${plannedCount === 1 ? "meal" : "meals"} planned`}</Text>
        </View>
        {space.canManage ? <Button label="Reset" icon="refresh" disabled={!data || busy} onPress={() => requestReset({ date: null, label: "This week" })} /> : null}
      </View>
      <SpaceSelector />
      {status ? <Text accessibilityLiveRegion="polite" accessibilityRole={statusIsError ? "alert" : undefined} style={[styles.status, statusIsError && styles.error]}>{status}</Text> : null}
      {error ? <Button label="Retry loading week" icon="refresh" onPress={() => { void refetch(); }} /> : null}
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
              router.push({ pathname: "/profile", params: { section: "account" } });
            }}
          />
        </View>
      ) : null}
      <WeekDrag days={dayOptions} disabled={busy || !space.canManage} onAssign={(slotId, date) => {
        const slot = sortedSlots.find(item => item.id === slotId);
        if (slot && slot.slot_date !== date) update.mutate({ slot, patch: { slot_date: date } });
      }} onReorder={(id, beforeId) => {
        const ids = reorderDaySlots(sortedSlots, id, beforeId);
        if (ids) reorder.mutate(ids);
      }}>
        {groups.map(group => (
          <WeekDropDay key={group.iso} day={group.iso}>
            <TourTarget id={group.iso === dayOptions[0]?.iso ? "week" : `week-${group.iso}`}>
            <View style={styles.groupHeader}>
              <View style={styles.dayHeading}><Text style={styles.groupTitle}>{group.label}</Text><Text style={styles.dayDate}>{group.short}</Text></View>
              {space.canManage && group.iso && group.slots.some(slot => slot.recipe_id || slot.slot_type !== "flexible") ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Reset ${group.label}`} disabled={busy} onPress={() => requestReset({ date: group.iso, label: group.label })} style={styles.resetDay}>
                  <Ionicons name="refresh" color={Colors.muted} size={20} />
                </Pressable>
              ) : null}
              {space.canManage ? <Pressable accessibilityRole="button" accessibilityLabel={`Add meal to ${group.label}`} disabled={busy || !data} onPress={() => { addMeal.reset(); setAddDay(group); }} style={styles.addDay}>
                <Ionicons name="add" size={20} color={Colors.tomato} /><Text style={styles.addLabel}>Add meal</Text>
              </Pressable> : null}
            </View>
            </TourTarget>
            {!group.slots.length ? <Text style={styles.emptyDay}>No dinner planned</Text> : null}
        {group.slots.map((slot) => {
          const isExpanded = expandedSlotId === slot.id;
          return (
            <WeekDropMeal key={slot.id} id={slot.id} day={group.iso}>
            <View style={[styles.row, isExpanded ? styles.rowExpanded : null]}>
              <View style={styles.cardTop}>
                <View style={[styles.identity, compact && styles.compactIdentity]}>
                  {space.canManage ? <WeekDragHandle id={slot.id} label={slot.recipe_name ?? slotLabel(slot.slot_type)} disabled={busy} /> : null}
                  {slot.recipe_id ? <RecipePhoto photoUrl={slot.recipe_photo_url} accessibilityLabel={`${slot.recipe_name ?? "Meal"} photo`} style={styles.thumb} /> : null}
                </View>
                <View style={[styles.slotMain, { minWidth: Platform.OS === "web" ? "min-content" as ViewStyle["minWidth"] : 100 * fontScale }]}>
                  <Text style={styles.meal}>{slot.recipe_name ?? slotLabel(slot.slot_type)}</Text>
                  <Text style={styles.meta}>
                    Serves {slot.servings}
                    {slot.recipe_total_minutes ? ` - ${slot.recipe_total_minutes} min` : ""}
                  </Text>
                </View>
                <Button
                  label={isExpanded ? (compact ? "" : "Done") : space.canManage ? "Edit" : "Log"}
                  accessibilityLabel={isExpanded ? "Done" : space.canManage ? "Edit" : "Log"}
                  icon={isExpanded ? "checkmark" : "create"}
                  disabled={busy}
                  onPress={() => {
                    setExpandedSlotId(isExpanded ? null : slot.id);
                    setPortion(1);
                  }}
                />
              </View>
              {isExpanded ? (
                <>
                  {space.canManage ? <><DaySelection days={dayOptions} value={slot.slot_date} disabled={busy}
                    onChange={date => update.mutate({ slot, patch: { slot_date: date } })} />
                  <View style={styles.controls}>
                    <View style={styles.stepper}>
                      <Button label="" icon="remove" variant="quiet" accessibilityLabel="Decrease servings" disabled={busy || slot.servings <= 1} onPress={() => update.mutate({ slot, patch: { servings: slot.servings - 1 } })} />
                      <Text style={styles.servings}>{slot.servings}</Text>
                      <Button label="" icon="add" variant="quiet" accessibilityLabel="Increase servings" disabled={busy || slot.servings >= 30} onPress={() => update.mutate({ slot, patch: { servings: slot.servings + 1 } })} />
                    </View>
                    {slot.recipe_id ? <Button label="Duplicate" icon="copy-outline" variant="quiet" accessibilityLabel={`Duplicate ${slot.recipe_name ?? "meal"}`} disabled={busy}
                      onPress={() => { duplicateMeal.reset(); setDuplicateSlot(slot); }} /> : null}
                  </View>
                  </> : null}
                  {space.groupId && premiumActive ? <View style={styles.controls}><Text style={styles.meta}>Your portion</Text><Button label="" icon="remove" accessibilityLabel="Decrease your portion" disabled={busy || portion <= 1} onPress={() => setPortion(portion - 1)} /><Text style={styles.servings}>{portion}</Text><Button label="" icon="add" accessibilityLabel="Increase your portion" disabled={busy || portion >= 30} onPress={() => setPortion(portion + 1)} /></View> : null}
                  <View style={styles.actions}>
                    {slot.recipe_id && premiumActive ? (
                      <>
                        <Button label="Ate" icon="checkmark-circle" variant="primary" disabled={busy} onPress={() => confirmMeal.mutate({ slot, mealStatus: "ate" })} />
                        <Button label="Skipped" icon="close-circle" variant="quiet" disabled={busy} onPress={() => confirmMeal.mutate({ slot, mealStatus: "skipped" })} />
                      </>
                    ) : null}
                    {space.canManage ? <View style={styles.removeAction}><Button label="" icon="trash-outline" variant="quiet-danger" accessibilityLabel={`Remove ${slot.recipe_name ?? slotLabel(slot.slot_type)}`} disabled={busy} onPress={() => remove.mutate(slot.id)} /></View> : null}
                  </View>
                </>
              ) : null}
            </View>
            </WeekDropMeal>
          );
        })}
          </WeekDropDay>
        ))}
      </WeekDrag>
      <RecipePicker weeklyChoices={!space.groupId} householdId={space.groupId} title={`Add to ${addDay?.label ?? "day"}`} visible={!!addDay} busy={addMeal.isPending} error={addMeal.error instanceof Error ? addMeal.error.message : undefined}
        onClose={() => setAddDay(null)} onSelect={recipe => { if (addDay) addMeal.mutate({ recipeId: recipe.id, date: addDay.iso || null }); }} />
      <Modal visible={!!duplicateSlot} transparent animationType="fade" onRequestClose={() => { if (!duplicateMeal.isPending) setDuplicateSlot(null); }}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalPanel, styles.duplicatePanel]} accessibilityViewIsModal>
            <View style={styles.duplicateHeader}>
              <Text style={[styles.groupTitle, styles.slotMain]}>Duplicate meal</Text>
              <Button label="" icon="close" accessibilityLabel="Close duplicate meal" disabled={duplicateMeal.isPending} onPress={() => setDuplicateSlot(null)} />
            </View>
            <Text style={styles.modalCopy}>{duplicateSlot?.recipe_name}</Text>
            <ScrollView>
              {[...dayOptions, { iso: "", label: "Unscheduled", short: "" }].map(day => <Pressable key={day.iso} accessibilityRole="button"
                accessibilityLabel={`Duplicate meal to ${day.label}${day.short ? `, ${day.short}` : ""}`} accessibilityState={{ disabled: busy }} disabled={busy}
                onPress={() => { if (duplicateSlot && !busy) duplicateMeal.mutate({ slot: duplicateSlot, date: day.iso || null }); }} style={styles.duplicateDay}>
                <Text style={[styles.meal, styles.slotMain]}>{day.label}{day.short ? `, ${day.short}` : ""}</Text>
                <Ionicons name="copy-outline" size={20} color={Colors.tomato} />
              </Pressable>)}
            </ScrollView>
            {duplicateMeal.isError ? <Text accessibilityRole="alert" style={styles.error}>{duplicateMeal.error instanceof Error ? duplicateMeal.error.message : "Unable to duplicate meal. Try again."}</Text> : null}
          </View>
        </View>
      </Modal>
      <Modal visible={!!resetScope} transparent animationType="fade" onRequestClose={() => { if (!reset.isPending) setResetScope(null); }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalPanel}>
            <Text style={styles.groupTitle}>Reset {resetScope?.label.toLowerCase()}?</Text>
            <Text style={styles.modalCopy}>Selected meals return to Discover. Saved recipes, favorites, hidden meals, and logged nutrition stay unchanged.</Text>
            <View style={styles.actions}>
              <Button label="Cancel" icon="close" disabled={reset.isPending} onPress={() => setResetScope(null)} />
              <Button label={reset.isPending ? "Resetting..." : "Confirm reset"} icon="refresh" variant="danger" disabled={reset.isPending} onPress={() => { if (resetScope) reset.mutate(resetScope); }} />
            </View>
            {reset.isError ? <Text accessibilityRole="alert" style={styles.error}>Reset failed. Nothing was confirmed. Please try again.</Text> : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

async function invalidatePlan(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["weekly-plan"] }),
    queryClient.invalidateQueries({ queryKey: ["recipes", "picker"] }),
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
    return { iso, label: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][index], short: `${value.getUTCMonth() + 1}/${value.getUTCDate()}` };
  });
}

function slotLabel(type: WeeklySlot["slot_type"]) {
  if (type === "dining_out") return "Dining out";
  if (type === "leftovers") return "Leftovers";
  if (type === "flexible") return "Flexible dinner";
  return "Choose a meal";
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: "900", color: Colors.ink },
  subtitle: { color: Colors.muted },
  status: { color: Colors.basil, fontWeight: "800", marginBottom: 8 },
  premiumBanner: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: Colors.surface, borderColor: Colors.border, borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 10 },
  premiumTitle: { color: Colors.ink, fontWeight: "900" },
  premiumNote: { color: Colors.muted, lineHeight: 19, fontSize: 13, marginTop: 3 },
  groupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4, minHeight: 44 },
  dayHeading: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 8, rowGap: 2 },
  dayDate: { color: Colors.muted, fontSize: 13 },
  groupTitle: { color: Colors.ink, fontWeight: "800", fontSize: 18 },
  resetDay: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  addDay: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, paddingHorizontal: 8 },
  addLabel: { color: Colors.tomato, fontWeight: "800" },
  emptyDay: { color: Colors.muted },
  error: { color: Colors.danger },
  modalBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)", padding: 20 },
  modalPanel: { maxWidth: 420, width: "100%", padding: 20, gap: 16, backgroundColor: Colors.surface, borderRadius: 8 },
  modalCopy: { color: Colors.muted, lineHeight: 22 },
  row: { backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, padding: 12, gap: 12 },
  rowExpanded: { borderColor: "#f0b6b2" },
  cardTop: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  identity: { flexDirection: "row", gap: 8, alignItems: "center" },
  compactIdentity: { flexDirection: "column-reverse", gap: 0 },
  duplicatePanel: { maxHeight: "90%" },
  duplicateHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  duplicateDay: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  slotBadge: { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.tomato, alignItems: "center", justifyContent: "center" },
  slotBadgeText: { color: "#fff", fontWeight: "900" },
  thumb: { width: 44, height: 44, borderRadius: 6, backgroundColor: Colors.border },
  emptyThumb: { width: 58, height: 58, borderRadius: 8, backgroundColor: Colors.softRed, borderColor: Colors.border, borderWidth: 1 },
  slotMain: { flex: 1, minWidth: 0 },
  day: { color: Colors.basil, fontWeight: "800", fontSize: 12, textTransform: "uppercase" },
  meal: { color: Colors.ink, fontSize: 18, fontWeight: "800", textTransform: "capitalize" },
  meta: { color: Colors.muted, marginTop: 2 },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  stepper: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: Colors.border, borderRadius: 8 },
  servings: { minWidth: 24, textAlign: "center", color: Colors.ink, fontWeight: "900", fontSize: 18 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  removeAction: { marginLeft: "auto" }
});
