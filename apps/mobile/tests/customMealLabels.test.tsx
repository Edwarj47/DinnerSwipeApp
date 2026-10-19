import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { MacroCalculator } from "@/features/premium/MacroCalculator";
import { PremiumMacroPanel } from "@/features/premium/PremiumMacroPanel";
import { Calculation } from "@/features/premium/calculator";
import { todayISO } from "@/features/premium/macroDates";
import { apiFetch } from "@/services/api";
import { MEAL_LABEL_OPTIONS, mealLabelOptions, normalizeMealLabel } from "@/services/mealCategories";
import { useOfflineStatus } from "@/services/offlineStore";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn(), savedMessage: (text: string) => text }));
jest.mock("@/features/premium/MacroDatePicker", () => ({ MacroDatePicker: () => null }));
const request = jest.mocked(apiFetch);
const values = { calories: 40, protein_g: 0, carbs_g: 5, fat_g: 1, fiber_g: null };
function mount(element: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  return { ...screen, close: () => { screen.unmount(); client.clear(); } };
}
beforeEach(() => {
  useOfflineStatus.setState({ offline: false });
  request.mockReset().mockImplementation(async path => {
    if (path.endsWith("subscription/status")) return { premium_active: true };
    if (path.endsWith("nutrition/consent")) return { accepted: true };
    if (path.includes("/summary")) return { totals: values, eaten_meals: 1 };
    if (path.includes("/entries?")) return [{ id: "custom", entry_name: "My sauce", meal_date: todayISO(), meal_label: "sauce", ...values }];
    return {};
  });
});

test.each([
  ["sauce", "sauce", "Sauce"], [" DESSERT ", "dessert", "Dessert"],
  ["Appetizer", "Appetizer", "Appetizer"], ["side_dish", "side_dish", "Side Dish"],
  ["x".repeat(32), "x".repeat(32), "X" + "x".repeat(31)],
  [" DRINKS ", "beverage", "Beverages"]
])("meal label %s retains its wire value and a readable current option", (input, expected, display) => {
  const label = normalizeMealLabel(input);
  expect(label).toBe(expected);
  const options = mealLabelOptions(label);
  expect(options).toContainEqual({ value: expected, label: display });
  expect(options.filter(option => option.value === label)).toHaveLength(1);
  expect(options).toEqual(expect.arrayContaining(MEAL_LABEL_OPTIONS));
});

test.each([null, undefined, "", "   "])("only an absent or blank meal label %s defaults to Dinner", input => {
  expect(normalizeMealLabel(input)).toBe("dinner");
  expect(mealLabelOptions("dinner")).toEqual(MEAL_LABEL_OPTIONS);
});

test("manual macro edits show and preserve Sauce when saved or copied to a recipe", async () => {
  const screen = mount(<PremiumMacroPanel />);
  try {
    fireEvent.press(await screen.findByText("My sauce", { exact: true }));
    expect(screen.getByLabelText("Meal type: Sauce")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Meal type: Sauce"));
    expect(screen.getByRole("radio", { name: "Sauce" }).props.accessibilityState.checked).toBe(true);
    fireEvent.press(screen.getByRole("radio", { name: "Sauce" }));
    fireEvent.changeText(screen.getByLabelText("Entry notes"), "Keep my sauce");
    fireEvent.press(screen.getByLabelText("Save as recipe"));
    await screen.findByText("Recipe saved with nutrition for one serving.");
    const recipe = request.mock.calls.find(([path]) => path === "/api/v1/recipes")!;
    expect(JSON.parse(String(recipe[1]?.body)).meal_type).toBe("sauce");
    fireEvent.press(screen.getByLabelText("Update"));
    await screen.findByText("Macro entry updated.");
    const updated = request.mock.calls.find(([path]) => path.endsWith("entries/custom"))!;
    expect(JSON.parse(String(updated[1]?.body))).toMatchObject({ meal_label: "sauce", notes: "Keep my sauce" });
  } finally { screen.close(); }
});

test.each(["entry", "recipe"] as const)("calculator %s edits and copies preserve their custom category", async destination => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (path, init) => path.endsWith("calculations/saved") && !init?.method ? {
    id: "saved", entry_id: "custom", name: "My sauce", meal_label: "sauce", meal_date: todayISO(), servings: 1,
    items: [{ source: "manual", name: "Tomatoes", portions: 1, nutrition: values }], resolved_items: [values]
  } : original(path, init));
  const saved = jest.fn();
  const screen = mount(<MacroCalculator calculationId="saved" onClose={jest.fn()} onSaved={saved} />);
  try {
    fireEvent.press(await screen.findByLabelText(destination === "entry" ? "Update calculation" : "Save as recipe"));
    expect(screen.getByLabelText("Meal type: Sauce")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Meal type: Sauce"));
    expect(screen.getByRole("radio", { name: "Sauce" }).props.accessibilityState.checked).toBe(true);
    fireEvent.press(screen.getByRole("radio", { name: "Sauce" }));
    fireEvent.press(screen.getByLabelText(destination === "entry" ? "Update" : "Save recipe"));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    const writes = request.mock.calls.filter(([, init]) => init?.method);
    expect(writes).toHaveLength(1);
    expect(writes[0][1]?.method).toBe(destination === "entry" ? "PUT" : "POST");
    expect(JSON.parse(String(writes[0][1]?.body))).toMatchObject({ meal_label: "sauce", destination });
  } finally { screen.close(); }
});

test("new calculator drafts preserve a custom prefilled meal type", async () => {
  const saved = jest.fn<void, [Calculation]>();
  const screen = mount(<MacroCalculator initialName="My dip" initialMealLabel="side_dish"
    initialRows={[{ key: "one", source: "manual", name: "Beans", portions: 1, values }]}
    onSaved={saved} onClose={jest.fn()} />);
  try {
    fireEvent.press(await screen.findByLabelText("Log meal"));
    expect(screen.getByLabelText("Meal type: Side Dish")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Add to today"));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    const call = request.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(call[1]?.body)).meal_label).toBe("side_dish");
  } finally { screen.close(); }
});
