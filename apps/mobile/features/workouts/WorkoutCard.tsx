import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { Colors, shadow } from "@/components/theme";
import { swipeActionForOffset } from "@/features/discover/mealSwipe";
import { WorkoutTemplate } from "./types";
import { WorkoutPhoto, categoryLabel, styles } from "./ui";

export type WorkoutAction = "add" | "skip";
export type WorkoutCardHandle = { choose: (action: WorkoutAction) => void };
// Keep MealCard's spring, timing, thresholds and directional detection without creating a Recipe.
export const WorkoutCard = forwardRef<WorkoutCardHandle, { template: WorkoutTemplate; busy: boolean; proposing: boolean; onAction: (action: WorkoutAction) => void; onOpen: () => void }>(function WorkoutCard({ template, busy, proposing, onAction, onOpen }, ref) {
  const x = useSharedValue(0), y = useSharedValue(0);
  const { height } = useWindowDimensions();
  const [leaving, setLeaving] = useState(false);
  useEffect(() => { x.value = 0; y.value = 0; setLeaving(false); }, [template.id, busy, x, y]);
  const choose = useCallback((action: WorkoutAction) => {
    if (leaving || busy) return;
    setLeaving(true);
    x.value = withTiming(action === "add" ? 620 : -620, { duration: 220 });
    y.value = withTiming(20, { duration: 220 }, finished => { if (finished) runOnJS(onAction)(action); });
  }, [leaving, busy, x, y, onAction]);
  useImperativeHandle(ref, () => ({ choose }), [choose]);
  const gesture = Gesture.Pan().enabled(!busy && !leaving).onUpdate(event => { x.value = event.translationX; y.value = event.translationY; }).onEnd(() => {
    const action = swipeActionForOffset(x.value, y.value, 90);
    if (action === "add" || action === "skip") runOnJS(choose)(action);
    else { x.value = withSpring(0); y.value = withSpring(0); }
  });
  const animated = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { rotate: `${x.value / 24}deg` }] }));
  const plan = useAnimatedStyle(() => ({ opacity: swipeActionForOffset(x.value, y.value) === "add" ? interpolate(x.value, [22, 95], [0, 1], Extrapolation.CLAMP) : 0 }));
  const skip = useAnimatedStyle(() => ({ opacity: swipeActionForOffset(x.value, y.value) === "skip" ? interpolate(x.value, [-95, -22], [1, 0], Extrapolation.CLAMP) : 0 }));
  return <GestureDetector gesture={gesture}><Animated.View style={[local.card, animated]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${template.title}`} disabled={busy || leaving} onPress={onOpen}>
      <WorkoutPhoto template={template} height={height <= 760 ? 180 : 240} />
      <View style={styles.body}><Text style={styles.heading}>{template.title}</Text><Text style={styles.eyebrow}>{categoryLabel(template.category)} / {template.exercises.length} exercises</Text>
        {template.description ? <Text numberOfLines={2} style={styles.muted}>{template.description}</Text> : null}
        <Text numberOfLines={3} style={styles.muted}>{template.exercises.map(item => item.name).join(", ")}</Text>
      </View>
    </Pressable>
    <Animated.View pointerEvents="none" style={[local.badge, { left: 16, borderColor: Colors.basil }, plan]}><Text style={[styles.title, { color: Colors.basil }]}>{proposing ? "PROPOSE" : "PLAN"}</Text></Animated.View>
    <Animated.View pointerEvents="none" style={[local.badge, { right: 16, borderColor: Colors.danger }, skip]}><Text style={[styles.title, { color: Colors.danger }]}>SKIP</Text></Animated.View>
  </Animated.View></GestureDetector>;
});
const local = StyleSheet.create({ card: { borderRadius: 8, overflow: "hidden", backgroundColor: Colors.surface, marginVertical: 12, ...shadow },
  badge: { position: "absolute", top: 20, borderWidth: 2, borderRadius: 8, padding: 10, backgroundColor: Colors.surface } });
