import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Share } from "react-native";
import { PremiumMacroPanel } from "@/features/premium/PremiumMacroPanel";
import { todayISO } from "@/features/premium/macroDates";
import { apiFetch } from "@/services/api";

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
    await act(async () => { jest.advanceTimersByTime(3600); });
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
