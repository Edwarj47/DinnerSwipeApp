import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { WorkoutGroupPanel } from "@/features/workouts/WorkoutGroupPanel";
import { getWorkoutPlan, getWorkoutProposals, getWorkoutTemplates, workoutWrite } from "@/features/workouts/api";
import { resetWorkoutMode, useWorkoutMode } from "@/services/workoutMode";
import { setOfflineOwner } from "@/services/offlineStore";

jest.mock("@expo/vector-icons", () => ({ Ionicons: jest.requireActual("react-native").View }));
jest.mock("@/features/workouts/api", () => ({ ...jest.requireActual("@/features/workouts/api"), getWorkoutTemplates: jest.fn(), getWorkoutPlan: jest.fn(), getWorkoutProposals: jest.fn(), workoutWrite: jest.fn() }));
jest.mock("@/features/workouts/ui", () => ({ ...jest.requireActual("@/features/workouts/ui"), WorkoutPhoto: () => null }));
const template = { id: "mine", title: "My Squat", category: "lower" as const, owner_id: "a", exercises: [{ name: "Squat" }], discover_enabled: true };
function mount(role = "owner") { const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } }); const screen = render(<QueryClientProvider client={client}><WorkoutGroupPanel groupId="team" role={role} /></QueryClientProvider>); return { ...screen, close: () => { screen.unmount(); client.clear(); } }; }
beforeEach(() => {
  jest.clearAllMocks(); setOfflineOwner("a"); resetWorkoutMode("a"); useWorkoutMode.setState({ enabled: true, mode: "workouts" });
  jest.mocked(getWorkoutTemplates).mockResolvedValue({ items: [template], total: 1 }); jest.mocked(getWorkoutProposals).mockResolvedValue({ items: [{ id: "proposal", template_id: "mine", snapshot: template, status: "pending" }] });
  jest.mocked(getWorkoutPlan).mockResolvedValue({ id: "plan", week_start: "2026-10-12", read_only: false, slots: [] }); jest.mocked(workoutWrite).mockResolvedValue({});
});
test("nutrition and flag-off never display or fetch workout group controls", () => {
  useWorkoutMode.setState({ mode: "nutrition" }); const screen = mount();
  expect(screen.queryByTestId("workout-group-panel")).toBeNull(); expect(getWorkoutTemplates).not.toHaveBeenCalled(); screen.close();
  useWorkoutMode.setState({ mode: "workouts", enabled: false }); const hidden = mount(); expect(hidden.queryByTestId("workout-group-panel")).toBeNull(); hidden.close();
});
test("one-click bulk selection shares only the user's private workouts", async () => {
  jest.mocked(getWorkoutTemplates).mockImplementation(async groupId => ({ items: groupId ? [template] : [template, { ...template, id: "theirs", owner_id: "b" }], total: groupId ? 1 : 2 }));
  const screen = mount(); try {
    await waitFor(() => expect(screen.getByLabelText("Share My Squat")).toBeTruthy()); expect(screen.queryByLabelText("Share theirs")).toBeNull();
    fireEvent.press(screen.getByText("Select all")); fireEvent.press(screen.getByText("Share selected (1)"));
    await waitFor(() => expect(workoutWrite).toHaveBeenCalledWith("templates/share", "POST", { template_ids: ["mine"], household_id: "team" }));
  } finally { screen.close(); }
});
test("members may share their own routines but cannot curate Discover or decide proposals", async () => {
  const screen = mount("member"); try {
    await waitFor(() => expect(screen.getByLabelText("Share My Squat")).toBeTruthy());
    expect(screen.queryByLabelText("Discover: My Squat")).toBeNull(); expect(screen.queryByText("Approve")).toBeNull(); expect(screen.queryByText("Reject")).toBeNull();
  } finally { screen.close(); }
});
test("owner curation and proposal decisions use the workout contract", async () => {
  const screen = mount(); try {
    await waitFor(() => expect(screen.getByLabelText("Discover: My Squat")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Discover: My Squat")); await waitFor(() => expect(workoutWrite).toHaveBeenCalledWith("discover-choices", "PATCH", { household_id: "team", enable_ids: [], disable_ids: ["mine"] }));
    await waitFor(() => expect(screen.getByText("Approve").parent?.props.accessibilityState?.disabled).not.toBe(true));
    fireEvent.press(screen.getByText("Approve")); await waitFor(() => expect(workoutWrite).toHaveBeenCalledWith("proposals/proposal/decision", "POST", { action: "approve", slot_date: null }));
  } finally { screen.close(); }
});
