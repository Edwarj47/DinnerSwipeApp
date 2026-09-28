import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { AppState, AppStateStatus, Text } from "react-native";

import { BiometricGate } from "@/components/BiometricGate";
import { getBiometricSettings, setBiometricPreference, setBiometricTimeout } from "@/services/biometrics";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/components/BrandLogo", () => ({ BrandLogo: () => null }));
jest.mock("@/services/api", () => ({
  getToken: jest.fn().mockResolvedValue("fixture-token"),
  getRefreshToken: jest.fn().mockResolvedValue("fixture-refresh"),
  clearAuthTokens: jest.fn()
}));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));
jest.mock("expo-local-authentication", () => ({
  AuthenticationType: { FACIAL_RECOGNITION: 2, FINGERPRINT: 1, IRIS: 3 },
  hasHardwareAsync: jest.fn().mockResolvedValue(true),
  isEnrolledAsync: jest.fn().mockResolvedValue(true),
  supportedAuthenticationTypesAsync: jest.fn().mockResolvedValue([1]),
  authenticateAsync: jest.fn()
}));

let now = 100_000;
let onState: (state: AppStateStatus) => void;
let storage: Map<string, string>;
const authenticate = jest.mocked(LocalAuthentication.authenticateAsync);
beforeEach(async () => {
  now = 100_000;
  storage = new Map();
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async key => storage.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { storage.set(key, value); });
  authenticate.mockReset().mockResolvedValue({ success: true });
  jest.spyOn(Date, "now").mockImplementation(() => now);
  AppState.currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, callback) => {
    onState = callback;
    return { remove: jest.fn() };
  });
  await setBiometricPreference(true);
});
afterEach(() => jest.restoreAllMocks());

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><BiometricGate><Text>Private meals</Text></BiometricGate></QueryClientProvider>);
}
async function transition(state: AppStateStatus, elapsed = 0) {
  now += elapsed;
  await act(async () => { AppState.currentState = state; onState(state); });
}

test("five-minute default persists and returning from a store does not prompt again", async () => {
  expect((await getBiometricSettings()).timeoutMinutes).toBe(5);
  const screen = mount();
  await screen.findByText("Private meals");
  expect(authenticate).toHaveBeenCalledTimes(1);
  await transition("inactive");
  await transition("background", 120_000);
  await transition("active", 179_999);
  expect(screen.getByText("Private meals")).toBeTruthy();
  expect(authenticate).toHaveBeenCalledTimes(1);
  screen.unmount();
}, 20_000);

test("elapsed time starts at inactive, not the later background event; cancellation stays locked", async () => {
  const screen = mount();
  await screen.findByText("Private meals");
  authenticate.mockResolvedValue({ success: false, error: "user_cancel" });
  await transition("inactive");
  await transition("background", 120_000);
  await transition("active", 180_000);
  await screen.findByText("Unlock was cancelled or not recognized.");
  expect(authenticate).toHaveBeenCalledTimes(2);
  expect(screen.queryByText("Private meals")).toBeNull();
  await transition("background");
  await transition("active", 100);
  expect(screen.queryByText("Private meals")).toBeNull();
  authenticate.mockResolvedValue({ success: true });
  fireEvent.press(screen.getByLabelText("Unlock Dinner Swipe with biometrics"));
  await screen.findByText("Private meals");
});

test("timeout choices persist and a fresh launch still locks within the grace period", async () => {
  await setBiometricTimeout(15);
  expect((await getBiometricSettings()).timeoutMinutes).toBe(15);
  const screen = mount();
  await screen.findByText("Private meals");
  await transition("background");
  await transition("active", 300_000);
  expect(authenticate).toHaveBeenCalledTimes(1);
  screen.unmount();
  const fresh = mount();
  await fresh.findByText("Private meals");
  expect(authenticate).toHaveBeenCalledTimes(2);
});

test("immediate mode locks on return but the native prompt does not cause another unlock", async () => {
  await setBiometricTimeout(0);
  authenticate.mockImplementation(async () => {
    AppState.currentState = "inactive";
    onState("inactive");
    AppState.currentState = "active";
    onState("active");
    return { success: true };
  });
  const screen = mount();
  await screen.findByText("Private meals");
  expect(authenticate).toHaveBeenCalledTimes(1);
  await transition("background");
  await transition("active", 10);
  await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(2));
  await screen.findByText("Private meals");
});

test("secure storage or authentication failures never expose saved content", async () => {
  jest.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error("Storage unavailable"));
  const screen = mount();
  await screen.findByText("Unable to unlock. Try again or sign in with your password.");
  expect(screen.queryByText("Private meals")).toBeNull();
  expect(authenticate).not.toHaveBeenCalled();
});

test("disabled biometrics do not prompt and invalid stored timeouts default safely", async () => {
  await setBiometricPreference(false);
  storage.set("dinnerSwipeBiometricTimeoutMinutes", "invalid");
  expect((await getBiometricSettings()).timeoutMinutes).toBe(5);
  const screen = mount();
  await screen.findByText("Private meals");
  await transition("background");
  await transition("active", 900_000);
  expect(authenticate).not.toHaveBeenCalled();
});
