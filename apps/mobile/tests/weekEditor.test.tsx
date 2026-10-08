import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Dimensions, StyleSheet, Text } from "react-native";

import WeekScreen from "@/app/(tabs)/week";
import GroceryScreen from "@/app/(tabs)/grocery";
import { Button } from "@/components/Button";
import { apiFetch } from "@/services/api";
import { todayISO } from "@/features/premium/macroDates";

jest.mock("@expo/vector-icons", () => ({ Ionicons: ({ name }: { name: string }) => {
  const { View } = jest.requireActual("react-native");
  return <View testID={`icon-${name}`} />;
} }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }), useLocalSearchParams: () => ({}) }));
jest.mock("@/components/Screen", () => ({ Screen: ({ header, children }: { header: React.ReactNode; children: React.ReactNode }) => <>{header}{children}</> }));
jest.mock("@/features/planner/WeekDrag", () => ({
  WeekDrag: jest.requireActual("react-native").View,
  WeekDropDay: jest.requireActual("react-native").View,
  WeekDropMeal: jest.requireActual("react-native").View,
  WeekDragHandle: () => null
}));
jest.mock("@/features/recipes/RecipePicker", () => ({ RecipePicker: () => null }));
jest.mock("@/features/planner/useCurrentWeek", () => ({ plannerContextKey: jest.requireActual("@/features/planner/useCurrentWeek").plannerContextKey, useCurrentWeek: () => {
  const { useQuery } = jest.requireActual("@tanstack/react-query");
  const { apiFetch } = jest.requireMock("@/services/api");
  return useQuery({ queryKey: ["weekly-plan"], queryFn: () => apiFetch("/api/v1/weekly-plans/current") });
} }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));

const request = jest.mocked(apiFetch);
const initialSlot = { id: "slot", slot_date: "2026-09-28" as string | null, slot_type: "meal", recipe_id: "beef", recipe_name: "Ground Beef", servings: 2, sort_order: 0 };
let slot = { ...initialSlot };
let quantity = 1;
let failUpdate = false;
let failAction = false;
let extraSlots: typeof slot[] = [];
let removed = false;
const plan = () => ({ id: "week", week_start: "2026-09-28", slots: [...(removed ? [] : [{ ...slot }]), ...extraSlots] });

beforeEach(() => {
  slot = { ...initialSlot };
  quantity = 1;
  failUpdate = false;
  failAction = false;
  extraSlots = [];
  removed = false;
  request.mockReset().mockImplementation(async (path, options) => {
    if (path === "/api/v1/weekly-plans/current/slots/slot" && options?.method === "PUT") {
      if (failUpdate) throw new Error("Unable to save day. Try again.");
      Object.assign(slot, JSON.parse(String(options.body)));
    }
    if (path === "/api/v1/weekly-plans/current/slots" && options?.method === "POST") {
      if (failAction) throw new Error("Unable to duplicate meal. Try again.");
      const body = JSON.parse(String(options.body));
      extraSlots.push({ ...slot, ...body, id: "copy", sort_order: 1 });
    }
    if (path === "/api/v1/weekly-plans/current/slots/slot" && options?.method === "DELETE") {
      if (failAction) throw new Error("Unable to remove meal. Try again.");
      removed = true;
    }
    if (path === "/api/v1/macros/confirmations") {
      if (failAction) throw new Error("Unable to log meal. Try again.");
      return { id: "log", ...JSON.parse(String(options?.body)) };
    }
    if (path.includes("weekly-plans")) return plan();
    if (path === "/api/v1/profile") return { notification_preferences: {} };
    if (path.includes("subscription")) return { premium_active: true };
    if (path === "/api/v1/grocery-lists/items/milk") quantity = JSON.parse(String(options?.body)).quantity;
    if (path === "/api/v1/grocery-lists/current") return { items: [{ id: "milk", display_name: "Milk", quantity, category: "dairy", unit: null, is_checked: false, match_status: "manual" }] };
    return [];
  });
});

function mount(child: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}>{child}</QueryClientProvider>);
  return { ...screen, close: () => { screen.unmount(); client.clear(); } };
}

const writes = () => request.mock.calls.filter(([, options]) => options?.method === "PUT");
async function openEditor(screen: ReturnType<typeof mount>) {
  fireEvent.press(await screen.findByLabelText("Edit"));
  fireEvent.press(screen.getByLabelText("Day selection: Monday, 9/28"));
}

async function openDuplicate(screen: ReturnType<typeof mount>) {
  fireEvent.press(await screen.findByLabelText("Edit"));
  fireEvent.press(screen.getByLabelText("Duplicate Ground Beef"));
}

test("day menu has the full week, closes without changing a meal, and replaces the chip and Replace controls", async () => {
  const screen = mount(<WeekScreen />);
  try {
    await openEditor(screen);
    expect(screen.getAllByRole("radio")).toHaveLength(8);
    expect(screen.getByRole("radio", { name: "Monday, 9/28" }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole("radio", { name: "Sunday, 10/4" })).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Dismiss day selection"));
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByLabelText("Replace")).toBeNull();
    expect(screen.queryByLabelText("Assign to Monday")).toBeNull();
    expect(writes()).toHaveLength(0);
    fireEvent.press(screen.getByLabelText("Day selection: Monday, 9/28"));
    fireEvent.press(screen.getByRole("radio", { name: "Monday, 9/28" }));
    expect(screen.queryByRole("radio")).toBeNull();
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
}, 20_000);

test.each([["Sunday, 10/4", "2026-10-04"], ["Any day", null]])("assigns %s and shows the saved selection", async (label, date) => {
  const screen = mount(<WeekScreen />);
  try {
    await openEditor(screen);
    fireEvent.press(screen.getByRole("radio", { name: label! }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/weekly-plans/current/slots/slot", {
      method: "PUT", body: JSON.stringify({ slot_date: date })
    }));
    await screen.findByLabelText(`Day selection: ${label}`);
    expect(screen.queryByRole("radio")).toBeNull();
  } finally { screen.close(); }
});

test("a failed assignment keeps the original selection and shows the error", async () => {
  failUpdate = true;
  const screen = mount(<WeekScreen />);
  try {
    await openEditor(screen);
    fireEvent.press(screen.getByRole("radio", { name: "Sunday, 10/4" }));
    await screen.findByText("Unable to save day. Try again.");
    expect(screen.getByLabelText("Day selection: Monday, 9/28").props.accessibilityState.disabled).toBe(false);
    expect(slot.slot_date).toBe("2026-09-28");
  } finally { screen.close(); }
});

test("day and serving controls are disabled while a save is pending", async () => {
  const screen = mount(<WeekScreen />);
  let resolve!: (value: unknown) => void;
  try {
    await openEditor(screen);
    request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fireEvent.press(screen.getByRole("radio", { name: "Sunday, 10/4" }));
    await waitFor(() => expect(screen.getByLabelText("Day selection: Monday, 9/28").props.accessibilityState.disabled).toBe(true));
    expect(screen.getByLabelText("Increase servings").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText("Decrease servings").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText("Duplicate Ground Beef").props.accessibilityState.disabled).toBe(true);
    await act(async () => { resolve(plan()); });
    await waitFor(() => expect(screen.getByLabelText("Increase servings").props.accessibilityState.disabled).toBe(false));
  } finally { screen.close(); }
});

test.each([[1, "Decrease servings"], [30, "Increase servings"]])("serving limits are respected at %s", async (servings, button) => {
  slot.servings = servings;
  const screen = mount(<WeekScreen />);
  try {
    fireEvent.press(await screen.findByLabelText("Edit"));
    expect(screen.getByLabelText(button).props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText(button));
    expect(writes()).toHaveLength(0);
  } finally { screen.close(); }
});

test("single-icon serving buttons still increase and decrease the portion count", async () => {
  const screen = mount(<WeekScreen />);
  try {
    fireEvent.press(await screen.findByLabelText("Edit"));
    expect(screen.queryByText("+")).toBeNull();
    expect(screen.queryByText("-")).toBeNull();
    fireEvent.press(screen.getByLabelText("Increase servings"));
    await screen.findByText("Serves 3");
    await waitFor(() => expect(screen.getByLabelText("Decrease servings").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByLabelText("Decrease servings"));
    await screen.findByText("Serves 2");
    expect(writes().map(([, options]) => JSON.parse(String(options?.body)))).toEqual([{ servings: 3 }, { servings: 2 }]);
  } finally { screen.close(); }
});

test("the collapsed card has only Edit; the editor offers Duplicate without the unused menu or lock", async () => {
  const screen = mount(<WeekScreen />);
  try {
    const edit = await screen.findByLabelText("Edit");
    expect(screen.queryByLabelText("Duplicate Ground Beef")).toBeNull();
    fireEvent.press(edit);
    expect(screen.getAllByLabelText("Duplicate Ground Beef")).toHaveLength(1);
    for (const label of ["Meal", "Leftovers", "Out", "Flex", "Keep", "Unlock"]) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
    expect(screen.queryByText(/open to changes|future auto-pick/)).toBeNull();
    expect(screen.getByLabelText("Day selection: Monday, 9/28")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Done"));
    expect(screen.getByLabelText("Edit")).toBeTruthy();
    expect(screen.queryByLabelText("Duplicate Ground Beef")).toBeNull();
  } finally { screen.close(); }
});

test.each([[320, 1], [390, 1.3]])("editors at width %s and font scale %s keep a full-size Done icon and Duplicate out of the header", async (width, fontScale) => {
  const window = Dimensions.get("window"), deviceScreen = Dimensions.get("screen");
  act(() => Dimensions.set({ window: { ...window, width, fontScale, height: 720 } }));
  const screen = mount(<WeekScreen />);
  try {
    fireEvent.press(await screen.findByLabelText("Edit"));
    expect(screen.queryByText("Done")).toBeNull();
    expect(StyleSheet.flatten(screen.getByLabelText("Done").props.style)).toMatchObject({ width: 44, height: 44 });
    expect(screen.getAllByLabelText("Duplicate Ground Beef")).toHaveLength(1);
    fireEvent.press(screen.getByLabelText("Done"));
    expect(screen.getByText("Edit")).toBeTruthy();
    expect(screen.queryByLabelText("Duplicate Ground Beef")).toBeNull();
  } finally {
    screen.close();
    act(() => Dimensions.set({ window, screen: deviceScreen }));
  }
});

test.each([["Sunday, 10/4", "2026-10-04", "Sunday"], ["Monday, 9/28", "2026-09-28", "Monday"], ["Unscheduled", null, "Unscheduled"]])("duplicates a meal to %s, preserving servings without logging consumption", async (label, date, day) => {
  const screen = mount(<WeekScreen />);
  try {
    await openDuplicate(screen);
    expect(screen.getAllByRole("button", { name: /^Duplicate meal to / })).toHaveLength(8);
    fireEvent.press(screen.getByLabelText(`Duplicate meal to ${label}`));
    await screen.findByText(`Meal duplicated to ${day}.`);
    expect(request).toHaveBeenCalledWith("/api/v1/weekly-plans/current/slots", {
      method: "POST", body: JSON.stringify({ recipe_id: "beef", slot_date: date, servings: 2 })
    });
    expect(slot).toEqual(initialSlot);
    expect(extraSlots).toHaveLength(1);
    expect(screen.queryByText("Duplicate meal")).toBeNull();
    expect(screen.getAllByLabelText("Edit")).toHaveLength(2);
    expect(request.mock.calls.some(([path]) => path === "/api/v1/macros/confirmations")).toBe(false);
  } finally { screen.close(); }
});

test("a cancelled duplicate makes no changes; a failed copy stays open for retry", async () => {
  const screen = mount(<WeekScreen />);
  try {
    await openDuplicate(screen);
    fireEvent.press(screen.getByLabelText("Close duplicate meal"));
    expect(extraSlots).toHaveLength(0);
    expect(request.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
    failAction = true;
    fireEvent.press(screen.getByLabelText("Duplicate Ground Beef"));
    fireEvent.press(screen.getByLabelText("Duplicate meal to Sunday, 10/4"));
    await waitFor(() => expect(screen.getAllByText("Unable to duplicate meal. Try again.").length).toBeGreaterThan(0));
    expect(screen.getByText("Duplicate meal")).toBeTruthy();
    expect(extraSlots).toHaveLength(0);
    expect(slot).toEqual(initialSlot);
    failAction = false;
    fireEvent.press(screen.getByLabelText("Duplicate meal to Sunday, 10/4"));
    await screen.findByText("Meal duplicated to Sunday.");
  } finally { screen.close(); }
});

test.each([
  ["Ate", "ate", "Added to Monday's macro entries."],
  ["Skipped", "skipped", "Logged as skipped. No nutrition added."]
])("%s collapses the editor only after saving and reports the right outcome", async (label, status, message) => {
  const screen = mount(<WeekScreen />);
  try {
    fireEvent.press(await screen.findByLabelText("Edit"));
    fireEvent.press(screen.getByLabelText(label));
    await screen.findByText(message);
    expect(request).toHaveBeenCalledWith("/api/v1/macros/confirmations", {
      method: "POST", body: JSON.stringify({ recipe_id: "beef", weekly_plan_slot_id: "slot", meal_date: "2026-09-28", status, servings_consumed: 2 })
    });
    expect(screen.getByLabelText("Edit")).toBeTruthy();
    expect(screen.queryByLabelText("Done")).toBeNull();
    expect(screen.queryByLabelText("Day selection: Monday, 9/28")).toBeNull();
    expect(slot).toEqual(initialSlot);
  } finally { screen.close(); }
});

test("unscheduled meals log against the device's current date, and success feedback expires", async () => {
  jest.useFakeTimers();
  slot.slot_date = null;
  const screen = mount(<WeekScreen />);
  try {
    fireEvent.press(await screen.findByLabelText("Edit"));
    fireEvent.press(screen.getByLabelText("Ate"));
    await act(async () => { await jest.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Added to today's macro entries.")).toBeTruthy();
    const body = request.mock.calls.find(([path]) => path === "/api/v1/macros/confirmations")![1]!.body;
    expect(JSON.parse(String(body)).meal_date).toBe(todayISO());
    await act(async () => { await jest.advanceTimersByTimeAsync(4999); });
    expect(screen.getByText("Added to today's macro entries.")).toBeTruthy();
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
    expect(screen.queryByText("Added to today's macro entries.")).toBeNull();
  } finally { screen.close(); jest.useRealTimers(); }
});

test("pending or failed meal logging cannot discard the editor or change other controls", async () => {
  const screen = mount(<WeekScreen />);
  let reject!: (reason: Error) => void;
  try {
    fireEvent.press(await screen.findByLabelText("Edit"));
    request.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    fireEvent.press(screen.getByLabelText("Ate"));
    await waitFor(() => expect(screen.getByLabelText("Done").props.accessibilityState.disabled).toBe(true));
    for (const label of ["Ate", "Skipped", "Remove Ground Beef", "Increase servings", "Decrease servings", "Duplicate Ground Beef", "Day selection: Monday, 9/28"]) {
      expect(screen.getByLabelText(label).props.accessibilityState.disabled).toBe(true);
    }
    await act(async () => { reject(new Error("Unable to log meal. Try again.")); });
    await screen.findByText("Unable to log meal. Try again.");
    expect(screen.getByLabelText("Done")).toBeTruthy();
    expect(screen.getByLabelText("Ate").props.accessibilityState.disabled).toBe(false);
    expect(slot).toEqual(initialSlot);
  } finally { screen.close(); }
});

test("Remove clears the planned card without calling the nutrition deletion endpoint", async () => {
  const screen = mount(<WeekScreen />);
  try {
    fireEvent.press(await screen.findByLabelText("Edit"));
    const remove = screen.getByLabelText("Remove Ground Beef");
    expect(screen.queryByText("Remove")).toBeNull();
    expect(StyleSheet.flatten(remove.props.style)).toMatchObject({ width: 44, height: 44 });
    fireEvent.press(remove);
    await screen.findByText("Meal removed.");
    expect(screen.queryByText("Ground Beef")).toBeNull();
    expect(screen.queryByLabelText("Done")).toBeNull();
    expect(request).toHaveBeenCalledWith("/api/v1/weekly-plans/current/slots/slot", { method: "DELETE" });
    expect(request.mock.calls.some(([path]) => path.startsWith("/api/v1/macros/"))).toBe(false);
  } finally { screen.close(); }
});

test("grocery quantity controls have one symbol and respect the zero minimum", async () => {
  const screen = mount(<GroceryScreen />);
  try {
    fireEvent.press(await screen.findByLabelText("Edit Milk"));
    expect(screen.queryByText("+")).toBeNull();
    expect(screen.queryByText("-")).toBeNull();
    fireEvent.press(screen.getByLabelText("Decrease Milk quantity"));
    await screen.findByText("Buy total: 0");
    await waitFor(() => expect(screen.getByLabelText("Increase Milk quantity").props.accessibilityState.disabled).toBe(false));
    await waitFor(() => expect(screen.getByLabelText("Decrease Milk quantity").props.accessibilityState.disabled).toBe(true));
    fireEvent.press(screen.getByLabelText("Increase Milk quantity"));
    await waitFor(() => expect(screen.getByLabelText("Decrease Milk quantity").props.accessibilityState.disabled).toBe(false));
    expect(quantity).toBe(1);
  } finally { screen.close(); }
});

test("icon-only buttons have a fixed touch target without a duplicate label or empty text", () => {
  const press = jest.fn();
  const screen = render(<Button label="" icon="add" accessibilityLabel="Increase servings" onPress={press} />);
  const button = screen.getByLabelText("Increase servings");
  expect(StyleSheet.flatten(button.props.style)).toMatchObject({ width: 44, height: 44, paddingHorizontal: 0 });
  expect(screen.getAllByTestId("icon-add")).toHaveLength(1);
  expect(screen.UNSAFE_queryAllByType(Text)).toHaveLength(0);
  fireEvent.press(button);
  expect(press).toHaveBeenCalledTimes(1);
});
