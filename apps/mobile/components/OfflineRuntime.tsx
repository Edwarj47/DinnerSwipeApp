import NetInfo from "@react-native-community/netinfo";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { reconnectOffline, recheckSession, warmOfflineCache } from "@/services/api";
import { deviceOffline, offlineOwner, setDeviceOffline, useOfflineStatus } from "@/services/offlineStore";
import { useAppAccess } from "@/services/session";

export function OfflineRuntime() {
  const client = useQueryClient();
  const access = useAppAccess();
  const checking = useRef(false);
  useEffect(() => {
    const check = async () => {
      if (checking.current || AppState.currentState === "background") return;
      checking.current = true;
      try {
        recheckSession();
        await reconnectOffline();
        if (!deviceOffline()) await client.invalidateQueries();
      } finally { checking.current = false; }
    };
    const unsubscribe = NetInfo.addEventListener(state => {
      if (state.isConnected === false || state.isInternetReachable === false) setDeviceOffline(true);
      else if (state.isConnected) void check();
    });
    const appState = AppState.addEventListener("change", state => { if (state === "active") void check(); });
    const timer = setInterval(() => { if (deviceOffline() || useOfflineStatus.getState().edits.length) void check(); }, 30000);
    return () => { unsubscribe(); appState.remove(); clearInterval(timer); };
  }, [client]);
  useEffect(() => { if (access) void warmOfflineCache(); }, [access]);
  useEffect(() => {
    let owner = offlineOwner();
    const changed = new Map<string, string[]>();
    return useOfflineStatus.subscribe((state, previous) => {
      if (offlineOwner() !== owner) { owner = offlineOwner(); changed.clear(); return; }
      const remaining = new Set(state.edits.map(edit => edit.operation_id));
      for (const edit of previous.edits) {
        if (remaining.has(edit.operation_id)) continue;
        const keys = edit.kind === "grocery_update"
          ? [edit.household_id ? ["grocery", edit.household_id] : ["grocery"]]
          : [["macro-entries"], ["macro-summary"], ["macro-analytics"]];
        for (const key of keys) changed.set(JSON.stringify(key), key);
      }
      if (state.syncing) return;
      // Refresh once per drained scope, not every acknowledgement or every app query.
      for (const [id, key] of changed) {
        if (key[0] === "grocery" && state.edits.some(edit => edit.kind === "grocery_update" && edit.household_id === key[1])) continue;
        changed.delete(id);
        void client.invalidateQueries({ queryKey: key, exact: key[0] === "grocery" });
      }
    });
  }, [client]);
  return null;
}
