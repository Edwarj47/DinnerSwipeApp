import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { TourTarget } from "@/features/onboarding/TourTarget";
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
  const params = useLocalSearchParams<{ workout_view?: string; tour?: string }>();
  useEffect(() => { if (params.tour && ["library", "sessions", "progress"].includes(params.workout_view ?? "")) setView(params.workout_view as "library" | "sessions" | "progress"); }, [params.workout_view, params.tour]);
  return <Screen contentWidth={760} header={<WorkoutHeader title="Workouts" />}><WorkoutSpaceSelector /><SegmentedControl value={view} onChange={setView} adaptive accessibilityLabel="Workout views" options={[{ value: "library", label: "Library", icon: "barbell-outline" }, { value: "sessions", label: "Sessions", icon: "calendar-outline" }, { value: "progress", label: "Progress", icon: "stats-chart-outline" }]} />
    {view === "library" ? <TourTarget id="workout-library"><WorkoutLibrary /></TourTarget> : view === "sessions" ? <WorkoutSessions /> : <WorkoutProgress />}
  </Screen>;
}
