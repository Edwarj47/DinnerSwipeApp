import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Share } from "react-native";
import { PremiumMacroPanel } from "@/features/premium/PremiumMacroPanel";
import { todayISO } from "@/features/premium/macroDates";
import { apiFetch } from "@/services/api";
import { GRAMS_PER_OUNCE } from "@/services/weightUnits";
import { useOfflineStatus } from "@/services/offlineStore";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn(), savedMessage: (message: string) => message }));
jest.mock("react-native-calendars", () => ({ Calendar: ({ onDayPress }: { onDayPress: (day: { dateString: string }) => void }) => {
  const { Button } = jest.requireActual("react-native");
  return <Button title="Pick leap day" onPress={() => onDayPress({ dateString: "2024-02-29" })} />;
} }));
const request = jest.mocked(apiFetch);
const totals = { calories: 500, protein_g: 30, carbs_g: 10, fat_g: 5, fiber_g: 2 };
const analytics = { days: 30, start_date: "2026-09-01", end_date: "2026-09-30", totals, averages: totals,
  targets: {}, days_logged: 1, daily_totals: [
    { meal_date: "2026-09-27", calories: 0, entry_count: 0 },
    { meal_date: "2026-09-28", calories: 500, entry_count: 1 }
  ] };

beforeEach(() => {
  useOfflineStatus.setState({ offline: false });
  request.mockReset().mockImplementation(async (path, init) => {
    if (path.includes("subscription/status")) return { premium_active: true, current_tier: "premium", plans: [] };
    if (path.includes("/summary")) return { start_date: "2026-09-22", end_date: "2026-09-28", eaten_meals: 1, totals };
    if (path.includes("/targets")) return {};
    if (path.includes("/analytics")) return analytics;
    if (path.includes("/export")) return { analytics, entries: [] };
    if (path.includes("/entries")) return init?.method === "POST" ? { id: "new-entry" } : [];
    return {};
  });
});

test("Save as recipe preserves the form, canonical grams and zero values without logging twice", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (path, init) => path === "/api/v1/profile"
    ? { notification_preferences: { protein_unit: "oz" } } : original(path, init));
  const screen = mount();
  try {
    await screen.findByLabelText("Protein ounces");
    expect(screen.getByLabelText("Save as recipe").props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText("Entry name"), "Protein shake");
    fireEvent.press(screen.getByText("Beverages", { exact: true }));
    fireEvent.changeText(screen.getByLabelText("Calories"), "160");
    fireEvent.changeText(screen.getByLabelText("Protein ounces"), "1");
    fireEvent.changeText(screen.getByLabelText("Fat grams"), "0");
    fireEvent.changeText(screen.getByLabelText("Entry notes"), "My shake");
    fireEvent.press(screen.getByLabelText("Save as recipe"));
    await screen.findByText("Recipe saved with nutrition for one serving.");
    const call = request.mock.calls.find(([path, init]) => path === "/api/v1/recipes" && init?.method === "POST")!;
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({ name: "Protein shake", description: "My shake", servings: 1,
      meal_type: "beverage", nutrition: { calories: 160, protein_g: 28.35, fat_g: 0, carbs_g: null, fiber_g: null } });
    expect(request.mock.calls.some(([path, init]) => path.endsWith("/entries") && init?.method === "POST")).toBe(false);
    expect(screen.getByLabelText("Entry name").props.value).toBe("Protein shake");
    expect(screen.getByLabelText("Recipe saved").props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText("Entry name"), "Protein smoothie");
    expect(screen.getByLabelText("Save as recipe").props.accessibilityState.disabled).toBe(false);
  } finally { screen.close(); }
});

test("recipe-save errors preserve the form and offline recipe creation is disabled", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (path, init) => {
    if (path === "/api/v1/recipes") throw new Error("Recipe save failed");
    return original(path, init);
  });
  const screen = mount();
  try {
    await screen.findByLabelText("Entry name");
    fireEvent.changeText(screen.getByLabelText("Entry name"), "My soup");
    fireEvent.press(screen.getByLabelText("Save as recipe"));
    await screen.findByText("Recipe save failed");
    expect(screen.getByLabelText("Entry name").props.value).toBe("My soup");
    act(() => useOfflineStatus.setState({ offline: true }));
    expect(screen.getByLabelText("Save as recipe").props.accessibilityState.disabled).toBe(true);
  } finally { screen.close(); useOfflineStatus.setState({ offline: false }); }
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}><PremiumMacroPanel /></QueryClientProvider>);
  return { ...screen, close: () => { screen.unmount(); client.clear(); } };
}

test("macro success is transient, invalid dates do not query, and errors stay visible", async () => {
  jest.useFakeTimers();
  const screen = mount();
  try {
    await screen.findByLabelText("Entry name");
    expect(screen.getByText("Last 7 days")).toBeTruthy();
    expect(screen.queryByText("Testing access code")).toBeNull();
    fireEvent.changeText(screen.getByLabelText("Entry name"), "Breakfast oats");
    fireEvent.press(screen.getByText("Breakfast"));
    fireEvent.changeText(screen.getByLabelText("Calories"), "250");
    fireEvent.press(screen.getByLabelText("Add"));
    await screen.findByText("Macro entry added.");
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(screen.queryByText("Macro entry added.")).toBeNull();
    fireEvent.changeText(screen.getByLabelText("Macro date"), "2026-09-");
    expect(screen.getByText("Enter a date as YYYY-MM-DD.")).toBeTruthy();
    expect(request.mock.calls.some(([path]) => path.includes("start_date=2026-09-&"))).toBe(false);
    fireEvent.changeText(screen.getByLabelText("Macro date"), todayISO());
    fireEvent.changeText(screen.getByLabelText("Entry name"), "Error fixture");
    request.mockRejectedValue(new Error("Save failed, retry."));
    fireEvent.press(screen.getByLabelText("Add"));
    await screen.findByText("Save failed, retry.");
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(screen.getByText("Save failed, retry.")).toBeTruthy();
  } finally { screen.close(); }
}, 20_000);

test("date popup loads the exact historic day and calendar filters hide empty days", async () => {
  const screen = mount();
  try {
    await screen.findByLabelText("Choose macro date");
    fireEvent.press(screen.getByLabelText("Choose macro date"));
    fireEvent.press(screen.getByText("Pick leap day"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/macros/entries?start_date=2024-02-29&end_date=2024-02-29"));
    expect(screen.queryByText("Choose date")).toBeNull();
    fireEvent.press(screen.getByText("Calendar", { exact: true }));
    await screen.findByLabelText("2026-09-27: 0 calories, 0 entries");
    expect(screen.getByText("Cal", { exact: true })).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Filter days: All days"));
    fireEvent.press(screen.getByLabelText("Logged days"));
    expect(screen.queryByLabelText("2026-09-27: 0 calories, 0 entries")).toBeNull();
    fireEvent.press(screen.getByLabelText("2026-09-28: 500 calories, 1 entries"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/macros/entries?start_date=2026-09-28&end_date=2026-09-28"));
  } finally { screen.close(); }
});

test("all-time Trends and its export use the same selected period", async () => {
  const share = jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction });
  const screen = mount();
  try {
    await screen.findByText("Trends");
    fireEvent.press(screen.getByText("Trends"));
    await screen.findByText("30-day analytics");
    fireEvent.press(screen.getByLabelText("Analytics period: Last 30 days"));
    fireEvent.press(screen.getByLabelText("All time"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/macros/analytics?all_time=true"));
    await screen.findByText("All-time analytics");
    await waitFor(() => expect(screen.getByLabelText("Export analytics").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByLabelText("Export analytics"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/macros/export?all_time=true"));
    await waitFor(() => expect(share).toHaveBeenCalled());
  } finally { screen.close(); }
});

test("summary period persists across mounts without overwriting other preferences", async () => {
  let profile = { notification_preferences: { macro_summary_days: 14, confirm_plan_reset: false }, household_size: 2 };
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (path, init) => {
    if (path === "/api/v1/profile") {
      if (init?.method === "PUT") profile = JSON.parse(String(init.body));
      return { ...profile };
    }
    return original(path, init);
  });
  const screen = mount();
  try {
    await screen.findByLabelText("Summary period: Last 14 days");
    await waitFor(() => expect(request).toHaveBeenCalledWith(`/api/v1/macros/summary?days=14&end_date=${todayISO()}`));
    fireEvent.press(screen.getByLabelText("Summary period: Last 14 days"));
    fireEvent.changeText(screen.getByLabelText("Summary days"), "21");
    fireEvent.press(screen.getByLabelText("Apply summary period"));
    await waitFor(() => expect(profile.notification_preferences.macro_summary_days).toBe(21));
    expect(profile.notification_preferences.confirm_plan_reset).toBe(false);
    await waitFor(() => expect(request).toHaveBeenCalledWith(`/api/v1/macros/summary?days=21&end_date=${todayISO()}`));
  } finally { screen.close(); }
  const again = mount();
  try { await again.findByLabelText("Summary period: Last 21 days"); }
  finally { again.close(); }
});

test("macro ounce inputs and targets submit grams while calories remain unchanged", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (path, init) => path === "/api/v1/profile"
    ? { notification_preferences: { protein_unit: "oz", fiber_unit: "oz" } } : original(path, init));
  const screen = mount();
  try {
    await screen.findByLabelText("Protein ounces");
    expect(screen.getByText("1.058 oz")).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Entry name"), "Shake");
    fireEvent.changeText(screen.getByLabelText("Calories"), "160");
    fireEvent.changeText(screen.getByLabelText("Protein ounces"), "1");
    fireEvent.changeText(screen.getByLabelText("Fat grams"), "0");
    expect(screen.getByLabelText("Carbs grams")).toBeTruthy();
    expect(screen.getByLabelText("Fiber ounces")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Add"));
    await screen.findByText("Macro entry added.");
    const entry = JSON.parse(String(request.mock.calls.find(([path, init]) => path.endsWith("/entries") && init?.method === "POST")![1]?.body));
    expect(entry).toMatchObject({ calories: 160, protein_g: GRAMS_PER_OUNCE, fat_g: 0, carbs_g: null });
    fireEvent.changeText(screen.getByLabelText("Daily protein target"), "5");
    fireEvent.changeText(screen.getByLabelText("Daily calories target"), "2000");
    fireEvent.press(screen.getByLabelText("Save targets"));
    await waitFor(() => expect(request.mock.calls.some(([path, init]) => path.endsWith("/targets") && init?.method === "PUT")).toBe(true));
    const target = JSON.parse(String(request.mock.calls.find(([path, init]) => path.endsWith("/targets") && init?.method === "PUT")![1]?.body));
    expect(target).toMatchObject({ daily_protein_g: 5 * GRAMS_PER_OUNCE, daily_calories: 2000 });
  } finally { screen.close(); }
});
