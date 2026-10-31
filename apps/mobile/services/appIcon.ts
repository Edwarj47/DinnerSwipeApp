import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { AccentColor } from "./appearancePalette";

type IconModule = { isSupported: () => boolean; getCurrentIcon: () => Promise<string>; setIcon: (accent: string) => Promise<void> };
function nativeModule(): IconModule | null {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return null;
  try {
    return requireOptionalNativeModule<IconModule>("DinnerSwipeAppIcons");
  } catch { return null; }
}
export function appIconSupported() { return Boolean(nativeModule()?.isSupported()); }
export async function applyAppIcon(accent: AccentColor) {
  const module = nativeModule();
  if (!module?.isSupported()) return;
  if (await module.getCurrentIcon() !== accent) await module.setIcon(accent);
}
