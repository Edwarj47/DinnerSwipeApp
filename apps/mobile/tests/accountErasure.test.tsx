import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { AccountDeletionPanel } from "@/features/settings/AccountDeletionPanel";
import { apiFetch, clearAuthTokens, getStoredSessionIdentity } from "@/services/api";
import { AuthSessionContext } from "@/services/session";
import { eraseLocalAccountData, useErasureReceipt } from "@/services/accountErasure";
import { changeOffline, eraseOfflineAccount, loadOffline, setOfflineOwner } from "@/services/offlineStore";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn(), clearAuthTokens: jest.fn(), getStoredSessionIdentity: jest.fn() }));
jest.mock("@/services/accountErasure", () => ({ eraseLocalAccountData: jest.fn(), useErasureReceipt: { setState: jest.fn() } }));

const preflight = { enabled: true, can_delete: true, ownership_transfers: [], billing_acknowledgement_required: false, personal_space_requires_review: false };

function setup(info = preflight, isCurrent = () => true) {
  jest.mocked(getStoredSessionIdentity).mockResolvedValue({ owner: "erasure-ui-user", isCurrent });
  jest.mocked(apiFetch).mockImplementation(async path => path.endsWith("/account/deletion") ? info
    : path.endsWith("/account/erase") ? { status: "complete", receipt_id: "receipt-fixture" }
      : { status: "not_requested", requested_at: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}><AuthSessionContext.Provider value={{ authenticated: true, email: "fixture@example.com", userId: "erasure-ui-user" }}>
    <AccountDeletionPanel />
  </AuthSessionContext.Provider></QueryClientProvider>);
  return { ...screen, client };
}

beforeEach(() => { jest.clearAllMocks(); });

function confirm(screen: ReturnType<typeof setup>) {
  fireEvent.changeText(screen.getByLabelText("Password for permanent account deletion"), "synthetic-password");
  fireEvent.changeText(screen.getByLabelText("Type DELETE to permanently delete account"), "DELETE");
}

test("permanent erasure requires confirmation, clears only the bound account and shows its receipt", async () => {
  const screen = setup();
  try {
    await screen.findByLabelText("Permanently delete account");
    expect(screen.getByLabelText("Permanently delete account")).toBeDisabled();
    confirm(screen);
    fireEvent.press(screen.getByLabelText("Permanently delete account"));
    await waitFor(() => expect(clearAuthTokens).toHaveBeenCalledTimes(1));
    expect(apiFetch).toHaveBeenCalledWith("/api/v1/auth/account/erase", {
      method: "POST", headers: { "X-Dinner-Account": "erasure-ui-user" },
      body: JSON.stringify({ current_password: "synthetic-password", confirmation: "DELETE", billing_acknowledged: false })
    });
    expect(eraseLocalAccountData).toHaveBeenCalledWith("erasure-ui-user");
    expect(useErasureReceipt.setState).toHaveBeenCalledWith({ receipt: { status: "complete", receipt_id: "receipt-fixture", device_cleanup_pending: false } });
  } finally { screen.unmount(); screen.client.clear(); }
});

test("billing acknowledgement and group ownership block premature confirmation", async () => {
  const screen = setup({ ...preflight, billing_acknowledgement_required: true });
  try {
    await screen.findByLabelText("Permanently delete account"); confirm(screen);
    expect(screen.getByLabelText("Permanently delete account")).toBeDisabled();
    fireEvent(screen.getByLabelText("Acknowledge ongoing subscription billing"), "valueChange", true);
    expect(screen.getByLabelText("Permanently delete account")).toBeEnabled();
  } finally { screen.unmount(); screen.client.clear(); }
  const blocked = setup({ ...preflight, can_delete: false, ownership_transfers: [{ id: "group", name: "Test group" }] } as typeof preflight);
  try {
    await blocked.findByText("Transfer ownership of Test group before continuing."); confirm(blocked);
    expect(blocked.getByLabelText("Permanently delete account")).toBeDisabled();
  } finally { blocked.unmount(); blocked.client.clear(); }
});

test("late erasure completion never logs out a different signed-in account", async () => {
  let current = true;
  const screen = setup(preflight, () => current);
  try {
    await screen.findByLabelText("Permanently delete account"); confirm(screen);
    jest.mocked(apiFetch).mockImplementation(async path => {
      if (path.endsWith("/account/erase")) { current = false; return { status: "pending", receipt_id: "receipt-fixture" }; }
      return preflight;
    });
    fireEvent.press(screen.getByLabelText("Permanently delete account"));
    await waitFor(() => expect(getStoredSessionIdentity).toHaveBeenCalled());
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/v1/auth/account/erase", expect.anything()));
    expect(clearAuthTokens).not.toHaveBeenCalled();
    expect(eraseLocalAccountData).not.toHaveBeenCalled();
  } finally { screen.unmount(); screen.client.clear(); }
});

test("explicit erasure clears the offline outbox and rejects late writes without touching another account", async () => {
  const owner = "erasure-offline-fixture", other = "surviving-offline-fixture";
  await AsyncStorage.clear(); setOfflineOwner(owner);
  await changeOffline(owner, data => { data.edits.push({ operation_id: "pending", kind: "macro_create", values: {}, label: "Private meal" }); });
  await changeOffline(other, data => { data.cache.fixture = { data: "untouched", at: Date.now() }; });
  await eraseOfflineAccount(owner);
  expect(await AsyncStorage.getItem("dinnerSwipe.offline.v1." + owner)).toBeNull();
  expect((await loadOffline(owner)).edits).toEqual([]);
  await expect(changeOffline(owner, data => { data.cache.late = { data: "must not return", at: Date.now() }; })).rejects.toThrow("This account was deleted.");
  expect((await loadOffline(other)).cache.fixture.data).toBe("untouched");
  setOfflineOwner(null);
});
