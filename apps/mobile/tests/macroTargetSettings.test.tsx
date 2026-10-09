import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { MacroTargetSettings } from "@/features/premium/MacroTargetSettings";
import { SettingsSection } from "@/features/settings/SettingsSection";
import { apiFetch } from "@/services/api";
import { GRAMS_PER_OUNCE } from "@/services/weightUnits";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
const request = jest.mocked(apiFetch);
test("targets stay collapsed and preserve grams, goal and the existing endpoint", async () => {
  request.mockImplementation(async (path, init) => path === "/api/v1/profile" ? { notification_preferences: { protein_unit: "oz" } } :
    init?.method === "PUT" ? JSON.parse(String(init.body)) : { daily_calories: 2000, daily_protein_g: 180, goal: "My goal" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}><SettingsSection title="Macro targets" icon="flag-outline"><MacroTargetSettings /></SettingsSection></QueryClientProvider>);
  try {
    expect(screen.queryByLabelText("Daily calories target")).toBeNull();
    expect(request).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText("Expand Macro targets"));
    await waitFor(() => expect(screen.getByLabelText("Macro goal").props.value).toBe("My goal"));
    await screen.findByText("Protein (oz)");
    fireEvent.changeText(screen.getByLabelText("Daily protein target"), "5");
    fireEvent.press(screen.getByLabelText("Save targets"));
    await screen.findByText("Macro targets saved.");
    const call = request.mock.calls.find(([path, init]) => path.endsWith("/targets") && init?.method === "PUT")!;
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({ daily_protein_g: 5 * GRAMS_PER_OUNCE, daily_calories: 2000, goal: "My goal" });
  } finally { screen.unmount(); client.clear(); }
});
