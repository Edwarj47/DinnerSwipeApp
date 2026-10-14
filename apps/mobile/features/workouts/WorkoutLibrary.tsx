import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { Button } from "@/components/Button";
import { useTransientMessage } from "@/components/useTransientMessage";
import { SearchField } from "@/components/SearchField";
import { chooseWorkout, getWorkoutTemplates, workoutKey } from "./api";
import { CategoryFilters } from "./CategoryFilters";
import { PerformanceForm } from "./PerformanceForm";
import { TemplateEditor } from "./TemplateEditor";
import { WorkoutDetail } from "./WorkoutDetail";
import { WorkoutGroupPanel } from "./WorkoutGroupPanel";
import { useSpace } from "@/features/groups/useSpace";
import { useWorkoutOwner } from "./WorkoutRuntime";
import { WorkoutCategory, WorkoutTemplate } from "./types";
import { WorkoutPhoto, WorkoutQueryState, categories, categoryLabel, styles } from "./ui";

export function WorkoutLibrary() {
  const owner = useWorkoutOwner(), space = useSpace(), client = useQueryClient();
  const [search, setSearch] = useState(""), [selected, setSelected] = useState<WorkoutCategory[]>(categories.map(item => item.value));
  const [editor, setEditor] = useState<WorkoutTemplate | "new" | null>(null), [detail, setDetail] = useState<WorkoutTemplate | null>(null), [performance, setPerformance] = useState<WorkoutTemplate | null>(null), [message, setMessage] = useTransientMessage();
  const templates = useQuery<{ items: WorkoutTemplate[]; total: number }>({ queryKey: workoutKey(owner, "templates", "personal", "library"), queryFn: () => getWorkoutTemplates(), enabled: Boolean(owner), retry: false });
  const plan = useMutation({ mutationFn: (template: WorkoutTemplate) => chooseWorkout(template.id), onSuccess: () => { setDetail(null); setMessage("Workout added to your personal week."); void client.invalidateQueries({ queryKey: workoutKey(owner, "plan", "personal") }); } });
  const rows: WorkoutTemplate[] = templates.data?.items.filter((item: WorkoutTemplate) => item.owner_id === owner && selected.includes(item.category) && item.title.toLowerCase().includes(search.toLowerCase())) ?? [];
  const refresh = () => { void client.invalidateQueries({ queryKey: ["workouts", owner, "templates"] }); };
  return <View style={{ gap: 12 }}>
    <View style={styles.row}><Text style={[styles.title, styles.copy]}>My Workouts</Text><Button label="New workout" icon="add" variant="primary" onPress={() => setEditor("new")} /></View>
    <SearchField value={search} onChangeText={setSearch} placeholder="Search workouts" accessibilityLabel="Search workouts" />
    <CategoryFilters selected={selected} onChange={setSelected} />
    {message ? <Text accessibilityLiveRegion="polite" style={styles.eyebrow}>{message}</Text> : null}
    {plan.error ? <Text accessibilityRole="alert" style={styles.error}>{plan.error.message}</Text> : null}
    <WorkoutQueryState loading={templates.isLoading} error={templates.error} retry={() => { void templates.refetch(); }} />
    {rows.map(item => <View key={item.id} style={styles.item}><WorkoutPhoto template={item} height={140} /><View style={styles.body}><View style={styles.row}><Text style={[styles.title, styles.copy]}>{item.title}</Text><Button label="" icon="create-outline" accessibilityLabel={`Edit ${item.title}`} onPress={() => setEditor(item)} /><Button label="" icon="information-circle-outline" accessibilityLabel={`View ${item.title}`} onPress={() => setDetail(item)} /></View><Text style={styles.muted}>{categoryLabel(item.category)} / {item.exercises.length} exercises</Text><Button label="Log performance" icon="barbell-outline" onPress={() => setPerformance(item)} /></View></View>)}
    {!rows.length && !templates.isLoading && !templates.isError ? <Text style={styles.muted}>{templates.data?.items.length ? "No matching workouts" : "No personal workouts"}</Text> : null}
    {space.groupId ? <WorkoutGroupPanel groupId={space.groupId} role={space.group?.current_user_role} /> : null}
    {editor ? <TemplateEditor template={editor === "new" ? undefined : editor} onClose={() => setEditor(null)} onSaved={() => { setMessage("Workout saved."); refresh(); }} /> : null}
    {detail ? <WorkoutDetail template={detail} onClose={() => setDetail(null)} busy={plan.isPending} onPlan={() => plan.mutate(detail)} onLog={() => { setPerformance(detail); setDetail(null); }} /> : null}
    {performance ? <PerformanceForm template={performance} onClose={() => setPerformance(null)} onSaved={() => { setMessage("Personal session saved."); void client.invalidateQueries({ queryKey: workoutKey(owner, "logs") }); void client.invalidateQueries({ queryKey: workoutKey(owner, "progress") }); }} /> : null}
  </View>;
}
