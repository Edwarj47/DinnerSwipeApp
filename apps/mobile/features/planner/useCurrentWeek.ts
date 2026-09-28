import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect } from "react";
import { AppState } from "react-native";

import { apiFetch } from "@/services/api";
import { WeeklyPlan } from "@/services/types";
import { usePlannerStore } from "@/stores/plannerStore";

export function useCurrentWeek() {
  const plan = useQuery<WeeklyPlan>({ queryKey: ["weekly-plan"],
    queryFn: () => apiFetch<WeeklyPlan>("/api/v1/weekly-plans/current"), retry: false });
  const syncWeek = usePlannerStore(state => state.syncWeek);
  const weekStart = plan.data?.week_start;
  useEffect(() => { if (weekStart) syncWeek(weekStart); }, [weekStart, syncWeek]);
  const { refetch } = plan;
  useFocusEffect(useCallback(() => {
    void refetch();
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void refetch();
    });
    // Refresh an open screen across Monday midnight, using the server's week boundary.
    const timer = setInterval(() => { if (AppState.currentState === "active") void refetch(); }, 60_000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, [refetch]));
  return plan;
}
