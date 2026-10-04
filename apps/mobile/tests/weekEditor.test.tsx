import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";

import WeekScreen from "@/app/(tabs)/week";
import GroceryScreen from "@/app/(tabs)/grocery";
import { Button } from "@/components/Button";
import { apiFetch } from "@/services/api";

jest.mock("@expo/vector-icons", () => ({ Ionicons: ({ name }: { name: string }) => {
  const { View } = jest.requireActual("react-native");
  return <View testID={`icon-${name}`} />;
} }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }), useLocalSearchParams: () => ({}) }));
jest.mock("@/components/Screen", () => ({ Screen: jest.requireActual("react-native").View }));
jest.mock("@/features/planner/WeekDrag", () => ({
  WeekDrag: jest.requireActual("react-native").View,
  WeekDropDay: jest.requireActual("react-native").View,
  WeekDropMeal: jest.requireActual("react-native").View,
  WeekDragHandle: () => null
}));
jest.mock("@/features/recipes/RecipePicker", () => ({ RecipePicker: () => null }));
jest.mock("@/features/planner/useCurrentWeek", () => ({ useCurrentWeek: () => {
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
const plan = () => ({ id: "week", week_start: "2026-09-28", slots: [{ ...slot }] });

beforeEach(() => {
  slot = { ...initialSlot };
  quantity = 1;
  failUpdate = false;
  request.mockReset().mockImplementation(async (path, options) => {
    if (path === "/api/v1/weekly-plans/current/slots/slot" && options?.method === "PUT") {
      if (failUpdate) throw new Error("Unable to save day. Try again.");
      Object.assign(slot, JSON.parse(String(options.body)));
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
    await screen.findByText("Serves 3 - open to changes");
    await waitFor(() => expect(screen.getByLabelText("Decrease servings").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByLabelText("Decrease servings"));
    await screen.findByText("Serves 2 - open to changes");
    expect(writes().map(([, options]) => JSON.parse(String(options?.body)))).toEqual([{ servings: 3 }, { servings: 2 }]);
  } finally { screen.close(); }
});

test("grocery quantity controls have one symbol and respect the zero minimum", async () => {
  const screen = mount(<GroceryScreen />);
  try {
    fireEvent.press(await screen.findByLabelText("Edit Milk"));
    expect(screen.queryByText("+")).toBeNull();
    expect(screen.queryByText("-")).toBeNull();
    fireEvent.press(screen.getByLabelText("Decrease Milk quantity"));
    await screen.findByText("Shopping total: 0");
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
