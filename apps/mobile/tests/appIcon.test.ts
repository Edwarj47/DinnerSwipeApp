import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { appIconSupported, applyAppIcon } from "@/services/appIcon";

jest.mock("expo-modules-core", () => ({ requireOptionalNativeModule: jest.fn() }));
const load = jest.mocked(requireOptionalNativeModule);
beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

test.each(["android", "ios"] as const)("supported %s builds select only a different registered icon", async platform => {
  jest.replaceProperty(Platform, "OS", platform);
  const module = { isSupported: () => true, getCurrentIcon: jest.fn(async () => "red"), setIcon: jest.fn(async () => undefined) };
  load.mockReturnValue(module);
  expect(appIconSupported()).toBe(true);
  await applyAppIcon("blue"); expect(module.setIcon).toHaveBeenCalledWith("blue");
  module.getCurrentIcon.mockResolvedValue("blue"); module.setIcon.mockClear();
  await applyAppIcon("blue"); expect(module.setIcon).not.toHaveBeenCalled();
  await applyAppIcon("black"); expect(module.setIcon).toHaveBeenCalledWith("black");
});

test("web and older native builds safely skip unavailable icon APIs", async () => {
  jest.replaceProperty(Platform, "OS", "web");
  await applyAppIcon("green"); expect(load).not.toHaveBeenCalled(); expect(appIconSupported()).toBe(false);
  jest.replaceProperty(Platform, "OS", "android"); load.mockReturnValue(null);
  await expect(applyAppIcon("purple")).resolves.toBeUndefined(); expect(appIconSupported()).toBe(false);
});

test("native errors propagate to the separate, retryable icon status", async () => {
  jest.replaceProperty(Platform, "OS", "ios");
  load.mockReturnValue({ isSupported: () => true, getCurrentIcon: async () => "red", setIcon: async () => { throw new Error("Unavailable"); } });
  await expect(applyAppIcon("teal")).rejects.toThrow("Unavailable");
});
