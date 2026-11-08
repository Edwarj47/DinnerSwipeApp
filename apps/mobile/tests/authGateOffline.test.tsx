import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { AuthGate } from "@/components/AuthGate";
import { apiFetch, clearAuthTokens, getToken, getRefreshToken, reconnectOffline, setAuthTokens } from "@/services/api";
import { useAuthSession } from "@/services/session";
import { deviceOffline, setDeviceOffline } from "@/services/offlineStore";
import { usePathname } from "expo-router";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({ usePathname: jest.fn(() => "/"), Link: () => null }));
jest.mock("@/components/BrandLogo", () => ({ BrandLogo: () => null }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@/services/biometrics", () => ({ getBiometricSettings: async () => ({ supported: false, enabled: false }) }));
jest.mock("@/services/api", () => ({
  getToken: jest.fn(async () => "cached-token"), getRefreshToken: jest.fn(async () => "cached-refresh"), setAuthTokens: jest.fn(),
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

test("signed-out account access can retry sign-in after a transient network failure", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  jest.mocked(usePathname).mockReturnValue("/delete-account");
  let signedIn = false, attempts = 0;
  jest.mocked(getToken).mockImplementation(async () => signedIn ? "fixture-token" : null);
  jest.mocked(getRefreshToken).mockResolvedValue(null);
  jest.mocked(setAuthTokens).mockImplementation(async () => { signedIn = true; });
  jest.mocked(reconnectOffline).mockImplementation(async options => {
    expect(options).toEqual({ accountOnly: true });
    setDeviceOffline(false);
  });
  jest.mocked(apiFetch).mockImplementation(async path => {
    if (path.endsWith("/login")) {
      if (++attempts === 1) { setDeviceOffline(true); throw new Error("Temporary sign-in failure"); }
      if (deviceOffline()) throw new Error("Sign-in was retried before reconnection");
      return { access_token: "fixture-token", refresh_token: "fixture-refresh" };
    }
    return { user_id: "fixture-user", email: "fixture@example.com" };
  });
  setDeviceOffline(false);
  const screen = render(<QueryClientProvider client={client}><AuthGate><Protected /></AuthGate></QueryClientProvider>);
  try {
    fireEvent.changeText(await screen.findByLabelText("Email"), "fixture@example.com");
    fireEvent.changeText(screen.getByLabelText("Password"), "fixture-password");
    fireEvent.press(screen.getByLabelText("Sign in"));
    await screen.findByText("Temporary sign-in failure");
    fireEvent.press(screen.getByLabelText("Sign in"));
    await screen.findByText("Private content");
    expect(attempts).toBe(2);
    expect(reconnectOffline).toHaveBeenCalledWith({ accountOnly: true });
  } finally { screen.unmount(); client.clear(); setDeviceOffline(false); jest.mocked(usePathname).mockReturnValue("/"); }
});
