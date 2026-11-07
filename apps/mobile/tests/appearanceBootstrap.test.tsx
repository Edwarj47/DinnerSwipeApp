import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react-native";
import { AppState, StyleSheet, Text } from "react-native";
import { AppearanceBootstrap } from "@/components/AppearanceBootstrap";
import { BiometricGate } from "@/components/BiometricGate";
import { addAuthChangeListener, apiFetch, getStoredSessionIdentity } from "@/services/api";
import { resetAppearance, useAppearance } from "@/services/appearance";
import { authenticateForUnlock } from "@/services/biometrics";
import { setOfflineOwner } from "@/services/offlineStore";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/components/BrandLogo", () => ({ BrandLogo: () => null }));
jest.mock("@/services/appIcon", () => ({ applyAppIcon: jest.fn(async () => undefined) }));
jest.mock("@/services/api", () => ({
  apiFetch: jest.fn(), getStoredSessionIdentity: jest.fn(),
  getToken: jest.fn(async () => "fixture-token"), getRefreshToken: jest.fn(async () => "fixture-refresh"),
  clearAuthTokens: jest.fn(), addAuthChangeListener: jest.fn(() => jest.fn())
}));
jest.mock("@/services/biometrics", () => ({
  getBiometricSettings: jest.fn(async () => ({ enabled: true, supported: true, label: "fingerprint", timeoutMinutes: 5 })),
  authenticateForUnlock: jest.fn(), isBiometricPromptActive: () => false
}));

beforeEach(async () => {
  jest.clearAllMocks(); await AsyncStorage.clear();
  setOfflineOwner(null); resetAppearance(null); useAppearance.setState({ ready: false });
  AppState.currentState = "active";
  jest.mocked(getStoredSessionIdentity).mockResolvedValue({ owner: "owner-a", isCurrent: () => true });
  await AsyncStorage.setItem("dinnerSwipe.appearance.v1.owner-a", JSON.stringify({ accent: "teal" }));
});

test("cold start uses a neutral frame until the stored color is ready, then themes the still-locked biometric screen", async () => {
  let unlock!: (value: boolean) => void;
  jest.mocked(authenticateForUnlock).mockImplementation(() => new Promise(done => { unlock = done; }));
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });
  const screen = render(<QueryClientProvider client={client}><AppearanceBootstrap><BiometricGate><Text>Private meals</Text></BiometricGate></AppearanceBootstrap></QueryClientProvider>);
  try {
    expect(screen.getByLabelText("Loading appearance")).toBeTruthy();
    expect(screen.queryByLabelText("Unlock Dinner Swipe with biometrics")).toBeNull();
    const button = await screen.findByLabelText("Unlock Dinner Swipe with biometrics");
    expect(StyleSheet.flatten(button.props.style).backgroundColor).toBe("#0f766e");
    expect(screen.queryByText("Private meals")).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(useAppearance.getState()).toMatchObject({ owner: null, accent: "teal", ready: false });
    await act(async () => { unlock(true); });
    await screen.findByText("Private meals");
  } finally { screen.unmount(); client.clear(); }
});

test("explicit sign-out clears the pre-authentication color even before an offline owner was restored", async () => {
  const screen = render(<AppearanceBootstrap><Text>Unlock</Text></AppearanceBootstrap>);
  try {
    await screen.findByText("Unlock");
    expect(useAppearance.getState().accent).toBe("teal");
    act(() => { jest.mocked(addAuthChangeListener).mock.calls[0][0](); });
    await waitFor(() => expect(useAppearance.getState().accent).toBe("red"));
  } finally { screen.unmount(); }
});
