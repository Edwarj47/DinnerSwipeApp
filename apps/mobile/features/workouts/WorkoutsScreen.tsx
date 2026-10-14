import { useState } from "react";
import { Screen } from "@/components/Screen";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useSpace } from "@/features/groups/useSpace";
import { WorkoutLibrary } from "./WorkoutLibrary";
import { WorkoutProgress } from "./WorkoutProgress";
import { WorkoutSessions } from "./WorkoutSessions";
import { useWorkoutOwner } from "./WorkoutRuntime";
import { WorkoutHeader, WorkoutSpaceSelector } from "./ui";

export function WorkoutsScreen() { const space = useSpace(), owner = useWorkoutOwner(); return <Content key={`${owner}:${space.key}`} />; }
function Content() {
  const [view, setView] = useState<"library" | "sessions" | "progress">("library");
  return <Screen contentWidth={760} header={<WorkoutHeader title="Workouts" />}><WorkoutSpaceSelector /><SegmentedControl value={view} onChange={setView} adaptive accessibilityLabel="Workout views" options={[{ value: "library", label: "Library", icon: "barbell-outline" }, { value: "sessions", label: "Sessions", icon: "calendar-outline" }, { value: "progress", label: "Progress", icon: "stats-chart-outline" }]} />
    {view === "library" ? <WorkoutLibrary /> : view === "sessions" ? <WorkoutSessions /> : <WorkoutProgress />}
  </Screen>;
}
