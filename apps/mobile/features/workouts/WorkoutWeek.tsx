import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { useSpace } from "@/features/groups/useSpace";
import { DaySelection } from "@/features/planner/DaySelection";
import { monday, shiftDate, WeekNavigator } from "@/features/planner/WeekNavigator";
import { todayISO } from "@/features/premium/macroDates";
import { getWorkoutPlan, getWorkoutProposals, workoutKey, workoutWrite } from "./api";
import { PerformanceForm } from "./PerformanceForm";
import { WorkoutDetail } from "./WorkoutDetail";
import { useWorkoutOwner } from "./WorkoutRuntime";
import { WorkoutPlan, WorkoutProposal, WorkoutTemplate } from "./types";
import { WorkoutHeader, WorkoutQueryState, WorkoutQueueNotice, WorkoutSpaceSelector, styles } from "./ui";

export function WorkoutWeek() { const space = useSpace(), owner = useWorkoutOwner(); return <WeekContent key={`${owner}:${space.key}`} />; }
function WeekContent() {
  const owner = useWorkoutOwner(), space = useSpace(), client = useQueryClient(), router = useRouter();
  const [selected, setSelected] = useState<string | null>(null), [detail, setDetail] = useState<WorkoutTemplate | null>(null), [performance, setPerformance] = useState<WorkoutTemplate | null>(null);
  const [performanceSlot, setPerformanceSlot] = useState<string | undefined>();
  const current = useQuery<WorkoutPlan>({ queryKey: workoutKey(owner, "plan", space.key), queryFn: () => getWorkoutPlan(space.groupId), enabled: selected === null && Boolean(owner) && !space.isLoading && !space.isError, retry: false });
  const currentWeek = current.data?.week_start ?? monday(todayISO()), week = selected ?? currentWeek, historical = week < currentWeek;
  const history = useQuery<WorkoutPlan>({ queryKey: workoutKey(owner, "history", space.key, week), queryFn: () => getWorkoutPlan(space.groupId, week), enabled: Boolean(owner) && historical && !space.isLoading && !space.isError, retry: false });
  const query = historical ? history : current, plan = query.data, readOnly = historical || Boolean(plan?.read_only), manage = !readOnly && space.canManage;
  const proposals = useQuery<{ items: WorkoutProposal[] } | WorkoutProposal[]>({ queryKey: workoutKey(owner, "proposals", space.key), queryFn: () => getWorkoutProposals(space.groupId!), enabled: Boolean(owner && space.groupId) && !historical && !space.isLoading && !space.isError, retry: false, refetchInterval: 30000 });
  const refresh = () => { void client.invalidateQueries({ queryKey: workoutKey(owner, "plan", space.key) }); void client.invalidateQueries({ queryKey: workoutKey(owner, "proposals", space.key) }); };
  const update = useMutation({ mutationFn: ({ id, patch }: { id: string; patch: { slot_date?: string | null; sort_order?: number } }) => workoutWrite(`plans/slots/${encodeURIComponent(id)}`, "PATCH", patch), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => workoutWrite(`plans/slots/${encodeURIComponent(id)}`, "DELETE"), onSuccess: refresh });
  const decision = useMutation({ mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) => workoutWrite(`proposals/${encodeURIComponent(id)}/decision`, "POST", { action }), onSuccess: refresh });
  const reorder = useMutation({ mutationFn: (slotIds: string[]) => workoutWrite("plans/reorder", "PATCH", { slot_ids: slotIds, ...(space.groupId ? { household_id: space.groupId } : {}) }), onSuccess: refresh });
  const reset = useMutation({ mutationFn: () => workoutWrite(`plans/current/reset${space.groupId ? `?household_id=${space.groupId}` : ""}`, "POST", {}), onSuccess: refresh });
  const [confirmReset, setConfirmReset] = useState(false);
  const busy = update.isPending || remove.isPending || decision.isPending || reorder.isPending || reset.isPending;
  const days = Array.from({ length: 7 }, (_, i) => { const iso = shiftDate(week, i), date = new Date(`${iso}T12:00:00Z`); return { iso, label: date.toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" }), short: date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) }; });
  const slots = [...(plan?.slots ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const pending: WorkoutProposal[] = (Array.isArray(proposals.data) ? proposals.data : proposals.data?.items ?? []).filter((item: WorkoutProposal) => !item.status || item.status === "pending");
  const mutationError = update.error ?? remove.error ?? decision.error ?? reorder.error ?? reset.error;
  return <Screen contentWidth={760} header={<WorkoutHeader title={historical ? "History" : "This Week"} />}>
    <WorkoutSpaceSelector />
    <WeekNavigator week={week} currentWeek={currentWeek} onChange={value => { if (value <= currentWeek) { setSelected(value === currentWeek ? null : value); setDetail(null); setPerformance(null); } }} />
    {readOnly ? <Text style={styles.eyebrow}>Read-only workout history</Text> : null}
    {manage && plan?.slots.length ? <View style={styles.row}>
      <Button label={confirmReset ? "Confirm reset" : "Reset workouts"} icon="refresh" variant={confirmReset ? "danger" : "secondary"} disabled={busy}
        onPress={() => { if (confirmReset) { reset.mutate(); setConfirmReset(false); } else setConfirmReset(true); }} />
      {confirmReset ? <Button label="Cancel" icon="close" onPress={() => setConfirmReset(false)} /> : null}
    </View> : null}
    {mutationError ? <Text accessibilityRole="alert" style={styles.error}>{mutationError.message}</Text> : null}
    <WorkoutQueryState loading={space.isLoading || query.isLoading} error={space.error ?? query.error} retry={() => { void space.refetch(); void query.refetch(); }} />
    {plan && !query.isError ? [...days, { iso: "", label: "Unscheduled", short: "" }].map(day => <View key={day.iso} style={styles.section}>
      <Text style={styles.title}>{day.label}{day.short ? `, ${day.short}` : ""}</Text>
      {slots.filter(slot => (slot.slot_date ?? "") === day.iso).map(slot => <View key={slot.id} style={styles.item}><View style={styles.body}>
        <View style={styles.row}><Text style={[styles.title, styles.copy]}>{slot.snapshot.title}</Text><Button label="" icon="information-circle-outline" accessibilityLabel={`View ${slot.snapshot.title}`} onPress={() => { setPerformanceSlot(slot.id); setDetail(slot.snapshot); }} /></View>
        <Text style={styles.muted}>{slot.snapshot.exercises.length} exercises</Text>
        {manage ? <>
          <DaySelection days={days} value={slot.slot_date} disabled={busy} onChange={value => update.mutate({ id: slot.id, patch: { slot_date: value } })} />
          <View style={styles.row}>
            <Button label="" icon="arrow-up" accessibilityLabel={`Move ${slot.snapshot.title} earlier`} disabled={busy || slots.findIndex(row => row.id === slot.id) === 0} onPress={() => {
              const i = slots.findIndex(row => row.id === slot.id), previous = slots[i - 1];
              const ordered = slots.map(row => row.id); [ordered[i - 1], ordered[i]] = [slot.id, previous.id]; reorder.mutate(ordered);
            }} />
            <Button label="" icon="trash-outline" variant="quiet-danger" accessibilityLabel={`Remove ${slot.snapshot.title}`} disabled={busy} onPress={() => remove.mutate(slot.id)} />
          </View>
        </> : null}
        {!readOnly ? <Button label="Log performance" icon="barbell-outline" disabled={busy} onPress={() => { setPerformanceSlot(slot.id); setPerformance(slot.snapshot); }} /> : null}
      </View></View>)}
      {!slots.some(slot => (slot.slot_date ?? "") === day.iso) ? <Text style={styles.muted}>No workouts</Text> : null}
    </View>) : null}
    {!readOnly ? <Button label="Choose workouts" icon="add" onPress={() => router.push("/recipes")} /> : null}
    {!historical && space.groupId ? <View style={styles.section}><Text style={styles.title}>Proposals</Text>
      <WorkoutQueryState loading={proposals.isLoading} error={proposals.error} retry={() => { void proposals.refetch(); }} />
      {pending.map(item => <View key={item.id} style={styles.item}><View style={styles.body}><Text style={styles.title}>{item.snapshot?.title ?? item.template?.title ?? "Workout proposal"}</Text>{space.canManage ? <View style={styles.row}><Button label="Approve" icon="checkmark" variant="primary" disabled={busy} onPress={() => decision.mutate({ id: item.id, action: "approve" })} /><Button label="Reject" icon="close" disabled={busy} onPress={() => decision.mutate({ id: item.id, action: "reject" })} /></View> : <Text style={styles.muted}>Awaiting owner</Text>}</View></View>)}
      {!pending.length && !proposals.isLoading && !proposals.isError ? <Text style={styles.muted}>No pending proposals</Text> : null}
    </View> : null}
    <WorkoutQueueNotice />
    {detail ? <WorkoutDetail template={detail} onClose={() => setDetail(null)} onLog={readOnly ? undefined : () => { setPerformance(detail); setDetail(null); }} /> : null}
    {performance && !readOnly ? <PerformanceForm template={performance} slotId={performanceSlot} onClose={() => { setPerformance(null); setPerformanceSlot(undefined); }} onSaved={() => { void client.invalidateQueries({ queryKey: workoutKey(owner, "logs") }); void client.invalidateQueries({ queryKey: workoutKey(owner, "progress") }); }} /> : null}
  </Screen>;
}
