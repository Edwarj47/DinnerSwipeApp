import * as Linking from "expo-linking";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "@/components/theme";

export function SubscriptionDisclosures() {
  const colors = useThemeColors();
  const [failed, setFailed] = useState(false);
  const open = async (path: string) => {
    setFailed(false);
    try { await Linking.openURL(`https://dinner.dcss.dev/${path}`); }
    catch { setFailed(true); }
  };
  return <View style={{ gap: 4 }}>
    <Text style={{ color: colors.muted }}>Payment and any applicable tax are shown by the purchasing provider before confirmation. Paid subscriptions renew monthly until cancelled. The complimentary month does not renew or charge you.</Text>
    <View style={{ flexDirection: "row", gap: 20, flexWrap: "wrap" }}>
      <Pressable accessibilityRole="link" accessibilityLabel="Subscription terms of service" onPress={() => { void open("terms"); }} style={{ minHeight: 44, justifyContent: "center" }}>
        <Text style={{ color: colors.basil, textDecorationLine: "underline" }}>Terms of service</Text>
      </Pressable>
      <Pressable accessibilityRole="link" accessibilityLabel="Subscription privacy policy" onPress={() => { void open("privacy"); }} style={{ minHeight: 44, justifyContent: "center" }}>
        <Text style={{ color: colors.basil, textDecorationLine: "underline" }}>Privacy policy</Text>
      </Pressable>
    </View>
    {failed ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>Unable to open the page. Legal documents are also available in Account settings.</Text> : null}
  </View>;
}
