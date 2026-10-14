import { useState } from "react";
import { Text, View } from "react-native";
import { Button } from "@/components/Button";
import { SegmentedControl } from "@/components/SegmentedControl";
import { apiFetch, ConnectionError } from "@/services/api";
import { deviceOffline } from "@/services/offlineStore";
import { appendRecipeImage, RecipeImage, RecipePhotoPicker } from "@/features/recipes/RecipePhotoPicker";
import { workoutWrite } from "./api";
import { WorkoutCategory, WorkoutTemplate } from "./types";
import { WorkoutField, WorkoutPhoto, WorkoutSheet, categories, styles } from "./ui";
import { buildWorkoutTemplate, emptyExercise, ExerciseDraft, uploadedWorkoutPhotoReference } from "./template";

export function TemplateEditor({ template, onClose, onSaved }: { template?: WorkoutTemplate; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(template?.title ?? ""), [description, setDescription] = useState(template?.description ?? "");
  const [photoReference, setPhotoReference] = useState(template?.photo_reference ?? null), [photoPreview, setPhotoPreview] = useState(template?.photo_url ?? null), [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState<WorkoutCategory>(template?.category ?? "full_body");
  const [exercises, setExercises] = useState<ExerciseDraft[]>(template?.exercises.map(item => ({ name: item.name, sets: item.sets?.toString() ?? "", reps: item.reps ?? "", duration: item.duration_seconds?.toString() ?? "" })) ?? []);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  function edit(index: number, field: keyof ExerciseDraft, value: string) { setExercises(all => all.map((item, i) => i === index ? { ...item, [field]: value } : item)); }
  function reorder(index: number, offset: number) { setExercises(all => { const rows = [...all], [item] = rows.splice(index, 1); rows.splice(index + offset, 0, item); return rows; }); }
  async function uploadPhoto(image: RecipeImage) {
    if (deviceOffline()) throw new ConnectionError("Reconnect to upload a workout photo.");
    setUploading(true);
    try {
      const form = new FormData(); appendRecipeImage(form, "file", image);
      const result = await apiFetch<{ photo_url: string; photo_reference?: string }>("/api/v1/recipes/photo-upload", { method: "POST", body: form });
      setPhotoReference(uploadedWorkoutPhotoReference(result.photo_reference ?? result.photo_url)); setPhotoPreview(result.photo_url);
    } finally { setUploading(false); }
  }
  async function save() {
    setError(""); setBusy(true);
    try {
      await workoutWrite(template ? `templates/${encodeURIComponent(template.id)}` : "templates", template ? "PUT" : "POST", buildWorkoutTemplate(title, category, description, exercises, photoReference));
      onSaved(); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : "Workout could not be saved."); }
    finally { setBusy(false); }
  }
  return <WorkoutSheet title={template ? "Edit workout" : "New workout"} onClose={onClose} busy={busy || uploading}>
    <WorkoutField label="Workout title" value={title} onChangeText={setTitle} maxLength={160} editable={!busy} />
    <SegmentedControl value={category} options={categories} onChange={setCategory} adaptive disabled={busy} accessibilityLabel="Workout category" />
    <WorkoutField label="Description" value={description} onChangeText={setDescription} multiline maxLength={2000} editable={!busy} />
    <WorkoutPhoto template={{ id: template?.id ?? "draft", title, category, owner_id: template?.owner_id ?? "", exercises: [], photo_url: photoPreview }} height={120} />
    <RecipePhotoPicker onSelect={uploadPhoto} disabled={busy || uploading} />
    {photoReference ? <Button label="Remove photo" icon="trash-outline" disabled={busy || uploading} onPress={() => { setPhotoReference(null); setPhotoPreview(null); }} /> : null}
    {exercises.map((exercise, index) => <View key={index} style={styles.section}>
      <View style={styles.row}><Text style={[styles.title, styles.copy]}>Exercise {index + 1}</Text><Button label="" icon="arrow-up" accessibilityLabel={`Move exercise ${index + 1} earlier`} disabled={busy || index === 0} onPress={() => reorder(index, -1)} /><Button label="" icon="arrow-down" accessibilityLabel={`Move exercise ${index + 1} later`} disabled={busy || index === exercises.length - 1} onPress={() => reorder(index, 1)} /><Button label="" icon="trash-outline" accessibilityLabel={`Remove exercise ${index + 1}`} disabled={busy} onPress={() => setExercises(all => all.filter((_, i) => i !== index))} /></View>
      <WorkoutField label={`Exercise ${index + 1} name`} value={exercise.name} maxLength={160} editable={!busy} onChangeText={value => edit(index, "name", value)} />
      <View style={styles.row}>
        <View style={{ flexBasis: 90, flexGrow: 1 }}><WorkoutField label="Sets" accessibilityLabel={`Exercise ${index + 1} sets`} value={exercise.sets} keyboardType="number-pad" editable={!busy} onChangeText={value => edit(index, "sets", value)} /></View>
        <View style={{ flexBasis: 90, flexGrow: 1 }}><WorkoutField label="Reps" accessibilityLabel={`Exercise ${index + 1} reps`} value={exercise.reps} maxLength={80} editable={!busy} onChangeText={value => edit(index, "reps", value)} /></View>
        <View style={{ flexBasis: 90, flexGrow: 1 }}><WorkoutField label="Duration (s)" accessibilityLabel={`Exercise ${index + 1} duration (s)`} value={exercise.duration} keyboardType="number-pad" editable={!busy} onChangeText={value => edit(index, "duration", value)} /></View>
      </View>
    </View>)}
    <Button label="Add exercise" icon="add" disabled={busy || exercises.length >= 50} onPress={() => setExercises(all => [...all, emptyExercise()])} />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Button label={busy ? "Saving..." : "Save workout"} icon="save-outline" variant="primary" disabled={busy || uploading} onPress={() => { void save(); }} />
  </WorkoutSheet>;
}
