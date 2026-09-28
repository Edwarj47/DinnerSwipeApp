import { Ionicons } from "@expo/vector-icons";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { Colors } from "@/components/theme";
import { dragScrollOffset, findDropDay, Rect } from "./weekDrop";

type Drag = { id: string; label: string; x: number; y: number };
type Controls = {
  begin: (id: string, label: string, x: number, y: number) => void;
  move: (x: number, y: number) => void;
  finish: (x: number, y: number) => void;
  cancel: () => void;
  select: (id: string, label: string) => void;
  register: (day: string, node: View | null) => void;
};
const DragControls = createContext<Controls | null>(null);
const HoverDay = createContext<string | null>(null);

export function WeekDrag({ days, disabled, onAssign, children }: {
  days: { iso: string; label: string; short: string }[];
  disabled: boolean;
  onAssign: (slotId: string, date: string | null) => void;
  children: ReactNode;
}) {
  const root = useRef<View>(null);
  const scroll = useRef<ScrollView>(null);
  const viewport = useRef<Rect>({ x: 0, y: 0, width: 320, height: 0 });
  const offset = useRef(0);
  const contentHeight = useRef(0);
  const targets = useRef(new Map<string, View>());
  const rects = useRef(new Map<string, Rect>());
  const active = useRef<Drag | null>(null);
  const assignment = useRef(onAssign);
  const isDisabled = useRef(disabled);
  assignment.current = onAssign;
  isDisabled.current = disabled;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ id: string; label: string } | null>(null);
  const measure = useCallback(() => {
    root.current?.measureInWindow((x, y, width, height) => { viewport.current = { x, y, width, height }; });
    targets.current.forEach((node, key) => node.measureInWindow((x, y, width, height) => {
      if (targets.current.get(key) === node) rects.current.set(key, { x, y, width, height });
    }));
  }, []);
  const cancel = useCallback(() => { active.current = null; setDrag(null); setHover(null); }, []);
  const controls = useMemo<Controls>(() => ({
    begin(id, label, x, y) {
      if (isDisabled.current) return;
      setSelected(null);
      measure();
      active.current = { id, label, x, y };
      setDrag(active.current);
    },
    move(x, y) {
      if (!active.current) return;
      active.current = { ...active.current, x, y };
      setDrag(active.current);
      setHover(findDropDay(rects.current, viewport.current, x, y));
    },
    finish(x, y) {
      const day = findDropDay(rects.current, viewport.current, x, y);
      if (active.current && day !== null && !isDisabled.current) assignment.current(active.current.id, day || null);
      cancel();
    },
    cancel,
    select(id, label) { if (!isDisabled.current) setSelected({ id, label }); },
    register(day, node) {
      if (node) targets.current.set(day, node);
      else { targets.current.delete(day); rects.current.delete(day); }
    }
  }), [cancel, measure]);
  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) return;
    // Scrolling changes screen coordinates, so refresh targets throughout a drag.
    const timer = setInterval(() => {
      const item = active.current;
      if (!item) return;
      const next = dragScrollOffset(offset.current, item.y, viewport.current, contentHeight.current);
      if (next !== offset.current) scroll.current?.scrollTo({ y: next, animated: false });
      measure();
      setHover(findDropDay(rects.current, viewport.current, item.x, item.y));
    }, 40);
    return () => clearInterval(timer);
  }, [dragging, measure]);
  useEffect(() => { if (disabled) { cancel(); setSelected(null); } }, [disabled, cancel]);

  return (
    <DragControls.Provider value={controls}>
      <HoverDay.Provider value={hover}>
        <View ref={root} style={styles.root} onLayout={measure}>
          <ScrollView ref={scroll} scrollEnabled={!dragging} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled"
            onContentSizeChange={(_, height) => { contentHeight.current = height; measure(); }}
            onScroll={event => { offset.current = event.nativeEvent.contentOffset.y; if (active.current) measure(); }} scrollEventThrottle={16}>
            {children}
          </ScrollView>
          {drag ? (
            <View pointerEvents="none" style={[styles.ghost, {
              left: Math.max(0, Math.min(viewport.current.width - 220, drag.x - viewport.current.x - 110)),
              top: Math.max(0, Math.min(viewport.current.height - 64, drag.y - viewport.current.y + 18))
            }]}><Ionicons name="move" size={20} color={Colors.tomato} /><Text numberOfLines={2} style={styles.ghostText}>{drag.label}</Text></View>
          ) : null}
        </View>
        <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
          <View style={styles.backdrop}><View style={styles.picker} accessibilityViewIsModal>
            <View style={styles.heading}><Text style={styles.title}>Move {selected?.label}</Text><Pressable accessibilityRole="button" accessibilityLabel="Cancel move" onPress={() => setSelected(null)} style={styles.close}><Ionicons name="close" size={24} color={Colors.ink} /></Pressable></View>
            <ScrollView>
              {[...days, { iso: "", label: "Unscheduled", short: "" }].map(day => (
                <Pressable key={day.iso} accessibilityRole="button" accessibilityLabel={`Move to ${day.label}`} disabled={disabled} style={styles.choice} onPress={() => {
                  if (selected) onAssign(selected.id, day.iso || null);
                  setSelected(null);
                }}><Text style={styles.choiceText}>{day.label}</Text><Text style={styles.date}>{day.short}</Text><Ionicons name="chevron-forward" size={18} color={Colors.muted} /></Pressable>
              ))}
            </ScrollView>
          </View></View>
        </Modal>
      </HoverDay.Provider>
    </DragControls.Provider>
  );
}

export function WeekDropDay({ day, children }: { day: string; children: ReactNode }) {
  const controls = useContext(DragControls)!;
  const hover = useContext(HoverDay);
  const register = useCallback((node: View | null) => controls.register(day, node), [controls, day]);
  return <View testID={`week-day-${day || "unscheduled"}`} ref={register} collapsable={false} style={[styles.day, hover === day && styles.over]}>{children}</View>;
}

export function WeekDragHandle({ id, label, disabled }: { id: string; label: string; disabled: boolean }) {
  const controls = useContext(DragControls)!;
  const gesture = useMemo(() => Gesture.Pan().enabled(!disabled).minDistance(7).runOnJS(true)
    .onStart(e => controls.begin(id, label, e.absoluteX, e.absoluteY))
    .onUpdate(e => controls.move(e.absoluteX, e.absoluteY))
    .onEnd(e => controls.finish(e.absoluteX, e.absoluteY))
    .onFinalize(() => controls.cancel()), [controls, disabled, id, label]);
  return (
    <GestureDetector gesture={gesture} touchAction="none">
      <Pressable accessibilityRole="button" accessibilityLabel={`Move ${label}`} accessibilityHint="Drag to a day, or tap to choose a day" disabled={disabled} onPress={() => controls.select(id, label)} style={styles.handle}>
        <Ionicons name="reorder-three" size={25} color={Colors.muted} />
      </Pressable>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  list: { gap: 18, paddingBottom: 24 },
  day: { gap: 8, padding: 4, borderWidth: 1, borderColor: "transparent", borderBottomColor: Colors.border, minHeight: 112 },
  over: { borderColor: Colors.basil, backgroundColor: "#edf6ef" },
  handle: { width: 32, minHeight: 48, alignItems: "center", justifyContent: "center" },
  ghost: { position: "absolute", width: 220, zIndex: 100, backgroundColor: Colors.surface, borderColor: Colors.tomato, borderWidth: 2, borderRadius: 8, padding: 12, flexDirection: "row", gap: 8 },
  ghostText: { flex: 1, fontWeight: "800", color: Colors.ink },
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "rgba(0,0,0,0.45)" },
  picker: { width: "100%", maxWidth: 420, maxHeight: "85%", borderRadius: 8, backgroundColor: Colors.surface, padding: 16 },
  heading: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 18, fontWeight: "800", color: Colors.ink, flex: 1 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  choice: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, borderBottomWidth: 1, borderColor: Colors.border },
  choiceText: { flex: 1, color: Colors.ink, fontWeight: "700" },
  date: { color: Colors.muted }
});
