import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect } from "react";
import { AppState } from "react-native";

import { apiFetch } from "@/services/api";
import { WeeklyPlan } from "@/services/types";
import { usePlannerStore } from "@/stores/plannerStore";
import { ensurePlanningTimeZone } from "@/services/planningPreferences";

export function useCurrentWeek() {
  const client = useQueryClient();
  const plan = useQuery<WeeklyPlan>({ queryKey: ["weekly-plan"],
    queryFn: async () => {
      await ensurePlanningTimeZone();
      return apiFetch<WeeklyPlan>("/api/v1/weekly-plans/current");
    }, retry: false });
  const syncWeek = usePlannerStore(state => state.syncWeek);
  const weekStart = plan.data ? `${plan.data.week_start}:${plan.data.reset_cycle ?? ""}` : undefined;
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
    void refetch();
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void refetch();
    });
    // Reconcile rollover and scheduled resets while this screen stays open.
    const timer = setInterval(() => { if (AppState.currentState === "active") void refetch(); }, 60_000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, [refetch]));
  return plan;
}
