import { Ionicons } from "@expo/vector-icons";
import { ReactNode, useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { SegmentedControl } from "@/components/SegmentedControl";
import { ExperienceMode, updateWorkoutPreferences, useWorkoutMode } from "@/services/workoutMode";

export function ExperienceSelector({ children }: { children?: ReactNode }) {
  const { enabled, mode } = useWorkoutMode();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const label = mode === "workouts" ? "Workouts" : "Nutrition";
  const trigger = useRef<View>(null);
  useEffect(() => { if (Platform.OS === "web") (trigger.current as unknown as HTMLElement | null)?.setAttribute("title", "Nutrition or workouts"); }, [enabled]);
  if (!enabled) return <>{children}</>;
  async function change(next: ExperienceMode) {
    if (next === mode) { setOpen(false); return; }
    setBusy(true); setError("");
    try { await updateWorkoutPreferences({ mode: next }); setOpen(false); }
    catch (error) { setError(error instanceof Error ? error.message : "Experience could not be changed."); }
    finally { setBusy(false); }
  }
  return <>
    <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel={`Experience: ${label}`} accessibilityState={{ expanded: open }}
      style={styles.trigger} onPress={() => { setError(""); setOpen(true); }}>
      {children ?? <Ionicons name={mode === "workouts" ? "barbell-outline" : "restaurant-outline"} size={24} color={Colors.tomato} />}
      <View style={styles.badge}><Ionicons name="chevron-down" size={12} color={Colors.basil} /></View>
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => { if (!busy) setOpen(false); }}>
      <View style={styles.backdrop}><View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.row}><Ionicons name="swap-horizontal-outline" size={22} color={Colors.basil} /><Text style={styles.title}>Experience</Text><Button label="" icon="close" accessibilityLabel="Close experience selector" disabled={busy} onPress={() => setOpen(false)} /></View>
        <SegmentedControl value={mode} accessibilityLabel="Experience mode" disabled={busy} adaptive options={[{ value: "nutrition", label: "Nutrition", icon: "restaurant-outline" }, { value: "workouts", label: "Workouts", icon: "barbell-outline" }]} onChange={next => { void change(next); }} />
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </View></View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({ backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: 18 },
  trigger: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", right: -2, bottom: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: Colors.border },
  sheet: { width: "100%", maxWidth: 420, padding: 18, gap: 14, borderRadius: 8, backgroundColor: Colors.surface },
  row: { flexDirection: "row", alignItems: "center", gap: 10 }, title: { flex: 1, minWidth: 0, fontSize: 20, fontWeight: "800", color: Colors.ink }, error: { color: Colors.danger } });
