import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import WeekScreen from "@/app/(tabs)/week";
import DiscoverScreen from "@/app/(tabs)/index";
import { apiFetch } from "@/services/api";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }), useLocalSearchParams: () => ({}) }));
jest.mock("@/components/BrandLogo", () => ({ BrandLogo: () => null }));
jest.mock("@/components/Screen", () => ({ Screen: ({ header, children }: { header: React.ReactNode; children: React.ReactNode }) => <>{header}{children}</> }));
jest.mock("@/features/planner/WeekDrag", () => ({
  WeekDrag: jest.requireActual("react-native").View,
  WeekDropDay: jest.requireActual("react-native").View,
  WeekDropMeal: jest.requireActual("react-native").View,
  WeekDragHandle: () => null
}));
jest.mock("@/features/recipes/RecipePicker", () => ({ RecipePicker: () => null }));
jest.mock("@/features/recipes/RecipeDetailSheet", () => ({ RecipeDetailSheet: () => null }));
jest.mock("@/features/onboarding/OnboardingNextStepCard", () => ({ OnboardingNextStepCard: () => null }));
jest.mock("@/features/discover/MealCard", () => ({ MealCard: jest.requireActual("react").forwardRef(() => {
  const { Text } = jest.requireActual("react-native");
  return <Text>Next dinner to swipe</Text>;
}) }));
jest.mock("@/features/planner/useCurrentWeek", () => ({ plannerContextKey: jest.requireActual("@/features/planner/useCurrentWeek").plannerContextKey, useCurrentWeek: () => ({ data: {
  id: "week", week_start: "2026-09-28", meal_target: 1, slots: [
    { id: "slot", slot_date: "2026-09-28", slot_type: "meal", recipe_id: "planned", recipe_name: "Planned meal", servings: 2, sort_order: 0 }
  ]
} }) }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));

const request = jest.mocked(apiFetch);
let confirmation: boolean | undefined;
beforeEach(() => {
  confirmation = undefined;
  request.mockReset().mockImplementation(async (path) => {
    if (path === "/api/v1/households/current") return { id: "kitchen", name: "My Kitchen", is_personal: true, current_user_role: "owner" };
    if (path === "/api/v1/profile") return { notification_preferences: { confirm_plan_reset: confirmation } };
    if (path.includes("subscription")) return { premium_active: true };
    if (path.includes("recipes")) return [{ id: "unplanned", name: "Another dinner", is_hidden: false }];
    return { slots: [] };
  });
});

function mount(child: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}>{child}</QueryClientProvider>);
  return { ...screen, client, close: () => { screen.unmount(); client.clear(); } };
}

test("reset confirmation defaults on for existing accounts", async () => {
  const screen = mount(<WeekScreen />);
  try {
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/profile"));
    fireEvent.press(await screen.findByLabelText("Reset Monday"));
    await screen.findByText("Reset monday?");
    expect(request.mock.calls.some(([path]) => path.endsWith("/reset"))).toBe(false);
    fireEvent.press(screen.getByLabelText("Cancel"));
    expect(request.mock.calls.some(([path]) => path.endsWith("/reset"))).toBe(false);
  } finally { screen.close(); }
}, 20_000);

test.each([['Reset Monday', '2026-09-28'], ['Reset week', null]])("disabled warning resets the correct scope: %s", async (button, date) => {
  confirmation = false;
  const screen = mount(<WeekScreen />);
  try {
    await waitFor(() => expect(screen.client.getQueryData(["profile"])).toEqual({ notification_preferences: { confirm_plan_reset: false } }));
    fireEvent.press(screen.getByLabelText(button));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/weekly-plans/current/reset", {
      method: "POST", body: JSON.stringify({ slot_date: date })
    }));
    expect(screen.queryByText("Confirm reset")).toBeNull();
  } finally { screen.close(); }
});

test("Discover continues offering recipes beyond the old weekly goal", async () => {
  const screen = mount(<DiscoverScreen />);
  try {
    await screen.findByText("Next dinner to swipe");
    expect(screen.getByText("1 meal planned")).toBeTruthy();
    expect(screen.queryByText("Your dinner slots are filled.")).toBeNull();
  } finally { screen.close(); }
});
