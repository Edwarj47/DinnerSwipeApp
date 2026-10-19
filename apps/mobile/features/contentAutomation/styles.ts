import { StyleSheet } from "react-native";
import { Colors } from "@/components/theme";

export const styles = StyleSheet.create({
  content: { gap: 12, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  wrap: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  copy: { flex: 1, minWidth: 0 },
  loading: { width: 20, height: 20, flexShrink: 0 },
  title: { color: Colors.ink, fontSize: 16, lineHeight: 22, fontWeight: "700", flexShrink: 1 },
  label: { color: Colors.ink, fontSize: 14, lineHeight: 21, fontWeight: "700", flexShrink: 1 },
  text: { color: Colors.ink, fontSize: 14, lineHeight: 21, flexShrink: 1 },
  meta: { color: Colors.muted, fontSize: 13, lineHeight: 20, flexShrink: 1 },
  error: { color: Colors.danger, fontSize: 13, lineHeight: 20 },
  success: { color: Colors.basil, fontSize: 13, lineHeight: 20 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: Colors.border, paddingTop: 12, gap: 8 },
  batch: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Colors.border, paddingBottom: 12, gap: 8 },
  heading: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, minHeight: 48 },
  checkbox: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  checkIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  disabled: { opacity: 0.45 },
  candidate: { flexDirection: "row", gap: 8, alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Colors.border, paddingVertical: 8 },
  backdrop: { flex: 1, justifyContent: "flex-end", alignItems: "center", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { width: "100%", maxWidth: 640, maxHeight: "90%", backgroundColor: Colors.surface, borderTopLeftRadius: 8, borderTopRightRadius: 8, padding: 16, gap: 12 },
  preview: { gap: 14, paddingBottom: 24 },
  photo: { width: "100%", aspectRatio: 16 / 9, backgroundColor: Colors.softRed },
  step: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  stepNumber: { width: 26, textAlign: "center", color: Colors.basil, fontWeight: "700", lineHeight: 21 }
});
