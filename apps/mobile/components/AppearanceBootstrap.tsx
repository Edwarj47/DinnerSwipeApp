import { ReactNode, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { addAuthChangeListener } from "@/services/api";
import { resetAppearance, restoreStartupAppearance } from "@/services/appearance";
import { offlineOwner } from "@/services/offlineStore";
import { Colors } from "./theme";

export function AppearanceBootstrap({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    const unsubscribe = addAuthChangeListener(() => {
      if (!offlineOwner()) resetAppearance(null);
    });
    void restoreStartupAppearance().finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; unsubscribe(); };
  }, []);
  if (!ready) return <View style={styles.loading} accessibilityLabel="Loading appearance"><ActivityIndicator color={Colors.muted} /></View>;
  return children;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: Colors.background }
});
