import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { StyleProp, StyleSheet, ViewStyle } from "react-native";
import DiscoverScreen from "@/app/(tabs)/index";
import WeekScreen from "@/app/(tabs)/week";
import { GroupPlanningPanel } from "@/features/groups/GroupPlanningPanel";
import { SpaceSelector } from "@/features/groups/SpaceSelector";
import { apiFetch } from "@/services/api";
import { Household, Recipe } from "@/services/types";
import { usePlannerStore } from "@/stores/plannerStore";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({ push: jest.fn() }), useFocusEffect: () => undefined }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/components/Screen", () => ({ Screen: ({ header, children }: { header: React.ReactNode; children: React.ReactNode }) => <>{header}{children}</> }));
jest.mock("@/features/recipes/RecipeDetailSheet", () => ({ RecipeDetailSheet: () => null }));
jest.mock("@/features/groups/GroupRecipeSharing", () => ({ GroupRecipeSharing: () => null }));
jest.mock("@/features/recipes/RecipePicker", () => ({ RecipePicker: () => null }));
jest.mock("@/features/planner/WeekDrag", () => ({ WeekDrag: jest.requireActual("react-native").View, WeekDropDay: jest.requireActual("react-native").View, WeekDropMeal: jest.requireActual("react-native").View, WeekDragHandle: () => null }));
jest.mock("@/features/discover/MealCard", () => ({ MealCard: jest.requireActual("react").forwardRef(({ proposing, onAction }: { proposing: boolean; onAction: (action: string) => void }, _ref: unknown) => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return <Pressable accessibilityLabel={proposing ? "Propose swipe" : "Plan swipe"} onPress={() => onAction("add")}><Text>Recipe card</Text></Pressable>;
}) }));

const request = jest.mocked(apiFetch);
const group: Household = { id: "family", name: "Family", is_personal: false, invite_code: "ABCDEFGH", current_user_role: "owner", members: [], allergen_filter_mode: "warn", dislike_filter_mode: "warn" };
const recipe: Recipe = { id: "lentils", name: "Shared lentils", servings: 2, difficulty: "easy", meal_type: "dinner", source_type: "manual", validation_status: "approved", validation_warnings: [], duplicate_status: "new", image_status: "missing", ingredients: [], instructions: [], tags: [], is_favorite: false, is_hidden: false };
const plan = { id: "group-week", household_id: "family", week_start: "2026-10-05", slots: [{ id: "slot", recipe_id: "lentils", recipe_name: "Shared lentils", slot_date: "2026-10-05", servings: 6, slot_type: "meal", sort_order: 0 }] };
let selected: Household;
let enabled: boolean;
let failSave: boolean;
beforeEach(() => {
  usePlannerStore.getState().resetSession();
  selected = { ...group };
  enabled = false;
  failSave = false;
  request.mockReset().mockImplementation(async (path, init) => {
    if (path === "/api/v1/households/current") return selected;
    if (path === "/api/v1/households") return [selected, { ...group, id: "kitchen", name: "My Kitchen", is_personal: true }];
    if (path.endsWith("/kitchen/switch")) return { ...group, id: "kitchen", name: "My Kitchen", is_personal: true };
    if (path.includes("/discover-choices")) { if (failSave) throw new Error("Connection unavailable"); enabled = true; return { status: "saved" }; }
    if (path.includes("/library")) return { items: [{ recipe, enabled, is_blocked: false, warning_labels: [] }], total: 1, enabled_count: enabled ? 1 : 0 };
    if (path.endsWith("/proposals")) return { week_start: "2026-10-05", items: [] };
    if (path.includes("weekly-plans")) return plan;
    if (path.includes("subscription/status")) return { premium_active: true };
    if (path.endsWith("/macros/confirmations")) return { id: "log", ...JSON.parse(String(init?.body)) };
    return {};
  });
});

function mount(child: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}>{child}</QueryClientProvider>);
  return { ...screen, client, close: () => { screen.unmount(); client.clear(); } };
}

test("owners curate existing shared recipes and retain selections after a save failure", async () => {
  const screen = mount(<GroupPlanningPanel household={group} />);
  try {
    expect(screen.queryByText("Vote this week")).toBeNull();
    fireEvent.press(screen.getByLabelText("Discover choices"));
    const checkbox = await screen.findByRole("checkbox", { name: "Shared lentils" });
    expect(checkbox.props.accessibilityState.checked).toBe(false);
    fireEvent.press(checkbox);
    failSave = true;
    fireEvent.press(screen.getByLabelText("Save choices"));
    await screen.findByText("Connection unavailable");
    expect(screen.getByRole("checkbox", { name: "Shared lentils" }).props.accessibilityState.checked).toBe(true);
    failSave = false;
    fireEvent.press(screen.getByLabelText("Save choices"));
    await screen.findByText("Discover choices saved.");
    expect(request).toHaveBeenCalledWith("/api/v1/households/family/discover-choices", expect.objectContaining({ body: JSON.stringify({ enable_ids: ["lentils"], disable_ids: [], bulk_action: null, q: "" }) }));
  } finally { screen.close(); }
});

test("member views omit owner curation and review controls", async () => {
  const screen = mount(<GroupPlanningPanel household={{ ...group, current_user_role: "member" }} />);
  try {
    await screen.findByText("No proposals this week.");
    expect(screen.queryByLabelText("Discover choices")).toBeNull();
    expect(screen.queryByLabelText("Approve")).toBeNull();
    expect(screen.queryByLabelText("Request another recipe")).toBeTruthy();
  } finally { screen.close(); }
});

test("bulk selection preserves unsaved choices outside the current search", async () => {
  request.mockImplementation(async (path) => {
    if (path.includes("/proposals")) return { week_start: "2026-10-05", items: [] };
    if (path.includes("/library")) {
      const searched = path.includes("q=Soup");
      return { items: [{ recipe: searched ? { ...recipe, id: "soup", name: "Soup" } : recipe, enabled: false, is_blocked: false, warning_labels: [] }], total: 1, enabled_count: 0 };
    }
    return {};
  });
  const screen = mount(<GroupPlanningPanel household={group} />);
  try {
    fireEvent.press(screen.getByLabelText("Discover choices"));
    fireEvent.press(await screen.findByRole("checkbox", { name: "Shared lentils" }));
    fireEvent.changeText(screen.getByLabelText("Search group recipes"), "Soup");
    await screen.findByRole("checkbox", { name: "Soup" });
    fireEvent.press(screen.getByLabelText("Select all matches"));
    expect(screen.getByRole("checkbox", { name: "Soup" }).props.accessibilityState.checked).toBe(true);
    fireEvent.press(screen.getByLabelText("Save choices"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/households/family/discover-choices", expect.objectContaining({ body: JSON.stringify({ enable_ids: ["lentils"], disable_ids: [], bulk_action: "enable", q: "Soup" }) })));
  } finally { screen.close(); }
});

test("kitchen selector searches and persists the selected kitchen through the existing switch API", async () => {
  const screen = mount(<SpaceSelector label="Swiping for" />);
  try {
    fireEvent.press(await screen.findByLabelText("Swiping for: Family"));
    await screen.findByText("My Kitchen");
    expect(screen.getByText("Choose a group")).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Search groups"), "my");
    fireEvent.press(screen.getByRole("radio", { name: "My Kitchen" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/households/kitchen/switch", { method: "POST" }));
  } finally { screen.close(); }
});

test("Profile default picker keeps the default separate from the active group", async () => {
  const defaults = [{ ...group, is_default: true }, { ...group, id: "kitchen", name: "My Kitchen", is_personal: true, is_default: false }];
  selected = defaults[1];
  request.mockImplementation(async (path) => {
    if (path === "/api/v1/households/current") return selected;
    if (path === "/api/v1/households") return defaults;
    if (path.endsWith("/kitchen/default")) {
      defaults[0].is_default = false;
      defaults[1].is_default = true;
      return defaults[1];
    }
    return {};
  });
  const screen = mount(<SpaceSelector label="Default group" purpose="default" />);
  try {
    fireEvent.press(await screen.findByLabelText("Default group: Family"));
    expect(screen.getByRole("radio", { name: "Family" }).props.accessibilityState.checked).toBe(true);
    fireEvent.press(screen.getByRole("radio", { name: "My Kitchen" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/households/kitchen/default", { method: "POST" }));
  } finally { screen.close(); }
});

test.each(["owner", "member"])("empty group Discover shows owner details and a reachable picker for %s", async role => {
  selected = { ...group, current_user_role: role, owner: { id: "owner", email: "owner@example.com", name: "Alex" } };
  request.mockImplementation(async path => {
    if (path === "/api/v1/households/current") return selected;
    if (path === "/api/v1/households") return [selected];
    if (path.includes("/library")) return { items: [], total: 0 };
    if (path.includes("weekly-plans")) return { ...plan, slots: [] };
    return {};
  });
  const screen = mount(<DiscoverScreen />);
  try {
    await screen.findByText("No recipes selected yet");
    expect(screen.getByText("Group owner: Alex")).toBeTruthy();
    expect(screen.getByText("owner@example.com")).toBeTruthy();
    const target = screen.getByTestId("tour-target-discover");
    expect(StyleSheet.flatten(target.props.style).flexGrow).toBe(1);
    const wrappers: { props: { style?: StyleProp<ViewStyle> } }[] = target.findAllByType(jest.requireActual("react-native").View);
    expect(wrappers.some(view => view !== target && StyleSheet.flatten(view.props.style)?.flexGrow === 1)).toBe(true);
    expect(Boolean(screen.queryByLabelText("Choose recipes"))).toBe(role === "owner");
    fireEvent.press(screen.getByLabelText("Swiping for: Family"));
    await screen.findByText("Choose a group");
    expect(screen.getByLabelText("Search groups")).toBeTruthy();
  } finally { screen.close(); }
});

test("empty group never invents an owner's name and retains the email from legacy metadata", async () => {
  selected = { ...group, members: [{ id: "owner", role: "owner", email: "owner@example.com" }] };
  request.mockImplementation(async path => {
    if (path === "/api/v1/households/current") return selected;
    if (path.includes("/library")) return { items: [], total: 0 };
    if (path.includes("weekly-plans")) return { ...plan, slots: [] };
    return {};
  });
  const screen = mount(<DiscoverScreen />);
  try {
    await screen.findByText("No recipes selected yet");
    expect(screen.getByText("Group owner")).toBeTruthy();
    expect(screen.getByText("owner@example.com")).toBeTruthy();
  } finally { screen.close(); }
});

test("shared calendar is read-only for members and personal consumption defaults to one portion", async () => {
  selected.current_user_role = "member";
  const screen = mount(<WeekScreen />);
  try {
    fireEvent.press(await screen.findByLabelText("Log"));
    expect(screen.queryByLabelText("Reset")).toBeNull();
    expect(screen.queryByLabelText("Increase servings")).toBeNull();
    expect(screen.queryByLabelText("Duplicate Shared lentils")).toBeNull();
    fireEvent.press(screen.getByLabelText("Ate"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/macros/confirmations", expect.objectContaining({ body: JSON.stringify({ recipe_id: "lentils", weekly_plan_slot_id: "slot", meal_date: "2026-10-05", status: "ate", servings_consumed: 1 }) })));
    expect(request.mock.calls.some(([path, init]) => path.includes("weekly-plans") && init?.method)).toBe(false);
  } finally { screen.close(); }
});

test("week waits for kitchen resolution before fetching a plan or offering changes", async () => {
  let resolveKitchen: (household: Household) => void = () => undefined;
  const kitchen = new Promise<Household>(resolve => { resolveKitchen = resolve; });
  request.mockImplementation(async path => {
    if (path === "/api/v1/households/current") return kitchen;
    if (path.includes("subscription/status")) return { premium_active: true };
    if (path.includes("weekly-plans")) return plan;
    return {};
  });
  const screen = mount(<WeekScreen />);
  try {
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/households/current"));
    expect(screen.queryByLabelText("Reset")).toBeNull();
    expect(request.mock.calls.some(([path]) => path.includes("weekly-plans"))).toBe(false);
    resolveKitchen(group);
    await screen.findByLabelText("Edit");
    expect(request).toHaveBeenCalledWith("/api/v1/households/family/weekly-plans/current");
    expect(request.mock.calls.some(([path]) => path === "/api/v1/weekly-plans/current")).toBe(false);
  } finally { screen.close(); }
});

test("member Discover uses only the group library and captures the original group in its proposal", async () => {
  selected.current_user_role = "member";
  request.mockImplementation(async (path) => {
    if (path === "/api/v1/households/current") return selected;
    if (path.includes("/library")) return { items: [{ recipe }], total: 1 };
    if (path.includes("weekly-plans")) return { ...plan, slots: [] };
    return {};
  });
  const screen = mount(<DiscoverScreen />);
  try {
    fireEvent.press(await screen.findByLabelText("Propose swipe"));
    await waitFor(() => expect(request.mock.calls.some(([path, init]) => path === "/api/v1/recipes/swipes" && JSON.parse(String(init?.body)).household_id === "family")).toBe(true));
    expect(request.mock.calls.some(([path]) => path.startsWith("/api/v1/recipes?"))).toBe(false);
  } finally { screen.close(); }
});
