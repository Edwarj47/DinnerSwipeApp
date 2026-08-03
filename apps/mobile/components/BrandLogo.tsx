import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

import { Colors } from "@/components/theme";

type Props = {
  size?: number;
  framed?: boolean;
};

export function BrandLogo({ size = 64, framed = false }: Props) {
  return (
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
}

const styles = StyleSheet.create({
  logo: { overflow: "hidden", backgroundColor: Colors.tomato },
  framed: { borderColor: "#ffd9d6", borderWidth: 2 },
  image: { width: "100%", height: "100%" }
});
