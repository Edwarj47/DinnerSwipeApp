import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Button } from "@/components/Button";
import { ThemeColors, useThemedStyles } from "@/components/theme";
import { syncAppearanceIcon, updateAppearance, useAppearance } from "@/services/appearance";
import { ACCENT_OPTIONS, AccentColor, DEFAULT_ACCENT } from "@/services/appearancePalette";
import { appearanceArtwork } from "@/services/appearanceArtwork";
import { useOfflineStatus } from "@/services/offlineStore";

export function AppearanceSettings() {
  const state = useAppearance(), offline = useOfflineStatus(value => value.offline);
  const styles = useThemedStyles(createStyles), client = useQueryClient();
  const { width } = useWindowDimensions();
  const [attempted, setAttempted] = useState<AccentColor>(state.savedAccent);
  const [error, setError] = useState("");
  const disabled = !state.owner || !state.ready || state.pending || offline;
  const choose = (accent: AccentColor) => {
    setAttempted(accent); setError("");
    void updateAppearance(accent, client).catch(reason => setError(reason instanceof Error ? reason.message : "Couldn't save the accent color."));
  };
  return <View style={styles.body}>
    <View style={styles.preview}>
      <Image testID="appearance-icon-preview" source={appearanceArtwork(state.accent)} style={styles.icon} accessibilityLabel={`${state.accent} Dinner Swipe app icon`} />
      <View style={styles.copy}><Text style={styles.heading}>Accent color</Text><Text style={styles.muted}>{ACCENT_OPTIONS.find(option => option.value === state.accent)!.label}</Text></View>
    </View>
    <View style={styles.swatches} accessibilityLabel="Accent colors">
      {ACCENT_OPTIONS.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={`${option.label} accent`}
        aria-checked={state.accent === option.value} aria-disabled={disabled}
        accessibilityState={{ checked: state.accent === option.value, disabled }} disabled={disabled} onPress={() => choose(option.value)}
        style={[styles.option, { flexBasis: width >= 768 ? "12%" : "30%" }, state.accent === option.value && styles.selected]}>
        <View style={[styles.swatch, { backgroundColor: option.color }]}>{state.accent === option.value ? <Ionicons name="checkmark" size={22} color="#ffffff" /> : null}</View>
        <Text style={styles.label}>{option.label}</Text>
      </Pressable>)}
    </View>
    {state.pending ? <Text accessibilityLiveRegion="polite" style={styles.muted}>Saving...</Text> : null}
    {offline ? <Text style={styles.muted}>Offline</Text> : null}
    {state.error || error ? <View style={styles.status}><Text accessibilityRole="alert" style={styles.error}>{state.error || error}</Text><Button label="Retry" icon="refresh" disabled={disabled} onPress={() => choose(attempted)} /></View> : null}
    {state.iconError ? <View style={styles.status}><Text accessibilityRole="alert" style={styles.error}>{state.iconError}</Text><Button label="Retry icon" icon="refresh" onPress={() => { void syncAppearanceIcon(); }} /></View> : null}
    <Button label="Reset to default" icon="refresh" disabled={disabled || state.accent === DEFAULT_ACCENT} onPress={() => choose(DEFAULT_ACCENT)} />
  </View>;
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  body: { gap: 14 }, preview: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 56, height: 56, borderRadius: 8 }, copy: { flex: 1, minWidth: 0 },
  heading: { fontSize: 16, fontWeight: "700", color: colors.ink }, muted: { color: colors.muted, fontSize: 14 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { flexGrow: 1, minWidth: 64, maxWidth: 100, minHeight: 76, alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 2, borderColor: "transparent", borderRadius: 8, padding: 6 },
  selected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  swatch: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 13, color: colors.ink }, error: { color: colors.danger, flex: 1 },
  status: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }
});
