import { Ionicons } from "@expo/vector-icons";
import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { Colors } from "@/components/theme";

type Rect = { x: number; y: number; width: number; height: number };
type Drag = { id: string; label: string; x: number; y: number };
type Controls = {
  begin: (id: string, label: string, x: number, y: number) => void;
  move: (x: number, y: number) => void;
  finish: (x: number, y: number) => void;
  cancel: () => void;
  select: (id: string) => void;
};
const DragControls = createContext<Controls | null>(null);

export function WeekDrag({ days, counts, disabled, onAssign, children }: {
  days: { iso: string; label: string; short: string }[];
  counts: Record<string, number>;
  disabled: boolean;
  onAssign: (slotId: string, date: string | null) => void;
  children: ReactNode;
}) {
  const root = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0, width: 320 });
  const targets = useRef(new Map<string, View>());
  const rects = useRef(new Map<string, Rect>());
  const active = useRef<Drag | null>(null);
  const assignment = useRef(onAssign);
  assignment.current = onAssign;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const hit = useCallback((x: number, y: number) => {
    for (const [key, r] of rects.current) {
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return key;
    }
    return null;
  }, []);
  const cancel = useCallback(() => { active.current = null; setDrag(null); setHover(null); }, []);
  const controls = useMemo<Controls>(() => ({
    begin(id, label, x, y) {
      setSelected(null);
      root.current?.measureInWindow((rx, ry, width) => { origin.current = { x: rx, y: ry, width }; });
      rects.current.clear();
      targets.current.forEach((node, key) => node.measureInWindow((tx, ty, width, height) => {
        rects.current.set(key, { x: tx, y: ty, width, height });
      }));
      active.current = { id, label, x, y };
      setDrag(active.current);
    },
    move(x, y) {
      if (!active.current) return;
      setDrag({ ...active.current, x, y });
      setHover(hit(x, y));
    },
    finish(x, y) {
      const date = hit(x, y);
      if (active.current && date !== null) assignment.current(active.current.id, date || null);
      cancel();
    },
    cancel,
    select(id) { setSelected(id); }
  }), [cancel, hit]);
  return (
    <DragControls.Provider value={controls}>
      <View ref={root} style={styles.root}>
        <View style={styles.days}>
          {[{ iso: "", label: "Any", short: "" }, ...days].map(day => (
            <View key={day.iso} ref={node => { if (node) targets.current.set(day.iso, node); }} collapsable={false} style={styles.dayWrap}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Move meal to ${day.label}`}
                accessibilityState={{ disabled: disabled || !selected, selected: hover === day.iso }}
                disabled={disabled || !selected}
                onPress={() => { if (selected) { onAssign(selected, day.iso || null); setSelected(null); } }}
                style={[styles.day, !!(drag || selected) && styles.ready, hover === day.iso && styles.over]}
              >
                <Text style={[styles.label, hover === day.iso && styles.overText]}>{day.label}</Text>
                <Text style={[styles.count, hover === day.iso && styles.overText]}>{counts[day.iso] || "-"}</Text>
              </Pressable>
            </View>
          ))}
        </View>
        {children}
        {drag ? (
          <View pointerEvents="none" style={[styles.ghost, {
            left: Math.max(0, Math.min(origin.current.width - 220, drag.x - origin.current.x - 110)),
            top: drag.y - origin.current.y + 24
          }]}>
            <Ionicons name="move" size={20} color={Colors.tomato} />
            <Text numberOfLines={2} style={styles.ghostText}>{drag.label}</Text>
          </View>
        ) : null}
      </View>
    </DragControls.Provider>
  );
}

export function WeekDragHandle({ id, label, disabled }: { id: string; label: string; disabled: boolean }) {
  const controls = useContext(DragControls)!;
  const gesture = useMemo(() => {
    const pan = Gesture.Pan().enabled(!disabled).minDistance(7).runOnJS(true)
      .onStart(e => controls.begin(id, label, e.absoluteX, e.absoluteY))
      .onUpdate(e => controls.move(e.absoluteX, e.absoluteY))
      .onEnd(e => controls.finish(e.absoluteX, e.absoluteY))
      .onFinalize(() => controls.cancel());
    const tap = Gesture.Tap().enabled(!disabled).runOnJS(true).onEnd((_, success) => {
      if (success) controls.select(id);
    });
    return Gesture.Exclusive(pan, tap);
  }, [controls, disabled, id, label]);
  return (
    <GestureDetector gesture={gesture} touchAction="none">
      <Pressable accessibilityRole="button" accessibilityLabel={`Move ${label}`} accessibilityHint="Drag to a day, or select a day after pressing" disabled={disabled} onPress={() => controls.select(id)} style={styles.handle}>
        <Ionicons name="reorder-three" size={25} color={Colors.muted} />
      </Pressable>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  days: { flexDirection: "row", gap: 3, paddingVertical: 8, backgroundColor: Colors.background },
  dayWrap: { flex: 1, minWidth: 0 },
  day: { alignItems: "center", justifyContent: "center", minHeight: 52, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  ready: { borderColor: Colors.basil },
  over: { backgroundColor: Colors.basil },
  label: { fontSize: 11, fontWeight: "800", color: Colors.ink },
  count: { fontSize: 12, color: Colors.muted, marginTop: 4 },
  overText: { color: "#fff" },
  handle: { width: 32, minHeight: 44, alignItems: "center", justifyContent: "center" },
  ghost: { position: "absolute", width: 220, zIndex: 100, backgroundColor: Colors.surface, borderColor: Colors.tomato, borderWidth: 2, borderRadius: 8, padding: 12, flexDirection: "row", gap: 8 },
  ghostText: { flex: 1, fontWeight: "800", color: Colors.ink }
});
