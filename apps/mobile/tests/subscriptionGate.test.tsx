import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { usePathname } from "expo-router";
import { SubscriptionGate } from "@/features/subscription/SubscriptionGate";
import { apiFetch } from "@/services/api";
import { AuthSessionContext, useAppAccess } from "@/services/session";

jest.mock("expo-router", () => ({ usePathname: jest.fn(() => "/") }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
function Content() { return <Text>{useAppAccess() ? "Basic content" : "Locked"}</Text>; }
function setup(authenticated = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}><AuthSessionContext.Provider value={{
    authenticated, email: "account@test.invalid", userId: "one" }}>
    <SubscriptionGate><Content /></SubscriptionGate></AuthSessionContext.Provider></QueryClientProvider>);
  return { screen, close: () => { screen.unmount(); client.clear(); } };
}
beforeEach(() => { jest.mocked(apiFetch).mockReset(); jest.mocked(usePathname).mockReturnValue("/"); });

test("Basic remains free after welcome expires and never opens checkout", async () => {
  jest.mocked(apiFetch).mockResolvedValue({ basic_active: true, premium_active: false, welcome_eligible: false });
  const { screen, close } = setup();
  try {
    expect(screen.getByText("Basic content")).toBeTruthy();
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(jest.mocked(apiFetch).mock.calls.every(([path]) => path.endsWith("subscription/status"))).toBe(true);
  } finally { close(); }
});
test("a billing outage cannot paywall authenticated Basic", async () => {
  jest.mocked(apiFetch).mockRejectedValue(new Error("Offline"));
  const { screen, close } = setup();
  try { expect(screen.getByText("Basic content")).toBeTruthy(); } finally { close(); }
});
test("unauthenticated sessions never receive app access", () => {
  const { screen, close } = setup(false);
  try { expect(screen.getByText("Locked")).toBeTruthy(); expect(apiFetch).not.toHaveBeenCalled(); } finally { close(); }
});
test("account deletion stays independent and loads no app data", () => {
  jest.mocked(usePathname).mockReturnValue("/delete-account");
  const { screen, close } = setup();
  try { expect(screen.getByText("Locked")).toBeTruthy(); expect(apiFetch).not.toHaveBeenCalled(); } finally { close(); }
});
test("verified login automatically starts complimentary Premium without a checkout", async () => {
  let started = false;
  jest.mocked(apiFetch).mockImplementation(async path => {
    if (path.endsWith("welcome/start")) started = true;
    return { basic_active: true, welcome_eligible: !started, welcome_requires_verification: false, premium_active: started };
  });
  const { screen, close } = setup();
  try {
    await waitFor(() => expect(started).toBe(true));
    expect(screen.getByText("Basic content")).toBeTruthy();
    expect(jest.mocked(apiFetch).mock.calls.filter(([path]) => path.endsWith("welcome/start"))).toHaveLength(1);
  } finally { close(); }
});
test("unverified accounts cannot start complimentary Premium", async () => {
  jest.mocked(apiFetch).mockResolvedValue({ welcome_eligible: true, welcome_requires_verification: true });
  const { close } = setup();
  try {
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(jest.mocked(apiFetch).mock.calls.some(([path]) => path.endsWith("welcome/start"))).toBe(false);
  } finally { close(); }
});
