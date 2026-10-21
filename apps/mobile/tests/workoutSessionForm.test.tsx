import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { PerformanceForm } from "@/features/workouts/PerformanceForm";
import { saveWorkoutPerformance } from "@/features/workouts/api";
import { WorkoutTemplate } from "@/features/workouts/types";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/features/premium/MacroDatePicker", () => ({ MacroDatePicker: () => null }));
jest.mock("@/features/workouts/api", () => ({ saveWorkoutPerformance: jest.fn() }));
const save = jest.mocked(saveWorkoutPerformance);
const run: WorkoutTemplate = { id: "routine", owner_id: "a", title: "Morning run", category: "cardio", exercises: [{ name: "Run" }] };

beforeEach(() => { jest.clearAllMocks(); save.mockResolvedValue({ requestId: "saved", pending: false }); });

test("saves the pictured run with notes and completion, leaving set fields empty", async () => {
  const onSaved = jest.fn(), onClose = jest.fn();
  const screen = render(<PerformanceForm template={run} onSaved={onSaved} onClose={onClose} />);
  try {
    fireEvent.changeText(screen.getByLabelText("Run notes"), "3.15 miles");
    fireEvent.press(screen.getByLabelText("Run completed"));
    fireEvent.press(screen.getByLabelText("Session completed"));
    fireEvent.press(screen.getByLabelText("Save session"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ template_id: run.id, completed: true, sets: [],
      exercise_details: [{ exercise_index: 0, completed: true, notes: "3.15 miles" }] }), expect.any(String), run);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  } finally { screen.unmount(); }
});

test("saves an incomplete session with notes and no sets", async () => {
  const onSaved = jest.fn(), onClose = jest.fn();
  const screen = render(<PerformanceForm template={run} onSaved={onSaved} onClose={onClose} />);
  try {
    fireEvent.changeText(screen.getByLabelText("Session notes"), "Stopped early");
    fireEvent.press(screen.getByLabelText("Save session"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({ completed: false, notes: "Stopped early", sets: [] });
  } finally { screen.unmount(); }
});

test("an existing no-set session can be edited without changing its request ID", async () => {
  const onSaved = jest.fn(), onClose = jest.fn();
  const existing = { template_id: run.id, performed_on: "2026-10-14", completed: true, notes: "Original note", sets: [],
    exercise_details: [{ exercise_index: 0, completed: true, notes: "3.15 miles" }], snapshot: run, request_uuid: "existing-request" };
  const screen = render(<PerformanceForm template={run} existing={existing} onSaved={onSaved} onClose={onClose} />);
  try {
    expect(screen.getByLabelText("Run notes").props.value).toBe("3.15 miles");
    fireEvent.changeText(screen.getByLabelText("Session notes"), "Corrected note");
    fireEvent.press(screen.getByLabelText("Save session"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ completed: true, notes: "Corrected note", sets: [] }), "existing-request", run);
  } finally { screen.unmount(); }
});

test("partially entered invalid sets are still rejected", async () => {
  const onSaved = jest.fn(), onClose = jest.fn();
  const screen = render(<PerformanceForm template={run} onSaved={onSaved} onClose={onClose} />);
  try {
    fireEvent.changeText(screen.getByLabelText(/Run set 1 weight/), "20");
    fireEvent.press(screen.getByLabelText("Save session"));
    await screen.findByText("Add repetitions or duration to each recorded set.");
    expect(save).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  } finally { screen.unmount(); }
});
