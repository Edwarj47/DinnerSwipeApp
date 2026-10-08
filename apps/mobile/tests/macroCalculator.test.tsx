import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { MacroCalculator } from "@/features/premium/MacroCalculator";
import { CalculatorRow, calculationItems, calculationTotal, servingNutrition } from "@/features/premium/calculator";
import { apiFetch } from "@/services/api";
import { useOfflineStatus } from "@/services/offlineStore";
import { expireNutrition, hasTemporaryNutrition } from "@/services/temporaryNutrition";
import { todayISO } from "@/features/premium/macroDates";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
const request = jest.mocked(apiFetch);
const values = { calories: 74, protein_g: 6.29, carbs_g: 0.38, fat_g: 4.97, fiber_g: 0 };
const row: CalculatorRow = { key: "one", source: "manual", name: "My egg", portions: 2, values };
beforeEach(() => {
  useOfflineStatus.setState({ offline: false });
  request.mockReset().mockImplementation(async (path, init) => {
    if (path.includes("foods/search")) return { data: { foods: { food: { food_id: "3092", food_name: "Egg", food_description: "74 calories per large egg" } } } };
    if (path.includes("foods/3092")) return { data: { food: { servings: { serving: { serving_id: "11206", serving_description: "1 large", calories: "74", protein: "6.29", carbohydrate: ".38", fat: "4.97", fiber: "0" } } } } };
    if (path.endsWith("calculations/preview")) return { resolved_items: [values], serving_labels: ["1 large"], nutrition_unavailable: false };
    if (path.includes("calculations") && init?.method) return { id: "saved", entry_id: "entry", meal_date: todayISO() };
    return {};
  });
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });
  const saved = jest.fn(), close = jest.fn();
  const screen = render(<QueryClientProvider client={client}><MacroCalculator onClose={close} onSaved={saved} /></QueryClientProvider>);
  return { ...screen, saved, close, cleanup: () => { screen.unmount(); client.clear(); } };
}

test("portion math preserves zeros, unknown nutrients and expired provider views", () => {
  expect(calculationTotal([row])).toEqual({ calories: 148, protein_g: 12.58, carbs_g: .76, fat_g: 9.94, fiber_g: 0 });
  expect(calculationTotal([row, { ...row, values: { ...values, protein_g: null } }]).protein_g).toBeNull();
  expect(calculationTotal([{ ...row, expires: 10 }], 10).calories).toBeNull();
  expect(servingNutrition({ calories: "0", protein: "not readable" })).toMatchObject({ calories: 0, protein_g: null, fiber_g: null });
});
test("database save payload strips all temporary nutrition and UI-only fields", () => {
  expect(calculationItems([{ ...row, source: "fatsecret", food_id: "3092", serving_id: "11206", expires: 1000 }])).toEqual([
    { source: "fatsecret", name: "My egg", portions: 2, food_id: "3092", serving_id: "11206" }
  ]);
  expect(calculationItems([row])[0].nutrition).toEqual(values);
});
test("expired query data drops provider values but keeps references", () => {
  const data = { temporary_nutrition: true, totals: values, items: [{ source: "fatsecret", food_id: "3092" }], resolved_items: [values] };
  expect(hasTemporaryNutrition(data)).toBe(true);
  const expired = expireNutrition(data) as typeof data;
  expect(expired.resolved_items[0].calories).toBeNull();
  expect(expired.totals.calories).toBeNull();
  expect(expired.items[0].food_id).toBe("3092");
  expect(data.resolved_items[0].calories).toBe(74);
  expect(hasTemporaryNutrition(expired)).toBe(false);
});
test("stack supports add, edit, remove, naming and logging to today", async () => {
  const screen = mount();
  try {
    fireEvent.changeText(screen.getByLabelText("Calculator item name"), "My eggs");
    fireEvent.changeText(screen.getByLabelText("Calories"), "74");
    fireEvent.changeText(screen.getByLabelText("Calculator item servings"), "2");
    fireEvent.press(screen.getByLabelText("Add item"));
    expect(screen.getByText("Items (1)")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Edit My eggs"));
    fireEvent.changeText(screen.getByLabelText("Calculator item servings"), "3");
    fireEvent.press(screen.getByLabelText("Update item"));
    fireEvent.press(screen.getByLabelText("New item"));
    fireEvent.changeText(screen.getByLabelText("Calculator item name"), "Toast");
    fireEvent.press(screen.getByLabelText("Add item"));
    fireEvent.press(screen.getByLabelText("Remove Toast"));
    fireEvent.press(screen.getByLabelText("Add to today"));
    fireEvent.changeText(screen.getByLabelText("Calculation name"), "My breakfast");
    fireEvent.press(screen.getByLabelText("Add to today"));
    await waitFor(() => expect(screen.saved).toHaveBeenCalled());
    const call = request.mock.calls.find(([path, init]) => path.endsWith("calculations") && init?.method === "POST")!;
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({ name: "My breakfast", destination: "entry", meal_date: todayISO(), items: [{ name: "My eggs", portions: 3, nutrition: { calories: 74 } }] });
  } finally { screen.cleanup(); }
});
test("explicit search selects serving inside calculator and saves IDs rather than macros", async () => {
  const screen = mount();
  try {
    fireEvent.press(screen.getByLabelText("Search Database"));
    fireEvent.changeText(screen.getByLabelText("Search food database"), "eggs");
    expect(request.mock.calls.some(([path]) => path.includes("foods/search"))).toBe(false);
    fireEvent.press(screen.getByRole("checkbox"));
    fireEvent.press(screen.getByLabelText("Search"));
    fireEvent.press(await screen.findByText("Egg", { exact: true }));
    fireEvent.press(await screen.findByText("1 large", { exact: true }));
    expect(screen.getByLabelText("Calculator item name").props.value).toBe("eggs");
    expect(screen.queryByLabelText("Calories")).toBeNull();
    fireEvent.press(screen.getByLabelText("Add item"));
    fireEvent.press(screen.getByLabelText("Refresh database nutrition"));
    await waitFor(() => expect(request.mock.calls.some(([path]) => path.endsWith("calculations/preview"))).toBe(true));
    await waitFor(() => expect(screen.queryByText("Refreshing nutrition...")).toBeNull());
    const preview = request.mock.calls.find(([path]) => path.endsWith("calculations/preview"))!;
    expect(JSON.parse(String(preview[1]?.body)).items[0].nutrition).toBeUndefined();
    fireEvent.press(screen.getByLabelText("Save as recipe"));
    fireEvent.changeText(screen.getByLabelText("Calculation name"), "Egg breakfast");
    fireEvent.changeText(screen.getByLabelText("Calculation recipe servings"), "2");
    fireEvent.press(screen.getByLabelText("Save recipe"));
    await waitFor(() => expect(screen.saved).toHaveBeenCalled());
    const call = request.mock.calls.find(([path, init]) => path.endsWith("calculations") && init?.method === "POST")!;
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({ destination: "recipe", servings: 2,
      items: [{ name: "eggs", source: "fatsecret", food_id: "3092", serving_id: "11206" }] });
    expect(JSON.parse(String(call[1]?.body)).items[0].nutrition).toBeUndefined();
  } finally { screen.cleanup(); }
});
test("failed save retains stack and reuses idempotency key for retry", async () => {
  const original = request.getMockImplementation()!;
  let failures = 1;
  request.mockImplementation(async (path, init) => {
    if (path.endsWith("calculations") && failures-- > 0) throw new Error("Try again");
    return original(path, init);
  });
  const screen = mount();
  try {
    fireEvent.changeText(screen.getByLabelText("Calculator item name"), "My toast");
    fireEvent.press(screen.getByLabelText("Add item"));
    fireEvent.press(screen.getByLabelText("Add to today"));
    fireEvent.changeText(screen.getByLabelText("Calculation name"), "Breakfast");
    fireEvent.press(screen.getByLabelText("Add to today"));
    await screen.findByText("Try again");
    fireEvent.press(screen.getByLabelText("Add to today"));
    await waitFor(() => expect(screen.saved).toHaveBeenCalled());
    const calls = request.mock.calls.filter(([path, init]) => path.endsWith("calculations") && init?.method === "POST");
    expect(JSON.parse(String(calls[0][1]?.body)).request_id).toBe(JSON.parse(String(calls[1][1]?.body)).request_id);
  } finally { screen.cleanup(); }
});
