import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { GroupRecipeSharing } from "@/features/groups/GroupRecipeSharing";
import { apiFetch, reconnectOffline } from "@/services/api";
import { deviceOffline } from "@/services/offlineStore";
import { GroupRecipeOption, Household } from "@/services/types";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn(), reconnectOffline: jest.fn() }));
jest.mock("@/services/offlineStore", () => ({ deviceOffline: jest.fn(() => false) }));
jest.setTimeout(20_000);
const request = jest.mocked(apiFetch);
const offline = jest.mocked(deviceOffline);
const reconnect = jest.mocked(reconnectOffline);
const household: Household = { id: "family", name: "Family dinners", is_personal: false, invite_code: "ABCDEFGH", current_user_role: "member", members: [], allergen_filter_mode: "warn", dislike_filter_mode: "warn" };
function option(id: string, name: string, shared = false): GroupRecipeOption {
  return { is_shared: shared, recipe: { id, name, servings: 2, total_minutes: 30, difficulty: "easy", meal_type: "dinner", source_type: "manual",
    validation_status: "approved", validation_warnings: [], duplicate_status: "new", image_status: "missing", ingredients: [], instructions: [], tags: [], is_favorite: false, is_hidden: false } };
}
let options: GroupRecipeOption[];
beforeEach(() => {
  jest.clearAllMocks();
  offline.mockReturnValue(false);
  reconnect.mockImplementation(async () => { offline.mockReturnValue(false); });
  options = [option("pasta", "Private pasta"), option("salad", "Garden salad"), option("soup", "Tomato soup", true)];
  request.mockImplementation(async (path, init) => {
    if (init?.method === "POST") return { shared_count: 2, already_shared_count: 0, recipe_count: 2 };
    const url = new URL(path, "https://example.invalid");
    const matches = options.filter(row => row.recipe.name.toLowerCase().includes((url.searchParams.get("q") ?? "").toLowerCase()));
    const offset = Number(url.searchParams.get("offset"));
    return { items: matches.slice(offset, offset + 30), total: matches.length, shared_count: matches.filter(row => row.is_shared).length };
  });
});
function mount(group = household) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const wrap = (space: Household) => <QueryClientProvider client={client}><GroupRecipeSharing key={space.id} household={space} /></QueryClientProvider>;
  const screen = render(wrap(group));
  return { ...screen, client, changeGroup: (space: Household) => screen.rerender(wrap(space)), close: () => { screen.unmount(); client.clear(); } };
}
async function open(screen: ReturnType<typeof mount>) {
  fireEvent.press(screen.getByLabelText("Share recipes"));
  await screen.findByLabelText("Select Private pasta");
}

test("members choose multiple private recipes and already shared recipes are disabled", async () => {
  const screen = mount();
  const invalidate = jest.spyOn(screen.client, "invalidateQueries");
  try {
    await open(screen);
    expect(screen.getByText("Family dinners")).toBeTruthy();
    expect(screen.getByLabelText("Already shared: Tomato soup").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText("Share 0 recipes").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText("Select Private pasta"));
    fireEvent.press(screen.getByLabelText("Select Garden salad"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Share 2 recipes"));
    await screen.findByText("2 recipes shared with Family dinners.");
    expect(request).toHaveBeenCalledWith("/api/v1/households/family/recipes/share", expect.objectContaining({ method: "POST", body: JSON.stringify({ recipe_ids: ["pasta", "salad"] }) }));
    expect(screen.queryByLabelText("Search your recipes")).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["group-library"] });
  } finally { screen.close(); }
});

test("select all covers unloaded pages and allows exceptions", async () => {
  options = [option("pasta", "Private pasta"), ...Array.from({ length: 66 }, (_, i) => option(`meal-${i}`, `Saved meal ${i}`)), option("shared", "Already in Family", true)];
  const screen = mount();
  try {
    await open(screen);
    fireEvent.press(screen.getByLabelText("Select all recipes"));
    expect(screen.getByText("67 selected")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Select Private pasta"));
    expect(screen.getByText("66 selected")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Share 66 recipes"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/households/family/recipes/share", expect.objectContaining({ body: JSON.stringify({ select_all: true, q: "", excluded_recipe_ids: ["pasta"] }) })));
  } finally { screen.close(); }
});

test("paging retains selections and loads more while scrolling", async () => {
  options = [option("pasta", "Private pasta"), ...Array.from({ length: 31 }, (_, i) => option(`meal-${i}`, `Saved meal ${i}`))];
  const screen = mount();
  try {
    await open(screen);
    fireEvent.press(screen.getByLabelText("Select Private pasta"));
    fireEvent(screen.getByTestId("group-recipe-list"), "endReached", { distanceFromEnd: 0 });
    await waitFor(() => expect(request.mock.calls.some(([path]) => path.includes("offset=30"))).toBe(true));
    expect(screen.getByText("1 selected")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Share 1 recipe"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/households/family/recipes/share", expect.objectContaining({ body: JSON.stringify({ recipe_ids: ["pasta"] }) })));
  } finally { screen.close(); }
});

test("paging failure can reconnect and retry without losing selected recipes", async () => {
  options = [option("pasta", "Private pasta"), ...Array.from({ length: 31 }, (_, i) => option(`meal-${i}`, `Saved meal ${i}`))];
  const screen = mount();
  try {
    await open(screen);
    fireEvent.press(screen.getByLabelText("Select Private pasta"));
    request.mockRejectedValueOnce(new Error("Network unavailable"));
    fireEvent.press(screen.getByLabelText("More recipes"));
    await screen.findByText("More recipes couldn't be loaded. Try again.");
    expect(screen.getByText("1 selected")).toBeTruthy();
    offline.mockReturnValue(true);
    fireEvent.press(screen.getByLabelText("More recipes"));
    await waitFor(() => expect(reconnect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("group-recipe-list").props.data).toHaveLength(32));
    expect(screen.queryByText("More recipes couldn't be loaded. Try again.")).toBeNull();
    expect(screen.getByText("1 selected")).toBeTruthy();
  } finally { screen.close(); }
});

test("filtered select all uses the search; changing search clears that all-selection", async () => {
  const screen = mount();
  try {
    await open(screen);
    fireEvent.changeText(screen.getByLabelText("Search your recipes"), "pasta");
    await waitFor(() => expect(screen.queryByLabelText("Select Garden salad")).toBeNull());
    await waitFor(() => expect(screen.getByLabelText("Select all matching recipes").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByLabelText("Select all matching recipes"));
    expect(screen.getByText("1 selected")).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Search your recipes"), "salad");
    await screen.findByLabelText("Select Garden salad");
    expect(screen.getByText("0 selected")).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText("Select all matching recipes").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByLabelText("Select all matching recipes"));
    fireEvent.press(screen.getByLabelText("Share 1 recipe"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/households/family/recipes/share", expect.objectContaining({ body: JSON.stringify({ select_all: true, q: "salad", excluded_recipe_ids: [] }) })));
  } finally { screen.close(); }
});

test("manual selection persists across search and can be cleared", async () => {
  const screen = mount();
  try {
    await open(screen);
    fireEvent.press(screen.getByLabelText("Select Private pasta"));
    fireEvent.changeText(screen.getByLabelText("Search your recipes"), "salad");
    await screen.findByLabelText("Select Garden salad");
    fireEvent.press(screen.getByLabelText("Select Garden salad"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Clear selection"));
    expect(screen.getByText("0 selected")).toBeTruthy();
  } finally { screen.close(); }
});

test("load failure can retry; share failure keeps the selection and never claims success", async () => {
  const screen = mount();
  try {
    request.mockRejectedValueOnce(new Error("Network unavailable"));
    fireEvent.press(screen.getByLabelText("Share recipes"));
    await screen.findByText("Recipes couldn't be loaded.");
    offline.mockReturnValue(true);
    fireEvent.press(screen.getByLabelText("Retry"));
    await screen.findByLabelText("Select Private pasta");
    expect(reconnect).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByLabelText("Select Private pasta"));
    request.mockRejectedValueOnce(new Error("Please reconnect to share recipes."));
    fireEvent.press(screen.getByLabelText("Share 1 recipe"));
    await screen.findByText("Please reconnect to share recipes.");
    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(screen.queryByText("2 recipes shared with Family dinners.")).toBeNull();
    offline.mockReturnValue(true);
    request.mockResolvedValueOnce({ shared_count: 1, already_shared_count: 0, recipe_count: 1 });
    fireEvent.press(screen.getByLabelText("Share 1 recipe"));
    await screen.findByText("1 recipe shared with Family dinners.");
    expect(reconnect).toHaveBeenCalledTimes(2);
  } finally { screen.close(); }
});

test("group switching resets selection and the target; private kitchens have no share-to-self action", async () => {
  const screen = mount();
  try {
    await open(screen);
    fireEvent.press(screen.getByLabelText("Select Private pasta"));
    screen.changeGroup({ ...household, id: "friends", name: "Friends" });
    expect(screen.queryByLabelText("Search your recipes")).toBeNull();
    await open(screen);
    expect(screen.getByText("Friends")).toBeTruthy();
    expect(screen.getByText("0 selected")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Select Private pasta"));
    fireEvent.press(screen.getByLabelText("Share 1 recipe"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/households/friends/recipes/share", expect.anything()));
    screen.changeGroup({ ...household, id: "kitchen", is_personal: true });
    expect(screen.queryByLabelText("Share recipes")).toBeNull();
  } finally { screen.close(); }
});

test("pending sharing locks the picker until the explicit request completes", async () => {
  const screen = mount();
  let finish: (value: unknown) => void = () => {};
  try {
    await open(screen);
    fireEvent.press(screen.getByLabelText("Select Private pasta"));
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.press(screen.getByLabelText("Share 1 recipe"));
    await screen.findByLabelText("Sharing...");
    expect(screen.getByLabelText("Close recipe sharing").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText("Search your recipes").props.editable).toBe(false);
    expect(screen.getByLabelText("Select Garden salad").props.accessibilityState.disabled).toBe(true);
    await act(async () => finish({ shared_count: 1, already_shared_count: 0, recipe_count: 1 }));
    await screen.findByText("1 recipe shared with Family dinners.");
  } finally { screen.close(); }
});

test("success feedback disappears after five seconds", async () => {
  jest.useFakeTimers();
  const screen = mount();
  try {
    await open(screen);
    fireEvent.press(screen.getByLabelText("Select Private pasta"));
    fireEvent.press(screen.getByLabelText("Share 1 recipe"));
    await screen.findByText("2 recipes shared with Family dinners.");
    act(() => jest.advanceTimersByTime(5000));
    expect(screen.queryByText("2 recipes shared with Family dinners.")).toBeNull();
  } finally { screen.close(); jest.useRealTimers(); }
});
