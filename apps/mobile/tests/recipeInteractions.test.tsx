import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { UrlIngestionPanel } from "@/features/ingestion/UrlIngestionPanel";
import { ManualRecipePanel } from "@/features/recipes/ManualRecipePanel";
import { RecipeDetailSheet } from "@/features/recipes/RecipeDetailSheet";
import { apiFetch } from "@/services/api";
import { Recipe } from "@/services/types";
import { StyleSheet } from "react-native";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/features/recipes/RecipePhotoPicker", () => ({ RecipePhotoPicker: () => null }));
jest.mock("@/features/recipes/RecipePhotoEditor", () => ({ RecipePhotoEditor: () => null }));
jest.mock("@/features/recipes/RecipeNutritionPanel", () => ({ RecipeNutritionPanel: () => null }));
const request = jest.mocked(apiFetch);
// First renders include cold React Native transforms on CI.
jest.setTimeout(20_000);
const recipe: Recipe = {
  id: "owned", name: "Carrot soup", description: "Warm soup", servings: 2,
  meal_type: "dinner", difficulty: "easy", cuisine: "Italian", source_type: "manual",
  prep_minutes: 5, cook_minutes: 10, total_minutes: 15, photo_url: null,
  validation_status: "approved", validation_warnings: [], duplicate_status: "new", image_status: "missing",
  ingredients: [{ original_text: "2 carrots", normalized_name: "carrot", quantity: 2, unit: null, preparation_note: "chopped", section: "Soup", is_optional: false, sort_order: 0 }],
  instructions: [{ text: "Simmer the carrots.", step_number: 1, timer_minutes: 10, section: "Soup" }],
  tags: ["vegetarian"], can_edit: true, is_favorite: false, is_hidden: false,
  nutrition: { calories: 100, protein_g: 4, carbs_g: 12, fat_g: 2, fiber_g: 3 }
};
function mount(element: React.ReactElement, preferences: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  client.setQueryData(["profile"], { notification_preferences: preferences });
  const screen = render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  return { ...screen, rerenderElement: (element: React.ReactElement) => screen.rerender(<QueryClientProvider client={client}>{element}</QueryClientProvider>), close: () => { screen.unmount(); client.clear(); } };
}
beforeEach(() => request.mockReset().mockResolvedValue({}));
afterEach(() => jest.useRealTimers());

test("Plan it shows saving, then success for five seconds; failed actions show an error", async () => {
  jest.useFakeTimers();
  let finish!: (value: unknown) => void;
  request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const screen = mount(<RecipeDetailSheet recipe={recipe} visible onClose={jest.fn()} />);
  try {
    fireEvent.press(screen.getByText("Plan it"));
    await act(async () => { await jest.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Saving choice...")).toBeTruthy();
    expect(screen.queryByText("Added to This Week.")).toBeNull();
    await act(async () => { finish({}); await jest.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Added to This Week.")).toBeTruthy();
    await act(async () => { await jest.advanceTimersByTimeAsync(4999); });
    expect(screen.getByText("Added to This Week.")).toBeTruthy();
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
    expect(screen.queryByText("Added to This Week.")).toBeNull();
    request.mockRejectedValueOnce(new Error("Unable to plan meal"));
    fireEvent.press(screen.getByText("Plan it"));
    await act(async () => { await jest.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Unable to plan meal")).toBeTruthy();
    await act(async () => { await jest.advanceTimersByTimeAsync(6000); });
    expect(screen.getByText("Unable to plan meal")).toBeTruthy();
  } finally { screen.close(); }
});

test("owner edit loads all fields, preserves structured metadata and uses PUT", async () => {
  const saved = jest.fn();
  request.mockResolvedValue({ ...recipe, name: "My soup" });
  const screen = mount(<ManualRecipePanel initialRecipe={recipe} onSaved={saved} />);
  try {
    expect(screen.getByLabelText("Calories").props.value).toBe("100");
    expect(screen.queryByLabelText("Cuisine")).toBeNull();
    expect(screen.queryByLabelText("Photo URL")).toBeNull();
    fireEvent.changeText(screen.getByLabelText("Recipe name"), "My soup");
    fireEvent.press(screen.getByLabelText("Save recipe"));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ name: "My soup" })));
    expect(request.mock.calls[0][0]).toBe("/api/v1/recipes/owned");
    expect(request.mock.calls[0][1]?.method).toBe("PUT");
    const payload = JSON.parse(request.mock.calls[0][1]!.body as string);
    expect(payload.instructions[0].timer_minutes).toBe(10);
    expect(payload.ingredients[0].preparation_note).toBe("chopped");
    expect(payload.nutrition).toEqual(recipe.nutrition);
    expect(payload.cuisine).toBe("Italian");
  } finally { screen.close(); }
});

test("ingredient weights show an optional equivalent without rewriting preparation text", () => {
  const original = "100 grams carrots, peeled and finely chopped";
  const screen = mount(<RecipeDetailSheet recipe={{ ...recipe, ingredients: [{ original_text: original, normalized_name: "carrot", quantity: 100, unit: "g" }] }} visible onClose={jest.fn()} />, { ingredient_weight_unit: "oz" });
  try {
    expect(screen.getByText(original)).toBeTruthy();
    expect(screen.getByText("3.527 oz")).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  } finally { screen.close(); }
});

test("closing an in-flight edit does not reopen the recipe when saving finishes", async () => {
  let finish!: (value: Recipe) => void;
  request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const updated = jest.fn();
  const screen = mount(<RecipeDetailSheet recipe={recipe} visible onClose={jest.fn()} onUpdated={updated} />);
  try {
    fireEvent.press(screen.getByLabelText("Edit recipe"));
    fireEvent.press(screen.getByLabelText("Save recipe"));
    await waitFor(() => expect(request).toHaveBeenCalled());
    screen.rerenderElement(<RecipeDetailSheet recipe={null} visible={false} onClose={jest.fn()} onUpdated={updated} />);
    await act(async () => { finish(recipe); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(updated).not.toHaveBeenCalled();
    expect(screen.queryByText("Recipe updated.")).toBeNull();
  } finally { screen.close(); }
});

test("shared recipe customization saves a copy and failed edits keep the form", async () => {
  const copy = mount(<ManualRecipePanel initialRecipe={{ ...recipe, can_edit: false }} />);
  try {
    fireEvent.press(copy.getByLabelText("Save a copy"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/recipes", expect.objectContaining({ method: "POST" })));
  } finally { copy.close(); }
  request.mockRejectedValueOnce(new Error("Save failed"));
  const failed = mount(<ManualRecipePanel initialRecipe={recipe} />);
  try {
    fireEvent.changeText(failed.getByLabelText("Recipe name"), "Keep these edits");
    fireEvent.press(failed.getByLabelText("Save recipe"));
    await failed.findByText("Save failed");
    expect(failed.getByLabelText("Recipe name").props.value).toBe("Keep these edits");
  } finally { failed.close(); }
});

test.each(["Approve", "Reject"])("web %s collapses review immediately after success", async action => {
  const candidate = { id: "web", source_url: "https://example.test/soup", status: "requires_review", recipe_name: "Carrot soup", extracted_data: recipe };
  request.mockImplementation(async (path, init) => {
    if (path.endsWith("/url-ingestion") && init?.method === "POST") return { candidates: [candidate] };
    if (path.endsWith("/url-ingestion")) return [candidate];
    if (path.endsWith("/web")) return candidate;
    return {};
  });
  const screen = mount(<UrlIngestionPanel />);
  try {
    fireEvent.changeText(screen.getByLabelText("Recipe URL"), candidate.source_url);
    fireEvent.press(screen.getByLabelText("Fetch recipe"));
    await screen.findByText("Review recipe");
    expect(screen.queryByLabelText("Review recipe photo URL")).toBeNull();
    await waitFor(() => expect(screen.getByLabelText(action).props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByLabelText(action));
    await waitFor(() => expect(screen.queryByText("Review recipe")).toBeNull());
    expect(screen.getByText("Recent web drafts")).toBeTruthy();
  } finally { screen.close(); }
});

test("total minutes is derived, validates the combined time and preserves legacy total-only recipes", async () => {
  const screen = mount(<ManualRecipePanel initialRecipe={{ ...recipe, prep_minutes: null, cook_minutes: null, total_minutes: 45 }} />);
  try {
    expect(screen.getByLabelText("Total minutes").props.children).toBe("45");
    fireEvent.press(screen.getByLabelText("Save recipe"));
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).total_minutes).toBe(45);
    await screen.findByText("Recipe updated.");
    fireEvent.changeText(screen.getByLabelText("Prep minutes"), "10");
    fireEvent.changeText(screen.getByLabelText("Cook minutes"), "20");
    expect(screen.getByLabelText("Total minutes").props.children).toBe("30");
    fireEvent.changeText(screen.getByLabelText("Cook minutes"), "1440");
    expect(screen.getByLabelText("Save recipe").props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText("Prep minutes"), "");
    fireEvent.changeText(screen.getByLabelText("Cook minutes"), "");
    expect(screen.getByLabelText("Total minutes").props.children).toBe("Not entered");
    fireEvent.changeText(screen.getByLabelText("Prep minutes"), "0");
    expect(screen.getByLabelText("Total minutes").props.children).toBe("0");
    fireEvent.changeText(screen.getByLabelText("Prep minutes"), "1.5");
    expect(screen.getByLabelText("Save recipe").props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText("Prep minutes"), " ");
    fireEvent.changeText(screen.getByLabelText("Cook minutes"), " ");
    expect(screen.getByLabelText("Total minutes").props.children).toBe("Not entered");
    fireEvent.press(screen.getByLabelText("Save recipe"));
    await waitFor(() => expect(request.mock.calls).toHaveLength(2));
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toMatchObject({ prep_minutes: null, cook_minutes: null, total_minutes: null });
  } finally { screen.close(); }
});

test("step numbers use a centered badge without fixed text height", () => {
  const screen = mount(<RecipeDetailSheet recipe={{ ...recipe, instructions: [{ text: "Finish the soup.", step_number: 12 }] }} visible onClose={jest.fn()} />);
  try {
    expect(StyleSheet.flatten(screen.getByTestId("recipe-step-badge").props.style)).toMatchObject({ alignItems: "center", justifyContent: "center", minHeight: 32, flexShrink: 0 });
    const style = StyleSheet.flatten(screen.getByText("12").props.style);
    expect(style.height).toBeUndefined();
    expect(style.lineHeight).toBeUndefined();
  } finally { screen.close(); }
});

test("failed web approval preserves the review and reports a retryable error", async () => {
  const candidate = { id: "web", source_url: "https://example.test/soup", status: "requires_review", extracted_data: recipe };
  request.mockImplementation(async (path, init) => {
    if (path.endsWith("/approve")) throw new Error("Approval failed");
    if (path.endsWith("/url-ingestion") && init?.method === "POST") return { candidates: [candidate] };
    if (path.endsWith("/url-ingestion")) return [];
    return candidate;
  });
  const screen = mount(<UrlIngestionPanel />);
  try {
    fireEvent.changeText(screen.getByLabelText("Recipe URL"), candidate.source_url);
    fireEvent.press(screen.getByLabelText("Fetch recipe"));
    await screen.findByText("Review recipe");
    fireEvent.press(screen.getByLabelText("Approve"));
    await screen.findByText("Approval failed");
    expect(screen.getByLabelText("Review recipe name").props.value).toBe(recipe.name);
    expect(screen.getByLabelText("Approve").props.accessibilityState.disabled).toBe(false);
  } finally { screen.close(); }
});

test("web review can approve a named recipe without ingredients or instructions", async () => {
  const candidate = { id: "web", source_url: "https://example.test/shake", status: "requires_review", extracted_data: { ...recipe, ingredients: [], instructions: [] } };
  request.mockImplementation(async (path, init) => {
    if (path.endsWith("/url-ingestion") && init?.method === "POST") return { candidates: [candidate] };
    if (path.endsWith("/url-ingestion")) return [];
    return candidate;
  });
  const screen = mount(<UrlIngestionPanel />);
  try {
    fireEvent.changeText(screen.getByLabelText("Recipe URL"), candidate.source_url);
    fireEvent.press(screen.getByLabelText("Fetch recipe"));
    await screen.findByText("Review recipe");
    expect(screen.getByLabelText("Approve").props.accessibilityState.disabled).toBe(false);
    fireEvent.press(screen.getByLabelText("Approve"));
    await waitFor(() => expect(request.mock.calls.some(([path]) => path.endsWith("/approve"))).toBe(true));
  } finally { screen.close(); }
});
