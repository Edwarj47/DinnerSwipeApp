import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { SubscriptionPanel } from "@/features/subscription/SubscriptionPanel";
import { apiFetch } from "@/services/api";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));

function setup(sent: boolean) {
  jest.mocked(apiFetch).mockImplementation(async path => path.endsWith("resend-verification") ? { sent }
    : { basic_active: true, premium_active: false, welcome_eligible: true, welcome_requires_verification: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}><SubscriptionPanel /></QueryClientProvider>);
  return { screen, close: () => { screen.unmount(); client.clear(); } };
}
beforeEach(() => jest.mocked(apiFetch).mockReset());

test("welcome verification stays optional for free Basic and sends only on request", async () => {
  const { screen, close } = setup(true);
  try {
    await screen.findByText("30 days of Premium, on us");
    expect(screen.getByText("Basic FREE")).toBeTruthy();
    expect(jest.mocked(apiFetch).mock.calls.every(([path]) => path.endsWith("subscription/status"))).toBe(true);
    fireEvent.press(screen.getByLabelText("Resend verification email"));
    await screen.findByText("Verification email sent.");
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/v1/auth/resend-verification", { method: "POST" }));
    expect(jest.mocked(apiFetch).mock.calls.some(([path]) => /checkout|welcome\/start/.test(path))).toBe(false);
  } finally { close(); }
});

test("a skipped email delivery never claims the message was sent", async () => {
  const { screen, close } = setup(false);
  try {
    await screen.findByText("30 days of Premium, on us");
    fireEvent.press(screen.getByLabelText("Resend verification email"));
    await screen.findByText("We could not send a verification email. Try again later or contact support.");
    expect(screen.queryByText("Verification email sent.")).toBeNull();
  } finally { close(); }
});
