import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { MacroAnalyticsPanel } from "@/features/premium/MacroAnalyticsPanel";
import { analyticsDays, trendBuckets } from "@/features/premium/analytics";
import { apiFetch } from "@/services/api";
import { MacroDayTotal } from "@/services/types";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
const request = jest.mocked(apiFetch);
const day = (date: string, calories: number, protein = 0): MacroDayTotal => ({ meal_date: date, calories, protein_g: protein,
  carbs_g: 0, fat_g: 0, fiber_g: 0, entry_count: calories ? 1 : 0, eaten_meals: calories ? 1 : 0, skipped_meals: 0 });

test("trend buckets order without mutation, preserve zero days and flag incomplete nutrition", () => {
  const rows = [day("2026-10-03", 300, 30), day("2026-10-01", 100, 10), day("2026-10-02", 0)];
  expect(trendBuckets(rows, 2)).toEqual([
    { start: "2026-10-01", end: "2026-10-02", days: 2, calories: 50, protein_g: 5 },
    { start: "2026-10-03", end: "2026-10-03", days: 1, calories: 300, protein_g: 30 }
  ]);
  expect(rows[0].meal_date).toBe("2026-10-03");
  expect(trendBuckets([{ ...rows[0], nutrition_unavailable_count: 1 }])[0].calories).toBeNull();
  expect(trendBuckets([])).toEqual([]);
});
test("analytics days validate persisted preferences", () => {
  for (const invalid of [undefined, 0, -2, 367, 1.5, "invalid"]) expect(analyticsDays(invalid)).toBe(30);
  expect(analyticsDays(365)).toBe(365);
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}><MacroAnalyticsPanel /></QueryClientProvider>);
  return { ...screen, close: () => { screen.unmount(); client.clear(); } };
}
beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (path, init) => {
    if (path === "/api/v1/profile") return init?.method === "PUT" ? JSON.parse(String(init.body)) : {
      household_size: 2, allergens: [], disliked_ingredients: [], notification_preferences: { macro_analytics_days: 14, protein_unit: "oz", other_setting: true }
    };
    return { days: 14, start_date: "2026-09-25", end_date: "2026-10-08", days_logged: 2, eaten_meals: 2,
      targets: { daily_calories: 2000, daily_protein_g: 100 }, averages: { calories: 100, protein_g: 28.349523125, carbs_g: 5, fat_g: 5, fiber_g: 1 },
      daily_totals: [day("2026-10-07", 100, 28.349523125), day("2026-10-08", 100, 28.349523125)] };
  });
});
test("analytics loads charts, honors units, and persists a custom period without replacing other preferences", async () => {
  const screen = mount();
  try {
    await screen.findByTestId("analytics-chart-calories");
    expect(screen.getByTestId("analytics-chart-protein_g")).toBeTruthy();
    expect(screen.getByText("Last 14 days")).toBeTruthy();
    expect(screen.getByText("1 oz")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Summary period: Last 14 days"));
    fireEvent.changeText(screen.getByLabelText("Summary days"), "21");
    fireEvent.press(screen.getByLabelText("Apply summary period"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v1/profile", expect.objectContaining({ method: "PUT", body: expect.stringContaining('"macro_analytics_days":21') })));
    const write = request.mock.calls.find(([path, init]) => path === "/api/v1/profile" && init?.method === "PUT");
    expect(JSON.parse(String(write?.[1]?.body)).notification_preferences).toMatchObject({ other_setting: true, macro_analytics_days: 21, protein_unit: "oz" });
  } finally { screen.close(); }
});
test("empty analytics stays useful without presenting fabricated charts", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (path, init) => path.includes("/macros/analytics") ? { days_logged: 0, eaten_meals: 0, averages: {}, daily_totals: [] } : original(path, init));
  const screen = mount();
  try {
    await screen.findByText("No entries in this period");
    expect(screen.queryByTestId("analytics-chart-calories")).toBeNull();
  } finally { screen.close(); }
});
