import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { AuthGate } from "@/components/AuthGate";
import { apiFetch, clearAuthTokens, reconnectOffline } from "@/services/api";
import { useAuthSession } from "@/services/session";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({ usePathname: () => "/", Link: () => null }));
jest.mock("@/components/BrandLogo", () => ({ BrandLogo: () => null }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@/services/biometrics", () => ({ getBiometricSettings: async () => ({ supported: false, enabled: false }) }));
jest.mock("@/services/api", () => ({
  getToken: async () => "cached-token", getRefreshToken: async () => "cached-refresh",
  apiFetch: jest.fn(), clearAuthTokens: jest.fn(), reconnectOffline: jest.fn(),
  isAuthenticationError: (error: { status?: number }) => error?.status === 401,
  addAuthChangeListener: () => () => undefined
}));
function Protected() { return <Text>{useAuthSession().authenticated ? "Private content" : "Locked content"}</Text>; }

test("connection failure offers retry without clearing credentials or exposing private content", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  jest.mocked(apiFetch).mockRejectedValueOnce(new Error("Reconnect to verify access."));
  const screen = render(<QueryClientProvider client={client}><AuthGate><Protected /></AuthGate></QueryClientProvider>);
  try {
    await screen.findByText("Reconnect to verify access.");
    expect(screen.queryByText("Private content")).toBeNull();
    expect(clearAuthTokens).not.toHaveBeenCalled();
    jest.mocked(apiFetch).mockResolvedValue({ user_id: "user-a", email: "a@example.com" });
    fireEvent.press(screen.getByLabelText("Try again"));
    await waitFor(() => expect(reconnectOffline).toHaveBeenCalled());
    await screen.findByText("Private content");
    expect(clearAuthTokens).not.toHaveBeenCalled();
  } finally { screen.unmount(); client.clear(); }
}, 20_000);
