import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import DiscoverScreen from "@/app/(tabs)/index";
import { DISCOVER_CATEGORIES, discoverCategories, DiscoverSettings } from "@/features/discover/DiscoverSettings";
import { apiFetch } from "@/services/api";
import { openSettings } from "@/services/settingsMenu";
import type { Recipe, UserProfile } from "@/services/types";
import { usePlannerStore } from "@/stores/plannerStore";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/services/settingsMenu", () => ({ openSettings: jest.fn() }));
jest.mock("@/components/Screen", () => ({ Screen: ({ header, children }: { header: ReactNode; children: ReactNode }) => <>{header}{children}</> }));
jest.mock("@/components/BrandLogo", () => ({ BrandLogo: () => null }));
jest.mock("@/features/groups/SpaceSelector", () => ({ SpaceSelector: () => null }));
jest.mock("@/features/onboarding/TourTarget", () => ({ TourTarget: jest.requireActual("react-native").View }));
jest.mock("@/features/onboarding/TourContext", () => ({ useGuidedTour: () => null }));
jest.mock("@/features/recipes/RecipeDetailSheet", () => ({ RecipeDetailSheet: () => null }));
jest.mock("@/features/planner/useCurrentWeek", () => ({ useCurrentWeek: () => ({ data: { slots: [] }, isLoading: false, isError: false }) }));
jest.mock("@/features/groups/useSpace", () => ({ useSpace: () => ({
  key: mockGroupId ?? "personal", groupId: mockGroupId, canManage: true, isLoading: false, isError: false,
  group: mockGroupId ? { id: mockGroupId, name: "Family", is_personal: false, members: [] } : undefined
}) }));
jest.mock("@/features/discover/MealCard", () => ({ MealCard: jest.requireActual("react").forwardRef(({ recipe }: { recipe: Recipe }, _ref: unknown) => {
  const { Text } = jest.requireActual("react-native");
  return <Text>{recipe.name}</Text>;
}) }));

const request = jest.mocked(apiFetch);
const allCategories = DISCOVER_CATEGORIES.map(item => item.value);
const recipe: Recipe = {
  id: "soup", name: "Discover soup", servings: 2, difficulty: "easy", meal_type: "dinner", source_type: "manual",
  validation_status: "approved", validation_warnings: [], duplicate_status: "new", image_status: "missing",
  ingredients: [], instructions: [], tags: [], is_favorite: false, is_hidden: false
};
function makeProfile(categories?: string[]): UserProfile {
  return {
    email: "discover@example.com", household_size: 2, weekly_meal_target: 5, max_cook_minutes: null,
    difficulty_preference: null, dietary_preferences: [], allergens: [], disliked_ingredients: [],
    favorite_proteins: [], budget_preference: null, walmart_zip: null, preferred_grocery_retailer: "walmart",
    notification_preferences: { email: true }, ...(categories === undefined ? {} : { discover_preferences: { categories } })
  };
}
let profile: UserProfile;
let mockGroupId: string | undefined;
let saveFails: boolean;

beforeEach(() => {
  usePlannerStore.getState().resetSession();
  jest.clearAllMocks();
  mockGroupId = undefined;
  saveFails = false;
  profile = makeProfile();
  request.mockReset().mockImplementation(async (path, init) => {
    if (path === "/api/v1/profile") return profile;
    if (path === "/api/v1/profile/discover") {
      if (saveFails) throw new Error("Unable to save Discover filters");
      profile = { ...profile, discover_preferences: JSON.parse(String(init?.body)) };
      return profile;
    }
    if (path.startsWith("/api/v1/recipes?discover=true")) return [recipe];
    if (path.includes("/library?discover=true")) return { items: [{ recipe }], total: 1, enabled_count: 1 };
    throw new Error(`Unexpected request: ${path}`);
  });
});

function mount(child: ReactNode = <DiscoverSettings />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}>{child}</QueryClientProvider>);
  return { ...screen, client, close: () => { screen.unmount(); client.clear(); } };
}

async function ready(screen: ReturnType<typeof mount>) {
  await waitFor(() => expect(screen.getByLabelText("Discover Dinner").props.disabled).toBe(false));
}

test("legacy profiles default all eight category switches on, including Other", async () => {
  const screen = mount();
  try {
    await ready(screen);
    for (const item of DISCOVER_CATEGORIES) expect(screen.getByLabelText(`Discover ${item.label}`).props.value).toBe(true);
    expect(discoverCategories()).toEqual(allCategories);
    expect(discoverCategories(makeProfile())).toEqual(allCategories);
    expect(discoverCategories(makeProfile([]))).toEqual([]);
    expect(request.mock.calls.some(([, init]) => init?.method)).toBe(false);
  } finally { screen.close(); }
});

test("persisted selections render correctly and toggles PATCH only categories", async () => {
  profile = makeProfile(["dinner", "other"]);
  const screen = mount();
  try {
    await ready(screen);
    expect(screen.getByLabelText("Discover Breakfast").props.value).toBe(false);
    expect(screen.getByLabelText("Discover Other").props.value).toBe(true);
    fireEvent(screen.getByLabelText("Discover Beverages"), "valueChange", true);
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/profile/discover", {
      method: "PATCH", body: JSON.stringify({ categories: ["dinner", "beverage", "other"] })
    }));
    await waitFor(() => expect(screen.getByLabelText("Discover Beverages").props.value).toBe(true));
    expect(screen.client.getQueryData<UserProfile>(["profile"])?.notification_preferences).toEqual({ email: true });
    expect(request.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  } finally { screen.close(); }
});

test("turning the final category off saves an empty list rather than restoring defaults", async () => {
  profile = makeProfile(["dinner"]);
  const screen = mount();
  try {
    await ready(screen);
    fireEvent(screen.getByLabelText("Discover Dinner"), "valueChange", false);
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/profile/discover", { method: "PATCH", body: JSON.stringify({ categories: [] }) }));
    await waitFor(() => expect(screen.getByLabelText("Discover Dinner").props.value).toBe(false));
    for (const item of DISCOVER_CATEGORIES) expect(screen.getByLabelText(`Discover ${item.label}`).props.value).toBe(false);
  } finally { screen.close(); }
});

test("a save failure preserves saved selections and permits retry", async () => {
  profile = makeProfile(["dinner"]);
  saveFails = true;
  const screen = mount();
  try {
    await ready(screen);
    fireEvent(screen.getByLabelText("Discover Dinner"), "valueChange", false);
    await screen.findByText("Unable to save Discover filters");
    expect(screen.getByLabelText("Discover Dinner").props.value).toBe(true);
    await ready(screen);
    saveFails = false;
    fireEvent(screen.getByLabelText("Discover Dinner"), "valueChange", false);
    await waitFor(() => expect(screen.getByLabelText("Discover Dinner").props.value).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
  } finally { screen.close(); }
});

test("switches are disabled while the profile is loading or unavailable", async () => {
  let resolve: (value: UserProfile) => void = () => undefined;
  request.mockImplementation(() => new Promise<UserProfile>(done => { resolve = done; }));
  const screen = mount();
  try {
    for (const item of DISCOVER_CATEGORIES) expect(screen.getByLabelText(`Discover ${item.label}`).props.disabled).toBe(true);
    await act(async () => { resolve(profile); });
    await ready(screen);
    request.mockRejectedValue(new Error("Profile unavailable"));
    await act(async () => { await screen.client.invalidateQueries({ queryKey: ["profile"] }); });
    await screen.findByText("Profile unavailable");
    for (const item of DISCOVER_CATEGORIES) expect(screen.getByLabelText(`Discover ${item.label}`).props.disabled).toBe(true);
  } finally { screen.close(); }
});

test("pending saves disable switches until the server response updates the cache", async () => {
  profile = makeProfile(["dinner"]);
  let resolve: (value: UserProfile) => void = () => undefined;
  const screen = mount();
  try {
    await ready(screen);
    request.mockImplementation(() => new Promise<UserProfile>(done => { resolve = done; }));
    fireEvent(screen.getByLabelText("Discover Other"), "valueChange", true);
    await waitFor(() => expect(screen.getByLabelText("Discover Dinner").props.disabled).toBe(true));
    for (const item of DISCOVER_CATEGORIES) expect(screen.getByLabelText(`Discover ${item.label}`).props.disabled).toBe(true);
    await act(async () => { resolve(makeProfile(["dinner", "other"])); });
    await ready(screen);
    expect(screen.getByLabelText("Discover Other").props.value).toBe(true);
  } finally { screen.close(); }
});

test("successful saves invalidate Discover caches without invalidating libraries or group choices", async () => {
  profile = makeProfile(["dinner"]);
  const screen = mount();
  try {
    await ready(screen);
    const discoverKey = ["recipes", "discover", "personal", "dinner"];
    const libraryKey = ["recipes", "library"];
    const choicesKey = ["group-library", "family"];
    screen.client.setQueryDefaults(["recipes"], { gcTime: Infinity });
    screen.client.setQueryDefaults(["group-library"], { gcTime: Infinity });
    screen.client.setQueryData(discoverKey, [recipe]);
    screen.client.setQueryData(libraryKey, [recipe]);
    screen.client.setQueryData(choicesKey, { items: [{ recipe, enabled: true }] });
    const invalidate = jest.spyOn(screen.client, "invalidateQueries");
    fireEvent(screen.getByLabelText("Discover Other"), "valueChange", true);
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["recipes", "discover"] }));
    expect(screen.client.getQueryState(discoverKey)?.isInvalidated).toBe(true);
    expect(screen.client.getQueryState(libraryKey)?.isInvalidated).toBe(false);
    expect(screen.client.getQueryState(choicesKey)?.isInvalidated).toBe(false);
    expect(screen.client.getQueryData(choicesKey)).toEqual({ items: [{ recipe, enabled: true }] });
    expect(request.mock.calls.some(([path]) => path.includes("discover-choices"))).toBe(false);
  } finally { screen.close(); }
});

test.each([undefined, "family"])("active Discover uses filtered endpoints and refreshes after settings save (group=%s)", async groupId => {
  mockGroupId = groupId;
  profile = makeProfile(["dinner"]);
  const screen = mount(<><DiscoverSettings /><DiscoverScreen /></>);
  try {
    await screen.findByText("Discover soup");
    await ready(screen);
    const endpoint = groupId ? "/api/v1/households/family/library?discover=true&limit=100&offset=0" : "/api/v1/recipes?discover=true&limit=100&offset=0";
    expect(request).toHaveBeenCalledWith(endpoint);
    request.mockClear();
    fireEvent(screen.getByLabelText("Discover Beverages"), "valueChange", true);
    await waitFor(() => expect(request).toHaveBeenCalledWith(endpoint));
    await waitFor(() => expect(screen.getByLabelText("Discover Beverages").props.value).toBe(true));
    expect(screen.client.getQueryData(["recipes", "discover", groupId ?? "personal", "dinner,beverage"])).toEqual(expect.objectContaining({ recipes: [recipe] }));
    expect(request.mock.calls.some(([path]) => path.includes("discover-choices"))).toBe(false);
  } finally { screen.close(); }
});

test("empty category selections show a reachable settings action instead of recipes", async () => {
  profile = makeProfile([]);
  const screen = mount(<DiscoverScreen />);
  try {
    await screen.findByText("No categories selected");
    expect(screen.queryByText("Discover soup")).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Discover filters" }));
    expect(openSettings).toHaveBeenCalledWith({ section: "discover" });
  } finally { screen.close(); }
});
