import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import GroceryScreen from "@/app/(tabs)/grocery";
import RecipesScreen from "@/app/(tabs)/recipes";
import { ManualRecipePanel } from "@/features/recipes/ManualRecipePanel";
import { PantryCoverageEditor } from "@/features/grocery/PantryCoverageEditor";
import { apiFetch } from "@/services/api";
import { Recipe } from "@/services/types";
import { GRAMS_PER_OUNCE } from "@/services/weightUnits";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ mode: "review" }) }));
jest.mock("@/components/Screen", () => ({ Screen: jest.requireActual("react-native").View }));
jest.mock("@/components/BrandLogo", () => ({ BrandLogo: () => null }));
jest.mock("@/features/onboarding/TourTarget", () => ({ TourTarget: jest.requireActual("react-native").View }));
jest.mock("@/features/recipes/RecipePhotoPicker", () => ({ RecipePhotoPicker: () => null }));
jest.mock("@/features/recipes/RecipeDetailSheet", () => ({ RecipeDetailSheet: () => null }));
jest.mock("@/features/recipes/AiRecipePanel", () => ({ AiRecipePanel: () => null }));
jest.mock("@/features/ingestion/UrlRecycleBinPanel", () => ({ UrlRecycleBinPanel: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));

const request = jest.mocked(apiFetch);
function mount(child: React.ReactNode, preferences: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  client.setQueryData(["profile"], { notification_preferences: preferences });
  const screen = render(<QueryClientProvider client={client}>{child}</QueryClientProvider>);
  return { ...screen, client, close: () => { screen.unmount(); client.clear(); } };
}
beforeEach(() => request.mockReset());

test("grocery groups start expanded, collapse individually and share checks and pantry actions", async () => {
  let onion = { id: "onion", display_name: "Red onion", quantity: 3, unit: null, category: "produce", is_checked: false, match_status: "search_link" };
  let available = true;
  const pantry = [{ id: "pantry", normalized_name: "red onion", category: "produce" }];
  request.mockImplementation(async (path, init) => {
    if (path === "/api/v1/grocery-lists/items/onion/pantry") { available = false; return { id: "pantry" }; }
    if (path === "/api/v1/grocery-lists/items/onion") { onion = { ...onion, ...JSON.parse(String(init?.body)) }; return {}; }
    if (path === "/api/v1/grocery-lists/pantry") return available ? [] : pantry;
    if (path === "/api/v1/grocery-lists/current") return {
      items: available ? [onion] : [], pantry_coverage_version: 1,
      recipe_groups: available ? [
        { recipe_id: "tacos", recipe_name: "Tacos", items: [{ ...onion, is_checked: false, recipe_quantity: 2, recipe_count: 2 }] },
        { recipe_id: "salad", recipe_name: "Salad", items: [{ ...onion, is_checked: false, recipe_quantity: 1, recipe_count: 2 }] }
      ] : []
    };
    return {};
  });
  const screen = mount(<GroceryScreen />);
  try {
    await screen.findByText("Recipe: 2");
    expect(screen.getByText("Recipe: 1")).toBeTruthy();
    expect(screen.getAllByText("Buy total: 3")).toHaveLength(2);
    expect(screen.queryByText(/search_link/)).toBeNull();
    fireEvent.press(screen.getByLabelText("Collapse Tacos"));
    expect(screen.queryByText("Recipe: 2")).toBeNull();
    expect(screen.getByText("Recipe: 1")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Expand Tacos"));
    expect(StyleSheet.flatten(screen.getAllByRole("checkbox")[0].props.style)).toMatchObject({ width: 44, minHeight: 44 });
    fireEvent.press(screen.getAllByRole("checkbox")[0]);
    await waitFor(() => expect(screen.getAllByRole("checkbox").every(item => item.props.accessibilityState.checked)).toBe(true));
    fireEvent.press(screen.getAllByLabelText("Put Red onion in pantry")[1]);
    expect(request.mock.calls.some(([path]) => path.endsWith("/onion/pantry"))).toBe(false);
    fireEvent.press(screen.getByLabelText("Have enough for this week"));
    await waitFor(() => expect(screen.queryByText("Red onion")).toBeNull());
    expect(screen.client.getQueryData(["pantry"])).toEqual(pantry);
    expect(request).toHaveBeenCalledWith("/api/v1/grocery-lists/items/onion/pantry", expect.objectContaining({ method: "POST" }));
    const payload = JSON.parse(String(request.mock.calls.find(([path]) => path.endsWith("/onion/pantry"))?.[1]?.body));
    expect(payload.coverage_mode).toBe("enough");
  } finally { screen.close(); }
}, 20_000);

test("ignored feedback stays collapsed until opened, retains warnings and can be restored", async () => {
  const recipe: Recipe = { id: "shake", name: "Protein shake", servings: 1, meal_type: "snack", difficulty: "easy", source_type: "manual", validation_status: "approved", validation_warnings: ["Ingredients not added", "Instructions not added"], duplicate_status: "new", image_status: "missing", ingredients: [], instructions: [], tags: [], is_favorite: false, is_hidden: false, feedback_ignored: false };
  request.mockImplementation(async (path, init) => {
    if (path.endsWith("/feedback-preference")) { recipe.feedback_ignored = JSON.parse(String(init?.body)).ignored; return { ...recipe }; }
    if (path.startsWith("/api/v1/recipes?")) return [{ ...recipe }];
    return [];
  });
  const screen = mount(<RecipesScreen />);
  try {
    await screen.findByLabelText("Select Protein shake");
    expect(screen.queryByLabelText("Ignore feedback for Protein shake")).toBeNull();
    expect(screen.queryByLabelText("Complete review for Protein shake")).toBeNull();
    fireEvent.press(screen.getByLabelText("Select Protein shake"));
    fireEvent.press(screen.getByLabelText("Ignore selected"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/recipes/shake/feedback-preference", expect.objectContaining({ method: "PUT", body: JSON.stringify({ ignored: true }) })));
    await screen.findByText("Feedback ignored. Recipes stay in your library.");
    await waitFor(() => expect(screen.queryByText("Ingredients not added")).toBeNull());
    expect(screen.getByLabelText("Ignored feedback").props.accessibilityState.expanded).toBe(false);
    fireEvent.press(screen.getByLabelText("Ignored feedback"));
    expect(screen.getByText("Ingredients not added")).toBeTruthy();
    expect(screen.getByText("Instructions not added")).toBeTruthy();
    expect(screen.queryByLabelText("Complete review for Protein shake")).toBeNull();
    fireEvent.press(screen.getByLabelText("Review again Protein shake"));
    await screen.findByLabelText("Select Protein shake");
    expect(request.mock.calls.filter(([path]) => path.endsWith("/feedback-preference")).map(([, init]) => JSON.parse(String(init?.body)))).toEqual([{ ignored: true }, { ignored: false }]);
  } finally { screen.close(); }
});

test("manual recipe can save with only its title and default servings", async () => {
  request.mockResolvedValue({ id: "saved" });
  const screen = mount(<ManualRecipePanel />);
  try {
    fireEvent.changeText(screen.getByLabelText("Recipe name"), "Quick shake");
    expect(screen.getByLabelText("Save recipe").props.accessibilityState.disabled).toBe(false);
    fireEvent.press(screen.getByLabelText("Save recipe"));
    await screen.findByText("Recipe saved. It is ready for planning.");
    const payload = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(payload).toMatchObject({ name: "Quick shake", ingredients: [], instructions: [], servings: 4, accept_placeholder_photo: true });
  } finally { screen.close(); }
});

test("multiple reviews complete together, retain feedback, and can be reopened", async () => {
  const recipes: Recipe[] = ["Soup", "Shake"].map((name, index) => ({ id: String(index), name,
    servings: 1, meal_type: "snack", difficulty: "easy", source_type: "manual", validation_status: "approved",
    validation_warnings: ["Photo missing; placeholder accepted"], duplicate_status: "new", image_status: "missing",
    ingredients: [], instructions: [], tags: [], is_favorite: false, is_hidden: false }));
  request.mockImplementation(async (path, init) => {
    if (path.endsWith("/feedback-preferences")) {
      const payload = JSON.parse(String(init?.body));
      recipes.filter(recipe => payload.recipe_ids.includes(recipe.id)).forEach(recipe => { recipe.feedback_completed = payload.action === "complete"; recipe.feedback_ignored = payload.action === "ignore"; });
      return recipes.map(recipe => ({ ...recipe }));
    }
    if (path.endsWith("/feedback-preference")) { recipes[0].feedback_completed = false; return { ...recipes[0] }; }
    if (path.startsWith("/api/v1/recipes?")) return recipes.map(recipe => ({ ...recipe }));
    return [];
  });
  const screen = mount(<RecipesScreen />);
  try {
    await screen.findByLabelText("Select Soup");
    expect(screen.queryAllByLabelText(/^Complete review for /)).toHaveLength(0);
    expect(screen.queryAllByLabelText(/^Ignore feedback for /)).toHaveLength(0);
    fireEvent.press(screen.getByLabelText("Select Soup"));
    fireEvent.press(screen.getByLabelText("Select Shake"));
    expect(screen.getByLabelText("Select Soup").props.accessibilityState.checked).toBe(true);
    fireEvent.press(screen.getByLabelText("Complete (2)"));
    await screen.findByText("Review completed.");
    await waitFor(() => expect(screen.queryByLabelText("Select Soup")).toBeNull());
    const call = request.mock.calls.find(([path]) => path.endsWith("/feedback-preferences"))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ recipe_ids: ["0", "1"], action: "complete" });
    expect(screen.getByLabelText("Completed reviews").props.accessibilityState.expanded).toBe(false);
    expect(screen.queryByText("Photo missing; placeholder accepted")).toBeNull();
    fireEvent.press(screen.getByLabelText("Completed reviews"));
    expect(screen.getAllByText("Photo missing; placeholder accepted")).toHaveLength(2);
    expect(screen.queryAllByLabelText(/^Complete review for /)).toHaveLength(0);
    fireEvent.press(screen.getByLabelText("Review again Soup"));
    await screen.findByLabelText("Select Soup");
  } finally { screen.close(); }
});

test("selection toolbar clears and ignores multiple reviews without per-recipe actions", async () => {
  const recipes: Recipe[] = ["Soup", "Shake"].map((name, index) => ({ id: String(index), name,
    servings: 1, meal_type: "snack", difficulty: "easy", source_type: "manual", validation_status: "approved",
    validation_warnings: ["Ingredients not added"], duplicate_status: "new", image_status: "missing",
    ingredients: [], instructions: [], tags: [], is_favorite: false, is_hidden: false }));
  request.mockImplementation(async (path, init) => {
    if (path.endsWith("/feedback-preferences")) {
      const payload = JSON.parse(String(init?.body));
      recipes.filter(recipe => payload.recipe_ids.includes(recipe.id)).forEach(recipe => { recipe.feedback_ignored = payload.action === "ignore"; });
      return recipes.map(recipe => ({ ...recipe }));
    }
    if (path.startsWith("/api/v1/recipes?")) return recipes.map(recipe => ({ ...recipe }));
    return [];
  });
  const screen = mount(<RecipesScreen />);
  try {
    await screen.findByLabelText("Select shown");
    fireEvent.press(screen.getByLabelText("Select shown"));
    expect(screen.getByLabelText("Complete (2)")).toBeTruthy();
    expect(screen.getByLabelText("Ignore selected")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Clear selection"));
    expect(screen.getByLabelText("Select Soup").props.accessibilityState.checked).toBe(false);
    expect(screen.getByLabelText("Select Shake").props.accessibilityState.checked).toBe(false);
    expect(screen.queryByLabelText("Ignore selected")).toBeNull();
    expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
    fireEvent.press(screen.getByLabelText("Select shown"));
    fireEvent.press(screen.getByLabelText("Ignore selected"));
    await screen.findByText("Feedback ignored. Recipes stay in your library.");
    await waitFor(() => expect(screen.queryByLabelText("Select Soup")).toBeNull());
    const call = request.mock.calls.find(([path]) => path.endsWith("/feedback-preferences"))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ recipe_ids: ["0", "1"], action: "ignore" });
    expect(screen.getByLabelText("Ignored feedback").props.accessibilityState.expanded).toBe(false);
    fireEvent.press(screen.getByLabelText("Ignored feedback"));
    expect(screen.getAllByText("Ingredients not added")).toHaveLength(2);
    expect(screen.queryAllByLabelText(/^Complete review for /)).toHaveLength(0);
    expect(screen.queryAllByLabelText(/^Ignore feedback for /)).toHaveLength(0);
    expect(screen.getByLabelText("Review again Soup")).toBeTruthy();
  } finally { screen.close(); }
});

test("failed bulk review preserves selection and search clears it", async () => {
  const recipe = { id: "one", name: "Soup", validation_status: "approved", validation_warnings: ["Missing photo"], duplicate_status: "new", image_status: "missing" };
  request.mockImplementation(async path => {
    if (path.endsWith("/feedback-preferences")) throw new Error("Please retry review");
    if (path.startsWith("/api/v1/recipes?")) return [recipe];
    return [];
  });
  const screen = mount(<RecipesScreen />);
  try {
    await screen.findByLabelText("Select shown");
    fireEvent.press(screen.getByLabelText("Select shown"));
    fireEvent.press(screen.getByLabelText("Complete (1)"));
    await screen.findByText("Please retry review");
    expect(screen.getByLabelText("Select Soup").props.accessibilityState.checked).toBe(true);
    fireEvent.changeText(screen.getByLabelText("Search recipes"), "Soup");
    await waitFor(() => expect(screen.queryByLabelText("Complete (1)")).toBeNull());
  } finally { screen.close(); }
});

test("partial pantry coverage sends an explicit amount and never assumes full coverage", async () => {
  request.mockResolvedValue({ id: "pantry" });
  const saved = jest.fn();
  const screen = mount(<PantryCoverageEditor selection={{ itemId: "onion", name: "Red onion", normalizedName: "red onion", category: "produce", requiredQuantity: 3 }} onClose={jest.fn()} onSaved={saved} />);
  try {
    expect(screen.getByLabelText("Save amount").props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText("On-hand quantity"), "-1");
    expect(screen.getByLabelText("Save amount").props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText("On-hand quantity"), "1");
    fireEvent.press(screen.getByLabelText("Save amount"));
    await waitFor(() => expect(saved).toHaveBeenCalledWith("quantity"));
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({ coverage_mode: "quantity", quantity: 1, unit: "each" });
  } finally { screen.close(); }
});

test("an older API cannot silently treat partial stock as full pantry coverage", async () => {
  request.mockImplementation(async path => path.endsWith("/current") ? { items: [{ id: "onion", display_name: "Red onion", quantity: 3, category: "produce", is_checked: false, match_status: "search_link" }] } : []);
  const screen = mount(<GroceryScreen />);
  try {
    await screen.findByLabelText("Put Red onion in pantry");
    expect(screen.getByLabelText("Put Red onion in pantry").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText("Put Red onion in pantry"));
    expect(screen.queryByLabelText("Have enough for this week")).toBeNull();
  } finally { screen.close(); }
});

test("grocery ounce display and quantity steps retain the ingredient's stored grams", async () => {
  const rice = { id: "rice", display_name: "Rice", quantity: 100, unit: "g", category: "pantry", is_checked: false, match_status: "search_link" };
  const milk = { ...rice, id: "milk", display_name: "Milk", quantity: 2, unit: "cups" };
  request.mockImplementation(async path => path.endsWith("/current") ? { items: [rice, milk] } : []);
  const screen = mount(<GroceryScreen />);
  try {
    await screen.findByText("100 g");
    act(() => screen.client.setQueryData(["profile"], { notification_preferences: { ingredient_weight_unit: "oz" } }));
    await screen.findByText("3.527 oz");
    expect(screen.getByText("2 cups")).toBeTruthy();
    expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
    fireEvent.press(screen.getByLabelText("Edit Rice"));
    fireEvent.press(screen.getByLabelText("Increase Rice quantity"));
    await waitFor(() => expect(request.mock.calls.some(([path]) => path.endsWith("/items/rice"))).toBe(true));
    const payload = JSON.parse(String(request.mock.calls.find(([path]) => path.endsWith("/items/rice"))![1]?.body));
    expect(payload.quantity).toBeCloseTo(100 + GRAMS_PER_OUNCE, 8);
    expect(payload.unit).toBeUndefined();
    act(() => screen.client.setQueryData(["profile"], { notification_preferences: { ingredient_weight_unit: "g" } }));
    await screen.findByText("100 g");
    expect(screen.queryByText("As added")).toBeNull();
  } finally { screen.close(); }
});

test("pantry ounce entry converts back to the existing grocery weight unit", async () => {
  request.mockResolvedValue({ id: "pantry" });
  const saved = jest.fn();
  const screen = mount(<PantryCoverageEditor selection={{ itemId: "rice", name: "Rice", normalizedName: "rice", category: "pantry", requiredQuantity: 100, unit: "g" }} onClose={jest.fn()} onSaved={saved} />, { ingredient_weight_unit: "oz" });
  try {
    expect(screen.queryByText("As added")).toBeNull();
    expect(screen.getByLabelText("Pantry unit").props.value).toBe("oz");
    expect(screen.getByLabelText("Pantry unit").props.editable).toBe(false);
    fireEvent.changeText(screen.getByLabelText("On-hand quantity"), "2");
    fireEvent.press(screen.getByLabelText("Save amount"));
    await waitFor(() => expect(saved).toHaveBeenCalledWith("quantity"));
    const payload = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(payload.unit).toBe("g");
    expect(payload.quantity).toBe(2 * GRAMS_PER_OUNCE);
  } finally { screen.close(); }
});
