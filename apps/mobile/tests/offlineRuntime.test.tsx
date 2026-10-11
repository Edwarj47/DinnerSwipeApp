import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react-native";
import { OfflineRuntime } from "@/components/OfflineRuntime";
import { OfflineEdit, setOfflineOwner, useOfflineStatus } from "@/services/offlineStore";

jest.mock("@react-native-community/netinfo", () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock("@/services/api", () => ({ reconnectOffline: jest.fn(), recheckSession: jest.fn(), warmOfflineCache: jest.fn() }));

const grocery = (operation_id: string, household_id?: string): OfflineEdit => ({ operation_id, kind: "grocery_update", target_id: "milk", values: { is_checked: true }, label: "Milk", household_id });
const macro: OfflineEdit = { operation_id: "macro", kind: "macro_create", values: {}, label: "Shake" };
function mount() {
  const client = new QueryClient();
  const invalidate = jest.spyOn(client, "invalidateQueries");
  const screen = render(<QueryClientProvider client={client}><OfflineRuntime /></QueryClientProvider>);
  return { invalidate, close: () => { screen.unmount(); client.clear(); } };
}
beforeEach(() => {
  setOfflineOwner("user-a");
  useOfflineStatus.setState({ edits: [], offline: false, syncing: false, storageError: "", noticeSince: null });
});
afterEach(() => jest.restoreAllMocks());

test("a grocery sync burst refreshes only its list once after the queue drains", () => {
  const screen = mount();
  try {
    act(() => useOfflineStatus.setState({ edits: [grocery("one"), grocery("two")], syncing: true }));
    act(() => useOfflineStatus.setState({ edits: [grocery("two")] }));
    expect(screen.invalidate).not.toHaveBeenCalled();
    act(() => useOfflineStatus.setState({ edits: [] }));
    expect(screen.invalidate).not.toHaveBeenCalled();
    act(() => useOfflineStatus.setState({ syncing: false }));
    expect(screen.invalidate).toHaveBeenCalledTimes(1);
    expect(screen.invalidate).toHaveBeenCalledWith({ queryKey: ["grocery"], exact: true });
  } finally { screen.close(); }
});

test("partial sync does not refresh a group with remaining edits, or unrelated groups", () => {
  const screen = mount();
  try {
    act(() => useOfflineStatus.setState({ edits: [grocery("one", "family"), grocery("two", "family")], syncing: true }));
    act(() => useOfflineStatus.setState({ edits: [grocery("two", "family")], syncing: false }));
    expect(screen.invalidate).not.toHaveBeenCalled();
    act(() => useOfflineStatus.setState({ edits: [], syncing: true }));
    act(() => useOfflineStatus.setState({ syncing: false }));
    expect(screen.invalidate).toHaveBeenCalledTimes(1);
    expect(screen.invalidate).toHaveBeenCalledWith({ queryKey: ["grocery", "family"], exact: true });
  } finally { screen.close(); }
});

test("mixed sync invalidates affected macro data without reloading recipes or account settings", () => {
  const screen = mount();
  try {
    act(() => useOfflineStatus.setState({ edits: [grocery("one", "family"), macro], syncing: true }));
    act(() => useOfflineStatus.setState({ edits: [] }));
    act(() => useOfflineStatus.setState({ syncing: false }));
    expect(screen.invalidate.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: ["grocery", "family"], exact: true },
      { queryKey: ["macro-entries"], exact: false },
      { queryKey: ["macro-summary"], exact: false },
      { queryKey: ["macro-analytics"], exact: false }
    ]);
  } finally { screen.close(); }
});

test("changing accounts drops deferred refreshes rather than invalidating the new account", () => {
  const screen = mount();
  try {
    act(() => useOfflineStatus.setState({ edits: [grocery("one")], syncing: true }));
    act(() => useOfflineStatus.setState({ edits: [] }));
    act(() => setOfflineOwner("user-b"));
    expect(screen.invalidate).not.toHaveBeenCalled();
  } finally { screen.close(); }
});
