import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { Button } from "@/components/Button";
import { PerformanceForm } from "./PerformanceForm";
import { displayWorkoutWeight, useWorkoutMode } from "@/services/workoutMode";
import { getWorkoutLogs, ownWorkoutLogs, workoutKey } from "./api";
import { useWorkoutQueue } from "./storage";
import { WorkoutLog } from "./types";
import { useWorkoutOwner } from "./WorkoutRuntime";
import { WorkoutQueryState, WorkoutQueueNotice, WorkoutSheet, styles } from "./ui";

export function WorkoutSessions() {
  const owner = useWorkoutOwner(), unit = useWorkoutMode(state => state.weight_unit), client = useQueryClient();
  const logs = useQuery({ queryKey: workoutKey(owner, "logs"), queryFn: getWorkoutLogs, enabled: Boolean(owner), retry: false });
  const pending = useWorkoutQueue(state => state.pending);
  const [detail, setDetail] = useState<WorkoutLog | null>(null);
  const [edit, setEdit] = useState<WorkoutLog | null>(null);
  const byId = new Map<string, WorkoutLog>();
  for (const row of ownWorkoutLogs(logs.data?.items ?? [], owner)) byId.set(row.request_uuid ?? row.id ?? `${row.template_id}:${row.performed_on}`, row);
  for (const row of pending) byId.set(row.request_uuid, { ...row.values, snapshot: row.snapshot, request_uuid: row.request_uuid, pending: true, issue: row.issue });
  const rows = [...byId.values()].sort((a, b) => b.performed_on.localeCompare(a.performed_on));
  return <View style={{ gap: 12 }}><Text style={styles.title}>My Sessions</Text>
    <WorkoutQueueNotice onSynced={() => { void logs.refetch(); void client.invalidateQueries({ queryKey: workoutKey(owner, "progress") }); }} />
    <WorkoutQueryState loading={logs.isLoading} error={logs.error} retry={() => { void logs.refetch(); }} />
    {rows.map((row, i) => <View key={row.request_uuid ?? row.id ?? i} style={styles.item}><View style={styles.body}><View style={styles.row}><Text style={[styles.title, styles.copy]}>{row.snapshot?.title ?? row.template?.title ?? row.title ?? "Workout session"}</Text><Button label="" icon="information-circle-outline" accessibilityLabel={`View session ${row.performed_on}`} onPress={() => setDetail(row)} />{row.request_uuid && row.snapshot ? <Button label="" icon="create-outline" accessibilityLabel={`Correct session ${row.performed_on}`} onPress={() => setEdit(row)} /> : null}</View><Text style={styles.muted}>{row.performed_on} / {row.completed ? "Completed" : "Incomplete"} / {row.sets.length} sets</Text>{row.pending ? <Text style={row.issue ? styles.error : styles.eyebrow}>{row.issue ?? "Saved on this device"}</Text> : null}</View></View>)}
    {!rows.length && !logs.isLoading && !logs.isError ? <Text style={styles.muted}>No sessions recorded</Text> : null}
    {detail ? <WorkoutSheet title="Session performance" onClose={() => setDetail(null)}><Text style={styles.title}>{detail.snapshot?.title ?? detail.template?.title ?? "Workout session"}</Text><Text style={styles.muted}>{detail.performed_on} / {detail.completed ? "Completed" : "Incomplete"}</Text>
      {detail.sets.map(set => <View key={`${set.exercise_index}:${set.set_number}`} style={styles.section}><Text style={styles.title}>{detail.snapshot?.exercises[set.exercise_index]?.name ?? detail.template?.exercises[set.exercise_index]?.name ?? `Exercise ${set.exercise_index + 1}`} / Set {set.set_number}</Text><Text style={styles.muted}>{[set.reps !== undefined ? `${set.reps} reps` : "", set.weight_kg !== undefined ? `${displayWorkoutWeight(set.weight_kg, unit)} ${unit}` : "", set.duration_seconds !== undefined ? `${set.duration_seconds}s` : ""].filter(Boolean).join(" / ")}</Text></View>)}
      {detail.notes ? <Text style={styles.muted}>{detail.notes}</Text> : null}
    </WorkoutSheet> : null}
    {edit?.snapshot ? <PerformanceForm template={edit.snapshot} existing={edit} onClose={() => setEdit(null)} onSaved={() => { void logs.refetch(); void client.invalidateQueries({ queryKey: workoutKey(owner, "progress") }); }} /> : null}
  </View>;
}
