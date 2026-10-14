import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

import { Colors } from "@/components/theme";
import { ExperienceSelector } from "@/features/workouts/ExperienceSelector";

type Props = {
  size?: number;
  framed?: boolean;
  experienceSelector?: boolean;
};

export function BrandLogo({ size = 64, framed = false, experienceSelector = false }: Props) {
  const logo = (
    <View
      accessibilityLabel="Dinner Swipe logo"
      accessibilityRole="image"
      style={[
        styles.logo,
        { width: size, height: size, borderRadius: size / 2 },
        framed ? styles.framed : null
      ]}
    >
      <Image source={require("../assets/icon.png")} style={styles.image} contentFit="cover" />
    </View>
  );
  return experienceSelector ? <ExperienceSelector>{logo}</ExperienceSelector> : logo;
}

const styles = StyleSheet.create({
  logo: { overflow: "hidden", backgroundColor: Colors.tomato },
  framed: { borderColor: "#ffd9d6", borderWidth: 2 },
  image: { width: "100%", height: "100%" }
});
