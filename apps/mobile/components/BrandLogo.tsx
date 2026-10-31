import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

import { useThemedStyles, ThemeColors } from "@/components/theme";
import { ExperienceSelector } from "@/features/workouts/ExperienceSelector";
import { useAppearance } from "@/services/appearanceState";
import { appearanceArtwork } from "@/services/appearanceArtwork";

type Props = {
  size?: number;
  framed?: boolean;
  experienceSelector?: boolean;
};

export function BrandLogo({ size = 64, framed = false, experienceSelector = false }: Props) {
  const styles = useThemedStyles(createStyles);
  const accent = useAppearance(state => state.accent);
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
      <Image source={appearanceArtwork(accent)} style={styles.image} contentFit="cover" />
    </View>
  );
  return experienceSelector ? <ExperienceSelector>{logo}</ExperienceSelector> : logo;
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  logo: { overflow: "hidden", backgroundColor: Colors.accent },
  framed: { borderColor: Colors.accentFrame, borderWidth: 2 },
  image: { width: "100%", height: "100%" }
});
