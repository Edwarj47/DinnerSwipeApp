import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch, ApiError, ConnectionError } from "@/services/api";
import { changeOffline, loadOffline, setDeviceOffline, setOfflineOwner } from "@/services/offlineStore";
import { chooseWorkout, ownWorkoutLogs, workoutKey, workoutPath } from "@/features/workouts/api";
import { clearWorkoutOwner, queueWorkoutPerformance, restoreWorkoutQueue, syncWorkoutPerformance, useWorkoutQueue, workoutRead } from "@/features/workouts/storage";
import { WorkoutPerformance, WorkoutTemplate } from "@/features/workouts/types";
import { PremiumStatus } from "@/services/types";

jest.mock("@/services/api", () => ({ ...jest.requireActual("@/services/api"), apiFetch: jest.fn() }));
const owner = "workout-a";
const values: WorkoutPerformance = { template_id: "squat", performed_on: "2026-10-14", completed: true, sets: [{ exercise_index: 0, set_number: 1, reps: 8, weight_kg: 60 }] };
const snapshot: WorkoutTemplate = { id: "squat", title: "Original routine", category: "lower", exercises: [{ name: "Squat" }], owner_id: owner };
async function authorize(id = owner) {
  setOfflineOwner(id);
  await changeOffline(id, data => {
    data.session = { user_id: id, email: "workout@example.invalid" };
    data.verifiedAt = Date.now();
    data.subscription = { basic_active: true, premium_active: false, offline_until: new Date(Date.now() + 72 * 3600000).toISOString() } as PremiumStatus;
  });
}
beforeEach(async () => {
  setOfflineOwner(null); await clearWorkoutOwner(owner); await clearWorkoutOwner("workout-b"); await AsyncStorage.clear();
  jest.mocked(apiFetch).mockReset(); setDeviceOffline(false); await authorize();
});
afterEach(async () => { setOfflineOwner(null); await clearWorkoutOwner(owner); await clearWorkoutOwner("workout-b"); });

test("personal, owner, and member scheduling use workout-only endpoints", async () => {
  jest.mocked(apiFetch).mockResolvedValue({});
  await chooseWorkout("squat"); await chooseWorkout("squat", "team", true); await chooseWorkout("squat", "team", false);
  expect(jest.mocked(apiFetch).mock.calls.map(([path, init]) => [path, JSON.parse(String(init?.body))])).toEqual([
    ["/api/v1/workouts/plans/slots", { template_id: "squat" }],
    ["/api/v1/workouts/plans/slots", { template_id: "squat", household_id: "team" }],
    ["/api/v1/workouts/proposals", { template_id: "squat", household_id: "team" }]
  ]);
});
test("offline scheduling never enters either outbox", async () => {
  setDeviceOffline(true);
  await expect(chooseWorkout("squat", "team", true)).rejects.toThrow(/Reconnect/);
  await expect(chooseWorkout("squat", "team", false)).rejects.toThrow(/Reconnect/);
  expect(useWorkoutQueue.getState().pending).toEqual([]);
  expect((await loadOffline(owner)).edits).toEqual([]);
  expect(apiFetch).not.toHaveBeenCalled();
});
test("basic authenticated grace allows a durable performance log, without a premium entitlement", async () => {
  setDeviceOffline(true); await queueWorkoutPerformance("request-a", values, snapshot);
  useWorkoutQueue.setState({ pending: [] }); await restoreWorkoutQueue();
  expect(useWorkoutQueue.getState().pending).toMatchObject([{ request_uuid: "request-a", values, snapshot }]);
  expect((await loadOffline(owner)).edits).toEqual([]);
});
test("expired authentication rejects a new queued log", async () => {
  await changeOffline(owner, data => { data.verifiedAt = Date.now() - 73 * 3600000; });
  await expect(queueWorkoutPerformance("expired", values)).rejects.toThrow(/verify access/);
  expect(useWorkoutQueue.getState().pending).toEqual([]);
});
test("the durable queue is bounded and preserves earlier entries when full", async () => {
  for (let i = 0; i < 100; i++) await queueWorkoutPerformance(`request-${i}`, values);
  await expect(queueWorkoutPerformance("overflow", values)).rejects.toThrow(/storage is full/);
  await restoreWorkoutQueue(); expect(useWorkoutQueue.getState().pending).toHaveLength(100);
});
test("account changes clear the previous workout queue and cache", async () => {
  await queueWorkoutPerformance("request-a", values);
  setOfflineOwner("workout-b"); await clearWorkoutOwner(owner);
  expect(useWorkoutQueue.getState().pending).toEqual([]);
  expect(await AsyncStorage.getItem(`dinnerSwipe.workouts.offline.v1.${owner}`)).toBeNull();
  await restoreWorkoutQueue(); expect(useWorkoutQueue.getState().pending).toEqual([]);
});
test("lost network responses retry the same request UUID", async () => {
  await queueWorkoutPerformance("same-request", values);
  jest.mocked(apiFetch).mockRejectedValueOnce(new ConnectionError("offline"));
  await syncWorkoutPerformance(); expect(useWorkoutQueue.getState().pending).toHaveLength(1);
  jest.mocked(apiFetch).mockResolvedValueOnce({}); await syncWorkoutPerformance();
  expect(jest.mocked(apiFetch).mock.calls.map(([path]) => path)).toEqual(["/api/v1/workouts/logs/same-request", "/api/v1/workouts/logs/same-request"]);
  expect(useWorkoutQueue.getState().pending).toEqual([]);
});
test("corrections keep the original routine snapshot and request UUID", async () => {
  await queueWorkoutPerformance("correct", values, snapshot);
  await queueWorkoutPerformance("correct", { ...values, sets: [{ exercise_index: 0, set_number: 1, reps: 10 }] }, { ...snapshot, title: "Edited live routine" });
  expect(useWorkoutQueue.getState().pending).toMatchObject([{ request_uuid: "correct", revision: 2, snapshot: { title: "Original routine" }, values: { sets: [{ reps: 10 }] } }]);
  expect(useWorkoutQueue.getState().pending).toHaveLength(1);
});
test("a correction during synchronization is not removed by the old acknowledgement", async () => {
  await queueWorkoutPerformance("correct", values, snapshot);
  let release!: (value: unknown) => void;
  jest.mocked(apiFetch).mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue({});
  const syncing = syncWorkoutPerformance();
  for (let i = 0; i < 20 && !release; i++) await new Promise(resolve => setTimeout(resolve, 0));
  await queueWorkoutPerformance("correct", { ...values, completed: false }, snapshot); release({}); await syncing;
  expect(apiFetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(jest.mocked(apiFetch).mock.calls[1][1]?.body)).completed).toBe(false);
  expect(useWorkoutQueue.getState().pending).toEqual([]);
});
test.each([401, 402, 403, 404])("an explicit %s purges the denied cached path", async status => {
  const path = workoutPath("templates", undefined, { limit: "100", offset: "0" });
  jest.mocked(apiFetch).mockResolvedValueOnce({ items: [snapshot], total: 1 }); await workoutRead(path);
  jest.mocked(apiFetch).mockRejectedValueOnce(new ApiError("Denied", status)); await expect(workoutRead(path)).rejects.toThrow("Denied");
  jest.mocked(apiFetch).mockRejectedValueOnce(new ConnectionError("offline")); await expect(workoutRead(path)).rejects.toThrow(/not downloaded/);
});
test("membership denial removes every cache page belonging to that group", async () => {
  const paths = [workoutPath("templates", "team"), workoutPath("plans/current", "team"), workoutPath("proposals", "team")];
  jest.mocked(apiFetch).mockResolvedValue({ items: [] }); for (const path of paths) await workoutRead(path);
  jest.mocked(apiFetch).mockRejectedValueOnce(new ApiError("No membership", 404)); await expect(workoutRead(paths[0])).rejects.toThrow();
  jest.mocked(apiFetch).mockRejectedValue(new ConnectionError("offline"));
  for (const path of paths) await expect(workoutRead(path)).rejects.toThrow(/not downloaded/);
});
test("group changes never change personal log scope or expose another user's rows", () => {
  expect(workoutPath("logs")).toBe("/api/v1/workouts/logs");
  expect(workoutKey(owner, "logs")).not.toEqual(workoutKey("workout-b", "logs"));
  expect(ownWorkoutLogs([{ ...values, user_id: "workout-b" }, { ...values, user_id: owner }], owner)).toEqual([{ ...values, user_id: owner }]);
});
