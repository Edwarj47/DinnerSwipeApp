import { Ionicons } from "@expo/vector-icons";
import { ReactNode, useContext, useEffect, useRef } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Colors, shadow } from "@/components/theme";
import { TourScrollContext, useGuidedTour } from "./TourContext";

// In-flow callouts never cover a control or capture its gestures.
export function TourTarget({ id, children, fill = false }: { id: string; children: ReactNode; fill?: boolean }) {
  const tour = useGuidedTour();
  const reveal = useContext(TourScrollContext);
  const node = useRef<View>(null);
  const active = tour?.step.id === id;
  const expanded = active && tour?.expanded;
  useEffect(() => {
    if (!active) return;
    AccessibilityInfo.announceForAccessibility(tour.step.title);
    const timer = setTimeout(() => { if (node.current) reveal?.(node.current); }, 100);
    return () => clearTimeout(timer);
  }, [active, expanded, tour?.visit, tour?.step.title, reveal]);
  return <View ref={node} collapsable={false} testID={`tour-target-${id}`} style={fill ? styles.fill : undefined} onLayout={() => { if (expanded && node.current) reveal?.(node.current); }}>
    {expanded ? <View style={styles.callout} testID="tour-callout">
      <View style={styles.heading}><Ionicons name="compass-outline" size={20} color={Colors.basil} />
        <Text accessibilityRole="header" style={styles.title}>{tour.step.title}</Text></View>
      <Text style={styles.body}>{tour.step.body}</Text>
      <View style={styles.actions}>
        <Button label="Try it" icon="hand-left-outline" variant="primary" onPress={tour.collapse} />
        <Button label="Skip section" icon="play-skip-forward-outline" onPress={tour.skipSection} />
      </View>
      <View pointerEvents="none" style={styles.pointer} />
    </View> : null}
    <View style={fill ? styles.fill : undefined}>{children}{active ? <View testID="tour-highlight" pointerEvents="none" style={styles.highlight} /> : null}</View>
  </View>;
}
const styles = StyleSheet.create({
  fill: { flexGrow: 1 },
  callout: { marginVertical: 10, backgroundColor: Colors.surface, padding: 14, borderRadius: 8, borderColor: Colors.basil, borderWidth: 1, gap: 10, ...shadow },
  heading: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, color: Colors.ink, fontSize: 17, fontWeight: "800", lineHeight: 22 },
  body: { color: Colors.muted, fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pointer: { position: "absolute", bottom: -6, left: 24, width: 10, height: 10, backgroundColor: Colors.surface, borderRightWidth: 1, borderBottomWidth: 1, borderColor: Colors.basil, transform: [{ rotate: "45deg" }] },
  highlight: { ...StyleSheet.absoluteFillObject, borderWidth: 2, borderColor: Colors.basil, borderRadius: 8 }
});
