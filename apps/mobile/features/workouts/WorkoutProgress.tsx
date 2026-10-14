import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { displayWorkoutWeight, useWorkoutMode } from "@/services/workoutMode";
import { getWorkoutProgress, workoutKey } from "./api";
import { useWorkoutOwner } from "./WorkoutRuntime";
import { WorkoutQueryState, WorkoutQueueNotice, styles } from "./ui";
import { WorkoutProgress as ProgressData } from "./types";

export function WorkoutProgress() {
  const owner = useWorkoutOwner(), unit = useWorkoutMode(state => state.weight_unit);
  const progress = useQuery<ProgressData>({ queryKey: workoutKey(owner, "progress"), queryFn: getWorkoutProgress, enabled: Boolean(owner), retry: false });
  const data = progress.data;
  return <View style={{ gap: 12 }}><Text style={styles.title}>My Progress</Text><WorkoutQueueNotice onSynced={() => { void progress.refetch(); }} />
    <WorkoutQueryState loading={progress.isLoading} error={progress.error} retry={() => { void progress.refetch(); }} />
    {data && !progress.isError ? <>
      <View style={styles.section}><Text style={styles.title}>{data.sessions_completed} sessions completed</Text><Text style={styles.muted}>Volume: {displayWorkoutWeight(data.total_volume_kg, unit)} {unit}</Text><Text style={styles.muted}>Duration: {Math.round(data.total_duration_seconds / 60)} min</Text></View>
      {data.exercises.map((exercise: ProgressData["exercises"][number], i: number) => <View key={exercise.name ?? exercise.exercise_name ?? i} style={styles.section}><Text style={styles.title}>{exercise.name ?? exercise.exercise_name ?? "Exercise"}</Text><Text style={styles.muted}>{exercise.sessions_completed ?? 0} sessions / {displayWorkoutWeight(exercise.total_volume_kg ?? 0, unit)} {unit} volume</Text><Text style={styles.muted}>Max weight: {displayWorkoutWeight(exercise.max_weight_kg ?? 0, unit)} {unit} / {Math.round((exercise.total_duration_seconds ?? 0) / 60)} min</Text></View>)}
      {!data.exercises.length ? <Text style={styles.muted}>No completed exercise records</Text> : null}
    </> : null}
  </View>;
}
