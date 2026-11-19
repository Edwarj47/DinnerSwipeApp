import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { NativeBillingProvider } from "@/features/subscription/NativeBillingProvider";
import { PremiumPurchaseActions } from "@/features/subscription/PremiumPurchaseActions";
import { apiFetch } from "@/services/api";
import { AuthSessionContext } from "@/services/session";
import { storeAdapter } from "@/services/storeBilling";
import { NativeBillingContext, StorePurchase } from "@/services/nativeBillingTypes";
import { PremiumStatus } from "@/services/types";

let mockAuthChanged: () => void;
let mockPurchase: (purchase: StorePurchase) => void;
let mockStop: jest.Mock;
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn(), addAuthChangeListener: (listener: () => void) => {
  mockAuthChanged = listener; return () => undefined;
} }));
jest.mock("@/services/storeBilling", () => ({ storeProvider: "apple", storeAdapter: {
  connect: jest.fn(), products: jest.fn(), buy: jest.fn(), available: jest.fn(), restore: jest.fn(), finish: jest.fn(), manage: jest.fn()
} }));

const config: NativeBillingContext = { account_id: "billing-one", apple: { enabled: true, product_id: "premium", account_token: "binding-one" },
  google: { enabled: false, product_id: "", account_token: "" } };
const purchase = { id: "tx-one", productId: "premium", purchaseState: "purchased", appAccountToken: "binding-one" } as StorePurchase;
const status = { basic_active: true, premium_active: false, welcome_active: false, welcome_eligible: false } as PremiumStatus;

beforeEach(() => {
  jest.clearAllMocks();
  mockStop = jest.fn();
  jest.mocked(storeAdapter.connect).mockImplementation(async success => { mockPurchase = success; return mockStop; });
  jest.mocked(storeAdapter.products).mockResolvedValue({ id: "premium", price: "EUR 9,99" });
  jest.mocked(storeAdapter.available).mockResolvedValue([]);
  jest.mocked(storeAdapter.restore).mockResolvedValue([purchase]);
  jest.mocked(storeAdapter.buy).mockResolvedValue();
  jest.mocked(storeAdapter.finish).mockResolvedValue();
  jest.mocked(apiFetch).mockImplementation(async path => path.endsWith("context") ? config : {
    verified: true, finish_transaction: true, subscription: { ...status, premium_active: true }
  });
});

function setup(initialStatus = status) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const tree = (owner: string) => <QueryClientProvider client={queries}>
    <AuthSessionContext.Provider value={{ authenticated: true, email: `${owner}@test.invalid`, userId: owner }}>
      <NativeBillingProvider><PremiumPurchaseActions status={initialStatus} /></NativeBillingProvider>
    </AuthSessionContext.Provider></QueryClientProvider>;
  const screen = render(tree("one"));
  return { screen, queries, switchTo: (owner: string) => screen.rerender(tree(owner)), close: () => { screen.unmount(); queries.clear(); } };
}

test("native purchase uses store-localized price and never displays web coupons", async () => {
  const { screen, close } = setup();
  try {
    await screen.findByText("Premium EUR 9,99/month");
    expect(screen.queryByLabelText("Premium coupon code")).toBeNull();
    fireEvent.press(screen.getByLabelText("Subscribe to Premium"));
    await waitFor(() => expect(storeAdapter.buy).toHaveBeenCalledWith(config, { id: "premium", price: "EUR 9,99" }));
    expect(jest.mocked(apiFetch).mock.calls.some(([path]) => /checkout|coupon|portal/.test(path))).toBe(false);
  } finally { close(); }
});

test("Apple finish waits for server verification", async () => {
  let resolve!: (value: unknown) => void;
  const verified = new Promise(resolveValue => { resolve = resolveValue; });
  jest.mocked(apiFetch).mockImplementation(async path => path.endsWith("context") ? config : verified);
  const { screen, close } = setup();
  try {
    await screen.findByText("Premium EUR 9,99/month");
    act(() => mockPurchase(purchase));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/v1/subscription/native/verify", {
      method: "POST", body: JSON.stringify({ provider: "apple", reference: "tx-one" })
    }));
    expect(storeAdapter.finish).not.toHaveBeenCalled();
    await act(async () => resolve({ verified: true, finish_transaction: true, subscription: { premium_active: true } }));
    await waitFor(() => expect(storeAdapter.finish).toHaveBeenCalledTimes(1));
  } finally { close(); }
});

test("explicit restore reads returned purchases even without listener events", async () => {
  const { screen, close } = setup();
  try {
    await screen.findByText("Premium EUR 9,99/month");
    fireEvent.press(screen.getByLabelText("Restore purchases"));
    await screen.findByText("Premium restored.");
    expect(storeAdapter.restore).toHaveBeenCalledTimes(1);
    expect(storeAdapter.finish).toHaveBeenCalledWith(purchase);
  } finally { close(); }
});

test("provider verification failure never finishes or unlocks a purchase", async () => {
  jest.mocked(apiFetch).mockImplementation(async path => {
    if (path.endsWith("context")) return config;
    throw new Error("Verification unavailable");
  });
  const { screen, close } = setup();
  try {
    await screen.findByText("Premium EUR 9,99/month");
    act(() => mockPurchase(purchase));
    await screen.findByText("Verification unavailable");
    expect(storeAdapter.finish).not.toHaveBeenCalled();
    expect(screen.queryByText("Premium is active.")).toBeNull();
  } finally { close(); }
});

test("account epoch invalidates a late server callback before Apple finish", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise(res => { resolve = res; });
  jest.mocked(apiFetch).mockImplementation(async path => path.endsWith("context") ? config : pending);
  const { screen, close } = setup();
  try {
    await screen.findByText("Premium EUR 9,99/month");
    act(() => mockPurchase(purchase));
    await waitFor(() => expect(jest.mocked(apiFetch).mock.calls.some(([path]) => path.endsWith("verify"))).toBe(true));
    act(() => mockAuthChanged());
    await act(async () => resolve({ verified: true, finish_transaction: true, subscription: { premium_active: true } }));
    expect(storeAdapter.finish).not.toHaveBeenCalled();
    expect(screen.queryByText("Premium is active.")).toBeNull();
  } finally { close(); }
});

test("pending or foreign purchases never reach server verification", async () => {
  const { screen, close } = setup();
  try {
    await screen.findByText("Premium EUR 9,99/month");
    act(() => mockPurchase({ ...purchase, purchaseState: "pending" } as StorePurchase));
    await screen.findByText("Payment is pending. Premium will activate after verification.");
    act(() => mockPurchase({ ...purchase, appAccountToken: "foreign" } as StorePurchase));
    await screen.findByText("This purchase belongs to another Dinner Swipe account.");
    expect(jest.mocked(apiFetch).mock.calls.some(([path]) => path.endsWith("verify"))).toBe(false);
    expect(storeAdapter.finish).not.toHaveBeenCalled();
  } finally { close(); }
});

test("missing credentials disable purchase and restore without a web fallback", async () => {
  jest.mocked(apiFetch).mockResolvedValue({ ...config, apple: { ...config.apple, enabled: false } });
  const { screen, close } = setup();
  try {
    await screen.findByText("Store subscriptions are not available yet.");
    fireEvent.press(screen.getByLabelText("Subscribe to Premium"));
    fireEvent.press(screen.getByLabelText("Restore purchases"));
    expect(storeAdapter.connect).not.toHaveBeenCalled();
    expect(storeAdapter.buy).not.toHaveBeenCalled();
    expect(jest.mocked(apiFetch).mock.calls.some(([path]) => /checkout|coupon|portal/.test(path))).toBe(false);
  } finally { close(); }
});

test("welcome Premium cannot start an automatic paid subscription", async () => {
  const { screen, close } = setup({ ...status, premium_active: true, welcome_active: true });
  try {
    await screen.findByText("Premium EUR 9,99/month");
    fireEvent.press(screen.getByLabelText("Subscribe to Premium"));
    expect(storeAdapter.buy).not.toHaveBeenCalled();
  } finally { close(); }
});

test("an active web subscription blocks duplicate native billing but expired history does not", async () => {
  const active = setup({ ...status, source: "stripe", external_subscription_active: true, billing_management_available: true });
  try {
    await active.screen.findByText("Premium EUR 9,99/month");
    fireEvent.press(active.screen.getByLabelText("Subscribe to Premium"));
    expect(storeAdapter.buy).not.toHaveBeenCalled();
  } finally { active.close(); }
  const expired = setup({ ...status, source: "stripe", external_subscription_active: false, billing_management_available: true });
  try {
    await expired.screen.findByText("Premium EUR 9,99/month");
    fireEvent.press(expired.screen.getByLabelText("Subscribe to Premium"));
    await waitFor(() => expect(storeAdapter.buy).toHaveBeenCalledTimes(1));
  } finally { expired.close(); }
});
