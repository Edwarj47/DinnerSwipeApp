/* eslint-disable import/first */
const mockSecrets = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecrets.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockSecrets.set(key, value); }),
  deleteItemAsync: jest.fn(async (key: string) => { mockSecrets.delete(key); })
}));
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch, clearAuthTokens, getRefreshToken, getToken, setAuthTokens, syncOffline } from "@/services/api";
import { changeOffline, discardOfflineChange, loadOffline, macroAfter, offlineAccess, readOffline,
  setDeviceOffline, setOfflineOwner, useOfflineStatus } from "@/services/offlineStore";
import { MacroConfirmation, PremiumStatus } from "@/services/types";

const owner = "offline-user-a";
const groceryPath = "/api/v1/grocery-lists/current";
const day = new Date().toISOString().slice(0, 10);
const entriesPath = `/api/v1/macros/entries?start_date=${day}&end_date=${day}`;
function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}
function status(): PremiumStatus {
  return { basic_active: true, premium_active: true, offline_sync_version: 1,
    offline_until: new Date(Date.now() + 72 * 3600000).toISOString() } as PremiumStatus;
}
const entry = { entry_name: "Shake", meal_date: day, servings_consumed: 1, calories: 160, protein_g: 30, carbs_g: 4, fat_g: 3, fiber_g: 2 };
async function connect() {
  await setAuthTokens({ access_token: "access-a", refresh_token: "refresh-a" });
  jest.mocked(fetch)
    .mockResolvedValueOnce(response({ user_id: owner, email: "a@example.com" }))
    .mockResolvedValueOnce(response(status()))
    .mockResolvedValueOnce(response({ items: [{ id: "milk", display_name: "Milk", is_checked: false, revision: "revision-1" }] }))
    .mockResolvedValueOnce(response([]));
  await apiFetch("/api/v1/auth/status");
  await apiFetch("/api/v1/subscription/status");
  await apiFetch(groceryPath);
  await apiFetch(entriesPath);
  jest.mocked(fetch).mockClear();
}
beforeEach(async () => {
  await clearAuthTokens();
  await AsyncStorage.clear();
  mockSecrets.clear();
  setDeviceOffline(false);
  global.fetch = jest.fn();
});
afterEach(() => { jest.restoreAllMocks(); });

test.each([503, 429, "network"])("refresh failure %s retains credentials and downloaded data", async failure => {
  await connect();
  jest.mocked(fetch).mockResolvedValueOnce(response({ detail: "expired" }, 401));
  if (typeof failure === "number") jest.mocked(fetch).mockResolvedValueOnce(response({}, failure));
  else jest.mocked(fetch).mockRejectedValueOnce(new TypeError("Network request failed"));
  expect(await apiFetch(groceryPath)).toMatchObject({ items: [{ id: "milk" }] });
  expect(await getToken()).toBe("access-a");
  expect(await getRefreshToken()).toBe("refresh-a");
  expect(useOfflineStatus.getState().offline).toBe(true);
});

test("revoked refresh token never falls back to authorized cached data", async () => {
  await connect();
  jest.mocked(fetch).mockResolvedValueOnce(response({}, 401)).mockResolvedValueOnce(response({ detail: "revoked" }, 401));
  await expect(apiFetch(groceryPath)).rejects.toThrow();
  expect(await getToken()).toBeNull();
  expect(await getRefreshToken()).toBeNull();
});

test("first login and shared planning edits remain online-only", async () => {
  setDeviceOffline(true);
  await expect(apiFetch("/api/v1/auth/login", { method: "POST", body: "{}" })).rejects.toThrow(/offline/);
  setDeviceOffline(false);
  await connect();
  setDeviceOffline(true);
  await expect(apiFetch("/api/v1/weekly-plans/current/reset", { method: "POST", body: "{}" })).rejects.toThrow(/offline/);
  expect((await loadOffline(owner)).edits).toHaveLength(0);
});

test("grocery edits survive a restart and synchronize in revision order", async () => {
  await connect();
  setDeviceOffline(true);
  await apiFetch("/api/v1/grocery-lists/items/milk", { method: "PATCH", body: JSON.stringify({ is_checked: true }) });
  await apiFetch("/api/v1/grocery-lists/items/milk", { method: "PATCH", body: JSON.stringify({ quantity: 2 }) });
  const before = await loadOffline(owner);
  expect(before.edits[1].revision).toBe(`pending:${before.edits[0].operation_id}`);
  setOfflineOwner(null);
  expect(await apiFetch("/api/v1/auth/status")).toMatchObject({ user_id: owner });
  expect(useOfflineStatus.getState().edits).toHaveLength(2);
  expect(await apiFetch(groceryPath)).toMatchObject({ items: [{ is_checked: true, quantity: 2 }] });
  setDeviceOffline(false);
  jest.mocked(fetch).mockImplementation(async (_url, init) => {
    const edit = JSON.parse(String(init?.body));
    if (edit.values.quantity) expect(edit.revision).toBe("revision-2");
    return response({ result: { id: "milk", revision: edit.values.quantity ? "revision-3" : "revision-2" } });
  });
  await syncOffline();
  expect((await loadOffline(owner)).edits).toHaveLength(0);
  setDeviceOffline(true);
  expect(await apiFetch(groceryPath)).toMatchObject({ items: [{ is_checked: true, quantity: 2, revision: "revision-3" }] });
});

test("response lost after commit retries the identical operation, not a new macro", async () => {
  await connect();
  jest.mocked(fetch).mockRejectedValueOnce(new TypeError("Response lost"));
  const created = await apiFetch<MacroConfirmation>("/api/v1/macros/entries", { method: "POST", body: JSON.stringify(entry) });
  const sent = jest.mocked(fetch).mock.calls[0][1]?.body;
  expect((await loadOffline(owner)).edits).toHaveLength(1);
  expect(await apiFetch(entriesPath)).toMatchObject([{ id: created.id, calories: 160 }]);
  setDeviceOffline(false);
  jest.mocked(fetch).mockResolvedValueOnce(response({ result: { ...created, revision: "server-revision" } }));
  await syncOffline();
  expect(jest.mocked(fetch).mock.calls[1][1]?.body).toBe(sent);
  expect((await loadOffline(owner)).edits).toHaveLength(0);
  setDeviceOffline(true);
  expect(await apiFetch(entriesPath)).toMatchObject([{ id: created.id, revision: "server-revision" }]);
});

test("an acknowledgement already handled in another tab cannot regress the cache", async () => {
  await connect();
  setDeviceOffline(true);
  await apiFetch("/api/v1/grocery-lists/items/milk", { method: "PATCH", body: JSON.stringify({ quantity: 2 }) });
  setDeviceOffline(false);
  jest.mocked(fetch).mockImplementationOnce(async () => {
    await changeOffline(owner, data => {
      data.edits = [];
      data.cache[groceryPath].data = { items: [{ id: "milk", quantity: 9, revision: "later-change" }] };
    });
    return response({ result: { id: "milk", revision: "earlier-ack" } });
  });
  await syncOffline();
  setDeviceOffline(true);
  expect(await apiFetch(groceryPath)).toMatchObject({ items: [{ quantity: 9, revision: "later-change" }] });
});

test("recipe changes invalidate older downloaded lists rather than resurrecting hidden rows", async () => {
  await connect();
  await changeOffline(owner, data => { data.cache["/api/v1/recipes?collection=library"] = { at: Date.now(), data: [{ id: "hidden-later" }] }; });
  jest.mocked(fetch).mockResolvedValueOnce(response({ status: "hidden" }));
  await apiFetch("/api/v1/recipes/swipes", { method: "POST", body: JSON.stringify({ recipe_id: "hidden-later", action: "hide" }) });
  expect((await loadOffline(owner)).cache["/api/v1/recipes?collection=library"]).toBeUndefined();
});

test("create, edit portion, and delete work against a queued personal entry", async () => {
  await connect();
  setDeviceOffline(true);
  const row = await apiFetch<MacroConfirmation>("/api/v1/macros/entries", { method: "POST", body: JSON.stringify(entry) });
  await apiFetch(`/api/v1/macros/entries/${row.id}`, { method: "PUT", body: JSON.stringify({ servings_consumed: 2 }) });
  expect(await apiFetch(entriesPath)).toMatchObject([{ calories: 320, protein_g: 60 }]);
  await apiFetch(`/api/v1/macros/entries/${row.id}`, { method: "DELETE" });
  expect(await apiFetch(entriesPath)).toEqual([]);
  expect((await loadOffline(owner)).edits).toHaveLength(3);
});

test("a conflict keeps local values visible and discards only that item's chain", async () => {
  await connect();
  setDeviceOffline(true);
  await apiFetch("/api/v1/grocery-lists/items/milk", { method: "PATCH", body: JSON.stringify({ quantity: 2 }) });
  await apiFetch("/api/v1/grocery-lists/items/milk", { method: "PATCH", body: JSON.stringify({ is_checked: true }) });
  await apiFetch("/api/v1/macros/entries", { method: "POST", body: JSON.stringify(entry) });
  setDeviceOffline(false);
  jest.mocked(fetch).mockResolvedValueOnce(response({ detail: "Changed on another device" }, 409));
  await syncOffline();
  const pending = (await loadOffline(owner)).edits;
  expect(pending).toHaveLength(3);
  expect(pending[0].issue).toBe("Changed on another device");
  await discardOfflineChange(pending[0].operation_id);
  expect((await loadOffline(owner)).edits.map(edit => edit.kind)).toEqual(["macro_create"]);
});

test("failed local persistence never reports saved or sends a server mutation", async () => {
  await connect();
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error("Disk full"));
  await expect(apiFetch("/api/v1/macros/entries", { method: "POST", body: JSON.stringify(entry) })).rejects.toThrow("Disk full");
  expect(fetch).not.toHaveBeenCalled();
  expect((await loadOffline(owner)).edits).toHaveLength(0);
});

test("sign out and another account cannot access the previous account's queue", async () => {
  await connect();
  setDeviceOffline(true);
  await apiFetch("/api/v1/macros/entries", { method: "POST", body: JSON.stringify(entry) });
  await clearAuthTokens();
  await expect(apiFetch(entriesPath)).rejects.toThrow();
  expect(useOfflineStatus.getState().edits).toHaveLength(0);
  expect((await loadOffline(owner)).edits).toHaveLength(1);
  setDeviceOffline(false);
  await setAuthTokens({ access_token: "access-b", refresh_token: "refresh-b" });
  jest.mocked(fetch).mockResolvedValueOnce(response({ user_id: "user-b", email: "b@example.com" })).mockResolvedValueOnce(response(status()));
  await apiFetch("/api/v1/auth/status");
  await apiFetch("/api/v1/subscription/status");
  setDeviceOffline(true);
  await expect(apiFetch(entriesPath)).rejects.toThrow(/not downloaded/);
  expect(useOfflineStatus.getState().edits).toHaveLength(0);
});

test("offline grace expires, honors subscription expiry, rejects clock rollback and Premium downgrade", async () => {
  await connect();
  const data = await loadOffline(owner);
  expect(offlineAccess(data, true)).toBe(true);
  expect(offlineAccess({ ...data, verifiedAt: Date.now() - 73 * 3600000 })).toBe(false);
  expect(offlineAccess({ ...data, subscription: { ...status(), offline_until: new Date(Date.now() - 1).toISOString() } })).toBe(false);
  expect(offlineAccess({ ...data, seenAt: Date.now() + 120000 })).toBe(false);
  expect(offlineAccess({ ...data, subscription: { ...status(), premium_active: false } }, true)).toBe(false);
  await changeOffline(owner, saved => { saved.subscription!.offline_until = new Date(0).toISOString(); });
  setDeviceOffline(true);
  await expect(apiFetch("/api/v1/macros/entries", { method: "POST", body: JSON.stringify(entry) })).rejects.toThrow(/verify.*access/);
  expect((await loadOffline(owner)).edits).toHaveLength(0);
});

test("never presents last week's current plan as this week's", async () => {
  await connect();
  const data = await loadOffline(owner);
  data.cache["/api/v1/weekly-plans/current"] = { at: Date.now() - 8 * 86400000, data: { slots: [] } };
  expect(() => readOffline(data, "/api/v1/weekly-plans/current")).toThrow(/this week's/);
});

test("downloaded recipe search respects collections and cached macro ranges", async () => {
  await connect();
  const data = await loadOffline(owner);
  data.cache["/api/v1/recipes?collection=library&limit=100&offset=0"] = { at: Date.now(), data: [{ id: "shake", name: "Protein shake" }] };
  expect(readOffline(data, "/api/v1/recipes?collection=library&limit=30&offset=0&q=SHAKE")).toEqual([{ id: "shake", name: "Protein shake" }]);
  expect(() => readOffline(data, "/api/v1/recipes?collection=hidden&q=shake")).toThrow(/not downloaded/);
  data.cache["/api/v1/macros/entries?start_date=2026-01-01&end_date=2026-01-31"] = { at: Date.now(), data: [{ id: "old", meal_date: "2026-01-02" }] };
  expect(readOffline(data, "/api/v1/macros/entries?start_date=2026-01-02&end_date=2026-01-02")).toEqual([{ id: "old", meal_date: "2026-01-02" }]);
});

test("zero portions cannot silently create infinite nutrition totals", () => {
  expect(() => macroAfter({ operation_id: "edit", target_id: "zero", kind: "macro_update", label: "Zero", values: { servings_consumed: 1 },
    before: { ...entry, id: "zero", servings_consumed: 0 } as MacroConfirmation })).toThrow(/zero portion/);
});
