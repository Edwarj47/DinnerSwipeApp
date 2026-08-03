import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { Button } from "@/components/Button";
import { Colors, shadow } from "@/components/theme";
import { Recipe } from "@/services/types";

type Props = {
  recipe: Recipe;
  onAction: (action: "add" | "skip" | "favorite" | "hide") => void;
  onOpen: () => void;
};

export function MealCard({ recipe, onAction, onOpen }: Props) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const gesture = Gesture.Pan()
    .onUpdate((event) => {
      translateX.value = event.translationX;
      translateY.value = event.translationY;
    })
    .onEnd(() => {
      const x = translateX.value;
      const y = translateY.value;
      translateX.value = withSpring(0);
      translateY.value = withSpring(0);
      if (x > 90) runOnJS(onAction)("add");
      if (x < -90) runOnJS(onAction)("skip");
      if (y < -90) runOnJS(onAction)("favorite");
    });
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { rotate: `${translateX.value / 24}deg` }]
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
            <View style={styles.actions}>
              <Button label="Skip" icon="close" onPress={() => onAction("skip")} />
              <Button label="Plan" icon="add" variant="primary" onPress={() => onAction("add")} />
              <Button label="Fav" icon="heart" onPress={() => onAction("favorite")} />
              <Button label="Hide" icon="eye-off" variant="danger" onPress={() => onAction("hide")} />
            </View>
          </View>
        </Pressable>
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
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }
});

