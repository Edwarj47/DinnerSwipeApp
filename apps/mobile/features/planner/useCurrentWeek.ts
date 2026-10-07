import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect } from "react";
import { AppState } from "react-native";

import { apiFetch } from "@/services/api";
import { WeeklyPlan } from "@/services/types";
import { usePlannerStore } from "@/stores/plannerStore";
import { ensurePlanningTimeZone } from "@/services/planningPreferences";
import { useSpace } from "@/features/groups/useSpace";

export function plannerContextKey(plan: WeeklyPlan) {
  return `${plan.household_id ?? "personal"}:${plan.week_start}:${plan.reset_cycle ?? ""}`;
}

export function useCurrentWeek() {
  const client = useQueryClient();
  const space = useSpace();
  const plan = useQuery<WeeklyPlan>({ queryKey: space.queryKey("weekly-plan"),
    queryFn: async () => {
      if (!space.groupId) await ensurePlanningTimeZone();
      return apiFetch<WeeklyPlan>(space.path("/api/v1/weekly-plans/current"));
    }, enabled: !space.isLoading && !space.isError, retry: false });
  const syncWeek = usePlannerStore(state => state.syncWeek);
  const weekStart = plan.data && !space.isLoading && !space.isError ? plannerContextKey(plan.data) : undefined;
  useEffect(() => {
    if (!weekStart) return;
    const previous = usePlannerStore.getState().weekStart;
    syncWeek(weekStart);
    if (previous !== null && previous !== weekStart) {
      void client.invalidateQueries({ queryKey: ["grocery"] });
      void client.invalidateQueries({ queryKey: ["recipes"] });
    }
  }, [weekStart, syncWeek, client]);
  const { refetch } = plan;
  useFocusEffect(useCallback(() => {
    if (space.isLoading || space.isError) return;
    void refetch();
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void refetch();
    });
    // Reconcile rollover and scheduled resets while this screen stays open.
    const timer = setInterval(() => { if (AppState.currentState === "active") void refetch(); }, 30_000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, [refetch, space.isLoading, space.isError]));
  return { ...plan, data: space.isLoading || space.isError ? undefined : plan.data,
    isLoading: space.isLoading || plan.isLoading, isError: space.isError || plan.isError,
    error: space.error ?? plan.error,
    refetch: space.isError ? space.refetch : plan.refetch };
}
