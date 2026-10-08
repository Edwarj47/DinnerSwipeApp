import { Ionicons } from "@expo/vector-icons";
import { ReactNode, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Colors } from "@/components/theme";

export function SettingsSection({ title, icon, children, expanded, onToggle, initiallyOpen = false }: {
  title: string; icon: keyof typeof Ionicons.glyphMap; children: ReactNode;
  expanded?: boolean; onToggle?: () => void; initiallyOpen?: boolean;
}) {
  const [localOpen, setLocalOpen] = useState(initiallyOpen);
  const open = expanded ?? localOpen;
  return <View style={styles.section}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${open ? "Collapse" : "Expand"} ${title}`} accessibilityState={{ expanded: open }}
      onPress={onToggle ?? (() => setLocalOpen(!open))} style={styles.heading}>
      <Ionicons name={icon} size={22} color={Colors.basil} /><Text style={styles.title}>{title}</Text>
      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={20} color={Colors.muted} />
    </Pressable>
    {open ? <View style={styles.content}>{children}</View> : null}
  </View>;
}
const styles = StyleSheet.create({
  section: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Colors.border },
  heading: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingVertical: 10 },
  title: { flex: 1, minWidth: 0, color: Colors.ink, fontSize: 16, fontWeight: "700" },
  content: { gap: 12, paddingBottom: 14 }
});
