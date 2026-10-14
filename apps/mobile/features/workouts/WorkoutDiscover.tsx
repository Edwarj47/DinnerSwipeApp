import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "@/components/Button";
import { useTransientMessage } from "@/components/useTransientMessage";
import { Screen } from "@/components/Screen";
import { useSpace } from "@/features/groups/useSpace";
import { chooseWorkout, getWorkoutPlan, getWorkoutTemplates, workoutKey } from "./api";
import { CategoryFilters } from "./CategoryFilters";
import { PerformanceForm } from "./PerformanceForm";
import { WorkoutAction, WorkoutCard, WorkoutCardHandle } from "./WorkoutCard";
import { WorkoutDetail } from "./WorkoutDetail";
import { useWorkoutOwner } from "./WorkoutRuntime";
import { WorkoutCategory, WorkoutPlan, WorkoutSlot, WorkoutTemplate } from "./types";
import { WorkoutHeader, WorkoutQueryState, WorkoutSpaceSelector, categories, styles } from "./ui";

export function WorkoutDiscover() {
  const space = useSpace(), owner = useWorkoutOwner();
  return <DiscoverContent key={`${owner}:${space.key}`} />;
}
function DiscoverContent() {
  const space = useSpace(), owner = useWorkoutOwner(), client = useQueryClient(), router = useRouter();
  const [selected, setSelected] = useState<WorkoutCategory[]>(categories.map(item => item.value)), [seen, setSeen] = useState<string[]>([]);
  const [detail, setDetail] = useState<WorkoutTemplate | null>(null), [performance, setPerformance] = useState<WorkoutTemplate | null>(null), [message, setMessage] = useTransientMessage();
  const card = useRef<WorkoutCardHandle>(null);
  const templates = useQuery<{ items: WorkoutTemplate[]; total: number }>({ queryKey: workoutKey(owner, "templates", space.key, "discover"), queryFn: () => getWorkoutTemplates(space.groupId, true), enabled: Boolean(owner) && !space.isLoading && !space.isError, retry: false });
  const plan = useQuery<WorkoutPlan>({ queryKey: workoutKey(owner, "plan", space.key), queryFn: () => getWorkoutPlan(space.groupId), enabled: Boolean(owner) && !space.isLoading && !space.isError, retry: false });
  const action = useMutation({ mutationFn: (id: string) => chooseWorkout(id, space.groupId, space.canManage), onSuccess: (_, id) => {
    setSeen(all => [...all, id]); setDetail(null); setMessage(space.groupId && !space.canManage ? "Workout proposed." : "Workout added to this week.");
    void client.invalidateQueries({ queryKey: workoutKey(owner, "plan", space.key) });
    void client.invalidateQueries({ queryKey: workoutKey(owner, "proposals", space.key) });
  } });
  const planned = new Set(plan.data?.slots.map((slot: WorkoutSlot) => slot.template_id) ?? []);
  const current = templates.data?.items.find((item: WorkoutTemplate) => selected.includes(item.category) && !seen.includes(item.id) && !planned.has(item.id));
  function act(choice: WorkoutAction) { if (!current || action.isPending) return; setMessage(""); if (choice === "skip") setSeen(all => [...all, current.id]); else action.mutate(current.id); }
  const loading = space.isLoading || templates.isLoading || plan.isLoading, error = space.error ?? templates.error ?? plan.error;
  return <Screen contentWidth={760} header={<WorkoutHeader title="Discover" />}>
    <WorkoutSpaceSelector />
    <CategoryFilters selected={selected} onChange={values => { setSelected(values); action.reset(); }} />
    {message ? <Text accessibilityLiveRegion="polite" style={styles.eyebrow}>{message}</Text> : null}
    {action.error ? <Text accessibilityRole="alert" style={styles.error}>{action.error.message}</Text> : null}
    <WorkoutQueryState loading={loading} error={error} retry={() => { void space.refetch(); void templates.refetch(); void plan.refetch(); }} />
    {!loading && !error ? current ? <>
      <WorkoutCard ref={card} template={current} busy={action.isPending} proposing={Boolean(space.groupId && !space.canManage)} onAction={act} onOpen={() => setDetail(current)} />
      <View style={[styles.row, { justifyContent: "center" }]}><Button label="" icon="close" accessibilityLabel="Skip workout" disabled={action.isPending} onPress={() => card.current?.choose("skip")} /><Button label="" icon={space.groupId && !space.canManage ? "people-outline" : "calendar-outline"} accessibilityLabel={space.groupId && !space.canManage ? "Propose workout" : "Schedule workout"} variant="primary" disabled={action.isPending} onPress={() => card.current?.choose("add")} /></View>
    </> : <View style={styles.empty}><Text style={styles.title}>{!selected.length ? "No categories selected" : templates.data?.items.length ? "No more workouts" : "No workouts selected"}</Text>
      {templates.data?.items.length ? <Button label="Start again" icon="refresh" onPress={() => setSeen([])} disabled={!seen.length} /> : null}
      <Button label="Workout library" icon="barbell-outline" onPress={() => router.push("/recipes")} />
    </View> : null}
    {detail ? <WorkoutDetail template={detail} onClose={() => setDetail(null)} onPlan={() => action.mutate(detail.id)} onLog={() => { setPerformance(detail); setDetail(null); }} proposing={Boolean(space.groupId && !space.canManage)} busy={action.isPending} /> : null}
    {performance ? <PerformanceForm template={performance} groupId={space.groupId} onClose={() => setPerformance(null)} onSaved={() => { setMessage("Personal session saved."); void client.invalidateQueries({ queryKey: workoutKey(owner, "logs") }); void client.invalidateQueries({ queryKey: workoutKey(owner, "progress") }); }} /> : null}
  </Screen>;
}
