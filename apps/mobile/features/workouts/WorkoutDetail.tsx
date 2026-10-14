import { Text, View } from "react-native";
import { Button } from "@/components/Button";
import { WorkoutTemplate } from "./types";
import { WorkoutPhoto, WorkoutSheet, categoryLabel, styles } from "./ui";

export function WorkoutDetail({ template, onClose, onPlan, onLog, proposing = false, busy = false }: { template: WorkoutTemplate; onClose: () => void; onPlan?: () => void; onLog?: () => void; proposing?: boolean; busy?: boolean }) {
  return <WorkoutSheet title={template.title} onClose={onClose} busy={busy}>
    <WorkoutPhoto template={template} />
    <Text style={styles.eyebrow}>{categoryLabel(template.category)}</Text>
    {template.description ? <Text style={styles.muted}>{template.description}</Text> : null}
    {template.exercises.map((exercise, index) => <View key={index} style={styles.section}><Text style={styles.title}>{exercise.name}</Text><Text style={styles.muted}>{[exercise.sets ? `${exercise.sets} sets` : "", exercise.reps ? `${exercise.reps} reps` : "", exercise.duration_seconds ? `${exercise.duration_seconds} seconds` : ""].filter(Boolean).join(" / ")}</Text></View>)}
    {onPlan ? <Button label={proposing ? "Propose workout" : "Add to week"} icon={proposing ? "people-outline" : "calendar-outline"} variant="primary" disabled={busy} onPress={onPlan} /> : null}
    {onLog ? <Button label="Log performance" icon="barbell-outline" onPress={onLog} disabled={busy} /> : null}
  </WorkoutSheet>;
}
