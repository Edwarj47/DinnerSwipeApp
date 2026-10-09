import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { useOfflineStatus } from "@/services/offlineStore";

export function NutritionPendingNotice({ refreshing, onRefresh }: {
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const offline = useOfflineStatus(state => state.offline);
  const message = offline ? "Connect to refresh food nutrition." : refreshing
    ? "Refreshing food nutrition..." : "Some food nutrition couldn't be refreshed.";
  return <View style={styles.notice}>
    <Text accessibilityLiveRegion="polite" style={styles.text}>{message} Totals are incomplete.</Text>
    <Button label="" icon="refresh" accessibilityLabel="Refresh food nutrition" disabled={offline || refreshing} onPress={onRefresh} />
  </View>;
}

const styles = StyleSheet.create({
  notice: { flexDirection: "row", alignItems: "center", gap: 8 },
  text: { flex: 1, color: Colors.muted, fontSize: 13, lineHeight: 19 }
});
