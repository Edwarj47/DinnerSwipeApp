import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import { SubscriptionGate } from "@/features/subscription/SubscriptionGate";
import { apiFetch } from "@/services/api";
import { AuthSessionContext, useAppAccess } from "@/services/session";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
jest.mock("expo-router", () => ({ usePathname: () => "/", Link: () => null }));
jest.mock("@/components/BrandLogo", () => ({ BrandLogo: () => null }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@/services/api", () => ({
  getToken: jest.fn().mockResolvedValue("fixture-token"),
  addAuthChangeListener: () => () => undefined,
  clearAuthTokens: jest.fn(),
  apiFetch: jest.fn()
}));

test("native paywall opens plan choices and checks out with the selected tier", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } }
  });
  const request = jest.mocked(apiFetch);
  request.mockImplementation(async (path) => {
    if (path.endsWith("checkout-session")) throw new Error("Checkout fixture unavailable");
    return {
      basic_active: false, basic_monthly_price_cents: 599, premium_monthly_price_cents: 999,
      basic_stripe_configured: true, premium_stripe_configured: true
    };
  });
  const screen = render(
    <QueryClientProvider client={client}>
      <AuthSessionContext.Provider value={{ authenticated: true, email: "fixture@example.com" }}>
      <SubscriptionGate><Text>App content</Text></SubscriptionGate>
      </AuthSessionContext.Provider>
    </QueryClientProvider>
  );
  try {
    await screen.findByText("Choose your plan");
    fireEvent.press(screen.getByLabelText("Subscription plan: Basic, $5.99/month"));
    fireEvent.press(screen.getByText("Premium"));
    expect(screen.queryByText("First 30 days free")).toBeNull();
    fireEvent.press(screen.getByLabelText("Subscribe to Premium"));
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/api/v1/subscription/checkout-session",
      { method: "POST", body: JSON.stringify({ tier: "premium" }) }
    ));
    await screen.findByText("Checkout fixture unavailable");
  } finally {
    screen.unmount();
    client.clear();
  }
});

function ProtectedRecipes() {
  const recipes = useQuery({ queryKey: ["recipes"], queryFn: () => apiFetch<string[]>("/api/v1/recipes"), retry: false });
  return <Text>{recipes.data?.join(", ") ?? "Waiting for recipes"}</Text>;
}

function AppScreens() {
  return useAppAccess() ? <ProtectedRecipes /> : null;
}

test("access unlock retries a cached blocked recipe request without reloading", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } } });
  const request = jest.mocked(apiFetch);
  request.mockClear();
  let unlocked = false;
  const subscription = () => ({ basic_active: unlocked, premium_active: unlocked });
  request.mockImplementation(async (path) => {
    if (path.endsWith("waiver-code")) { unlocked = true; return subscription(); }
    if (path.endsWith("subscription/status")) return subscription();
    if (path.endsWith("recipes")) {
      if (!unlocked) throw new Error("Subscription required");
      return ["Saved dinner"];
    }
    return {};
  });
  await client.fetchQuery({ queryKey: ["recipes"], queryFn: () => apiFetch("/api/v1/recipes") }).catch(() => undefined);
  request.mockClear();
  const screen = render(
    <QueryClientProvider client={client}>
      <AuthSessionContext.Provider value={{ authenticated: true, email: "fixture@example.com" }}>
        <SubscriptionGate><AppScreens /></SubscriptionGate>
      </AuthSessionContext.Provider>
    </QueryClientProvider>
  );
  try {
    await screen.findByText("fixture@example.com");
    expect(request.mock.calls.some(([path]) => path.endsWith("recipes"))).toBe(false);
    fireEvent.changeText(screen.getByLabelText("Testing access code"), "test-fixture");
    fireEvent.press(screen.getByLabelText("Apply"));
    await screen.findByText("Saved dinner");
    expect(screen.queryByText("Choose your plan")).toBeNull();
    expect(client.getQueryState(["recipes"])?.status).toBe("success");
  } finally { screen.unmount(); client.clear(); }
});

test("subscription failure keeps protected screens closed and allows retry", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const request = jest.mocked(apiFetch);
  request.mockReset();
  request.mockRejectedValue(new Error("Offline"));
  const screen = render(
    <QueryClientProvider client={client}>
      <AuthSessionContext.Provider value={{ authenticated: true, email: "fixture@example.com" }}>
        <SubscriptionGate><AppScreens /></SubscriptionGate>
      </AuthSessionContext.Provider>
    </QueryClientProvider>
  );
  try {
    await screen.findByText("Unable to check your access");
    expect(screen.queryByText("Waiting for recipes")).toBeNull();
    request.mockResolvedValue({ basic_active: false });
    fireEvent.press(screen.getByLabelText("Try again"));
    await screen.findByText("Choose your plan");
  } finally { screen.unmount(); client.clear(); }
});
