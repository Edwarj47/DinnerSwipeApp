import { ReactNode } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View } from "react-native";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/Button";
import { BottomSheetModal } from "@/components/BottomSheetModal";
import { Colors } from "@/components/theme";
import { SpaceSelector } from "@/features/groups/SpaceSelector";
import { RecipePhoto } from "@/features/recipes/RecipePhoto";
import { syncWorkoutPerformance, useWorkoutQueue } from "./storage";
import { WorkoutCategory, WorkoutTemplate } from "./types";

export const categories: { value: WorkoutCategory; label: string }[] = [{ value: "upper", label: "Upper" }, { value: "lower", label: "Lower" }, { value: "cardio", label: "Cardio" }, { value: "full_body", label: "Full Body" }];
export const categoryLabel = (value: WorkoutCategory) => categories.find(item => item.value === value)?.label ?? value;
export function WorkoutHeader({ title }: { title: string }) {
  return <View style={styles.header}><BrandLogo size={46} experienceSelector /><View style={styles.copy}><Text style={styles.eyebrow}>Workouts</Text><Text style={styles.heading}>{title}</Text></View></View>;
}
export function WorkoutSpaceSelector() { return <SpaceSelector label="Workout space" />; }
export function WorkoutPhoto({ template, height = 180 }: { template: WorkoutTemplate; height?: number }) {
  return <RecipePhoto photoUrl={template.photo_url} accessibilityLabel={template.title} style={{ height, width: "100%", backgroundColor: Colors.softRed }} />;
}
export function WorkoutField({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput {...props} accessibilityLabel={props.accessibilityLabel ?? label} style={[styles.input, props.style]} /></View>;
}
export function WorkoutSheet({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  return <BottomSheetModal sheetStyle={styles.sheet} onRequestClose={() => { if (!busy) onClose(); }}>
    <View style={styles.header}><Text style={[styles.heading, styles.copy]}>{title}</Text><Button label="" icon="close" accessibilityLabel={`Close ${title}`} disabled={busy} onPress={onClose} /></View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 24 }}>{children}</ScrollView>
  </BottomSheetModal>;
}
export function WorkoutQueryState({ loading, error, retry }: { loading?: boolean; error?: Error | null; retry: () => void }) {
  if (loading) return <View style={styles.empty}><ActivityIndicator color={Colors.tomato} /><Text style={styles.muted}>Loading workouts...</Text></View>;
  if (error) return <View style={styles.empty}><Text accessibilityRole="alert" style={styles.error}>{error.message}</Text><Button label="Try again" icon="refresh" onPress={retry} /></View>;
  return null;
}
export function WorkoutQueueNotice({ onSynced }: { onSynced?: () => void }) {
  const { pending, syncing, error } = useWorkoutQueue();
  if (!pending.length && !error) return null;
  const issue = pending.find(item => item.issue)?.issue ?? error;
  return <View style={styles.notice}><Text style={issue ? styles.error : styles.muted}>{issue || `${pending.length} personal ${pending.length === 1 ? "session" : "sessions"} saved on this device.`}</Text>
    <Button label="" icon="refresh" accessibilityLabel="Retry workout session sync" disabled={syncing} onPress={() => { void syncWorkoutPerformance(true).then(onSynced); }} /></View>;
}
export const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 10 }, copy: { flex: 1, minWidth: 0 },
  heading: { fontSize: 24, lineHeight: 30, fontWeight: "800", color: Colors.ink }, title: { fontSize: 18, lineHeight: 24, fontWeight: "800", color: Colors.ink },
  eyebrow: { fontSize: 12, fontWeight: "800", color: Colors.basil }, muted: { color: Colors.muted, lineHeight: 21 }, error: { color: Colors.danger, lineHeight: 21 },
  photo: { alignItems: "center", justifyContent: "center", backgroundColor: Colors.softRed, width: "100%" },
  field: { gap: 6, minWidth: 0, flexGrow: 1 }, label: { color: Colors.ink, fontWeight: "700", fontSize: 13 },
  input: { minHeight: 44, padding: 10, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, color: Colors.ink, backgroundColor: Colors.surface },
  sheet: { width: "100%", maxWidth: 640, maxHeight: "90%", backgroundColor: Colors.surface, borderTopLeftRadius: 8, borderTopRightRadius: 8, padding: 18, gap: 14 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  section: { gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  item: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, backgroundColor: Colors.surface, overflow: "hidden", marginVertical: 8 },
  body: { padding: 14, gap: 10 }, empty: { paddingVertical: 28, alignItems: "center", gap: 14 },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, flexWrap: "wrap" }
});
