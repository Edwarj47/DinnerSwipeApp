import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming
} from "react-native-reanimated";

import { Colors, shadow } from "@/components/theme";
import { Recipe } from "@/services/types";

type MealAction = "add" | "skip" | "favorite" | "hide";

type Props = {
  recipe: Recipe;
  onAction: (action: MealAction) => void;
  onOpen: () => void;
};

const ACTIONS: {
  value: MealAction;
  label: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: "primary" | "neutral" | "danger";
  exitX: number;
  exitY: number;
}[] = [
  { value: "add", label: "Plan it", hint: "adds to This Week", icon: "add-circle", tone: "primary", exitX: 620, exitY: 20 },
  { value: "skip", label: "Skip", hint: "not this session", icon: "close-circle", tone: "neutral", exitX: -620, exitY: 20 },
  { value: "favorite", label: "Favorite", hint: "save for later", icon: "heart", tone: "primary", exitX: 0, exitY: -760 },
  { value: "hide", label: "Never show", hint: "hide suggestion", icon: "eye-off", tone: "danger", exitX: 0, exitY: 760 }
];

export function MealCard({ recipe, onAction, onOpen }: Props) {
  const [isLeaving, setIsLeaving] = useState(false);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  function choose(action: MealAction) {
    if (isLeaving) return;
    const target = ACTIONS.find((item) => item.value === action);
    if (!target) return;
    setIsLeaving(true);
    translateX.value = withTiming(target.exitX, { duration: 220 });
    translateY.value = withTiming(target.exitY, { duration: 220 }, (finished) => {
      if (finished) runOnJS(onAction)(action);
    });
  }

  const gesture = Gesture.Pan()
    .onUpdate((event) => {
      translateX.value = event.translationX;
      translateY.value = event.translationY;
    })
    .onEnd(() => {
      const x = translateX.value;
      const y = translateY.value;
      const absX = Math.abs(x);
      const absY = Math.abs(y);
      if (absX < 90 && absY < 90) {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        return;
      }
      if (absX >= absY) {
        if (x > 90) runOnJS(choose)("add");
        if (x < -90) runOnJS(choose)("skip");
        return;
      }
      if (y < -90) runOnJS(choose)("favorite");
      if (y > 90) runOnJS(choose)("hide");
    });
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { rotate: `${translateX.value / 24}deg` }]
  }));
  const planIndicator = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [22, 95], [0, 1], Extrapolation.CLAMP),
    transform: [
      { rotate: "-8deg" },
      { scale: interpolate(translateX.value, [22, 95], [0.92, 1], Extrapolation.CLAMP) }
    ]
  }));
  const skipIndicator = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-95, -22], [1, 0], Extrapolation.CLAMP),
    transform: [
      { rotate: "8deg" },
      { scale: interpolate(translateX.value, [-95, -22], [1, 0.92], Extrapolation.CLAMP) }
    ]
  }));
  const favoriteIndicator = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [-105, -26], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(translateY.value, [-105, -26], [1, 0.92], Extrapolation.CLAMP) }]
  }));
  const hideIndicator = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [26, 105], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(translateY.value, [26, 105], [0.92, 1], Extrapolation.CLAMP) }]
  }));
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.card, animated]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${recipe.name}`} onPress={onOpen}>
          <Image
            source={{ uri: recipe.photo_url ?? undefined }}
            placeholder={require("../../assets/icon.png")}
            accessibilityLabel={recipe.name}
            style={styles.image}
            contentFit="cover"
          />
          <View style={styles.body}>
            <View style={styles.header}>
              <Text style={styles.title}>{recipe.name}</Text>
              <Text style={styles.favorite}>{recipe.is_favorite ? "Favorite" : recipe.source_type}</Text>
            </View>
            <Text style={styles.meta}>
              {recipe.total_minutes ?? "?"} min • prep {recipe.prep_minutes ?? "?"} • {recipe.difficulty} • {recipe.meal_type}
            </Text>
            <Text style={styles.meta}>Serves {recipe.servings}</Text>
            <Text numberOfLines={2} style={styles.ingredients}>
              {recipe.ingredients.map((item) => item.normalized_name).slice(0, 6).join(", ")}
            </Text>
          </View>
        </Pressable>
        <View style={styles.picklist}>
          <Text style={styles.picklistTitle}>Choose</Text>
          <View style={styles.optionGrid}>
            {ACTIONS.map((item) => (
              <Pressable
                key={item.value}
                accessibilityRole="button"
                accessibilityLabel={`${item.label}: ${item.hint}`}
                disabled={isLeaving}
                onPress={() => choose(item.value)}
                style={[
                  styles.option,
                  item.tone === "primary" ? styles.optionPrimary : null,
                  item.tone === "danger" ? styles.optionDanger : null
                ]}
              >
                <Ionicons
                  name={item.icon}
                  size={19}
                  color={item.tone === "danger" ? Colors.danger : item.tone === "primary" ? Colors.tomato : Colors.ink}
                />
                <View style={styles.optionText}>
                  <Text style={styles.optionLabel}>{item.label}</Text>
                  <Text style={styles.optionHint}>{item.hint}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
        <Animated.View pointerEvents="none" style={[styles.swipeBadge, styles.planBadge, planIndicator]}>
          <Text style={[styles.swipeBadgeText, styles.planBadgeText]}>PLAN</Text>
          <Text style={styles.swipeHint}>Add to week</Text>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.swipeBadge, styles.skipBadge, skipIndicator]}>
          <Text style={[styles.swipeBadgeText, styles.skipBadgeText]}>SKIP</Text>
          <Text style={styles.swipeHint}>Not now</Text>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.swipeBadge, styles.favoriteBadge, favoriteIndicator]}>
          <Text style={[styles.swipeBadgeText, styles.favoriteBadgeText]}>FAVORITE</Text>
          <Text style={styles.swipeHint}>Save idea</Text>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.swipeBadge, styles.hideBadge, hideIndicator]}>
          <Text style={[styles.swipeBadgeText, styles.hideBadgeText]}>HIDE</Text>
          <Text style={styles.swipeHint}>Never show</Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: 8, overflow: "hidden", ...shadow },
  image: { width: "100%", aspectRatio: 1.05, backgroundColor: Colors.border },
  body: { padding: 16, gap: 10 },
  header: { flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "flex-start" },
  title: { color: Colors.ink, fontSize: 26, lineHeight: 31, fontWeight: "800", flex: 1 },
  favorite: { color: Colors.basil, fontWeight: "800", fontSize: 12, textTransform: "uppercase" },
  meta: { color: Colors.muted, fontSize: 14 },
  ingredients: { color: Colors.ink, fontSize: 15, lineHeight: 21 },
  picklist: { borderTopWidth: 1, borderTopColor: Colors.border, padding: 12, gap: 9, backgroundColor: "#fffaf8" },
  picklistTitle: { color: Colors.ink, fontWeight: "900", fontSize: 13, textTransform: "uppercase" },
  optionGrid: { gap: 8 },
  option: {
    minHeight: 52,
    borderRadius: 8,
    borderColor: Colors.border,
    borderWidth: 1,
    backgroundColor: Colors.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12
  },
  optionPrimary: { borderColor: "#f1bab6", backgroundColor: Colors.softRed },
  optionDanger: { borderColor: "#efbbb7", backgroundColor: "#fff2f0" },
  optionText: { flex: 1 },
  optionLabel: { color: Colors.ink, fontWeight: "900", fontSize: 15 },
  optionHint: { color: Colors.muted, fontSize: 12, marginTop: 1 },
  swipeBadge: {
    position: "absolute",
    borderRadius: 8,
    borderWidth: 2,
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
    gap: 2
  },
  planBadge: { top: 22, left: 18, borderColor: Colors.basil },
  skipBadge: { top: 22, right: 18, borderColor: Colors.danger },
  favoriteBadge: { top: "34%", alignSelf: "center", borderColor: Colors.corn },
  hideBadge: { bottom: "28%", alignSelf: "center", borderColor: Colors.danger },
  swipeBadgeText: { fontSize: 24, lineHeight: 28, fontWeight: "900" },
  planBadgeText: { color: Colors.basil },
  skipBadgeText: { color: Colors.danger },
  favoriteBadgeText: { color: Colors.tomatoDark },
  hideBadgeText: { color: Colors.danger },
  swipeHint: { color: Colors.ink, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }
});
