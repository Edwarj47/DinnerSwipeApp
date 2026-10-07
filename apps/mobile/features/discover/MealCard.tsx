import { RecipePhoto } from "@/features/recipes/RecipePhoto";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming
} from "react-native-reanimated";

import { Colors, shadow } from "@/components/theme";
import { formatDifficulty, formatMealType, formatSourceType } from "@/features/recipes/recipeDisplay";
import { Recipe } from "@/services/types";
import { MealAction, swipeActionForOffset } from "./mealSwipe";

export type MealCardHandle = {
  choose: (action: MealAction) => void;
};

type Props = {
  recipe: Recipe;
  onAction: (action: MealAction) => void;
  onOpen: () => void;
  compact?: boolean;
  proposing?: boolean;
  availableHeight?: number;
  onBodyLayout?: (height: number) => void;
};

const EXIT_TARGETS: Record<MealAction, { x: number; y: number }> = {
  add: { x: 620, y: 20 },
  skip: { x: -620, y: 20 },
  favorite: { x: 0, y: -760 },
  hide: { x: 0, y: 760 }
};

export const MealCard = forwardRef<MealCardHandle, Props>(function MealCard({ recipe, onAction, onOpen, compact = false, proposing = false, availableHeight, onBodyLayout }, ref) {
  const { height } = useWindowDimensions();
  const [bodyHeight, setBodyHeight] = useState(200);
  const imageHeight = Math.max(120, Math.min(compact ? 240 : 360, (availableHeight ?? height - 200) - bodyHeight));
  const [isLeaving, setIsLeaving] = useState(false);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const preview = useDerivedValue(() => swipeActionForOffset(translateX.value, translateY.value));

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
      const action = swipeActionForOffset(translateX.value, translateY.value, 90);
      if (!action) {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        return;
      }
      runOnJS(choose)(action);
    });
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { rotate: `${translateX.value / 24}deg` }]
  }));
  const planIndicator = useAnimatedStyle(() => ({
    opacity: preview.value === "add" ? interpolate(translateX.value, [22, 95], [0, 1], Extrapolation.CLAMP) : 0,
    transform: [
      { rotate: "-8deg" },
      { scale: interpolate(translateX.value, [22, 95], [0.92, 1], Extrapolation.CLAMP) }
    ]
  }));
  const skipIndicator = useAnimatedStyle(() => ({
    opacity: preview.value === "skip" ? interpolate(translateX.value, [-95, -22], [1, 0], Extrapolation.CLAMP) : 0,
    transform: [
      { rotate: "8deg" },
      { scale: interpolate(translateX.value, [-95, -22], [1, 0.92], Extrapolation.CLAMP) }
    ]
  }));
  const favoriteIndicator = useAnimatedStyle(() => ({
    opacity: preview.value === "favorite" ? interpolate(translateY.value, [-105, -26], [1, 0], Extrapolation.CLAMP) : 0,
    transform: [{ scale: interpolate(translateY.value, [-105, -26], [1, 0.92], Extrapolation.CLAMP) }]
  }));
  const hideIndicator = useAnimatedStyle(() => ({
    opacity: preview.value === "hide" ? interpolate(translateY.value, [26, 105], [0, 1], Extrapolation.CLAMP) : 0,
    transform: [{ scale: interpolate(translateY.value, [26, 105], [0.92, 1], Extrapolation.CLAMP) }]
  }));
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.card, animated]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${recipe.name}`} onPress={onOpen}>
          <RecipePhoto
            photoUrl={recipe.photo_url}
            accessibilityLabel={recipe.name}
            style={[styles.image, { height: imageHeight }]}
            contentFit="cover"
          />
          <View style={styles.body} onLayout={event => { const measured = event.nativeEvent.layout.height; setBodyHeight(measured); onBodyLayout?.(measured); }}>
            <View style={styles.header}>
              <Text style={styles.title}>{recipe.name}</Text>
              <Text style={styles.favorite}>{recipe.is_favorite ? "Favorite" : recipe.source_type === "manual" && recipe.can_edit === false ? "Shared recipe" : formatSourceType(recipe.source_type)}</Text>
            </View>
            <Text style={styles.meta}>
              {recipe.total_minutes ?? "?"} min • prep {recipe.prep_minutes ?? "?"} • {formatDifficulty(recipe.difficulty)} • {formatMealType(recipe.meal_type)}
            </Text>
            <Text style={styles.meta}>Serves {recipe.servings}</Text>
            <Text numberOfLines={2} style={styles.ingredients}>
              {recipe.ingredients.map((item) => item.normalized_name).slice(0, 6).join(", ")}
            </Text>
          </View>
        </Pressable>
        <Animated.View pointerEvents="none" style={[styles.swipeBadge, styles.planBadge, planIndicator]}>
          <Text style={[styles.swipeBadgeText, styles.planBadgeText]}>{proposing ? "PROPOSE" : "PLAN"}</Text>
          <Text style={styles.swipeHint}>{proposing ? "Ask the group" : "Add to week"}</Text>
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
  image: { width: "100%", backgroundColor: Colors.border },
  body: { padding: 14, gap: 8 },
  header: { flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "flex-start" },
  title: { color: Colors.ink, fontSize: 24, lineHeight: 29, fontWeight: "800", flex: 1, minWidth: 0 },
  favorite: { color: Colors.basil, fontWeight: "800", fontSize: 12, textTransform: "uppercase", flexShrink: 1, maxWidth: "35%" },
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
