import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { UserSettingsPanel } from "@/features/settings/UserSettingsPanel";
import { apiFetch } from "@/services/api";
import { GRAMS_PER_OUNCE } from "@/services/weightUnits";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: jest.requireActual("react-native").Image }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/services/biometrics", () => ({ getBiometricSettings: async () => ({ enabled: false }) }));
jest.mock("@/features/subscription/SubscriptionPanel", () => ({ SubscriptionPanel: () => null }));
jest.mock("@/features/discover/DiscoverSettings", () => ({ DiscoverSettings: () => null }));
jest.mock("@/features/workouts/WorkoutSettings", () => ({ WorkoutSettings: () => null }));
jest.mock("@/features/onboarding/TourTarget", () => ({ TourTarget: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const request = jest.mocked(apiFetch);
beforeEach(() => {
  jest.clearAllMocks();
  request.mockImplementation(async (path, init) => {
    if (path === "/api/v1/auth/status") return { email: "premium@example.test", email_verified: true, content_automation_enabled: false };
    if (path === "/api/v1/subscription/status") return { active: true, premium_active: true };
    if (path === "/api/v1/profile") return { household_size: 2, allergens: [], disliked_ingredients: [], notification_preferences: { protein_unit: "oz" } };
    if (path === "/api/v1/macros/targets") return init?.method === "PUT" ? JSON.parse(String(init.body)) : { daily_calories: 2000, daily_protein_g: 180, goal: "My goal" };
    throw new Error(`Unexpected request: ${path}`);
  });
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}><UserSettingsPanel /></QueryClientProvider>);
  return { ...screen, client, close: () => { screen.unmount(); client.clear(); } };
}

test("opening Premium Macro settings immediately shows targets and Save without another accordion", async () => {
  const screen = mount();
  try {
    expect(screen.queryByLabelText("Daily calories target")).toBeNull();
    expect(screen.queryByLabelText("Save targets")).toBeNull();
    const open = await screen.findByLabelText("Expand Macro settings");
    expect(request.mock.calls.some(([path]) => path === "/api/v1/macros/targets")).toBe(false);
    fireEvent.press(open);
    for (const label of ["Daily calories target", "Daily protein target", "Daily carbs target", "Daily fat target", "Macro goal", "Save targets"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.queryByLabelText("Expand Macro targets")).toBeNull();
    expect(screen.queryByLabelText("Collapse Macro targets")).toBeNull();
    await waitFor(() => expect(screen.getByLabelText("Macro goal").props.value).toBe("My goal"));
    await screen.findByText("Protein (oz)");
    await waitFor(() => expect(screen.getByLabelText("Save targets").props.accessibilityState.disabled).toBe(false));
    fireEvent.changeText(screen.getByLabelText("Daily protein target"), "5");
    fireEvent.press(screen.getByLabelText("Save targets"));
    await screen.findByText("Macro targets saved.");
    const call = request.mock.calls.find(([path, init]) => path.endsWith("/targets") && init?.method === "PUT")!;
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({ daily_protein_g: 5 * GRAMS_PER_OUNCE, daily_calories: 2000, goal: "My goal" });
    expect(screen.queryByText("Daily additions")).toBeNull();
    expect(request.mock.calls.some(([path]) => path.startsWith("/api/v1/content-automation"))).toBe(false);
  } finally { screen.close(); }
});

test.each([false, true])("non-Premium settings keep targets hidden with active subscription %s", async active => {
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, init) => path === "/api/v1/subscription/status" ? Promise.resolve({ active, premium_active: false }) : original(path, init));
  const screen = mount();
  try {
    await waitFor(() => expect(screen.client.getQueryState(["subscription-status"])?.status).toBe("success"));
    expect(screen.queryByLabelText("Expand Macro settings")).toBeNull();
    expect(screen.queryByLabelText("Daily calories target")).toBeNull();
    expect(screen.queryByLabelText("Save targets")).toBeNull();
    expect(request.mock.calls.some(([path]) => path === "/api/v1/macros/targets")).toBe(false);
    expect(screen.getByLabelText("Expand Account")).toBeTruthy();
    expect(screen.getByLabelText("Expand Meals")).toBeTruthy();
    expect(screen.getByLabelText("Expand Discover")).toBeTruthy();
  } finally { screen.close(); }
});
