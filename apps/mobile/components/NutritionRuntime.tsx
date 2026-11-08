import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { expireNutrition, hasTemporaryNutrition } from "@/services/temporaryNutrition";

export function NutritionRuntime({ refresh = true }: { refresh?: boolean }) {
  const client = useQueryClient();
  const refreshEnabled = useRef(refresh);
  refreshEnabled.current = refresh;
  useEffect(() => {
    const deadlines = new Map<string, number>();
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (event.type === "updated" && event.action.type === "success") {
        if (hasTemporaryNutrition(event.query.state.data)) deadlines.set(event.query.queryHash, Date.now() + 15 * 60 * 1000);
        else deadlines.delete(event.query.queryHash);
      }
      if (event.type === "removed") deadlines.delete(event.query.queryHash);
    });
    function expire() {
      for (const [hash, deadline] of deadlines) if (deadline <= Date.now()) {
        deadlines.delete(hash);
        const query = client.getQueryCache().get(hash);
        if (query) {
          client.setQueryData(query.queryKey, expireNutrition(query.state.data));
          void client.invalidateQueries({ queryKey: query.queryKey, exact: true,
            refetchType: refreshEnabled.current ? "active" : "none" });
        }
      }
    }
    const timer = setInterval(expire, 30000);
    const subscription = AppState.addEventListener("change", expire);
    return () => { unsubscribe(); clearInterval(timer); subscription.remove(); };
  }, [client]);
  return null;
}
