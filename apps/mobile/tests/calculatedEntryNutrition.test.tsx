import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AppState, AppStateStatus } from "react-native";
import { NutritionRuntime } from "@/components/NutritionRuntime";
import { RecipeMacroLogger } from "@/features/recipes/RecipeMacroLogger";
import { Calculation, PROVIDER_VIEW_MS } from "@/features/premium/calculator";
import { apiFetch } from "@/services/api";
import { setDeviceOffline } from "@/services/offlineStore";
import { MacroConfirmation, Recipe } from "@/services/types";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/features/premium/MacroDatePicker", () => ({ MacroDatePicker: () => null }));
const request = jest.mocked(apiFetch);
const path = "/api/v1/nutrition/calculations/calc-1";
const recipe = { id: "recipe-1", name: "Rice bowl", servings: 4, meal_type: "dinner", calculator_id: "calc-1" } as Recipe;
function calculation(overrides: Partial<Calculation> = {}): Calculation {
  return { id: "calc-1", recipe_id: recipe.id, name: recipe.name, meal_label: "dinner", servings: 4,
    items: [{ source: "fatsecret", name: "Rice", portions: 4, food_id: "food-1", serving_id: "serving-1" }],
    resolved_items: [{ calories: 400, protein_g: 20, carbs_g: 50, fat_g: 0, fiber_g: null }],
    totals: { calories: 1600, protein_g: 80, carbs_g: 200, fat_g: 0, fiber_g: null },
    temporary_nutrition: true, nutrition_unavailable: false, ...overrides };
}
function mount(props: { recipe?: Recipe; entry?: MacroConfirmation } = { recipe }, runtime = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const close = jest.fn();
  const screen = render(<QueryClientProvider client={client}>
    {runtime ? <NutritionRuntime /> : null}<RecipeMacroLogger {...props} date="2026-11-06" onClose={close} />
  </QueryClientProvider>);
  return { ...screen, client, onClose: close, close: () => { screen.unmount(); client.clear(); } };
}
beforeEach(() => {
  request.mockReset(); setDeviceOffline(false);
  request.mockImplementation(async url => url === path ? calculation() : {});
});
afterEach(() => { setDeviceOffline(false); jest.restoreAllMocks(); });

test("recipe totals use yield and selected portions, label notes visibly, and never copy refreshed macros into saves", async () => {
  const screen = mount();
  try {
    await waitFor(() => expect(screen.getByLabelText("Calculated Calories").props.children).toBe("400"));
    expect(screen.getByLabelText("Calculated Calories").props.accessibilityValue.text).toBe("400");
    expect(screen.getByLabelText("Calculated Protein (g)").props.children).toBe("20");
    expect(screen.getByLabelText("Calculated Fat (g)").props.children).toBe("0");
    expect(screen.getByLabelText("Calculated Fiber (g)").props.children).toBe("-");
    expect(screen.getByLabelText("Calculated Fiber (g)").props.accessibilityValue.text).toBe("Not available");
    expect(screen.queryByLabelText("Calories")).toBeNull();
    expect(screen.getByText("Notes (optional)")).toBeTruthy();
    expect(screen.getByLabelText("Recipe log notes").props.placeholderTextColor).toBe("#756f68");
    expect(screen.getByText("Powered by fatsecret Platform API")).toBeTruthy();
    const reads = request.mock.calls.filter(([url]) => url === path).length;
    fireEvent.changeText(screen.getByLabelText("Servings eaten"), "1.5");
    expect(screen.getByLabelText("Calculated Calories").props.children).toBe("600");
    expect(screen.getByLabelText("Calculated Protein (g)").props.children).toBe("30");
    expect(request.mock.calls.filter(([url]) => url === path)).toHaveLength(reads);
    fireEvent.changeText(screen.getByLabelText("Recipe log notes"), "Extra herbs");
    fireEvent.press(screen.getByLabelText("Save entry"));
    await waitFor(() => expect(screen.onClose).toHaveBeenCalled());
    const write = request.mock.calls.find(([url]) => url === "/api/v1/macros/entries")!;
    const payload = JSON.parse(String(write[1]?.body));
    expect(payload).toMatchObject({ recipe_id: recipe.id, servings_consumed: 1.5, notes: "Extra herbs" });
    for (const field of ["calories", "protein_g", "carbs_g", "fat_g", "fiber_g"]) expect(payload).not.toHaveProperty(field);
  } finally { screen.close(); }
});

test("logged-entry responses are scaled from the saved entry portion instead of multiplying it twice", async () => {
  const entry = { id: "entry-1", calculator_id: "calc-1", entry_name: "Rice bowl", servings_consumed: 2.5,
    meal_label: "lunch", meal_date: "2026-11-06", calories: 999999 } as MacroConfirmation;
  request.mockImplementation(async url => url === path ? calculation({ recipe_id: null, entry_id: entry.id, servings: 1,
    totals: { calories: 1000, protein_g: 50, carbs_g: 125, fat_g: 0, fiber_g: null } }) : {});
  const screen = mount({ entry });
  try {
    await waitFor(() => expect(screen.getByLabelText("Calculated Calories").props.children).toBe("1000"));
    fireEvent.changeText(screen.getByLabelText("Servings eaten"), "3");
    expect(screen.getByLabelText("Calculated Calories").props.children).toBe("1200");
    expect(screen.getByLabelText("Calculated Protein (g)").props.children).toBe("60");
    fireEvent.press(screen.getByLabelText("Save entry"));
    await waitFor(() => expect(screen.onClose).toHaveBeenCalled());
    const write = request.mock.calls.find(([url]) => url === "/api/v1/macros/entries/entry-1")!;
    expect(write[1]?.method).toBe("PUT");
    const payload = JSON.parse(String(write[1]?.body));
    expect(payload.servings_consumed).toBe(3); expect(payload).not.toHaveProperty("calories");
  } finally { screen.close(); }
});

test("loading has no invented zeroes and retry recovers without clearing the user's notes", async () => {
  let reject!: (error: Error) => void;
  request.mockImplementation(async url => url === path ? new Promise((_resolve, failed) => { reject = failed; }) : {});
  const screen = mount();
  try {
    await screen.findByText("Loading nutrition...");
    expect(screen.getByLabelText("Calculated Calories").props.children).toBe("-");
    expect(screen.getByLabelText("Refresh calculated nutrition").props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText("Recipe log notes"), "Keep my note");
    await act(async () => { reject(new Error("Temporary failure")); });
    await screen.findByText("Couldn't load calculated nutrition.");
    request.mockImplementation(async url => url === path ? calculation() : {});
    fireEvent.press(screen.getByLabelText("Refresh calculated nutrition"));
    await waitFor(() => expect(screen.getByLabelText("Calculated Calories").props.children).toBe("400"));
    expect(screen.getByLabelText("Recipe log notes").props.value).toBe("Keep my note");
    expect(request.mock.calls.filter(([, init]) => init?.method)).toHaveLength(0);
  } finally { screen.close(); }
});

test("partial nutrition keeps missing nutrients unknown, preserves true zeroes and offers refresh", async () => {
  request.mockImplementation(async url => url === path ? calculation({ nutrition_unavailable: true,
    totals: { calories: null, protein_g: 80, carbs_g: null, fat_g: 0, fiber_g: null } }) : {});
  const screen = mount();
  try {
    await screen.findByText("Some nutrition is unavailable. Totals are incomplete.");
    expect(screen.getByLabelText("Calculated Calories").props.children).toBe("-");
    expect(screen.getByLabelText("Calculated Protein (g)").props.children).toBe("20");
    expect(screen.getByLabelText("Calculated Fat (g)").props.children).toBe("0");
    expect(screen.getByLabelText("Refresh calculated nutrition").props.accessibilityState.disabled).toBe(false);
  } finally { screen.close(); }
});

test("going offline hides previously resolved provider nutrition, without changing notes or reference-only logging", async () => {
  const screen = mount();
  try {
    await waitFor(() => expect(screen.getByLabelText("Calculated Calories").props.children).toBe("400"));
    fireEvent.changeText(screen.getByLabelText("Recipe log notes"), "Offline note");
    act(() => setDeviceOffline(true));
    await screen.findByText("Reconnect to view calculated nutrition.");
    expect(screen.getByLabelText("Calculated Calories").props.children).toBe("-");
    expect(screen.queryByText("Powered by fatsecret Platform API")).toBeNull();
    expect(screen.getByLabelText("Refresh calculated nutrition").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText("Recipe log notes").props.value).toBe("Offline note");
  } finally { screen.close(); }
});

test("client expiry clears rendered totals before a pending foreground refresh completes", async () => {
  let now = Date.now(), resume!: (state: AppStateStatus) => void;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, callback) => { resume = callback; return { remove: jest.fn() }; });
  let complete!: (value: Calculation) => void;
  let reads = 0;
  request.mockImplementation(async url => url !== path ? {} : ++reads === 1 ? calculation() : new Promise(done => { complete = done; }));
  const screen = mount({ recipe }, true);
  try {
    await waitFor(() => expect(screen.getByLabelText("Calculated Calories").props.children).toBe("400"));
    now += PROVIDER_VIEW_MS + 1;
    act(() => resume("active"));
    await waitFor(() => expect(screen.getByLabelText("Calculated Calories").props.children).toBe("-"));
    await waitFor(() => expect(complete).toBeDefined());
    expect(screen.client.getQueryData<Calculation>(["nutrition-calculation", "calc-1"])?.totals.calories).toBeNull();
    await act(async () => complete(calculation()));
    await waitFor(() => expect(screen.getByLabelText("Calculated Calories").props.children).toBe("400"));
  } finally { screen.close(); }
});

test("calculated nutrients follow the user's selected measurement units", async () => {
  request.mockImplementation(async url => url === path ? calculation() : { notification_preferences: { protein_unit: "oz" } });
  const screen = mount();
  try {
    await waitFor(() => expect(screen.getByLabelText("Calculated Protein (oz)").props.children).toBe("0.705"));
    expect(screen.getByLabelText("Calculated Calories").props.children).toBe("400");
  } finally { screen.close(); }
});

test.each(["", "0", "-1", "21", "bad"])("invalid portion %s is never displayed as a misleading zero total", async value => {
  const screen = mount();
  try {
    await waitFor(() => expect(screen.getByLabelText("Calculated Calories").props.children).toBe("400"));
    fireEvent.changeText(screen.getByLabelText("Servings eaten"), value);
    expect(screen.getByLabelText("Calculated Calories").props.children).toBe("-");
    expect(screen.getByText("Enter more than 0 and up to 20 servings.")).toBeTruthy();
  } finally { screen.close(); }
});
