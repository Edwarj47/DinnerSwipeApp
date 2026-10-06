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
    await screen.findByText("For recipe: 2");
    expect(screen.getByText("For recipe: 1")).toBeTruthy();
    expect(screen.getAllByText("Shopping total: 3")).toHaveLength(2);
    expect(screen.queryByText(/search_link/)).toBeNull();
    fireEvent.press(screen.getByLabelText("Collapse Tacos"));
    expect(screen.queryByText("For recipe: 2")).toBeNull();
    expect(screen.getByText("For recipe: 1")).toBeTruthy();
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
    await screen.findByLabelText("Ignore feedback for Protein shake");
    fireEvent.press(screen.getByLabelText("Ignore feedback for Protein shake"));
    await waitFor(() => expect(screen.queryByText("Ingredients not added")).toBeNull());
    expect(screen.getByLabelText("Ignored feedback").props.accessibilityState.expanded).toBe(false);
    fireEvent.press(screen.getByLabelText("Ignored feedback"));
    expect(screen.getByText("Ingredients not added")).toBeTruthy();
    expect(screen.getByText("Instructions not added")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Review again Protein shake"));
    await screen.findByLabelText("Ignore feedback for Protein shake");
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
