import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { Screen } from "@/components/Screen";
import { ThemeColors, useThemedStyles } from "@/components/theme";
import { AccountDeletionPanel } from "@/features/settings/AccountDeletionPanel";

export default function DeleteAccountScreen() {
  const styles = useThemedStyles(createStyles);
  return <Screen contentWidth={560}>
    <View style={styles.content}>
      <Text style={styles.brand}>Dinner Swipe</Text>
      <AccountDeletionPanel />
      <View style={styles.links}>
        <Link href="/privacy" style={styles.link}>Privacy Policy</Link>
        <Link href="/" style={styles.link}>Back to Dinner Swipe</Link>
      </View>
    </View>
  </Screen>;
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  content: { gap: 24, paddingVertical: 16 },
  brand: { color: Colors.basil, fontWeight: "900", fontSize: 18 },
  links: { gap: 16, flexDirection: "row", flexWrap: "wrap" },
  link: { color: Colors.accentStrong, fontWeight: "700", lineHeight: 22 }
});
