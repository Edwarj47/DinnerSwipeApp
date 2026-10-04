import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ManualRecipePanel } from "@/features/recipes/ManualRecipePanel";
import { UrlIngestionPanel } from "@/features/ingestion/UrlIngestionPanel";
import { RecipeMacroLogger } from "@/features/recipes/RecipeMacroLogger";
import { PremiumMacroPanel } from "@/features/premium/PremiumMacroPanel";
import { formatMealType } from "@/features/recipes/recipeDisplay";
import { todayISO } from "@/features/premium/macroDates";
import { apiFetch } from "@/services/api";
import { normalizeMealLabel, normalizeRecipeCategory, recipeCategoryOptions } from "@/services/mealCategories";
import { MacroConfirmation, Recipe } from "@/services/types";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn(), savedMessage: (text: string) => text }));
jest.mock("@/features/recipes/RecipePhotoPicker", () => ({ RecipePhotoPicker: () => null }));
jest.mock("@/features/premium/MacroDatePicker", () => ({ MacroDatePicker: () => null }));
jest.setTimeout(20_000);

const request = jest.mocked(apiFetch);
const recipe: Recipe = { id: "shake", name: "Protein shake", servings: 1, meal_type: "beverage", difficulty: "easy", source_type: "manual",
  validation_status: "approved", validation_warnings: [], duplicate_status: "new", image_status: "missing", ingredients: [], instructions: [], tags: [],
  is_favorite: false, is_hidden: false, can_edit: true, nutrition: { calories: 160, protein_g: 30, carbs_g: 4, fat_g: 3, fiber_g: 2 } };
const entry: MacroConfirmation = { id: "drink-entry", entry_name: "Iced tea", meal_date: todayISO(), meal_label: "beverage", servings_consumed: 1,
  status: "ate", macro_source: "manual", created_at: "2026-10-04T12:00:00Z", calories: 10, protein_g: 0 };
function mount(element: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  return { ...screen, close: () => { screen.unmount(); client.clear(); } };
}
beforeEach(() => { request.mockReset().mockResolvedValue(recipe); });

test("beverages have one category and readable labels without losing legacy categories", () => {
  for (const value of ["beverage", "Beverages", "drink", " DRINKS "]) {
    expect(normalizeRecipeCategory(value)).toBe("beverage");
    expect(normalizeMealLabel(value)).toBe("beverage");
    expect(formatMealType(value)).toBe("Beverages");
  }
  expect(normalizeRecipeCategory("Appetizer")).toBe("Appetizer");
  expect(recipeCategoryOptions("Appetizer")).toContainEqual({ value: "Appetizer", label: "Appetizer" });
  expect(normalizeMealLabel("snack")).toBe("snack");
  expect(formatMealType("snack")).toBe("Snack");
});

test("manual creation and complete recipe editing offer Beverages", async () => {
  const screen = mount(<ManualRecipePanel />);
  try {
    fireEvent.changeText(screen.getByLabelText("Recipe name"), "Mint tea");
    fireEvent.press(screen.getByLabelText("Meal type: Dinner"));
    fireEvent.press(screen.getByLabelText("Beverages"));
    expect(screen.getByLabelText("Meal type: Beverages")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Save recipe"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/recipes", expect.objectContaining({ method: "POST" })));
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({ name: "Mint tea", meal_type: "beverage", ingredients: [], instructions: [] });
  } finally { screen.close(); }
  request.mockClear();
  const edit = mount(<ManualRecipePanel initialRecipe={recipe} />);
  try {
    expect(edit.getByLabelText("Meal type: Beverages")).toBeTruthy();
    fireEvent.press(edit.getByLabelText("Save recipe"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/recipes/shake", expect.objectContaining({ method: "PUT" })));
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).meal_type).toBe("beverage");
  } finally { edit.close(); }
});

test("legacy recipe categories survive editing without being changed", async () => {
  const screen = mount(<ManualRecipePanel initialRecipe={{ ...recipe, meal_type: "Appetizer" }} />);
  try {
    expect(screen.getByLabelText("Meal type: Appetizer")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Save recipe"));
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).meal_type).toBe("Appetizer");
  } finally { screen.close(); }
});

test("web recipe review can change the category to Beverages before approval", async () => {
  const candidate = { id: "tea-draft", source_url: "https://example.test/tea", status: "requires_review", extracted_data: { ...recipe, name: "Mint tea", meal_type: "snack" } };
  request.mockImplementation(async (path, init) => {
    if (path === "/api/v1/url-ingestion") return init?.method === "POST" ? { candidates: [candidate] } : [];
    return candidate;
  });
  const screen = mount(<UrlIngestionPanel />);
  try {
    fireEvent.changeText(screen.getByLabelText("Recipe URL"), candidate.source_url);
    fireEvent.press(screen.getByLabelText("Fetch recipe"));
    await screen.findByLabelText("Review meal type: Snack");
    fireEvent.press(screen.getByLabelText("Review meal type: Snack"));
    fireEvent.press(screen.getByLabelText("Beverages"));
    fireEvent.press(screen.getByLabelText("Approve"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/url-ingestion/tea-draft/approve", expect.anything()));
    const call = request.mock.calls.find(([path]) => path.endsWith("/approve"))!;
    expect(JSON.parse(String(call[1]?.body)).edits.meal_type).toBe("beverage");
    await waitFor(() => expect(screen.queryByText("Review recipe")).toBeNull());
  } finally { screen.close(); }
});

test("recipe picker logging recognizes beverage portions and preserves the category on edit", async () => {
  request.mockImplementation(async (_path, init) => init?.method ? {} : [recipe]);
  const closed = jest.fn();
  const screen = mount(<RecipeMacroLogger onClose={closed} date="2026-10-04" />);
  try {
    fireEvent.press(await screen.findByLabelText("Log Protein shake"));
    expect(screen.getByLabelText("Beverages").props.accessibilityState.selected).toBe(true);
    fireEvent.changeText(screen.getByLabelText("Servings eaten"), "1.5");
    fireEvent.press(screen.getByLabelText("Save entry"));
    await waitFor(() => expect(closed).toHaveBeenCalled());
    const payload = JSON.parse(String(request.mock.calls.find(([, init]) => init?.method === "POST")![1]?.body));
    expect(payload).toMatchObject({ recipe_id: "shake", meal_label: "beverage", calories: 240, protein_g: 45 });
  } finally { screen.close(); }
  request.mockClear();
  const edit = mount(<RecipeMacroLogger entry={entry} onClose={closed} />);
  try {
    expect(edit.getByLabelText("Beverages").props.accessibilityState.selected).toBe(true);
    fireEvent.press(edit.getByLabelText("Save entry"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/macros/entries/drink-entry", expect.objectContaining({ method: "PUT" })));
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).meal_label).toBe("beverage");
  } finally { edit.close(); }
});

test("standalone daily logging and editing retain Beverages instead of reverting to Dinner", async () => {
  request.mockImplementation(async (path, init) => {
    if (path.endsWith("/subscription/status")) return { premium_active: true, current_tier: "premium", plans: [] };
    if (path.includes("/summary")) return { totals: { calories: 0, protein_g: 0 }, eaten_meals: 0 };
    if (path.includes("/analytics")) return { totals: {}, averages: {}, daily_totals: [], targets: {} };
    if (path.includes("/entries")) return init?.method ? entry : [entry];
    return {};
  });
  const screen = mount(<PremiumMacroPanel />);
  try {
    await screen.findByLabelText("Entry name");
    fireEvent.changeText(screen.getByLabelText("Entry name"), "Mint tea");
    fireEvent.press(screen.getByLabelText("Beverages"));
    fireEvent.changeText(screen.getByLabelText("Calories"), "0");
    fireEvent.press(screen.getByLabelText("Add"));
    await screen.findByText("Macro entry added.");
    expect(JSON.parse(String(request.mock.calls.find(([, init]) => init?.method === "POST")![1]?.body)).meal_label).toBe("beverage");
    fireEvent.press(screen.getByText("Iced tea"));
    expect(screen.getByLabelText("Beverages").props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByLabelText("Update"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/macros/entries/drink-entry", expect.objectContaining({ method: "PUT", body: expect.stringContaining('"meal_label":"beverage"') })));
  } finally { screen.close(); }
});
