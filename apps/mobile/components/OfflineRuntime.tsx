import NetInfo from "@react-native-community/netinfo";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { reconnectOffline, recheckSession, warmOfflineCache } from "@/services/api";
import { deviceOffline, setDeviceOffline, useOfflineStatus } from "@/services/offlineStore";
import { useAppAccess } from "@/services/session";

export function OfflineRuntime() {
  const client = useQueryClient();
  const access = useAppAccess();
  const checking = useRef(false);
  const pending = useOfflineStatus(state => state.edits.length);
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
  const previous = useRef(pending);
  useEffect(() => {
    if (pending < previous.current) void client.invalidateQueries();
    previous.current = pending;
  }, [client, pending]);
  return null;
}
