import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { Button } from "@/components/Button";
import { useTransientMessage } from "@/components/useTransientMessage";
import { DaySelection } from "@/features/planner/DaySelection";
import { shiftDate } from "@/features/planner/WeekNavigator";
import { getWorkoutPlan, getWorkoutProposals, getWorkoutTemplates, workoutKey, workoutWrite } from "./api";
import { PerformanceForm, WorkoutCheckbox } from "./PerformanceForm";
import { WorkoutDetail } from "./WorkoutDetail";
import { useIsWorkoutMode, useWorkoutOwner } from "./WorkoutRuntime";
import { WorkoutPlan, WorkoutProposal, WorkoutTemplate } from "./types";
import { WorkoutPhoto, WorkoutQueryState, styles } from "./ui";
import { WorkoutSettings } from "./WorkoutSettings";
import { SettingsSection } from "@/features/settings/SettingsSection";

export type WorkoutGroupPanelProps = { groupId: string; role: string | null | undefined };
export function WorkoutGroupPanel(props: WorkoutGroupPanelProps) {
  const active = useIsWorkoutMode();
  if (!active) return null;
  return <GroupPanel key={`${props.groupId}:${props.role}`} {...props} />;
}
function GroupPanel({ groupId, role }: WorkoutGroupPanelProps) {
  const owner = useWorkoutOwner(), client = useQueryClient(), canManage = role === "owner";
  const [selected, setSelected] = useState<string[]>([]), [dates, setDates] = useState<Record<string, string | null>>({}), [message, setMessage] = useTransientMessage();
  const [detail, setDetail] = useState<WorkoutTemplate | null>(null), [performance, setPerformance] = useState<WorkoutTemplate | null>(null);
  const own = useQuery<{ items: WorkoutTemplate[]; total: number }>({ queryKey: workoutKey(owner, "templates", "personal", "library"), queryFn: () => getWorkoutTemplates(), enabled: Boolean(owner), retry: false });
  const shared = useQuery<{ items: WorkoutTemplate[]; total: number }>({ queryKey: workoutKey(owner, "templates", groupId, "library"), queryFn: () => getWorkoutTemplates(groupId), enabled: Boolean(owner), retry: false });
  const proposals = useQuery<{ items: WorkoutProposal[] } | WorkoutProposal[]>({ queryKey: workoutKey(owner, "proposals", groupId), queryFn: () => getWorkoutProposals(groupId), enabled: Boolean(owner), retry: false });
  const plan = useQuery<WorkoutPlan>({ queryKey: workoutKey(owner, "plan", groupId), queryFn: () => getWorkoutPlan(groupId), enabled: Boolean(owner) && canManage, retry: false });
  const refresh = () => { void client.invalidateQueries({ queryKey: ["workouts", owner, "templates"] }); void client.invalidateQueries({ queryKey: workoutKey(owner, "proposals", groupId) }); void client.invalidateQueries({ queryKey: workoutKey(owner, "plan", groupId) }); };
  const share = useMutation({ mutationFn: () => workoutWrite("templates/share", "POST", { template_ids: selected, household_id: groupId }), onSuccess: () => { setSelected([]); setMessage("Workouts shared."); refresh(); } });
  const curate = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => workoutWrite("discover-choices", "PATCH", { household_id: groupId, enable_ids: enabled ? [id] : [], disable_ids: enabled ? [] : [id] }), onSuccess: refresh });
  const decide = useMutation({ mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) => workoutWrite(`proposals/${encodeURIComponent(id)}/decision`, "POST", { action, ...(action === "approve" ? { slot_date: dates[id] ?? null } : {}) }), onSuccess: refresh });
  const ownItems: WorkoutTemplate[] = (own.data?.items ?? []).filter((item: WorkoutTemplate) => item.owner_id === owner), ids = ownItems.map(item => item.id), busy = share.isPending || curate.isPending || decide.isPending;
  const error = share.error ?? curate.error ?? decide.error;
  const pending: WorkoutProposal[] = (Array.isArray(proposals.data) ? proposals.data : proposals.data?.items ?? []).filter((item: WorkoutProposal) => !item.status || item.status === "pending");
  const days = plan.data ? Array.from({ length: 7 }, (_, i) => { const iso = shiftDate(plan.data!.week_start, i), date = new Date(`${iso}T12:00:00Z`); return { iso, label: date.toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" }), short: date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) }; }) : [];
  return <View testID="workout-group-panel" style={{ gap: 14 }}>
    {canManage ? <SettingsSection title="Workout weekly reset" icon="calendar-outline"><WorkoutSettings groupId={groupId} /></SettingsSection> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.eyebrow}>{message}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error.message}</Text> : null}
    <View style={styles.section}><View style={styles.row}><Text style={[styles.title, styles.copy]}>Share My Workouts</Text><Button label="Select all" icon="checkbox-outline" disabled={busy || !ids.length} onPress={() => setSelected(ids)} /><Button label="" icon="remove-circle-outline" accessibilityLabel="Clear workout selection" disabled={busy || !selected.length} onPress={() => setSelected([])} /></View>
      <WorkoutQueryState loading={own.isLoading} error={own.error} retry={() => { void own.refetch(); }} />
      {ownItems.map(item => <WorkoutCheckbox key={item.id} label={`Share ${item.title}`} checked={selected.includes(item.id)} disabled={busy} onChange={() => setSelected(all => all.includes(item.id) ? all.filter(id => id !== item.id) : [...all, item.id])} />)}
      {!ownItems.length && !own.isLoading && !own.isError ? <Text style={styles.muted}>No personal workouts</Text> : null}
      <Button label={`Share selected${selected.length ? ` (${selected.length})` : ""}`} icon="share-social-outline" variant="primary" disabled={busy || !selected.length} onPress={() => share.mutate()} />
    </View>
    <View style={styles.section}><Text style={styles.title}>Group Workouts</Text>
      <WorkoutQueryState loading={shared.isLoading} error={shared.error} retry={() => { void shared.refetch(); }} />
      {shared.data?.items.map((item: WorkoutTemplate) => <View key={item.id} style={styles.item}><WorkoutPhoto template={item} height={120} /><View style={styles.body}><View style={styles.row}><Text style={[styles.title, styles.copy]}>{item.title}</Text><Button label="" icon="information-circle-outline" accessibilityLabel={`View ${item.title}`} onPress={() => setDetail(item)} /></View>
        {canManage ? <WorkoutCheckbox label={`Discover: ${item.title}`} checked={Boolean(item.discover_enabled)} disabled={busy} onChange={() => curate.mutate({ id: item.id, enabled: !item.discover_enabled })} /> : <Text style={styles.muted}>{item.discover_enabled ? "In group Discover" : "Not in group Discover"}</Text>}
      </View></View>)}
      {!shared.data?.items.length && !shared.isLoading && !shared.isError ? <Text style={styles.muted}>No shared workouts</Text> : null}
    </View>
    <View style={styles.section}><Text style={styles.title}>Workout Proposals</Text><WorkoutQueryState loading={proposals.isLoading} error={proposals.error} retry={() => { void proposals.refetch(); }} />
      {pending.map(item => <View key={item.id} style={styles.item}><View style={styles.body}><Text style={styles.title}>{item.snapshot?.title ?? item.template?.title ?? "Workout proposal"}</Text>
        {canManage ? <><DaySelection days={days} value={dates[item.id] ?? null} disabled={busy || plan.isLoading || plan.isError} onChange={value => setDates(all => ({ ...all, [item.id]: value }))} /><View style={styles.row}><Button label="Approve" icon="checkmark" variant="primary" disabled={busy || plan.isLoading || plan.isError} onPress={() => decide.mutate({ id: item.id, action: "approve" })} /><Button label="Reject" icon="close" disabled={busy} onPress={() => decide.mutate({ id: item.id, action: "reject" })} /></View></> : <Text style={styles.muted}>Awaiting owner</Text>}
      </View></View>)}
      {canManage && plan.isError ? <WorkoutQueryState error={plan.error} retry={() => { void plan.refetch(); }} /> : null}
      {!pending.length && !proposals.isLoading && !proposals.isError ? <Text style={styles.muted}>No pending proposals</Text> : null}
    </View>
    {detail ? <WorkoutDetail template={detail} onClose={() => setDetail(null)} onLog={() => { setPerformance(detail); setDetail(null); }} /> : null}
    {performance ? <PerformanceForm template={performance} groupId={groupId} onClose={() => setPerformance(null)} onSaved={() => { void client.invalidateQueries({ queryKey: workoutKey(owner, "logs") }); void client.invalidateQueries({ queryKey: workoutKey(owner, "progress") }); }} /> : null}
  </View>;
}
