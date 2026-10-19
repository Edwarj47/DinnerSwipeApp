import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { RecipeMacroLogger } from "@/features/recipes/RecipeMacroLogger";
import { RecipeNutritionPanel } from "@/features/recipes/RecipeNutritionPanel";
import { RecipeLibrarySection } from "@/features/recipes/RecipeLibrarySection";
import { EMPTY_NUTRITION, nutritionInputs, parseNutrition } from "@/features/recipes/recipeNutrition";
import { apiFetch } from "@/services/api";
import { MacroConfirmation, Recipe } from "@/services/types";
import { usePlannerStore } from "@/stores/plannerStore";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/features/premium/MacroDatePicker", () => ({ MacroDatePicker: () => null }));
const request = jest.mocked(apiFetch);
const recipe = { id: "recipe-1", name: "Rice bowl", servings: 4, meal_type: "dinner", is_hidden: false,
  nutrition: { calories: 400, protein_g: 20, carbs_g: null, fat_g: 0, fiber_g: null } } as Recipe;
function mount(element: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  return { ...screen, close: () => { screen.unmount(); client.clear(); } };
}
beforeEach(() => { request.mockReset().mockResolvedValue({}); usePlannerStore.getState().resetSession(); });

test("whole recipe normalization preserves zero and missing values", () => {
  expect(parseNutrition({ ...EMPTY_NUTRITION, calories: "1600", protein_g: "80", fat_g: "0" }, 4)).toEqual(recipe.nutrition);
  expect(nutritionInputs(recipe.nutrition, 1.5).calories).toBe("600");
  expect(() => parseNutrition({ ...EMPTY_NUTRITION, calories: "bad" })).toThrow();
  expect(() => parseNutrition(EMPTY_NUTRITION, 0)).toThrow();
});

test("recipe logging scales portions, permits individual overrides and saves its date", async () => {
  const close = jest.fn();
  const screen = mount(<RecipeMacroLogger recipe={recipe} date="2026-09-28" onClose={close} />);
  try {
    fireEvent.changeText(screen.getByLabelText("Servings eaten"), "1.5");
    expect(screen.getByLabelText("Calories").props.value).toBe("600");
    fireEvent.changeText(screen.getByLabelText("Protein (g)"), "33");
    fireEvent.press(screen.getByLabelText("Save entry"));
    await waitFor(() => expect(close).toHaveBeenCalled());
    const payload = JSON.parse(request.mock.calls.find(([path]) => path === "/api/v1/macros/entries")![1]!.body as string);
    expect(payload).toMatchObject({ recipe_id: "recipe-1", servings_consumed: 1.5, meal_date: "2026-09-28", protein_g: 33 });
    expect(payload).toMatchObject({ calories: 600, fat_g: 0, carbs_g: null, fiber_g: null });
  } finally { screen.close(); }
});

test("Log meal preserves a sauce recipe category instead of defaulting to Dinner", async () => {
  request.mockImplementation(async path => path.endsWith("subscription/status") ? { premium_active: true } : {});
  const screen = mount(<RecipeNutritionPanel recipe={{ ...recipe, meal_type: "sauce" }} />);
  try {
    fireEvent.press(await screen.findByLabelText("Log meal"));
    expect(screen.getByRole("button", { name: "Sauce" }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole("button", { name: "Dinner" }).props.accessibilityState.selected).toBe(false);
    fireEvent.press(screen.getByLabelText("Save entry"));
    await waitFor(() => expect(screen.queryByLabelText("Save entry")).toBeNull());
    const writes = request.mock.calls.filter(([, init]) => init?.method);
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe("/api/v1/macros/entries");
    expect(JSON.parse(String(writes[0][1]?.body))).toMatchObject({ recipe_id: recipe.id, meal_label: "sauce" });
  } finally { screen.close(); }
});

test("recipe picker logging preserves a custom meal type and permits an explicit change", async () => {
  request.mockResolvedValue([{ ...recipe, meal_type: "side_dish" }]);
  const screen = mount(<RecipeMacroLogger onClose={jest.fn()} />);
  try {
    fireEvent.press(await screen.findByLabelText("Log Rice bowl"));
    expect(screen.getByRole("button", { name: "Side Dish" }).props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByLabelText("Save entry"));
    await waitFor(() => expect(request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    expect(JSON.parse(String(request.mock.calls.find(([, init]) => init?.method === "POST")![1]?.body)).meal_label).toBe("side_dish");
    await waitFor(() => expect(screen.getByLabelText("Save entry").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByRole("button", { name: "Lunch" }));
    fireEvent.press(screen.getByLabelText("Save entry"));
    await waitFor(() => expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2));
    expect(JSON.parse(String(request.mock.calls.filter(([, init]) => init?.method === "POST")[1][1]?.body)).meal_label).toBe("lunch");
  } finally { screen.close(); }
});

test.each(["sauce", "dessert", "Appetizer", "side_dish"])("logged %s entries retain their category on edit and Save as recipe", async mealLabel => {
  const entry = { id: "custom-entry", recipe_id: recipe.id, entry_name: "My recipe", meal_label: mealLabel,
    meal_date: "2026-10-19", servings_consumed: 1, calories: 100 } as MacroConfirmation;
  const screen = mount(<RecipeMacroLogger entry={entry} onClose={jest.fn()} />);
  try {
    const display = mealLabel.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
    expect(screen.getByRole("button", { name: display }).props.accessibilityState.selected).toBe(true);
    fireEvent.changeText(screen.getByLabelText("Recipe log notes"), "Keep this category");
    fireEvent.press(screen.getByLabelText("Save as recipe"));
    fireEvent.press(screen.getByLabelText("Save recipe"));
    await screen.findByText("Recipe saved to your library.");
    const savedRecipe = request.mock.calls.find(([path]) => path === "/api/v1/recipes")!;
    expect(JSON.parse(String(savedRecipe[1]?.body)).meal_type).toBe(mealLabel);
    fireEvent.press(screen.getByLabelText("Save entry"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/macros/entries/custom-entry", expect.objectContaining({ method: "PUT" })));
    const updated = request.mock.calls.find(([path]) => path.endsWith("entries/custom-entry"))!;
    expect(JSON.parse(String(updated[1]?.body))).toMatchObject({ meal_label: mealLabel, notes: "Keep this category" });
  } finally { screen.close(); }
});

test("logged-meal editor saves reviewed nutrition as a recipe without changing the diary entry", async () => {
  const entry = { id: "entry-1", entry_name: "Rice bowl", recipe_id: "recipe-1", meal_date: "2026-09-28", meal_label: "dinner",
    servings_consumed: 1, calories: 400, protein_g: 20, carbs_g: null, fat_g: 0, fiber_g: null } as MacroConfirmation;
  const close = jest.fn();
  const screen = mount(<RecipeMacroLogger entry={entry} onClose={close} />);
  try {
    fireEvent.changeText(screen.getByLabelText("Servings eaten"), "1.5");
    fireEvent.changeText(screen.getByLabelText("Protein (g)"), "33");
    fireEvent.changeText(screen.getByLabelText("Recipe log notes"), "My lunch");
    fireEvent.press(screen.getByLabelText("Save as recipe"));
    fireEvent.changeText(screen.getByLabelText("Logged meal recipe name"), "My rice bowl");
    fireEvent.press(screen.getByLabelText("Save recipe"));
    await screen.findByText("Recipe saved to your library.");
    const writes = request.mock.calls.filter(([, init]) => init?.method);
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe("/api/v1/recipes");
    expect(JSON.parse(String(writes[0][1]?.body))).toMatchObject({
      name: "My rice bowl", description: "My lunch", meal_type: "dinner", servings: 1,
      nutrition: { calories: 600, protein_g: 33, carbs_g: null, fat_g: 0, fiber_g: null }
    });
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Recipe saved").props.accessibilityState.disabled).toBe(true);
  } finally { screen.close(); }
});

test.each(["breakfast", "sauce"])("logged database %s items copy references, portions and meal labels, never temporary totals", async mealLabel => {
  const entry = { id: "entry-1", calculator_id: "calc-1", entry_name: "My eggs", meal_date: "2026-09-28", meal_label: mealLabel,
    servings_consumed: 2, calories: 148, protein_g: 12.58 } as MacroConfirmation;
  request.mockImplementation(async (path) => path.endsWith("calc-1") ? {
    items: [{ source: "fatsecret", name: "Egg", portions: 2, food_id: "3092", serving_id: "11206" }]
  } : {});
  const screen = mount(<RecipeMacroLogger entry={entry} onClose={jest.fn()} />);
  try {
    fireEvent.changeText(screen.getByLabelText("Servings eaten"), "3");
    fireEvent.press(screen.getByLabelText("Save as recipe"));
    fireEvent.press(screen.getByLabelText("Save recipe"));
    await screen.findByText("Recipe saved to your library.");
    const call = request.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(call[0]).toBe("/api/v1/nutrition/calculations");
    const payload = JSON.parse(String(call[1]?.body));
    expect(payload).toMatchObject({ name: "My eggs", destination: "recipe", servings: 1, meal_label: mealLabel,
      items: [{ source: "fatsecret", name: "Egg", portions: 3, food_id: "3092", serving_id: "11206" }] });
    expect(payload.items[0].nutrition).toBeUndefined();
  } finally { screen.close(); }
});

test("hidden section loads on expand and unhide clears only that local history", async () => {
  request.mockImplementation(async (path, options) => options?.method === "POST" ? { status: "visible" } : path.includes("collection=hidden") ? [recipe] : []);
  usePlannerStore.getState().addSwipe({ recipe, action: "hide" });
  usePlannerStore.getState().addSwipe({ recipe: { ...recipe, id: "other" }, action: "skip" });
  const screen = mount(<RecipeLibrarySection collection="hidden" q="" onOpen={jest.fn()} onActions={jest.fn()} />);
  try {
    expect(request).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText("Hidden Recipes"));
    await screen.findByLabelText("Unhide Rice bowl");
    fireEvent.press(screen.getByLabelText("Unhide Rice bowl"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/recipes/recipe-1/unhide", { method: "POST" }));
    await waitFor(() => expect(usePlannerStore.getState().history.map(item => item.recipe.id)).toEqual(["other"]));
    fireEvent.press(screen.getByLabelText("Hidden Recipes"));
    expect(screen.queryByLabelText("Open Rice bowl")).toBeNull();
  } finally { screen.close(); }
});
