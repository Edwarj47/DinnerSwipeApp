import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { useState } from "react";
import { StyleSheet, TextInput } from "react-native";
import { Button } from "@/components/Button";
import { themeColors } from "@/components/theme";
import { AppearanceSettings } from "@/features/settings/AppearanceSettings";
import { apiFetch } from "@/services/api";
import { applyAppIcon } from "@/services/appIcon";
import { resetAppearance, restoreAppearance, seedAppearance, syncAppearanceIcon, updateAppearance, useAppearance } from "@/services/appearance";
import { ACCENT_OPTIONS, parseAppearance } from "@/services/appearancePalette";
import { setDeviceOffline, setOfflineOwner } from "@/services/offlineStore";
import { UserProfile } from "@/services/types";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: jest.requireActual("react-native").Image }));
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/services/appIcon", () => ({ applyAppIcon: jest.fn(async () => undefined) }));
const request = jest.mocked(apiFetch), icon = jest.mocked(applyAppIcon);
let client: QueryClient;
function profile(accent: string) { return { appearance_preferences: { accent } } as UserProfile; }

beforeEach(async () => {
  jest.clearAllMocks(); await AsyncStorage.clear();
  setOfflineOwner("owner-a"); resetAppearance("owner-a"); setDeviceOffline(false);
  seedAppearance({ accent: "red" }, "owner-a");
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  request.mockImplementation(async (_path, init) => profile(JSON.parse(String(init?.body)).accent));
});
afterEach(async () => { client.clear(); setOfflineOwner(null); await syncAppearanceIcon(); });

test("preset parsing is allowlisted and contrast is readable", () => {
  expect(parseAppearance({ accent: "#fff" })).toEqual({ accent: "red" });
  expect(parseAppearance(null)).toEqual({ accent: "red" });
  const luminance = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, index) => sum + c * [.2126, .7152, .0722][index], 0);
  for (const option of ACCENT_OPTIONS) {
    const colors = themeColors(option.value);
    expect(1.05 / (luminance(colors.accent) + .05)).toBeGreaterThanOrEqual(4.5);
    expect(colors.danger).toBe("#b3261e"); expect(colors.background).toBe("#fff6f3");
  }
});

test("optimistic preview saves before requesting a native icon change", async () => {
  let resolve!: (value: UserProfile) => void;
  request.mockImplementation(() => new Promise(done => { resolve = done; }));
  const task = updateAppearance("blue", client);
  expect(useAppearance.getState()).toMatchObject({ accent: "blue", savedAccent: "red", pending: true });
  expect(icon).not.toHaveBeenCalled();
  await waitFor(() => expect(resolve).toBeDefined()); resolve(profile("blue")); await task;
  expect(request).toHaveBeenCalledWith("/api/v1/profile/appearance", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ accent: "blue" }) }));
  expect(useAppearance.getState()).toMatchObject({ accent: "blue", savedAccent: "blue", pending: false });
  expect(icon).toHaveBeenCalledWith("blue");
  expect(client.getQueryData(["profile"])).toMatchObject(profile("blue"));
});

test("failed saves restore the last saved palette and do not switch the icon", async () => {
  request.mockRejectedValue(new Error("Network unavailable"));
  await updateAppearance("purple", client);
  expect(useAppearance.getState()).toMatchObject({ accent: "red", pending: false });
  expect(useAppearance.getState().error).toContain("Couldn't save");
  expect(icon).not.toHaveBeenCalled();
});

test("native icon failure does not roll back a saved account preference", async () => {
  icon.mockRejectedValueOnce(new Error("Launcher unavailable"));
  await updateAppearance("green", client);
  expect(useAppearance.getState()).toMatchObject({ accent: "green", savedAccent: "green", iconError: "Couldn't update the app icon." });
  await syncAppearanceIcon(); expect(useAppearance.getState().iconError).toBe("");
});

test("late saves cannot affect another account", async () => {
  let resolve!: (value: UserProfile) => void;
  request.mockImplementation(() => new Promise(done => { resolve = done; }));
  const task = updateAppearance("orange", client);
  await waitFor(() => expect(resolve).toBeDefined());
  setOfflineOwner("owner-b"); seedAppearance({ accent: "teal" }, "owner-b");
  resolve(profile("orange")); await task;
  expect(useAppearance.getState()).toMatchObject({ owner: "owner-b", accent: "teal", savedAccent: "teal", pending: false });
  expect(client.getQueryData(["profile"])).toBeUndefined(); expect(icon).not.toHaveBeenCalled();
});

test("cached preferences are account scoped and an older restore cannot override server preferences", async () => {
  await updateAppearance("purple", client);
  resetAppearance("owner-a"); await restoreAppearance("owner-a");
  expect(useAppearance.getState().accent).toBe("purple");
  setOfflineOwner("owner-b"); await restoreAppearance("owner-b"); expect(useAppearance.getState().accent).toBe("red");
  let resolve!: (value: string) => void;
  jest.spyOn(AsyncStorage, "getItem").mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const restore = restoreAppearance("owner-b");
  seedAppearance({ accent: "blue" }, "owner-b"); resolve(JSON.stringify({ accent: "orange" })); await restore;
  expect(useAppearance.getState().accent).toBe("blue"); jest.restoreAllMocks();
});

test("offline color changes are not queued or sent", async () => {
  setDeviceOffline(true);
  await expect(updateAppearance("blue", client)).rejects.toThrow("Connect");
  expect(request).not.toHaveBeenCalled(); expect(useAppearance.getState().accent).toBe("red");
});

test("logout clears the theme and resets the native icon", async () => {
  await updateAppearance("teal", client); setOfflineOwner(null); await syncAppearanceIcon();
  expect(useAppearance.getState()).toMatchObject({ owner: null, accent: "red", savedAccent: "red" });
  expect(icon).toHaveBeenLastCalledWith("red");
});

function Form() {
  const [draft, setDraft] = useState("");
  return <><TextInput accessibilityLabel="Preserved draft" value={draft} onChangeText={setDraft} /><Button label="Primary action" variant="primary" onPress={() => undefined} /></>;
}
test("existing controls react to theme changes without remounting form drafts", () => {
  const screen = render(<Form />);
  try {
    fireEvent.changeText(screen.getByLabelText("Preserved draft"), "Keep my meal");
    act(() => seedAppearance({ accent: "blue" }, "owner-a"));
    expect(screen.getByLabelText("Preserved draft").props.value).toBe("Keep my meal");
    expect(StyleSheet.flatten(screen.getByLabelText("Primary action").props.style).backgroundColor).toBe("#2d6cdf");
  } finally { screen.unmount(); }
});

test("Appearance swatches select, save and reset without a Premium requirement", async () => {
  const screen = render(<QueryClientProvider client={client}><AppearanceSettings /></QueryClientProvider>);
  try {
    fireEvent.press(screen.getByLabelText("Teal accent"));
    await waitFor(() => expect(screen.getByLabelText("Teal accent").props.accessibilityState).toMatchObject({ checked: true, disabled: false }));
    fireEvent.press(screen.getByLabelText("Reset to default"));
    await waitFor(() => expect(screen.getByLabelText("Red accent").props.accessibilityState.checked).toBe(true));
    await waitFor(() => expect(useAppearance.getState().pending).toBe(false));
  } finally { screen.unmount(); }
});
