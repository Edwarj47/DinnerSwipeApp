import { Ionicons } from "@expo/vector-icons";
import { createContext, useContext, useEffect, useRef } from "react";
import { Platform, Pressable, StyleSheet, ViewInstance } from "react-native";
import { useThemeColors, useThemedStyles, ThemeColors } from "@/components/theme";
import { openSettings } from "@/services/settingsMenu";

export const SettingsContext = createContext<{ invitePremium: () => void; close: () => void; open: boolean } | null>(null);
export const useSettingsMenu = () => useContext(SettingsContext);

export function SettingsButton() {
  const styles = useThemedStyles(createStyles);
  const Colors = useThemeColors();
  const settings = useSettingsMenu();
  const ref = useRef<ViewInstance>(null);
  useEffect(() => { if (Platform.OS === "web") (ref.current as unknown as HTMLElement | null)?.setAttribute("title", "User and group settings"); }, []);
  if (!settings) return null;
  return <Pressable ref={ref} accessibilityRole="button" accessibilityLabel="Open settings" accessibilityState={{ expanded: settings.open }} onPress={() => openSettings()}
    style={[styles.avatar, settings.open && styles.active]}>
    <Ionicons name="person-outline" size={24} color={Colors.accent} />
  </Pressable>;
}
const createStyles = (Colors: ThemeColors) => (StyleSheet.create({
  avatar: { width: 44, height: 44, borderRadius: 22, flexShrink: 0, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  active: { borderColor: Colors.accent, backgroundColor: Colors.accentSoft }
}));
