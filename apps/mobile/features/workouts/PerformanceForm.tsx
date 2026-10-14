import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { MacroDatePicker } from "@/features/premium/MacroDatePicker";
import { todayISO } from "@/features/premium/macroDates";
import { displayWorkoutWeight, updateWorkoutPreferences, useWorkoutMode, weightInKg, WorkoutWeightUnit } from "@/services/workoutMode";
import { saveWorkoutPerformance } from "./api";
import { ActualSet, buildPerformance, emptyActualSet, initialPerformance, performanceFromLog } from "./performance";
import { WorkoutLog, WorkoutTemplate } from "./types";
import { WorkoutField, WorkoutSheet, styles } from "./ui";

export function WorkoutCheckbox({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }} aria-checked={checked} disabled={disabled} onPress={onChange} style={[styles.row, { minHeight: 44 }]}><Ionicons name={checked ? "checkbox" : "square-outline"} size={24} color={checked ? Colors.basil : Colors.muted} /><Text style={[styles.label, { flexShrink: 1 }]}>{label}</Text></Pressable>;
}
function WeightInput({ kg, unit, label, onChange, disabled }: { kg: string; unit: WorkoutWeightUnit; label: string; onChange: (kg: string) => void; disabled: boolean }) {
  const [typed, setTyped] = useState<{ kg: string; unit: WorkoutWeightUnit; text: string } | null>(null);
  const value = typed?.kg === kg && typed.unit === unit ? typed.text : kg && Number.isFinite(Number(kg)) ? displayWorkoutWeight(Number(kg), unit) : kg;
  return <WorkoutField label={`Weight (${unit})`} accessibilityLabel={label} keyboardType="decimal-pad" value={value} editable={!disabled} onChangeText={text => {
    const canonical = text.trim() && /^\d+(?:\.\d*)?$/.test(text.trim()) ? String(weightInKg(Number(text), unit)) : text;
    setTyped({ kg: canonical, unit, text }); onChange(canonical);
  }} />;
}
export function PerformanceForm({ template, existing, slotId, groupId, onClose, onSaved }: { template: WorkoutTemplate; existing?: WorkoutLog; slotId?: string; groupId?: string; onClose: () => void; onSaved: () => void }) {
  const [exercises, setExercises] = useState(() => existing ? performanceFromLog(template, existing).exercises : initialPerformance(template));
  const [performedOn, setPerformedOn] = useState(existing?.performed_on ?? todayISO()), [completed, setCompleted] = useState(existing?.completed ?? false), [notes, setNotes] = useState(() => existing ? performanceFromLog(template, existing).notes : "");
  const [busy, setBusy] = useState(false), [unitBusy, setUnitBusy] = useState(false), [error, setError] = useState("");
  const requestId = useRef(existing?.request_uuid ?? Crypto.randomUUID());
  const unit = useWorkoutMode(state => state.weight_unit);
  function setRow(exercise: number, row: number, field: keyof ActualSet, value: string) {
    setExercises(all => all.map((item, i) => i !== exercise ? item : { ...item, sets: item.sets.map((set, n) => n !== row ? set : { ...set, [field]: value }) }));
  }
  async function changeUnit(next: WorkoutWeightUnit) {
    setUnitBusy(true); setError("");
    try { await updateWorkoutPreferences({ weight_unit: next }); }
    catch (error) { setError(error instanceof Error ? error.message : "Weight unit could not be saved."); }
    finally { setUnitBusy(false); }
  }
  async function save() {
    setBusy(true); setError("");
    try { await saveWorkoutPerformance({ ...buildPerformance(template, performedOn, completed, notes, exercises, todayISO()), ...(slotId ? { plan_slot_id: slotId } : {}), ...(groupId ? { household_id: groupId } : {}) }, requestId.current, template); onSaved(); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : "Session could not be saved."); }
    finally { setBusy(false); }
  }
  return <WorkoutSheet title="Log performance" onClose={onClose} busy={busy || unitBusy}>
    <Text style={styles.title}>{template.title}</Text>
    <View style={styles.row}><Text style={styles.muted}>{performedOn}</Text><MacroDatePicker value={performedOn} label="Session date" title="Session date" maxDate={todayISO()} onChange={value => { if (!busy) setPerformedOn(value); }} /></View>
    <SegmentedControl value={unit} accessibilityLabel="Workout weight unit" disabled={busy || unitBusy} options={[{ value: "kg", label: "kg" }, { value: "lb", label: "lb" }]} onChange={next => { void changeUnit(next); }} />
    {template.exercises.map((exercise, i) => <View key={i} style={styles.section}>
      <Text style={styles.title}>{exercise.name}</Text>
      <Text style={styles.muted}>{[exercise.sets ? `${exercise.sets} sets` : "", exercise.reps ? `${exercise.reps} reps` : "", exercise.duration_seconds ? `${exercise.duration_seconds}s` : ""].filter(Boolean).join(" / ")}</Text>
      {exercises[i].sets.map((set, row) => <View key={row} style={{ gap: 8 }}>
        <View style={styles.row}><Text style={[styles.label, styles.copy]}>Set {row + 1}</Text><Button label="" icon="remove-circle-outline" accessibilityLabel={`Remove ${exercise.name} set ${row + 1}`} disabled={busy || exercises[i].sets.length <= 1} onPress={() => setExercises(all => all.map((item, index) => index !== i ? item : { ...item, sets: item.sets.filter((_, n) => n !== row) }))} /></View>
        <View style={[styles.row, { alignItems: "flex-start" }]}>
          <View style={{ flexBasis: 90, flexGrow: 1 }}><WorkoutField label="Reps" accessibilityLabel={`${exercise.name} set ${row + 1} reps`} keyboardType="number-pad" value={set.reps} editable={!busy} onChangeText={value => setRow(i, row, "reps", value)} /></View>
          <View style={{ flexBasis: 110, flexGrow: 1 }}><WeightInput kg={set.weightKg} unit={unit} label={`${exercise.name} set ${row + 1} weight ${unit}`} disabled={busy || unitBusy} onChange={value => setRow(i, row, "weightKg", value)} /></View>
          <View style={{ flexBasis: 110, flexGrow: 1 }}><WorkoutField label="Duration (s)" accessibilityLabel={`${exercise.name} set ${row + 1} duration seconds`} keyboardType="number-pad" value={set.duration} editable={!busy} onChangeText={value => setRow(i, row, "duration", value)} /></View>
        </View>
      </View>)}
      <Button label="Add set" icon="add" disabled={busy || exercises.reduce((n, item) => n + item.sets.length, 0) >= 200} onPress={() => setExercises(all => all.map((item, index) => index !== i ? item : { ...item, sets: [...item.sets, emptyActualSet()] }))} />
      <WorkoutField label={`${exercise.name} notes`} multiline maxLength={1000} value={exercises[i].notes} editable={!busy} onChangeText={value => setExercises(all => all.map((item, index) => index !== i ? item : { ...item, notes: value }))} />
      <WorkoutCheckbox label={`${exercise.name} completed`} checked={exercises[i].completed} disabled={busy} onChange={() => setExercises(all => all.map((item, index) => index !== i ? item : { ...item, completed: !item.completed }))} />
    </View>)}
    <WorkoutField label="Session notes" multiline maxLength={2000} value={notes} editable={!busy} onChangeText={setNotes} />
    <WorkoutCheckbox label="Session completed" checked={completed} disabled={busy} onChange={() => setCompleted(value => !value)} />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Button label={busy ? "Saving..." : "Save session"} icon="save-outline" variant="primary" disabled={busy || unitBusy} onPress={() => { void save(); }} />
  </WorkoutSheet>;
}
