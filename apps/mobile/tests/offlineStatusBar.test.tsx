import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render } from "@testing-library/react-native";
import { OfflineStatusBar } from "@/components/OfflineStatusBar";
import { OfflineEdit, useOfflineStatus } from "@/services/offlineStore";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/api", () => ({ retryOfflineSync: jest.fn() }));
const edit: OfflineEdit = { operation_id: "check-1", kind: "grocery_update", target_id: "onion", label: "Red onion", values: { is_checked: true } };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}><OfflineStatusBar /></QueryClientProvider>);
  return { ...screen, close: () => { screen.unmount(); client.clear(); } };
}
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date("2026-10-05T00:00:00Z"));
  useOfflineStatus.setState({ offline: false, syncing: false, edits: [], storageError: "", noticeSince: null });
});
afterEach(() => jest.useRealTimers());

test("successful checkbox sync remains silent, including after the canceled delay", () => {
  const screen = mount();
  try {
    act(() => useOfflineStatus.setState({ edits: [edit], syncing: true }));
    act(() => jest.advanceTimersByTime(500));
    expect(screen.queryByRole("button")).toBeNull();
    act(() => useOfflineStatus.setState({ edits: [], syncing: false }));
    act(() => jest.advanceTimersByTime(20_000));
    expect(screen.queryByRole("button")).toBeNull();
    expect(useOfflineStatus.getState().noticeSince).toBeNull();
  } finally { screen.close(); }
});

test("pending changes show after ten seconds without restarting for another checkbox", () => {
  const screen = mount();
  try {
    act(() => useOfflineStatus.setState({ edits: [edit], syncing: true }));
    const start = useOfflineStatus.getState().noticeSince;
    act(() => jest.advanceTimersByTime(9000));
    act(() => useOfflineStatus.setState({ edits: [edit, { ...edit, operation_id: "check-2" }] }));
    expect(useOfflineStatus.getState().noticeSince).toBe(start);
    expect(screen.queryByRole("button")).toBeNull();
    act(() => jest.advanceTimersByTime(999));
    expect(screen.queryByRole("button")).toBeNull();
    act(() => jest.advanceTimersByTime(1));
    fireEvent.press(screen.getByLabelText("Taking longer to sync. Changes are saved."));
    expect(screen.getAllByText("Red onion")).toHaveLength(2);
    act(() => useOfflineStatus.setState({ edits: [], syncing: false }));
    expect(screen.queryByLabelText("Taking longer to sync. Changes are saved.")).toBeNull();
    expect(screen.getByText("All changes are synced.")).toBeTruthy();
  } finally { screen.close(); }
});

test("screen remounts keep the original delay and new sync bursts stay quiet", () => {
  act(() => useOfflineStatus.setState({ edits: [edit] }));
  const first = mount();
  act(() => jest.advanceTimersByTime(6000)); first.close();
  const next = mount();
  try {
    act(() => jest.advanceTimersByTime(4000));
    expect(next.getByLabelText("1 change waiting to sync")).toBeTruthy();
    act(() => useOfflineStatus.setState({ edits: [] }));
    act(() => useOfflineStatus.setState({ edits: [edit] }));
    expect(next.queryByLabelText("1 change waiting to sync")).toBeNull();
    act(() => jest.advanceTimersByTime(9999));
    expect(next.queryByLabelText("1 change waiting to sync")).toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(next.getByLabelText("1 change waiting to sync")).toBeTruthy();
  } finally { next.close(); }
});

test("offline status is delayed and clears on recovery", () => {
  const screen = mount();
  try {
    act(() => useOfflineStatus.setState({ offline: true }));
    act(() => jest.advanceTimersByTime(9999));
    expect(screen.queryByLabelText("Offline - downloaded data")).toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByLabelText("Offline - downloaded data")).toBeTruthy();
    act(() => useOfflineStatus.setState({ offline: false }));
    expect(screen.queryByLabelText("Offline - downloaded data")).toBeNull();
  } finally { screen.close(); }
});

test("conflicts and local storage failures remain immediately actionable", () => {
  const screen = mount();
  try {
    act(() => useOfflineStatus.setState({ edits: [{ ...edit, issue: "Changed on another device" }] }));
    expect(screen.getByLabelText("1 change needs review")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("1 change needs review"));
    expect(screen.getByText("Changed on another device")).toBeTruthy();
    expect(screen.getByLabelText("Discard local changes")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Close sync status"));
    act(() => useOfflineStatus.setState({ edits: [], storageError: "Storage is full" }));
    expect(screen.getByLabelText("Storage is full")).toBeTruthy();
  } finally { screen.close(); }
});
