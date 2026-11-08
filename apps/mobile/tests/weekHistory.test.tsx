import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Text } from "react-native";
import { useFocusEffect } from "expo-router";
import WeekScreen from "@/app/(tabs)/week";
import { HistoricalWeek } from "@/features/planner/HistoricalWeek";
import { monday, shiftDate, WeekNavigator } from "@/features/planner/WeekNavigator";
import { apiFetch } from "@/services/api";
import type { Household, WeeklyPlan } from "@/services/types";
import { usePlannerStore } from "@/stores/plannerStore";
import { todayISO } from "@/features/premium/macroDates";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
jest.mock("expo-router", () => ({ useFocusEffect: jest.fn(), useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/services/planningPreferences", () => ({ ensurePlanningTimeZone: jest.fn(async () => undefined) }));
jest.mock("@/features/premium/macroDates", () => ({ ...jest.requireActual("@/features/premium/macroDates"), todayISO: jest.fn(() => "2026-10-14") }));
jest.mock("@/components/Screen", () => ({ Screen: ({ header, children }: { header: ReactNode; children: ReactNode }) => <>{header}{children}</> }));
jest.mock("@/features/groups/SpaceSelector", () => ({ SpaceSelector: () => null }));
jest.mock("@/features/onboarding/TourTarget", () => ({ TourTarget: jest.requireActual("react-native").View }));
jest.mock("@/features/recipes/RecipePicker", () => ({ RecipePicker: ({ visible, title, onSelect }: { visible: boolean; title: string; onSelect: (recipe: { id: string }) => void }) => {
  const { View, Text, Pressable } = jest.requireActual("react-native");
  return visible ? <View><Text>{title}</Text><Pressable accessibilityRole="button" accessibilityLabel="Choose test meal" onPress={() => onSelect({ id: "test-meal" })}><Text>Test meal</Text></Pressable></View> : null;
} }));
jest.mock("@/features/planner/WeekDrag", () => ({
  WeekDrag: jest.requireActual("react-native").View,
  WeekDropDay: jest.requireActual("react-native").View,
  WeekDropMeal: jest.requireActual("react-native").View,
  WeekDragHandle: () => null
}));
jest.mock("react-native-calendars", () => ({
  Calendar: jest.requireActual("react-native").View,
  LocaleConfig: { locales: { "": {} }, defaultLocale: "" }
}));

const request = jest.mocked(apiFetch);
const currentWeek = "2026-10-12";
const pastWeek = "2026-10-05";
const household: Household = {
  id: "family", name: "Family", is_personal: false, invite_code: "ABCDEFGH",
  current_user_role: "owner", members: [], allergen_filter_mode: "warn", dislike_filter_mode: "warn"
};
type HistoricalFixture = Omit<WeeklyPlan, "id"> & { id: string | null; read_only: true };
const history: HistoricalFixture = {
  id: "past-plan", week_start: pastWeek, meal_target: 2, read_only: true,
  slots: [
    { id: "past-slot", recipe_id: "deleted-recipe", recipe_name: "Saved soup", recipe_total_minutes: 30,
      recipe_difficulty: "medium", slot_date: pastWeek, slot_type: "meal", servings: 6, is_locked: true, sort_order: 0 },
    { id: "unscheduled", recipe_id: "salad", recipe_name: "Old salad", slot_date: null,
      slot_type: "meal", servings: 2, is_locked: false, sort_order: 1 }
  ]
};
let selected: Household;
let saved: HistoricalFixture;
let historyError: boolean;
let future: Omit<WeeklyPlan, "id"> & { id: string | null };
let addError: boolean;

beforeEach(() => {
  jest.mocked(useFocusEffect).mockClear();
  jest.mocked(todayISO).mockReturnValue("2026-10-14");
  usePlannerStore.getState().resetSession();
  selected = { ...household, is_personal: true };
  saved = history;
  historyError = false;
  addError = false;
  future = { id: null, week_start: "2026-10-19", meal_target: 2, slots: [] };
  request.mockReset().mockImplementation(async (path, init) => {
    if (path === "/api/v1/households/current") return selected;
    if (path.includes("/weekly-plans/history?")) {
      if (historyError) throw new Error("History unavailable");
      return { ...saved, week_start: path.split("week_start=")[1] };
    }
    if (path.endsWith("/weekly-plans/current")) return { ...history, id: "current-plan", week_start: currentWeek, read_only: false, slots: [] };
    if (path.includes("/weekly-plans/current") && path.includes("week_start=2026-10-19")) {
      if (init?.method === "POST") {
        if (addError) throw new Error("Unable to add meal. Try again.");
        const body = JSON.parse(String(init.body));
        future = { ...future, id: "future-plan", household_id: selected.is_personal ? undefined : selected.id, slots: [...future.slots,
          { id: `future-slot-${future.slots.length}`, recipe_id: body.recipe_id, recipe_name: "Test meal", slot_date: body.slot_date,
            slot_type: "meal", servings: 2, sort_order: future.slots.length, is_locked: false }] };
      }
      return future;
    }
    if (path === "/api/v1/profile") return { notification_preferences: {} };
    if (path === "/api/v1/subscription/status") return { premium_active: true };
    throw new Error(`Unexpected request: ${path}`);
  });
});

function mount(child: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}>{child}</QueryClientProvider>);
  return { ...screen, client, close: () => { screen.unmount(); client.clear(); } };
}

function expectReadOnly(screen: ReturnType<typeof mount>) {
  expect(screen.getByText("Read-only")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^(Edit|Log|Ate|Skipped|Reset|Duplicate|Remove|Add meal|Increase servings|Decrease servings)/ })).toBeNull();
  expect(request.mock.calls.some(([, init]) => init?.method && init.method !== "GET")).toBe(false);
}

test.each([true, false])("history is read-only and fetches only its selected scope (personal=%s)", async personal => {
  selected.is_personal = personal;
  const screen = mount(<HistoricalWeek week={pastWeek} currentWeek={currentWeek} onChange={jest.fn()} />);
  try {
    await screen.findByText("Saved soup");
    expect(screen.getByText("Old salad")).toBeTruthy();
    expect(screen.getByText("Serves 6 - 30 min")).toBeTruthy();
    expect(screen.getByText("Unscheduled")).toBeTruthy();
    expectReadOnly(screen);
    const path = personal ? "/api/v1/weekly-plans/history?week_start=2026-10-05" : "/api/v1/households/family/weekly-plans/history?week_start=2026-10-05";
    expect(request).toHaveBeenCalledWith(path, expect.objectContaining({ signal: expect.anything() }));
    expect(request.mock.calls.some(([path]) => path.includes("/weekly-plans/current"))).toBe(false);
  } finally { screen.close(); }
});

test("empty history stays read-only without invoking current-week creation", async () => {
  saved = { ...history, id: null, meal_target: 0, slots: [] };
  const screen = mount(<HistoricalWeek week={pastWeek} currentWeek={currentWeek} onChange={jest.fn()} />);
  try {
    await screen.findByText("No saved plan for this week.");
    expectReadOnly(screen);
    expect(request.mock.calls.some(([path]) => path.includes("/current") && path.includes("weekly-plans"))).toBe(false);
  } finally { screen.close(); }
});

test("history error retry uses the historical endpoint and never falls back to current", async () => {
  historyError = true;
  const screen = mount(<HistoricalWeek week={pastWeek} currentWeek={currentWeek} onChange={jest.fn()} />);
  try {
    await screen.findByText("History unavailable");
    expectReadOnly(screen);
    historyError = false;
    fireEvent.press(screen.getByRole("button", { name: "Retry week" }));
    await screen.findByText("Saved soup");
    expect(request.mock.calls.filter(([path]) => path.includes("/weekly-plans/history?"))).toHaveLength(2);
    expect(request.mock.calls.some(([path]) => path.includes("/weekly-plans/current"))).toBe(false);
  } finally { screen.close(); }
});

test.each([true, false])("navigating from current to history unmounts current queries and actions (personal=%s)", async personal => {
  selected.is_personal = personal;
  const screen = mount(<WeekScreen />);
  try {
    await waitFor(() => expect(screen.getByRole("button", { name: "Previous week" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Next week" }).props.accessibilityState.disabled).toBe(false);
    fireEvent.press(screen.getByRole("button", { name: "Previous week" }));
    await screen.findByText("Saved soup");
    expectReadOnly(screen);
    request.mockClear();
    await act(async () => { await screen.client.invalidateQueries({ queryKey: ["weekly-plan"] }); });
    fireEvent.press(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() => expect(request.mock.calls.some(([path]) => path.endsWith("week_start=2026-09-28"))).toBe(true));
    expect(request.mock.calls.some(([path]) => path.includes("/weekly-plans/current"))).toBe(false);
    fireEvent.press(screen.getByRole("button", { name: "Next week" }));
    await screen.findByText("Saved soup");
    fireEvent.press(screen.getByRole("button", { name: "Next week" }));
    await screen.findByText("This Week");
    await waitFor(() => expect(screen.getByRole("button", { name: "Next week" }).props.accessibilityState.disabled).toBe(false));
  } finally { screen.close(); }
});

test.each([true, false])("adding to next week keeps the viewed week and current cache isolated (personal=%s)", async personal => {
  selected.is_personal = personal;
  const screen = mount(<WeekScreen />);
  try {
    await screen.findByText("This Week");
    await waitFor(() => expect(screen.getByLabelText("Add meal to Monday").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByLabelText("Next week"));
    await screen.findByText("Upcoming Week");
    await waitFor(() => expect(screen.getByLabelText("Add meal to Monday").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByLabelText("Add meal to Monday"));
    fireEvent.press(await screen.findByLabelText("Choose test meal"));
    await screen.findByText("Meal added.");
    expect(screen.getByText("Upcoming Week")).toBeTruthy();
    expect(screen.getByText("10/19")).toBeTruthy();
    const path = `${personal ? "/api/v1" : "/api/v1/households/family"}/weekly-plans/current/slots?week_start=2026-10-19`;
    expect(request).toHaveBeenCalledWith(path, { method: "POST", body: JSON.stringify({ recipe_id: "test-meal", slot_date: "2026-10-19" }) });
    const current = screen.client.getQueryData<WeeklyPlan>(personal ? ["weekly-plan"] : ["weekly-plan", "family"]);
    expect(current?.week_start).toBe(currentWeek);
    expect(current?.slots).toHaveLength(0);
    expect(usePlannerStore.getState().weekStart).not.toContain("2026-10-19");
    expect(request.mock.calls.some(([path, init]) => path.includes("/macros/") && init?.method === "POST")).toBe(false);
    screen.rerender(<QueryClientProvider client={screen.client}><Text>Another tab</Text></QueryClientProvider>);
    screen.rerender(<QueryClientProvider client={screen.client}><WeekScreen /></QueryClientProvider>);
    await screen.findByText("Upcoming Week");
    expect(screen.getByText("10/19")).toBeTruthy();
    await screen.findByText("Test meal");
  } finally { screen.close(); }
});

test("failed future addition stays on the chosen week and can be retried in place", async () => {
  addError = true;
  const screen = mount(<WeekScreen />);
  try {
    await waitFor(() => expect(screen.getByLabelText("Add meal to Monday").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByLabelText("Next week"));
    await waitFor(() => expect(screen.getByLabelText("Add meal to Monday").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByLabelText("Add meal to Monday"));
    fireEvent.press(await screen.findByLabelText("Choose test meal"));
    await screen.findAllByText("Unable to add meal. Try again.");
    expect(screen.getByText("Upcoming Week")).toBeTruthy();
    addError = false;
    fireEvent.press(screen.getByLabelText("Choose test meal"));
    await screen.findByText("Meal added.");
    expect(screen.getByText("10/19")).toBeTruthy();
  } finally { screen.close(); }
});

test("returning focus refreshes the selected future group week", async () => {
  selected.is_personal = false;
  const screen = mount(<WeekScreen />);
  let cleanup: (() => void) | undefined;
  try {
    await waitFor(() => expect(screen.getByLabelText("Add meal to Monday").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByLabelText("Next week"));
    await waitFor(() => expect(screen.getByLabelText("Add meal to Monday").props.accessibilityState.disabled).toBe(false));
    future = { ...future, id: "updated-group-plan", slots: [{ id: "new-meal", slot_type: "meal", recipe_id: "shared", recipe_name: "Owner's added meal", servings: 2, sort_order: 0, is_locked: false, slot_date: "2026-10-19" }] };
    const onFocus = jest.mocked(useFocusEffect).mock.calls.at(-1)![0];
    await act(async () => { cleanup = onFocus() || undefined; });
    await screen.findByText("Owner's added meal");
    expect(screen.getByText("Upcoming Week")).toBeTruthy();
  } finally { cleanup?.(); screen.close(); }
});

test("a late future-week save cannot replace the current week after navigating back", async () => {
  const original = request.getMockImplementation()!;
  let finish: ((plan: WeeklyPlan) => void) | undefined;
  request.mockImplementation((path, init) => init?.method === "POST" && path.includes("week_start=2026-10-19")
    ? new Promise<WeeklyPlan>(resolve => { finish = resolve; }) : original(path, init));
  const screen = mount(<WeekScreen />);
  try {
    await waitFor(() => expect(screen.getByLabelText("Add meal to Monday").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByLabelText("Next week"));
    await waitFor(() => expect(screen.getByLabelText("Add meal to Monday").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByLabelText("Add meal to Monday"));
    fireEvent.press(await screen.findByLabelText("Choose test meal"));
    await waitFor(() => expect(finish).toBeDefined());
    fireEvent.press(screen.getByLabelText("Previous week"));
    await screen.findByText("This Week");
    await act(async () => { finish!({ id: "late-plan", week_start: "2026-10-19", meal_target: 2, slots: [] }); });
    await waitFor(() => expect(screen.client.getQueryData<WeeklyPlan>(["weekly-plan"])?.week_start).toBe(currentWeek));
    expect(screen.getByText("This Week")).toBeTruthy();
    expect(screen.getByText("10/12")).toBeTruthy();
  } finally { screen.close(); }
});

test("navigator enables past-to-current navigation but disables the future arrow", () => {
  const change = jest.fn();
  const screen = mount(<WeekNavigator week={currentWeek} currentWeek={currentWeek} onChange={change} />);
  try {
    const next = screen.getByRole("button", { name: "Next week" });
    expect(next.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(next);
    expect(change).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole("button", { name: "Previous week" }));
    expect(change).toHaveBeenLastCalledWith(pastWeek);
    screen.rerender(<QueryClientProvider client={screen.client}><WeekNavigator week={pastWeek} currentWeek={currentWeek} onChange={change} /></QueryClientProvider>);
    expect(screen.getByRole("button", { name: "Next week" }).props.accessibilityState.disabled).toBe(false);
    fireEvent.press(screen.getByRole("button", { name: "Next week" }));
    expect(change).toHaveBeenLastCalledWith(currentWeek);
  } finally { screen.close(); }
});

test("week calendar caps future dates and normalizes a chosen day to Monday", () => {
  const change = jest.fn();
  const screen = mount(<WeekNavigator week={pastWeek} currentWeek={currentWeek} onChange={change} />);
  try {
    fireEvent.press(screen.getByRole("button", { name: "Choose week" }));
    const calendar = screen.getByTestId("macro-calendar");
    expect(calendar.props.maxDate).toBe("2026-10-18");
    fireEvent(calendar, "dayPress", { dateString: "2026-10-19" });
    expect(change).not.toHaveBeenCalled();
    fireEvent(calendar, "dayPress", { dateString: "2026-10-08" });
    expect(change).toHaveBeenLastCalledWith(pastWeek);
    fireEvent.press(screen.getByRole("button", { name: "Choose week" }));
    fireEvent.press(screen.getByRole("button", { name: "This week" }));
    expect(change).toHaveBeenLastCalledWith(currentWeek);
  } finally { screen.close(); }
});

test("This week uses the authoritative group week when the phone is already on Monday", () => {
  jest.mocked(todayISO).mockReturnValue("2026-10-19");
  const change = jest.fn();
  const screen = mount(<WeekNavigator week="2026-10-26" currentWeek={currentWeek} allowFuture onChange={change} />);
  try {
    fireEvent.press(screen.getByRole("button", { name: "Choose week" }));
    fireEvent.press(screen.getByRole("button", { name: "This week" }));
    expect(change).toHaveBeenLastCalledWith(currentWeek);
  } finally { screen.close(); }
});

test.each([
  ["2026-10-11", "2026-10-05"], ["2026-10-12", "2026-10-12"],
  ["2027-01-01", "2026-12-28"]
])("Monday normalization for %s is stable across week and year boundaries", (day, expected) => {
  expect(monday(day)).toBe(expected);
  expect(shiftDate(expected, 7)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
