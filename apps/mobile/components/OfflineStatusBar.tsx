import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { Colors } from "./theme";
import { retryOfflineSync } from "@/services/api";
import { discardOfflineChange, useOfflineStatus } from "@/services/offlineStore";

const fieldLabels: Record<string, string> = { is_checked: "Collected", quantity: "Quantity", entry_name: "Name", meal_date: "Date",
  meal_label: "Meal", servings_consumed: "Servings", status: "Status", calories: "Calories", protein_g: "Protein (g)",
  carbs_g: "Carbs (g)", fat_g: "Fat (g)", fiber_g: "Fiber (g)", notes: "Notes" };
export const SYNC_NOTICE_DELAY_MS = 10_000;

export function OfflineStatusBar() {
  const { offline, syncing, edits, storageError, noticeSince } = useOfflineStatus();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [elapsedSince, setElapsedSince] = useState<number | null>(null);
  const client = useQueryClient();
  useEffect(() => {
    if (noticeSince === null) return;
    const timer = setTimeout(() => setElapsedSince(noticeSince), Math.max(0, SYNC_NOTICE_DELAY_MS - (Date.now() - noticeSince)));
    return () => clearTimeout(timer);
  }, [noticeSince]);
  const issues = edits.filter(edit => edit.issue).length;
  const delayed = noticeSince !== null && (elapsedSince === noticeSince || Date.now() - noticeSince >= SYNC_NOTICE_DELAY_MS);
  const showBand = Boolean(storageError || issues || delayed);
  if (!showBand && !open) return null;
  const title = storageError || (issues ? `${issues} change${issues === 1 ? " needs" : "s need"} review`
    : syncing ? "Taking longer to sync. Changes are saved." : edits.length ? `${edits.length} change${edits.length === 1 ? "" : "s"} waiting to sync` : "Offline - downloaded data");
  return <>
    {showBand ? <Pressable accessibilityRole="button" accessibilityLabel={title} style={styles.band} onPress={() => setOpen(true)}>
      <Ionicons name={issues ? "alert-circle-outline" : offline ? "cloud-offline-outline" : "sync-outline"} size={20} color={Colors.ink} />
      <Text style={styles.label}>{title}</Text><Ionicons name="chevron-forward" size={18} color={Colors.ink} />
    </Pressable> : null}
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={styles.backdrop}><View style={styles.modal}>
        <View style={styles.header}><Text style={styles.title}>Saved on this device</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close sync status" onPress={() => setOpen(false)} style={styles.close}><Ionicons name="close" size={24} /></Pressable>
        </View>
        <ScrollView>
          {!edits.length ? <Text style={styles.text}>{offline ? "No pending changes. Connect to refresh downloaded data." : "All changes are synced."}</Text> : null}
          {edits.map(edit => <View key={edit.operation_id} style={styles.item}>
            <Text style={styles.label}>{edit.label}</Text>
            <Text style={styles.text}>{edit.kind === "macro_delete" ? "Remove entry" : Object.entries(edit.values).filter(([key, value]) => fieldLabels[key] && value !== null && value !== undefined).map(([key, value]) => `${fieldLabels[key]}: ${typeof value === "boolean" ? value ? "Yes" : "No" : String(value)}`).join("\n")}</Text>
            <Text style={[styles.text, Boolean(edit.issue) && styles.error]}>{edit.issue ?? "Waiting to sync"}</Text>
            {edit.issue ? <Button label="Discard local changes" icon="trash-outline" variant="danger" onPress={async () => {
              try { await discardOfflineChange(edit.operation_id); await client.invalidateQueries(); }
              catch { setError("Unable to update local storage. Try again."); }
            }} /> : null}
          </View>)}
        </ScrollView>
        {error || storageError ? <Text style={styles.error}>{error || storageError}</Text> : null}
        <Button label="Retry sync" icon="sync" disabled={syncing} onPress={async () => {
          try { await retryOfflineSync(); await client.invalidateQueries(); }
          catch { setError("Unable to sync. Your changes are still saved."); }
        }} />
      </View></View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  band: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: "#fff0c7", borderBottomWidth: 1, borderColor: Colors.border },
  label: { flex: 1, fontSize: 14, fontWeight: "700", color: Colors.ink },
  text: { fontSize: 14, lineHeight: 21, color: Colors.muted },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: 16 },
  modal: { width: "100%", maxWidth: 520, maxHeight: "85%", backgroundColor: Colors.surface, borderRadius: 8, padding: 16, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 20, fontWeight: "800", color: Colors.ink },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  item: { borderBottomWidth: 1, borderColor: Colors.border, paddingVertical: 14, gap: 8 },
  error: { color: Colors.danger, fontSize: 14, lineHeight: 21 }
});
