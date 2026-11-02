import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, fireEventAsync, render, waitFor } from "@testing-library/react-native";
import { RecipeLibrarySection } from "@/features/recipes/RecipeLibrarySection";
import { apiFetch } from "@/services/api";
import { useOfflineStatus } from "@/services/offlineStore";
import { Recipe } from "@/services/types";
import { usePlannerStore } from "@/stores/plannerStore";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/features/recipes/RecipePhoto", () => ({ RecipePhoto: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
const request = jest.mocked(apiFetch);
const recipe = { id: "favorite-1", name: "My soup", is_favorite: true, total_minutes: 30 } as Recipe;
const open = jest.fn(), actions = jest.fn();
function mount(q = "") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  const element = (query: string) => <QueryClientProvider client={client}><RecipeLibrarySection collection="favorites" q={query} onOpen={open} onActions={actions} /></QueryClientProvider>;
  const screen = render(element(q));
  return { ...screen, client, search: (query: string) => screen.rerender(element(query)), close: () => { screen.unmount(); client.clear(); } };
}
beforeEach(() => {
  jest.clearAllMocks(); useOfflineStatus.setState({ offline: false }); usePlannerStore.getState().resetSession();
  request.mockReset().mockResolvedValue([recipe]);
});
afterEach(() => useOfflineStatus.setState({ offline: false }));

test("Favorites is collapsed, loads its own collection and opens existing recipe details/actions", async () => {
  const screen = mount("soup & rice");
  try {
    expect(request).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole("button", { name: "Favorites" }));
    await screen.findByLabelText("Open My soup");
    expect(request).toHaveBeenCalledWith("/api/v1/recipes?collection=favorites&limit=30&offset=0&q=soup%20%26%20rice");
    fireEvent.press(screen.getByLabelText("Open My soup")); expect(open).toHaveBeenCalledWith(recipe);
    fireEvent.press(screen.getByLabelText("Actions for My soup")); expect(actions).toHaveBeenCalledWith(recipe);
    expect(screen.queryByLabelText("Unhide My soup")).toBeNull();
    expect(screen.queryByLabelText("Restore My soup")).toBeNull();
    fireEvent.press(screen.getByLabelText("Favorites"));
    expect(screen.queryByLabelText("Open My soup")).toBeNull();
  } finally { screen.close(); }
});

test("removing a favorite refreshes recipe collections without altering weekly or swipe history", async () => {
  let removed = false;
  request.mockImplementation(async (_path, init) => {
    if (init?.method === "DELETE") { removed = true; return { status: "unfavorited" }; }
    return removed ? [] : [recipe];
  });
  usePlannerStore.getState().addSwipe({ recipe, action: "add" });
  const before = usePlannerStore.getState().history;
  const screen = mount();
  try {
    const invalidate = jest.spyOn(screen.client, "invalidateQueries");
    fireEvent.press(screen.getByLabelText("Favorites"));
    await screen.findByLabelText("Remove My soup from favorites");
    await fireEventAsync.press(screen.getByLabelText("Remove My soup from favorites"));
    await screen.findByText("No favorite recipes yet.");
    expect(request).toHaveBeenCalledWith("/api/v1/recipes/favorite-1/favorite", { method: "DELETE" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["recipes"] });
    expect(usePlannerStore.getState().history).toBe(before);
    expect(request.mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
  } finally { screen.close(); }
});

test("failed removal retains the item and offline mode disables the remove action", async () => {
  request.mockImplementation(async (_path, init) => { if (init?.method === "DELETE") throw Error("Save failed"); return [recipe]; });
  const screen = mount();
  try {
    fireEvent.press(screen.getByLabelText("Favorites"));
    await screen.findByLabelText("Remove My soup from favorites");
    fireEvent.press(screen.getByLabelText("Remove My soup from favorites"));
    await screen.findByText("Save failed");
    expect(screen.getByLabelText("Open My soup")).toBeTruthy();
    act(() => useOfflineStatus.setState({ offline: true }));
    expect(screen.getByLabelText("Remove My soup from favorites").props.accessibilityState.disabled).toBe(true);
  } finally { screen.close(); }
});

test("favorites are paginated by the server and search applies to the entire collection", async () => {
  request.mockImplementation(async path => path.includes("q=beans") ? [] : path.includes("offset=30") ? [{ ...recipe, id: "last", name: "Last favorite" }] :
    Array.from({ length: 30 }, (_, i) => ({ ...recipe, id: `favorite-${i}`, name: `Soup ${i}` })));
  const screen = mount();
  try {
    fireEvent.press(screen.getByLabelText("Favorites"));
    fireEvent.press(await screen.findByLabelText("More recipes"));
    await screen.findByLabelText("Open Last favorite");
    expect(request).toHaveBeenCalledWith("/api/v1/recipes?collection=favorites&limit=30&offset=30&q=");
    screen.search("beans");
    await screen.findByText("No matching recipes.");
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/recipes?collection=favorites&limit=30&offset=0&q=beans"));
  } finally { screen.close(); }
});
