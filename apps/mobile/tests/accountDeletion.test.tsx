import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import { AccountDeletionPanel } from "@/features/settings/AccountDeletionPanel";
import { apiFetch } from "@/services/api";
import { AuthSessionContext } from "@/services/session";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));

function setup(email = "fixture@example.com", authenticated = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const tree = (owner: string) => <QueryClientProvider client={client}>
    <AuthSessionContext.Provider value={{ authenticated, email: owner, userId: `id-${owner}` }}><AccountDeletionPanel /></AuthSessionContext.Provider>
  </QueryClientProvider>;
  return { ...render(tree(email)), client, tree };
}

beforeEach(() => jest.mocked(apiFetch).mockReset());

test("does not request account data before authentication", () => {
  const screen = setup("fixture@example.com", false);
  expect(apiFetch).not.toHaveBeenCalled();
  expect(screen.queryByText("Request deletion")).toBeNull();
  screen.unmount(); screen.client.clear();
});

test("does not submit or load receipts without a confirmed immutable account ID", () => {
  const client = new QueryClient();
  const screen = render(<QueryClientProvider client={client}>
    <AuthSessionContext.Provider value={{ authenticated: true, email: "fixture@example.com" }}>
      <AccountDeletionPanel />
    </AuthSessionContext.Provider>
  </QueryClientProvider>);
  expect(screen.getByText("Reconnect to confirm your account before managing deletion.")).toBeTruthy();
  expect(screen.queryByText("Request deletion")).toBeNull();
  expect(apiFetch).not.toHaveBeenCalled();
  screen.unmount(); client.clear();
});

test("submits a confirmed request and keeps a receipt visible without saying it was deleted", async () => {
  let pending = false;
  jest.mocked(apiFetch).mockImplementation(async (_path, options) => {
    if (options?.method === "POST") { pending = true; return { status: "deletion_requested" }; }
    return { status: pending ? "pending_manual_review" : "not_requested", requested_at: pending ? "2026-11-07T12:00:00Z" : null };
  });
  const screen = setup();
  try {
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    fireEvent.changeText(screen.getByLabelText("Password for account deletion request"), "test-password");
    fireEvent.changeText(screen.getByLabelText("Type DELETE to request account deletion"), "DELETE");
    fireEvent.press(screen.getByLabelText("Request deletion"));
    await screen.findByText("Deletion request pending review");
    expect(apiFetch).toHaveBeenCalledWith("/api/v1/auth/account/delete-request", {
      method: "POST", headers: { "X-Dinner-Account": "id-fixture@example.com" },
      body: JSON.stringify({ current_password: "test-password", confirmation: "DELETE" })
    });
    expect(screen.queryByLabelText("Password for account deletion request")).toBeNull();
    expect(screen.getByText("Your account has not been deleted. Support: dinnerswipe@dcss.dev")).toBeTruthy();
  } finally { screen.unmount(); screen.client.clear(); }
});

test("an existing request survives reopening and never carries across accounts", async () => {
  jest.mocked(apiFetch).mockResolvedValueOnce({ status: "pending_manual_review", requested_at: "2026-11-07T12:00:00Z" })
    .mockResolvedValue({ status: "not_requested", requested_at: null });
  const screen = setup();
  try {
    await screen.findByText("Deletion request pending review");
    screen.rerender(screen.tree("other@example.com"));
    await screen.findByLabelText("Password for account deletion request");
    expect(screen.queryByText("Deletion request pending review")).toBeNull();
    expect(apiFetch).toHaveBeenCalledWith("/api/v1/auth/account/deletion-request", {
      headers: { "X-Dinner-Account": "id-other@example.com" }
    });
  } finally { screen.unmount(); screen.client.clear(); }
});

test("a failed request stays retryable and does not show a success receipt", async () => {
  jest.mocked(apiFetch).mockImplementation(async (_path, options) => {
    if (options?.method === "POST") throw new Error("Please wait and try again.");
    return { status: "not_requested", requested_at: null };
  });
  const screen = setup();
  try {
    fireEvent.changeText(screen.getByLabelText("Password for account deletion request"), "test-password");
    fireEvent.changeText(screen.getByLabelText("Type DELETE to request account deletion"), "DELETE");
    fireEvent.press(screen.getByLabelText("Request deletion"));
    await screen.findByText("Please wait and try again.");
    expect(screen.queryByText("Deletion request pending review")).toBeNull();
    expect(screen.getByLabelText("Request deletion")).toBeEnabled();
  } finally { screen.unmount(); screen.client.clear(); }
});
