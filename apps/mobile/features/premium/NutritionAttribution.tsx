import { createElement } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Colors } from "@/components/theme";

export function NutritionAttribution() {
  return <View style={styles.row}>
    {Platform.OS === "web" ? createElement("span", { style: { fontFamily: "system-ui, sans-serif", fontSize: 12, lineHeight: "30px" } },
      createElement("a", { href: "https://platform.fatsecret.com" }, "Powered by fatsecret Platform API")) :
      <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL("https://platform.fatsecret.com"); }}>
        <Text style={styles.link}>Powered by fatsecret Platform API</Text>
      </Pressable>}
  </View>;
}
const styles = StyleSheet.create({ row: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, link: { color: Colors.basil, fontSize: 12, textDecorationLine: "underline", paddingVertical: 8 } });
