import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";
import MacrosScreen from "@/app/(tabs)/profile";
import { SettingsMenuProvider } from "@/features/settings/SettingsMenu";
import { SettingsButton, SettingsContext, useSettingsMenu } from "@/features/settings/SettingsContext";
import { apiFetch } from "@/services/api";
import { addSettingsListener } from "@/services/settingsMenu";

const mockParams: { section?: string; reset_token?: string; tour?: string } = {};
const mockRouter = { replace: jest.fn() };
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("expo-router", () => ({ useLocalSearchParams: () => mockParams, useRouter: () => mockRouter }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@/components/Screen", () => ({ Screen: ({ header, children }: { header: React.ReactNode; children: React.ReactNode }) => <>{header}{children}</> }));
jest.mock("@/features/settings/UserSettingsPanel", () => { const { Text } = jest.requireActual("react-native"); return { UserSettingsPanel: ({ initialSection }: { initialSection?: string }) => <Text>User settings content {initialSection}</Text> }; });
jest.mock("@/features/groups/HouseholdPanel", () => { const { Text } = jest.requireActual("react-native"); return { HouseholdPanel: () => <Text>Existing group tools</Text> }; });
jest.mock("@/features/premium/PremiumMacroPanel", () => { const { Text } = jest.requireActual("react-native"); return { PremiumMacroPanel: () => <Text>Existing macro tracker</Text> }; });
jest.mock("@/features/premium/MacroAnalyticsPanel", () => { const { Text } = jest.requireActual("react-native"); return { MacroAnalyticsPanel: () => <Text>Analytics dashboard</Text> }; });
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
const request = jest.mocked(apiFetch);
beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockParams)) delete mockParams[key as keyof typeof mockParams];
  request.mockResolvedValue({ premium_active: false, active: false });
});
function mount(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  return { ...screen, close: () => { screen.unmount(); client.clear(); } };
}
function InvitationTrigger() {
  const menu = useSettingsMenu();
  return <Pressable accessibilityLabel="Invite Premium" onPress={() => menu?.invitePremium()}><Text>Invite</Text></Pressable>;
}
test("fixed circle opens both settings views and dismisses without changing pages", async () => {
  const screen = mount(<SettingsMenuProvider><SettingsButton /></SettingsMenuProvider>);
  try {
    fireEvent.press(screen.getByLabelText("Open settings"));
    await screen.findByText("Settings");
    expect(screen.getByText("User settings content")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Group settings"));
    expect(screen.getByText("Existing group tools")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Close settings"));
    expect(screen.queryByText("Existing group tools")).toBeNull();
  } finally { screen.close(); }
});
test("Basic invitation links to subscription settings without starting checkout", async () => {
  const screen = mount(<SettingsMenuProvider><InvitationTrigger /></SettingsMenuProvider>);
  try {
    await waitFor(() => expect(request).toHaveBeenCalled());
    fireEvent.press(screen.getByLabelText("Invite Premium"));
    expect(screen.getByText("Unlock Macros")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("View Premium"));
    expect(screen.getByText("User settings content account")).toBeTruthy();
    expect(screen.queryByText("Unlock Macros")).toBeNull();
    expect(request.mock.calls.some(([path]) => path.includes("checkout") || path.includes("/macros/"))).toBe(false);
  } finally { screen.close(); }
});
test("Basic deep links cannot mount macro tracking or analytics", async () => {
  const invite = jest.fn();
  const screen = mount(<SettingsContext.Provider value={{ open: false, close: jest.fn(), invitePremium: invite }}><MacrosScreen /></SettingsContext.Provider>);
  try {
    await screen.findByText("Macros is a Premium feature");
    expect(invite).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Existing macro tracker")).toBeNull();
    expect(screen.queryByText("Analytics dashboard")).toBeNull();
  } finally { screen.close(); }
});
test("Premium keeps the tracker and analytics accessible without an invitation", async () => {
  request.mockResolvedValue({ premium_active: true, active: true });
  const invite = jest.fn();
  const screen = mount(<SettingsContext.Provider value={{ open: false, close: jest.fn(), invitePremium: invite }}><MacrosScreen /></SettingsContext.Provider>);
  try {
    await screen.findByText("Existing macro tracker");
    fireEvent.press(screen.getByLabelText("Analytics"));
    expect(screen.getByText("Analytics dashboard")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Macro tracking"));
    expect(screen.getByText("Existing macro tracker")).toBeTruthy();
    expect(invite).not.toHaveBeenCalled();
  } finally { screen.close(); }
});
test("legacy settings links open settings, not a Basic invitation", async () => {
  mockParams.section = "account";
  const opened = jest.fn(), invite = jest.fn();
  const remove = addSettingsListener(opened);
  const screen = mount(<SettingsContext.Provider value={{ open: false, close: jest.fn(), invitePremium: invite }}><MacrosScreen /></SettingsContext.Provider>);
  try {
    await screen.findByText("Macros is a Premium feature");
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ section: "account", focus: "subscription" }));
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(invite).not.toHaveBeenCalled();
  } finally { remove(); screen.close(); }
});
test("subscription errors fail closed and can be retried", async () => {
  request.mockRejectedValue(new Error("Offline"));
  const screen = mount(<MacrosScreen />);
  try {
    await screen.findByText("Couldn't check your subscription.");
    expect(screen.queryByText("Existing macro tracker")).toBeNull();
    request.mockResolvedValue({ premium_active: true });
    fireEvent.press(screen.getByLabelText("Retry subscription"));
    await screen.findByText("Existing macro tracker");
  } finally { screen.close(); }
});
