import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Linking, Pressable } from "react-native";
import { DailyAdditionsSection } from "@/features/contentAutomation/DailyAdditionsSection";
import { CandidatePreview } from "@/features/contentAutomation/CandidatePreview";
import { automationKey, batchKey, sourcesKey } from "@/features/contentAutomation/api";
import { Batch, Candidate, ContentAutomation, dateLabel, reportReason, sourceLink, SourceOverview } from "@/features/contentAutomation/types";
import { UserSettingsPanel } from "@/features/settings/UserSettingsPanel";
import { apiFetch } from "@/services/api";
import { setDeviceOffline, setOfflineOwner } from "@/services/offlineStore";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: jest.requireActual("react-native").Image }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/services/api", () => ({ API_URL: "https://dinner.test", apiFetch: jest.fn() }));
jest.mock("@/services/biometrics", () => ({ getBiometricSettings: async () => ({ enabled: false }) }));
jest.mock("@/features/subscription/SubscriptionPanel", () => ({ SubscriptionPanel: () => null }));
jest.mock("@/features/premium/MacroTargetSettings", () => ({ MacroTargetSettings: () => null }));
jest.mock("@/features/discover/DiscoverSettings", () => ({ DiscoverSettings: () => null }));
jest.mock("@/features/workouts/WorkoutSettings", () => ({ WorkoutSettings: () => null }));
jest.mock("@/features/onboarding/TourTarget", () => ({ TourTarget: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const ROOT = "/api/v1/content-automation";
const OWNER = "daily-account";
const request = jest.mocked(apiFetch);
const recipe: Candidate = {
  id: "recipe-1", kind: "recipe", status: "pending", title: "Lemon chickpea bowls",
  photo_url: "https://dinner.test/api/v1/media/recipes/meal?v=1&token=signed",
  source_url: "https://recipes.example/lemon-bowls", source_name: "Example Kitchen", warnings: ["Check allergens."],
  payload: {
    description: "Chickpeas with fresh lemon.", servings: 2, prep_minutes: 5, cook_minutes: 10, total_minutes: 15,
    meal_type: "dinner", difficulty: "easy", cuisine: "Mediterranean", tags: ["vegetarian"],
    ingredients: [{ original_text: "1 can chickpeas" }, { original_text: "1 lemon" }], instructions: [{ text: "Warm the chickpeas." }, { text: "Finish with lemon." }],
    nutrition: { calories: 320, protein_g: 14, carbs_g: 42, fat_g: 9, fiber_g: 8 }
  }
};
const workout: Candidate = {
  id: "workout-1", kind: "workout", status: "pending", title: "Full body strength",
  photo_url: null, source_url: "javascript:alert(1)", source_name: null, warnings: [],
  payload: { title: "Full body strength", category: "full_body", description: "A short strength session.", exercises: [{ name: "Squat", sets: 3, reps: "8-12", duration_seconds: 60 }] }
};
let batch: Batch;
let state: ContentAutomation;
let sources: SourceOverview;
const SOURCE_ID = "a".repeat(64);
const SOURCE_TITLE = "Lemon bowl source lead";
const WORKOUT_SOURCE_TITLE = "Strength source lead";

beforeEach(() => {
  jest.clearAllMocks();
  setOfflineOwner(OWNER);
  setDeviceOffline(false);
  batch = {
    id: "batch-1", scheduled_date: "2026-10-16", status: "complete", recipe_count: 2, workout_count: 2,
    pending_count: 2, approved_count: 1, dismissed_count: 1, report: { reasons: ["One recipe did not meet nutrition requirements."] },
    recipes: [recipe, { ...recipe, id: "approved-1", title: "Saved soup", status: "approved" }],
    workouts: [workout, { ...workout, id: "dismissed-1", title: "Dismissed circuit", status: "dismissed" }]
  };
  state = {
    campaign: { id: "campaign-1", status: "active", time_zone: "America/New_York", start_date: "2026-10-16", end_date: "2026-10-22", days_total: 7, completed_days: 1, pending_count: 2 },
    batches: [summary(batch)]
  };
  sources = { runs: [{
    id: "run/one", scheduled_date: "2026-10-20", status: "complete", reasons: [],
    sources: [
      { id: SOURCE_ID, kind: "recipe", title: SOURCE_TITLE, source_url: "https://recipes.example/lemon", source_name: "Example Kitchen", status: "pending" },
      { id: "b".repeat(64), kind: "workout", title: WORKOUT_SOURCE_TITLE, source_url: "javascript:alert(1)", source_name: "Example Fitness", status: "pending" },
      { id: "c".repeat(64), kind: "recipe", title: "Dismissed source lead", source_url: "https://recipes.example/soup", source_name: "Example Kitchen", status: "dismissed" }
    ]
  }] };
  request.mockImplementation(async (path, init) => {
    if (path === ROOT) return structuredClone(state);
    if (path === `${ROOT}/sources`) return structuredClone(sources);
    if (path === `${ROOT}/sources/${encodeURIComponent(sources.runs[0]?.id)}/dismiss`) {
      const { source_ids: ids } = JSON.parse(String(init?.body)) as { source_ids: string[] };
      sources.runs[0].sources = sources.runs[0].sources.map(source => ids.includes(source.id) ? { ...source, status: "dismissed" } : source);
      return structuredClone(sources);
    }
    if (path === `${ROOT}/batches/${batch.id}`) return structuredClone(batch);
    if (path === `${ROOT}/campaign`) {
      state.campaign!.status = JSON.parse(String(init?.body)).paused ? "paused" : "active";
      return structuredClone(state);
    }
    if (path === `${ROOT}/batches/${batch.id}/decisions`) {
      const { action, candidate_ids: ids } = JSON.parse(String(init?.body)) as { action: string; candidate_ids: string[] };
      const update = (candidate: Candidate) => ids.includes(candidate.id) && candidate.status === "pending" ? { ...candidate, status: action === "approve" ? "approved" : "dismissed" } : candidate;
      batch = { ...batch, recipes: batch.recipes.map(update), workouts: batch.workouts.map(update) };
      const candidates = [...batch.recipes, ...batch.workouts];
      batch.pending_count = candidates.filter(item => item.status === "pending").length;
      batch.approved_count = candidates.filter(item => item.status === "approved").length;
      batch.dismissed_count = candidates.filter(item => item.status === "dismissed").length;
      state.campaign!.pending_count = batch.pending_count;
      state.batches = [summary(batch)];
      return structuredClone(batch);
    }
    if (path.endsWith("/auth/status")) return { user_id: OWNER, email: "daily@example.test", email_verified: true };
    if (path.endsWith("/profile")) return { household_size: 2, allergens: [], disliked_ingredients: [], notification_preferences: {} };
    if (path.endsWith("/subscription/status")) return { active: false, premium_active: false };
    throw new Error(`Unexpected request: ${path}`);
  });
});
afterEach(() => { jest.restoreAllMocks(); setOfflineOwner(null); setDeviceOffline(false); });

function summary(full: Batch) {
  const { recipes: _recipes, workouts: _workouts, ...value } = full;
  return value;
}
function mount(element: React.ReactElement = <DailyAdditionsSection />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  return { ...screen, client, close: () => { screen.unmount(); client.clear(); } };
}
async function expand(screen: ReturnType<typeof mount>) {
  fireEvent.press(await screen.findByLabelText("Expand Daily additions"));
  fireEvent.press(await screen.findByLabelText(`Expand batch ${dateLabel(batch.scheduled_date)}`));
  await screen.findByText("Lemon chickpea bowls");
  await waitFor(() => expect(screen.getByLabelText("Approve batch").props.accessibilityState.disabled).toBe(false));
}
async function showSources(screen: ReturnType<typeof mount>) {
  fireEvent.press(await screen.findByLabelText("Expand Daily additions"));
  fireEvent.press(screen.getByLabelText(/^Sources(?: \(\d+\))?$/));
  await screen.findByText("Needs source checks");
}
function sourceRequests() { return request.mock.calls.filter(([path]) => path === `${ROOT}/sources`); }
function writes() { return request.mock.calls.filter(([, init]) => init?.method === "POST" || init?.method === "PATCH"); }
// Native host views translate ARIA props; inspect Pressable for the web contract.
function webControl(screen: ReturnType<typeof mount>, label: string) {
  const control = screen.UNSAFE_getAllByType(Pressable).find(node => node.props.accessibilityLabel === label);
  if (!control) throw new Error(`Missing control: ${label}`);
  return control.props;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("settings show a collapsed Daily additions section for a campaign even without Premium", async () => {
  const screen = mount(<UserSettingsPanel />);
  try {
    await screen.findByLabelText("Expand Daily additions");
    expect(screen.queryByText("2 pending")).toBeNull();
    expect(request.mock.calls.some(([path]) => path.includes("/batches/"))).toBe(false);
    fireEvent.press(screen.getByLabelText("Expand Daily additions"));
    expect(screen.getByText("2 pending")).toBeTruthy();
    expect(screen.getByText("Active - 1/7 days")).toBeTruthy();
    expect(screen.getByText(/America\/New_York/)).toBeTruthy();
    expect(writes()).toHaveLength(0);
    fireEvent.press(screen.getByLabelText("Expand Meals"));
    expect(screen.queryByText("2 pending")).toBeNull();
    expect(screen.getByLabelText("Expand Daily additions")).toBeTruthy();
  } finally { screen.close(); }
});

test.each(["none", "loading", "error"])("no campaign section is exposed for %s", async mode => {
  const pending = deferred<ContentAutomation>();
  state.campaign = null;
  if (mode === "loading") request.mockReturnValue(pending.promise);
  if (mode === "error") request.mockRejectedValue(new Error("Unavailable"));
  const screen = mount();
  try {
    await waitFor(() => expect(request).toHaveBeenCalledWith(ROOT, expect.objectContaining({ signal: expect.anything() })));
    if (mode !== "loading") await waitFor(() => expect(screen.client.getQueryState(automationKey(OWNER))?.fetchStatus).toBe("idle"));
    expect(screen.queryByText("Daily additions")).toBeNull();
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
});

test("signed-out accounts do not request campaign data", () => {
  setOfflineOwner(null);
  const screen = mount();
  try { expect(request).not.toHaveBeenCalled(); expect(screen.queryByText("Daily additions")).toBeNull(); }
  finally { screen.close(); }
});

test("pending and history list dates, counts, and shortfall reasons", async () => {
  state.batches.push({ ...summary(batch), id: "history", scheduled_date: "2026-10-15", status: "reviewed", pending_count: 0 });
  state.batches.push({ ...summary(batch), id: "next", scheduled_date: "2026-10-17", status: "scheduled", pending_count: 0 });
  const screen = mount();
  try {
    fireEvent.press(await screen.findByLabelText("Expand Daily additions"));
    expect(screen.getByLabelText("Pending (2)")).toBeTruthy();
    expect(screen.getByLabelText("History (1)")).toBeTruthy();
    expect(screen.getByLabelText(`Expand batch ${dateLabel("2026-10-17")}`)).toBeTruthy();
    expect(webControl(screen, `Expand batch ${dateLabel("2026-10-17")}`)["aria-expanded"]).toBe(false);
    expect(screen.getAllByText("2 recipes | 2 workouts")).toHaveLength(2);
    expect(screen.getByText("2 pending | 1 approved | 1 dismissed")).toBeTruthy();
    expect(screen.getAllByText("One recipe did not meet nutrition requirements.").length).toBeGreaterThan(0);
    fireEvent.press(screen.getByLabelText("History (1)"));
    expect(screen.getByLabelText(`Expand batch ${dateLabel("2026-10-15")}`)).toBeTruthy();
    expect(screen.queryByLabelText(`Expand batch ${dateLabel("2026-10-16")}`)).toBeNull();
  } finally { screen.close(); }
});

test("selection and previews never save automatically; only pending items have checkboxes", async () => {
  const screen = mount();
  try {
    await expand(screen);
    expect(webControl(screen, `Collapse batch ${dateLabel(batch.scheduled_date)}`)["aria-expanded"]).toBe(true);
    expect(webControl(screen, "Select all pending additions")["aria-checked"]).toBe(false);
    expect(screen.getByLabelText("Approve selected").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText("Dismiss selected").props.accessibilityState.disabled).toBe(true);
    expect(screen.queryByLabelText("Select Saved soup")).toBeNull();
    expect(screen.queryByLabelText("Select Dismissed circuit")).toBeNull();
    fireEvent.press(screen.getByLabelText("Select Lemon chickpea bowls"));
    expect(screen.getByText("1/2 selected")).toBeTruthy();
    expect(screen.getByLabelText("Select all pending additions").props.accessibilityState.checked).toBe("mixed");
    expect(webControl(screen, "Select all pending additions")["aria-checked"]).toBe("mixed");
    expect(webControl(screen, "Select Lemon chickpea bowls")["aria-checked"]).toBe(true);
    fireEvent.press(screen.getByLabelText("Preview Lemon chickpea bowls"));
    expect(screen.getByText("1 can chickpeas")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Close daily addition preview"));
    expect(writes()).toHaveLength(0);
    fireEvent.press(screen.getByLabelText("Select all pending additions"));
    expect(screen.getByText("2/2 selected")).toBeTruthy();
    expect(webControl(screen, "Select all pending additions")["aria-checked"]).toBe(true);
    fireEvent.press(screen.getByLabelText("Select all pending additions"));
    expect(screen.getByText("0/2 selected")).toBeTruthy();
    expect(webControl(screen, "Select all pending additions")["aria-checked"]).toBe(false);
  } finally { screen.close(); }
});

test.each(["selected", "batch"])("approve %s submits only the explicit pending ids and invalidates library keys", async action => {
  const screen = mount();
  const invalidate = jest.spyOn(screen.client, "invalidateQueries");
  try {
    await expand(screen);
    if (action === "selected") fireEvent.press(screen.getByLabelText("Select Lemon chickpea bowls"));
    fireEvent.press(screen.getByLabelText(action === "selected" ? "Approve selected" : "Approve batch"));
    await waitFor(() => expect(request).toHaveBeenCalledWith(`${ROOT}/batches/batch-1/decisions`, {
      method: "POST", body: JSON.stringify({ action: "approve", candidate_ids: action === "selected" ? ["recipe-1"] : ["recipe-1", "workout-1"] })
    }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["recipes"] }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["workouts", OWNER, "templates"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: automationKey(OWNER), exact: true });
    expect(request.mock.calls.some(([path]) => path === "/api/v1/recipes" || path === "/api/v1/workouts/templates")).toBe(false);
    expect(batch.approved_count).toBe(action === "selected" ? 2 : 3);
    await waitFor(() => expect(screen.getByLabelText(action === "selected" ? "Pending (1)" : "History (1)")).toBeTruthy());
  } finally { screen.close(); }
});

test("dismiss selected posts only selected pending items without invalidating libraries", async () => {
  const screen = mount();
  const invalidate = jest.spyOn(screen.client, "invalidateQueries");
  try {
    await expand(screen);
    fireEvent.press(screen.getByLabelText("Select Full body strength"));
    fireEvent.press(screen.getByLabelText("Dismiss selected"));
    await screen.findByText("Selected additions dismissed.");
    expect(request).toHaveBeenCalledWith(`${ROOT}/batches/batch-1/decisions`, { method: "POST", body: JSON.stringify({ action: "dismiss", candidate_ids: ["workout-1"] }) });
    expect(screen.queryByLabelText("Select Full body strength")).toBeNull();
    expect(screen.getByText("0/1 selected")).toBeTruthy();
    expect(invalidate.mock.calls.some(([filters]) => filters?.queryKey?.[0] === "recipes" || filters?.queryKey?.[0] === "workouts")).toBe(false);
  } finally { screen.close(); }
});

test("saving disables selection, campaign changes, and repeated submissions", async () => {
  const saving = deferred<Batch>();
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, init) => path.endsWith("/decisions") ? saving.promise : original(path, init));
  const screen = mount();
  try {
    await expand(screen);
    fireEvent.press(screen.getByLabelText("Approve batch"));
    await screen.findByText("Saving decisions...");
    expect(screen.getByLabelText("Select Lemon chickpea bowls").props.accessibilityState.disabled).toBe(true);
    expect(webControl(screen, "Select Lemon chickpea bowls")["aria-disabled"]).toBe(true);
    expect(screen.getByLabelText("Pause daily additions").props.disabled).toBe(true);
    expect(screen.getByLabelText("Approve batch").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText("Approve batch"));
    expect(writes()).toHaveLength(1);
    await act(async () => { saving.resolve(structuredClone(batch)); });
    await waitFor(() => expect(screen.queryByText("Saving decisions...")).toBeNull());
  } finally { screen.close(); }
});

test("approval failure is not retried automatically and reconciles batch and library data", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, init) => path.endsWith("/decisions") ? Promise.reject(new Error("Network failure")) : original(path, init));
  const screen = mount();
  const invalidate = jest.spyOn(screen.client, "invalidateQueries");
  try {
    await expand(screen);
    fireEvent.press(screen.getByLabelText("Approve batch"));
    await screen.findByText(/Couldn't confirm the decision/);
    await waitFor(() => expect(screen.getByLabelText("Approve batch").props.accessibilityState.disabled).toBe(false));
    expect(writes()).toHaveLength(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: automationKey(OWNER) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["recipes"] });
    expect(screen.getByLabelText("Select Lemon chickpea bowls")).toBeTruthy();
  } finally { screen.close(); }
});

test("batch loading and errors do not allow decisions and retry recovers", async () => {
  const loading = deferred<Batch>();
  const original = request.getMockImplementation()!;
  let fail = true;
  request.mockImplementation((path, init) => path === `${ROOT}/batches/batch-1` && fail ? loading.promise : original(path, init));
  const screen = mount();
  try {
    fireEvent.press(await screen.findByLabelText("Expand Daily additions"));
    fireEvent.press(screen.getByLabelText(`Expand batch ${dateLabel(batch.scheduled_date)}`));
    await screen.findByLabelText("Loading daily batch");
    expect(screen.queryByLabelText("Approve batch")).toBeNull();
    await act(async () => { loading.reject(new Error("Unavailable")); });
    await screen.findByText("Couldn't load this batch.");
    expect(screen.queryByLabelText("Approve batch")).toBeNull();
    fail = false;
    fireEvent.press(screen.getByLabelText("Retry daily batch"));
    await screen.findByLabelText("Approve batch");
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
});

test("offline disables approvals and pause without queuing a write", async () => {
  const screen = mount();
  try {
    await expand(screen);
    act(() => setDeviceOffline(true));
    expect(screen.getByText("Reconnect to review daily additions.")).toBeTruthy();
    expect(screen.getByLabelText("Approve batch").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText("Pause daily additions").props.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText("Approve batch"));
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
});

test("pause and resume use PATCH and the returned campaign state", async () => {
  const screen = mount();
  try {
    fireEvent.press(await screen.findByLabelText("Expand Daily additions"));
    fireEvent(screen.getByLabelText("Pause daily additions"), "valueChange", true);
    await screen.findByText("Daily additions paused.");
    expect(request).toHaveBeenCalledWith(`${ROOT}/campaign`, { method: "PATCH", body: JSON.stringify({ paused: true }) });
    expect(screen.getByLabelText("Pause daily additions").props.value).toBe(true);
    fireEvent(screen.getByLabelText("Pause daily additions"), "valueChange", false);
    await screen.findByText("Daily additions resumed.");
    expect(screen.getByLabelText("Pause daily additions").props.value).toBe(false);
  } finally { screen.close(); }
});

test("pause in flight is disabled and failure leaves the server state unchanged", async () => {
  const saving = deferred<ContentAutomation>();
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, init) => path === `${ROOT}/campaign` ? saving.promise : original(path, init));
  const screen = mount();
  try {
    fireEvent.press(await screen.findByLabelText("Expand Daily additions"));
    fireEvent(screen.getByLabelText("Pause daily additions"), "valueChange", true);
    await screen.findByText("Updating campaign...");
    expect(screen.getByLabelText("Pause daily additions").props.disabled).toBe(true);
    fireEvent(screen.getByLabelText("Pause daily additions"), "valueChange", true);
    await act(async () => { saving.reject(new Error("Unavailable")); });
    await screen.findByText("Couldn't update the campaign. Refresh and try again.");
    expect(screen.getByLabelText("Pause daily additions").props.value).toBe(false);
    expect(writes()).toHaveLength(1);
  } finally { screen.close(); }
});

test.each(["completed", "cancelled", "expired", "failed"])("%s campaign keeps history but has no pause switch", async status => {
  state.campaign!.status = status;
  const screen = mount();
  try {
    fireEvent.press(await screen.findByLabelText("Expand Daily additions"));
    expect(screen.getByText(`${status[0].toUpperCase()}${status.slice(1)} - 1/7 days`)).toBeTruthy();
    expect(screen.queryByLabelText("Pause daily additions")).toBeNull();
    expect(screen.getByLabelText("Pending (1)")).toBeTruthy();
  } finally { screen.close(); }
});

test("preparing batches cannot submit partial pending candidates", async () => {
  batch.status = "running";
  state.batches = [summary(batch)];
  const screen = mount();
  try {
    fireEvent.press(await screen.findByLabelText("Expand Daily additions"));
    fireEvent.press(screen.getByLabelText(`Expand batch ${dateLabel(batch.scheduled_date)}`));
    await screen.findByText("Running...");
    expect(screen.getByLabelText("Approve batch").props.accessibilityState.disabled).toBe(true);
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
});

test("empty failed batches live in history, show reasons, and have no decision controls", async () => {
  batch = { ...batch, status: "failed", recipe_count: 0, workout_count: 0, pending_count: 0, recipes: [], workouts: [], report: { reasons: ["No qualifying candidates were found."] } };
  state.batches = [summary(batch)];
  const screen = mount();
  try {
    fireEvent.press(await screen.findByLabelText("Expand Daily additions"));
    expect(screen.getByText("No pending batches.")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("History (1)"));
    expect(screen.getByText("No qualifying candidates were found.")).toBeTruthy();
    fireEvent.press(screen.getByLabelText(`Expand batch ${dateLabel(batch.scheduled_date)}`));
    await screen.findByText("No additions in this batch.");
    expect(screen.queryByLabelText("Approve batch")).toBeNull();
  } finally { screen.close(); }
});

test.each(["complete", "partial"])("%s batches permit review after generation ends", async status => {
  batch.status = status;
  batch.report.reasons = ["recipe_shortfall:2/5", "workout_shortfall:2/5"];
  state.batches = [summary(batch)];
  const screen = mount();
  try {
    await expand(screen);
    expect(screen.getByText("Recipe shortfall: 2/5")).toBeTruthy();
    expect(screen.getByText("Workout shortfall: 2/5")).toBeTruthy();
    expect(screen.getByLabelText("Approve batch").props.accessibilityState.disabled).toBe(false);
  } finally { screen.close(); }
});

test("skipped batches show campaign pause reasons in history", async () => {
  batch = { ...batch, status: "skipped", recipe_count: 0, workout_count: 0, pending_count: 0, recipes: [], workouts: [], report: { reasons: ["campaign_paused"] } };
  state.batches = [summary(batch)];
  const screen = mount();
  try {
    fireEvent.press(await screen.findByLabelText("Expand Daily additions"));
    fireEvent.press(screen.getByLabelText("History (1)"));
    expect(screen.getByText("Campaign paused")).toBeTruthy();
    fireEvent.press(screen.getByLabelText(`Expand batch ${dateLabel(batch.scheduled_date)}`));
    await screen.findByText("No additions in this batch.");
    expect(screen.queryByLabelText("Select all pending additions")).toBeNull();
  } finally { screen.close(); }
});

test("a paused campaign still allows explicit review of existing pending additions", async () => {
  state.campaign!.status = "paused";
  const screen = mount();
  try {
    await expand(screen);
    expect(screen.getByLabelText("Pause daily additions").props.value).toBe(true);
    expect(screen.getByLabelText("Approve batch").props.accessibilityState.disabled).toBe(false);
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
});

test("refetch removes candidates decided elsewhere from the selected pending ids", async () => {
  const screen = mount();
  try {
    await expand(screen);
    fireEvent.press(screen.getByLabelText("Select all pending additions"));
    batch.recipes = batch.recipes.map(item => ({ ...item, status: "approved" }));
    batch.pending_count = 1;
    fireEvent.press(screen.getByLabelText("Refresh daily batch"));
    await waitFor(() => expect(screen.getByText("1/1 selected")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Approve selected"));
    await waitFor(() => expect(request).toHaveBeenCalledWith(`${ROOT}/batches/batch-1/decisions`, {
      method: "POST", body: JSON.stringify({ action: "approve", candidate_ids: ["workout-1"] })
    }));
  } finally { screen.close(); }
});

test("summary refresh failure disables stale decision controls and refresh recovers", async () => {
  const screen = mount();
  const original = request.getMockImplementation()!;
  try {
    await expand(screen);
    request.mockImplementation((path, init) => path === ROOT ? Promise.reject(new Error("Unavailable")) : original(path, init));
    fireEvent.press(screen.getByLabelText("Refresh daily additions"));
    await screen.findByText("Couldn't refresh daily additions. Try again.");
    expect(screen.getByLabelText("Approve batch").props.accessibilityState.disabled).toBe(true);
    request.mockImplementation(original);
    fireEvent.press(screen.getByLabelText("Refresh daily additions"));
    await waitFor(() => expect(screen.getByLabelText("Approve batch").props.accessibilityState.disabled).toBe(false));
  } finally { screen.close(); }
});

test("changing accounts immediately removes the previous campaign, selection and modal", async () => {
  const screen = mount();
  try {
    await expand(screen);
    fireEvent.press(screen.getByLabelText("Select Lemon chickpea bowls"));
    fireEvent.press(screen.getByLabelText("Preview Lemon chickpea bowls"));
    state.campaign = null;
    act(() => setOfflineOwner("different-account"));
    expect(screen.queryByText("Daily additions")).toBeNull();
    expect(screen.queryByLabelText("Close daily addition preview")).toBeNull();
    await waitFor(() => expect(screen.client.getQueryState(automationKey("different-account"))?.status).toBe("success"));
    expect(screen.queryByText("Daily additions")).toBeNull();
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
});

test("a late approval from another account cannot update current-account queries", async () => {
  const saving = deferred<Batch>();
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, init) => path.endsWith("/decisions") ? saving.promise : original(path, init));
  const screen = mount();
  const invalidate = jest.spyOn(screen.client, "invalidateQueries");
  try {
    await expand(screen);
    fireEvent.press(screen.getByLabelText("Approve batch"));
    await screen.findByText("Saving decisions...");
    state.campaign = null;
    act(() => setOfflineOwner("different-account"));
    await act(async () => { saving.resolve({ ...batch, pending_count: 0 }); });
    expect(invalidate).not.toHaveBeenCalled();
    expect(screen.client.getQueryData<Batch>(batchKey(OWNER, "batch-1"))?.pending_count).not.toBe(0);
    expect(screen.queryByText("Approved additions saved.")).toBeNull();
  } finally { screen.close(); }
});

test("sources load only in the visible Sources view, separately from complete candidates", async () => {
  expect(sourcesKey(OWNER)).toEqual(["content-automation", OWNER, "sources"]);
  const screen = mount();
  try {
    fireEvent.press(await screen.findByLabelText("Expand Daily additions"));
    expect(sourceRequests()).toHaveLength(0);
    fireEvent.press(screen.getByLabelText("History (0)"));
    expect(sourceRequests()).toHaveLength(0);
    fireEvent.press(screen.getByLabelText("Sources"));
    await screen.findByText(SOURCE_TITLE);
    expect(sourceRequests()).toHaveLength(1);
    expect(screen.getByText("Needs source checks")).toBeTruthy();
    expect(screen.getByText("2 pending sources | 1 dismissed")).toBeTruthy();
    expect(screen.getByLabelText("Sources (2)").props.accessibilityState.selected).toBe(true);
    expect(screen.getByText(`${dateLabel("2026-10-20")} - Complete`)).toBeTruthy();
    expect(screen.getByText("Recipe | Example Kitchen")).toBeTruthy();
    expect(screen.getByText("Workout | Example Fitness")).toBeTruthy();
    expect(screen.queryByText("Dismissed source lead")).toBeNull();
    expect(screen.queryByText(sources.runs[0].sources[0].source_url)).toBeNull();
    expect(screen.queryByText(recipe.title)).toBeNull();
    expect(screen.queryByLabelText("Approve batch")).toBeNull();
    expect(screen.queryByLabelText("Approve selected")).toBeNull();
    expect(screen.queryByLabelText(`Preview ${SOURCE_TITLE}`)).toBeNull();
    expect(screen.queryByLabelText("Select all pending additions")).toBeNull();
    fireEvent.press(screen.getByLabelText("Pending (1)"));
    await act(async () => { await screen.client.invalidateQueries({ queryKey: sourcesKey(OWNER), exact: true }); });
    expect(sourceRequests()).toHaveLength(1);
    expect(screen.queryByText("Needs source checks")).toBeNull();
    fireEvent.press(screen.getByLabelText(`Expand batch ${dateLabel(batch.scheduled_date)}`));
    await screen.findByText(recipe.title);
    expect(screen.getByLabelText("Approve batch")).toBeTruthy();
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
});

test.each(["tab", "collapse"])("leaving Sources via %s aborts an in-flight discovery read", async leave => {
  const loading = deferred<SourceOverview>();
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, init) => path === `${ROOT}/sources` ? loading.promise : original(path, init));
  const screen = mount();
  try {
    await showSources(screen);
    await screen.findByLabelText("Loading discovered sources");
    expect(screen.queryByText("No discovered sources yet.")).toBeNull();
    const signal = sourceRequests()[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    fireEvent.press(screen.getByLabelText(leave === "tab" ? "History (0)" : "Collapse Daily additions"));
    await waitFor(() => expect(signal?.aborted).toBe(true));
    await act(async () => { loading.resolve(structuredClone(sources)); });
    expect(screen.client.getQueryData(sourcesKey(OWNER))).toBeUndefined();
    expect(screen.queryByText(SOURCE_TITLE)).toBeNull();
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
});

test.each(["tab", "collapse", "offline"])("running discovery polls only while visible and online, stopping on %s", async leave => {
  jest.useFakeTimers();
  sources.runs[0].status = "running";
  const screen = mount();
  try {
    await showSources(screen);
    await screen.findByText(SOURCE_TITLE);
    expect(sourceRequests()).toHaveLength(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(5000); });
    expect(sourceRequests()).toHaveLength(2);
    if (leave === "offline") act(() => setDeviceOffline(true));
    else fireEvent.press(screen.getByLabelText(leave === "tab" ? "History (0)" : "Collapse Daily additions"));
    const count = sourceRequests().length;
    await act(async () => { await jest.advanceTimersByTimeAsync(60000); });
    expect(sourceRequests()).toHaveLength(count);
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); jest.useRealTimers(); }
});

test("empty and running or partial discovery runs preserve status, dates and reasons", async () => {
  sources = { runs: [] };
  const screen = mount();
  try {
    await showSources(screen);
    await screen.findByText("No discovered sources yet.");
    expect(screen.getByLabelText("Sources (0)")).toBeTruthy();
    sources.runs = [
      { id: "running", scheduled_date: "2026-10-21", status: "running", sources: [], reasons: [] },
      { id: "partial", scheduled_date: "2026-10-20", status: "partial", sources: [], reasons: ["recipe_shortfall:0/5", "Publisher checks are still outstanding."] }
    ];
    fireEvent.press(screen.getByLabelText("Refresh discovered sources"));
    await screen.findByText("Discovery in progress...");
    expect(screen.getByText(`${dateLabel("2026-10-21")} - Running`)).toBeTruthy();
    expect(screen.getByText(`${dateLabel("2026-10-20")} - Partial`)).toBeTruthy();
    expect(screen.getByText("No pending sources.")).toBeTruthy();
    expect(screen.getByText("Recipe shortfall: 0/5")).toBeTruthy();
    expect(screen.getByText("Publisher checks are still outstanding.")).toBeTruthy();
    expect(screen.queryByLabelText("Approve batch")).toBeNull();
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
});

test("fully dismissed discovery runs retain counts but no actionable source rows", async () => {
  sources.runs[0].sources.forEach(source => { source.status = "dismissed"; });
  const screen = mount();
  try {
    await showSources(screen);
    await screen.findByText("No pending sources.");
    expect(screen.getByLabelText("Sources (0)")).toBeTruthy();
    expect(screen.getByText("0 pending sources | 3 dismissed")).toBeTruthy();
    expect(screen.queryAllByLabelText(/^Dismiss source /)).toHaveLength(0);
    expect(screen.queryAllByLabelText(/^Open source /)).toHaveLength(0);
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
});

test("source errors allow manual refresh and stale reads cannot dismiss leads", async () => {
  const original = request.getMockImplementation()!;
  let fail = true;
  request.mockImplementation((path, init) => path === `${ROOT}/sources` && fail ? Promise.reject(new Error("Unavailable")) : original(path, init));
  const screen = mount();
  try {
    await showSources(screen);
    await screen.findByText("Couldn't load discovered sources. Refresh and try again.");
    expect(screen.queryByText("No discovered sources yet.")).toBeNull();
    expect(sourceRequests()).toHaveLength(1);
    fail = false;
    fireEvent.press(screen.getByLabelText("Refresh discovered sources"));
    await screen.findByText(SOURCE_TITLE);
    await waitFor(() => expect(screen.getByLabelText(`Dismiss source ${SOURCE_TITLE}`).props.accessibilityState.disabled).toBe(false));
    fail = true;
    fireEvent.press(screen.getByLabelText("Refresh discovered sources"));
    await screen.findByText("Couldn't load discovered sources. Refresh and try again.");
    expect(screen.getByText(SOURCE_TITLE)).toBeTruthy();
    expect(screen.getByLabelText(`Dismiss source ${SOURCE_TITLE}`).props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText(`Dismiss source ${SOURCE_TITLE}`));
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
});

test("source links use the safe URL helper and handle opening, duplicate taps and failures", async () => {
  const opening = deferred<void>();
  const open = jest.spyOn(Linking, "openURL").mockReturnValueOnce(opening.promise).mockResolvedValue(undefined);
  const screen = mount();
  try {
    await showSources(screen);
    await screen.findByText(SOURCE_TITLE);
    expect(screen.getByLabelText(`Open source ${WORKOUT_SOURCE_TITLE}`).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText("Source link unavailable.")).toBeTruthy();
    fireEvent.press(screen.getByLabelText(`Open source ${WORKOUT_SOURCE_TITLE}`));
    expect(open).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText(`Open source ${SOURCE_TITLE}`));
    expect(open).toHaveBeenCalledWith(sourceLink(sources.runs[0].sources[0].source_url));
    await screen.findByText("Opening source...");
    expect(screen.getByLabelText(`Open source ${SOURCE_TITLE}`).props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText(`Open source ${SOURCE_TITLE}`));
    expect(open).toHaveBeenCalledTimes(1);
    await act(async () => { opening.reject(new Error("No browser")); });
    await screen.findByText("Couldn't open the source.");
    fireEvent.press(screen.getByLabelText(`Open source ${SOURCE_TITLE}`));
    await waitFor(() => expect(screen.queryByText("Couldn't open the source.")).toBeNull());
    expect(open).toHaveBeenCalledTimes(2);
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
});

test("dismiss uses exact SHA256 ids, encoded run ids and the returned overview only", async () => {
  const saving = deferred<SourceOverview>();
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, init) => path.endsWith("/dismiss") ? saving.promise : original(path, init));
  const screen = mount();
  const invalidate = jest.spyOn(screen.client, "invalidateQueries");
  const update = jest.spyOn(screen.client, "setQueryData");
  try {
    await showSources(screen);
    await screen.findByText(SOURCE_TITLE);
    fireEvent.press(screen.getByLabelText(`Dismiss source ${SOURCE_TITLE}`));
    await screen.findByText("Dismissing source...");
    expect(request).toHaveBeenCalledWith(`${ROOT}/sources/run%2Fone/dismiss`, { method: "POST", body: JSON.stringify({ source_ids: [SOURCE_ID] }) });
    for (const label of [`Dismiss source ${SOURCE_TITLE}`, `Dismiss source ${WORKOUT_SOURCE_TITLE}`, "Refresh discovered sources", "Pending (1)", "History (0)", "Sources (2)"]) {
      expect(screen.getByLabelText(label).props.accessibilityState.disabled).toBe(true);
    }
    expect(screen.getByLabelText("Pause daily additions").props.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText(`Dismiss source ${SOURCE_TITLE}`));
    expect(writes()).toHaveLength(1);
    const response = structuredClone(sources);
    response.runs[0].sources[0].status = "dismissed";
    await act(async () => { saving.resolve(response); });
    await screen.findByText("Source dismissed.");
    expect(screen.queryByText(SOURCE_TITLE)).toBeNull();
    expect(screen.getByText("1 pending sources | 2 dismissed")).toBeTruthy();
    expect(screen.getByLabelText("Sources (1)")).toBeTruthy();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(sourcesKey(OWNER), response);
    expect(invalidate).not.toHaveBeenCalled();
    expect(screen.getByText("2 pending")).toBeTruthy();
    expect(batch.pending_count).toBe(2);
    expect(writes()).toHaveLength(1);
  } finally { screen.close(); }
});

test("dismiss failure does not retry a write and reconciles sources without touching batch or library keys", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, init) => path.endsWith("/dismiss") ? Promise.reject(new Error("Network failure")) : original(path, init));
  const screen = mount();
  const invalidate = jest.spyOn(screen.client, "invalidateQueries");
  try {
    await showSources(screen);
    await screen.findByText(SOURCE_TITLE);
    fireEvent.press(screen.getByLabelText(`Dismiss source ${SOURCE_TITLE}`));
    await screen.findByText("Couldn't confirm dismissal. Check the refreshed sources and try again.");
    await waitFor(() => expect(screen.getByLabelText(`Dismiss source ${SOURCE_TITLE}`).props.accessibilityState.disabled).toBe(false));
    expect(writes()).toHaveLength(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: sourcesKey(OWNER), exact: true });
    expect(sourceRequests()).toHaveLength(2);
    request.mockImplementation(original);
    fireEvent.press(screen.getByLabelText(`Dismiss source ${SOURCE_TITLE}`));
    await screen.findByText("Source dismissed.");
    expect(screen.queryByText(SOURCE_TITLE)).toBeNull();
  } finally { screen.close(); }
});

test("offline source visits do not fetch or queue dismissals and cached controls are disabled", async () => {
  setDeviceOffline(true);
  const screen = mount();
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  try {
    await showSources(screen);
    expect(screen.getByText("Reconnect to check or dismiss sources.")).toBeTruthy();
    expect(sourceRequests()).toHaveLength(0);
    expect(screen.getByLabelText("Refresh discovered sources").props.accessibilityState.disabled).toBe(true);
    act(() => setDeviceOffline(false));
    await screen.findByText(SOURCE_TITLE);
    await waitFor(() => expect(screen.getByLabelText(`Dismiss source ${SOURCE_TITLE}`).props.accessibilityState.disabled).toBe(false));
    const dismiss = webControl(screen, `Dismiss source ${SOURCE_TITLE}`).onPress;
    const openSource = webControl(screen, `Open source ${SOURCE_TITLE}`).onPress;
    act(() => setDeviceOffline(true));
    expect(screen.getByLabelText(`Dismiss source ${SOURCE_TITLE}`).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText(`Open source ${SOURCE_TITLE}`).props.accessibilityState.disabled).toBe(true);
    await act(async () => { dismiss(); openSource(); });
    expect(writes()).toHaveLength(0);
    expect(open).not.toHaveBeenCalled();
    expect(sourceRequests()).toHaveLength(1);
  } finally { screen.close(); }
});

test("malformed non-SHA256 source ids never enable dismissal", async () => {
  sources.runs[0].sources[0].id = "not-a-sha256";
  const screen = mount();
  try {
    await showSources(screen);
    await screen.findByText(SOURCE_TITLE);
    expect(screen.getByLabelText(`Dismiss source ${SOURCE_TITLE}`).props.accessibilityState.disabled).toBe(true);
    await act(async () => { webControl(screen, `Dismiss source ${SOURCE_TITLE}`).onPress(); });
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
});

test("source lists are bounded to ten entries per page, newest dates first, and clamp after refresh", async () => {
  const template = sources.runs[0].sources[0];
  sources.runs = [
    { ...sources.runs[0], id: "older", sources: [{ ...template, title: "Older source" }] },
    { ...sources.runs[0], scheduled_date: "2026-10-21", sources: Array.from({ length: 10 }, (_, index) => ({ ...template, id: index.toString(16).padStart(64, "0"), title: `New source ${index + 1}` })) }
  ];
  const screen = mount();
  try {
    await showSources(screen);
    await screen.findByText("New source 1");
    expect(screen.getByText("11 pending sources | 0 dismissed")).toBeTruthy();
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect(screen.getAllByLabelText(/^Dismiss source /)).toHaveLength(10);
    expect(screen.queryByText("Older source")).toBeNull();
    expect(screen.getByLabelText("Previous sources page").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText("Next sources page"));
    expect(screen.getByText("Older source")).toBeTruthy();
    expect(screen.queryByText("New source 1")).toBeNull();
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    expect(screen.getByLabelText("Next sources page").props.accessibilityState.disabled).toBe(true);
    // Another reviewer can finish a run between refreshes.
    sources.runs = [sources.runs[1]];
    fireEvent.press(screen.getByLabelText("Refresh discovered sources"));
    await screen.findByText("New source 1");
    expect(screen.queryByLabelText("Next sources page")).toBeNull();
    expect(screen.getAllByLabelText(/^Dismiss source /)).toHaveLength(10);
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
});

test("owner switches abort discovery reads and never show previous-owner leads in the new view", async () => {
  const loading = deferred<SourceOverview>();
  const previous = structuredClone(sources);
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, init) => path === `${ROOT}/sources` && sourceRequests().length === 1 ? loading.promise : original(path, init));
  const screen = mount();
  try {
    await showSources(screen);
    await screen.findByLabelText("Loading discovered sources");
    const signal = sourceRequests()[0][1]?.signal;
    sources = { runs: [] };
    act(() => setOfflineOwner("different-account"));
    expect(screen.queryByText("Needs source checks")).toBeNull();
    await showSources(screen);
    await screen.findByText("No discovered sources yet.");
    expect(signal?.aborted).toBe(true);
    await act(async () => { loading.resolve(previous); });
    expect(screen.queryByText(SOURCE_TITLE)).toBeNull();
    expect(screen.client.getQueryData(sourcesKey("different-account"))).toEqual({ runs: [] });
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
});

test.each(["success", "error", "returning-owner"])("late dismiss %s cannot write caches or invalidate queries after account changes", async result => {
  const saving = deferred<SourceOverview>();
  const response = structuredClone(sources);
  response.runs[0].sources[0].status = "dismissed";
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, init) => path.endsWith("/dismiss") ? saving.promise : original(path, init));
  const screen = mount();
  const update = jest.spyOn(screen.client, "setQueryData");
  const invalidate = jest.spyOn(screen.client, "invalidateQueries");
  try {
    await showSources(screen);
    await screen.findByText(SOURCE_TITLE);
    fireEvent.press(screen.getByLabelText(`Dismiss source ${SOURCE_TITLE}`));
    await screen.findByText("Dismissing source...");
    act(() => setOfflineOwner("different-account"));
    if (result === "returning-owner") act(() => setOfflineOwner(OWNER));
    sources = { runs: [] };
    await showSources(screen);
    await screen.findByText("No discovered sources yet.");
    await act(async () => { if (result === "error") saving.reject(new Error("Unavailable")); else saving.resolve(response); });
    expect(update).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(screen.client.getQueryData(sourcesKey(result === "returning-owner" ? OWNER : "different-account"))).toEqual({ runs: [] });
    expect(screen.queryByText("Source dismissed.")).toBeNull();
    expect(screen.queryByText(/Couldn't confirm dismissal/)).toBeNull();
    expect(writes()).toHaveLength(1);
  } finally { screen.close(); }
});

test.each(["owner", "offline"])("a change to %s during pre-dismiss cancellation prevents the POST", async change => {
  const gate = deferred<void>();
  const screen = mount();
  try {
    await showSources(screen);
    await screen.findByText(SOURCE_TITLE);
    const staleDismiss = webControl(screen, `Dismiss source ${SOURCE_TITLE}`).onPress;
    jest.spyOn(screen.client, "cancelQueries").mockReturnValueOnce(gate.promise);
    fireEvent.press(screen.getByLabelText(`Dismiss source ${SOURCE_TITLE}`));
    await screen.findByText("Dismissing source...");
    if (change === "owner") {
      state.campaign = null;
      act(() => setOfflineOwner("different-account"));
    } else act(() => setDeviceOffline(true));
    await act(async () => { gate.resolve(); staleDismiss(); });
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
});

test("recipe preview shows full content, real signed photo, warnings and a source button without URL text", async () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  const screen = mount(<CandidatePreview candidate={recipe} onClose={jest.fn()} />);
  try {
    expect(screen.getByLabelText(recipe.title).props.source).toMatchObject({ uri: recipe.photo_url });
    for (const text of ["2 servings", "Prep: 5 min", "Cook: 10 min", "Total: 15 min", "Calories: 320 kcal", "Protein: 14 g", "Carbs: 42 g", "Fat: 9 g", "Fiber: 8 g", "1 can chickpeas", "1 lemon", "Warm the chickpeas.", "Finish with lemon.", "Check allergens."]) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText(recipe.source_url!)).toBeNull();
    fireEvent.press(screen.getByLabelText("Open source"));
    expect(open).toHaveBeenCalledWith(recipe.source_url);
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
});

test("workout preview shows exercises and uses the real logo asset when no photo is supplied", () => {
  const screen = mount(<CandidatePreview candidate={workout} onClose={jest.fn()} />);
  try {
    expect(screen.getByText("Full body")).toBeTruthy();
    expect(screen.getByText("1. Squat")).toBeTruthy();
    expect(screen.getByText("Sets: 3")).toBeTruthy();
    expect(screen.getByText("Reps: 8-12")).toBeTruthy();
    expect(screen.getByText("Duration: 60 s")).toBeTruthy();
    expect(screen.getByLabelText(workout.title).props.source).toEqual(screen.getByLabelText(workout.title).props.placeholder);
    expect(screen.queryByLabelText("Open source")).toBeNull();
  } finally { screen.close(); }
});

test("source link failures are handled without closing the preview", async () => {
  jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("Unavailable"));
  const screen = mount(<CandidatePreview candidate={recipe} onClose={jest.fn()} />);
  try {
    fireEvent.press(screen.getByLabelText("Open source"));
    await screen.findByText("Couldn't open the source.");
    expect(screen.getByText("1 can chickpeas")).toBeTruthy();
  } finally { screen.close(); }
});

test("unknown nutrition is not presented as zero and missing photos use the app asset", () => {
  if (recipe.kind !== "recipe") throw new Error("Expected recipe fixture");
  const screen = mount(<CandidatePreview candidate={{ ...recipe, photo_url: null, payload: { ...recipe.payload, nutrition: null } }} onClose={jest.fn()} />);
  try {
    expect(screen.getByText("Not provided")).toBeTruthy();
    expect(screen.queryByText("Calories: 0 kcal")).toBeNull();
    expect(screen.getByLabelText(recipe.title).props.source).toEqual(screen.getByLabelText(recipe.title).props.placeholder);
  } finally { screen.close(); }
});

test("batch reason labels preserve plain explanations and format known machine codes", () => {
  expect(reportReason("generation_window_expired")).toBe("Generation window expired");
  expect(reportReason("recipe_shortfall:0/5")).toBe("Recipe shortfall: 0/5");
  expect(reportReason("No licensed image available.")).toBe("No licensed image available.");
});

test.each([null, "not a url", "javascript:alert(1)", "file:///tmp/recipe", "http://localhost/private", "https://127.0.0.1/private", "http://169.254.169.254/meta", "https://internal.local/recipe", "https://user:secret@recipes.example/recipe", "https://recipes.example:8443/recipe"])("rejects unsafe source %s", url => {
  expect(sourceLink(url)).toBeNull();
});

test("calendar dates do not shift to the previous day in western time zones", () => {
  expect(dateLabel("2026-10-16")).toBe(new Date("2026-10-16T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }));
});
