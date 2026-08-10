import { Image } from "expo-image";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
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

export type MealCardHandle = {
  choose: (action: MealAction) => void;
};

type Props = {
  recipe: Recipe;
  onAction: (action: MealAction) => void;
  onOpen: () => void;
};

const EXIT_TARGETS: Record<MealAction, { x: number; y: number }> = {
  add: { x: 620, y: 20 },
  skip: { x: -620, y: 20 },
  favorite: { x: 0, y: -760 },
  hide: { x: 0, y: 760 }
};

export const MealCard = forwardRef<MealCardHandle, Props>(function MealCard({ recipe, onAction, onOpen }, ref) {
  const [isLeaving, setIsLeaving] = useState(false);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  useEffect(() => {
    translateX.value = 0;
    translateY.value = 0;
    setIsLeaving(false);
  }, [recipe.id, translateX, translateY]);

  const choose = useCallback((action: MealAction) => {
    if (isLeaving) return;
    const target = EXIT_TARGETS[action];
    setIsLeaving(true);
    translateX.value = withTiming(target.x, { duration: 220 });
    translateY.value = withTiming(target.y, { duration: 220 }, (finished) => {
      if (finished) runOnJS(onAction)(action);
    });
  }, [isLeaving, onAction, translateX, translateY]);

  useImperativeHandle(ref, () => ({ choose }), [choose]);

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
});

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: 8, overflow: "hidden", ...shadow },
  image: { width: "100%", aspectRatio: 1.05, backgroundColor: Colors.border },
  body: { padding: 16, gap: 10 },
  header: { flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "flex-start" },
  title: { color: Colors.ink, fontSize: 26, lineHeight: 31, fontWeight: "800", flex: 1 },
  favorite: { color: Colors.basil, fontWeight: "800", fontSize: 12, textTransform: "uppercase" },
  meta: { color: Colors.muted, fontSize: 14 },
  ingredients: { color: Colors.ink, fontSize: 15, lineHeight: 21 },
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
