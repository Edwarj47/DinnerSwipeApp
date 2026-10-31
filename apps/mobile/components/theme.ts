import { useMemo } from "react";
import { useAppearance } from "@/services/appearanceState";
import { ACCENT_OPTIONS, AccentColor, accentPalette } from "@/services/appearancePalette";

export const Colors = {
  background: "#fff6f3",
  surface: "#ffffff",
  ink: "#24211f",
  muted: "#756f68",
  border: "#eaded2",
  tomato: "#d71920",
  tomatoDark: "#9f1117",
  softRed: "#fff0ef",
  basil: "#2f7d59",
  corn: "#f2c14e",
  blue: "#2d6cdf",
  danger: "#b3261e"
};

export function themeColors(accent: AccentColor) { return { ...Colors, ...accentPalette(accent) }; }
export type ThemeColors = ReturnType<typeof themeColors>;
const palettes = Object.fromEntries(ACCENT_OPTIONS.map(option => [option.value, themeColors(option.value)])) as Record<AccentColor, ThemeColors>;
export function useThemeColors() { return palettes[useAppearance(state => state.accent)]; }
export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): T {
  const colors = useThemeColors();
  return useMemo(() => factory(colors), [factory, colors]);
}

export const shadow = {
  shadowColor: "#000",
  shadowOpacity: 0.12,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 6 },
  elevation: 4
};
