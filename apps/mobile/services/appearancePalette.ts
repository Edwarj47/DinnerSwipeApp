import presets from "./appearancePresets.json";
export type AccentColor = keyof typeof presets;
export const DEFAULT_ACCENT: AccentColor = "black";
export const ACCENT_OPTIONS = Object.entries(presets).map(([value, option]) => ({ ...option, value: value as AccentColor }));
export type AppearancePreferences = { accent: AccentColor };
export function parseAppearance(value: unknown): AppearancePreferences {
  const accent = value && typeof value === "object" ? (value as { accent?: unknown }).accent : undefined;
  return { accent: ACCENT_OPTIONS.some(option => option.value === accent) ? accent as AccentColor : DEFAULT_ACCENT };
}
function blend(hex: string, target: number, amount: number) {
  return "#" + [1, 3, 5].map(index => Math.round(parseInt(hex.slice(index, index + 2), 16) * (1 - amount) + target * amount).toString(16).padStart(2, "0")).join("");
}
export function accentPalette(accent: AccentColor) {
  const color = presets[accent].color;
  return accent === "red" ? { accent: color, accentStrong: "#9f1117", accentSoft: "#fff0ef", accentTrack: "#f4aaa8", accentFrame: "#ffd9d6", onAccent: "#ffffff" }
    : { accent: color, accentStrong: blend(color, 0, .25), accentSoft: blend(color, 255, .94), accentTrack: blend(color, 255, .65), accentFrame: blend(color, 255, .84), onAccent: "#ffffff" };
}
