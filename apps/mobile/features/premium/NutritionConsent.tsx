import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";

export type NutritionConsentStatus = { accepted: boolean; terms_version: string; terms_url: string;
  disclosure?: string; app_terms_url?: string; privacy_url?: string };

export function NutritionConsent({ data, loading, failed, pending, offline, onAccept, onRetry, onClose }: {
  data?: NutritionConsentStatus; loading: boolean; failed: boolean; pending: boolean; offline: boolean;
  onAccept: () => void; onRetry: () => void; onClose: () => void;
}) {
  if (loading) return <Text style={styles.copy}>Checking nutrition access...</Text>;
  if (failed) return <View style={styles.section}><Text accessibilityRole="alert" style={styles.copy}>Couldn't check nutrition terms.</Text>
    <Button label="Retry" icon="refresh-outline" disabled={offline} onPress={onRetry} /></View>;
  return <View style={styles.section}>
    <Text style={styles.title}>Nutrition tools consent</Text>
    <Text style={styles.copy}>{data?.disclosure ?? "OpenAI processes meal descriptions and completed recordings. FatSecret receives food searches. Review the Privacy Policy and Terms before continuing."}</Text>
    <View style={styles.links}>{[
      ["Privacy Policy", data?.privacy_url ?? "https://dinner.dcss.dev/privacy"],
      ["Terms of Service", data?.app_terms_url ?? "https://dinner.dcss.dev/terms"],
      ["FatSecret terms", data?.terms_url ?? "https://platform.fatsecret.com/terms"],
    ].map(([label, url]) => <Pressable key={label} accessibilityRole="link" accessibilityLabel={label}
      onPress={() => { void Linking.openURL(url); }} style={styles.linkTarget}><Text style={styles.link}>{label}</Text></Pressable>)}</View>
    <Button label="Agree and continue" icon="checkmark" variant="primary" disabled={!data || pending || offline} onPress={onAccept} />
    <Button label="Not now" icon="close" disabled={pending} onPress={onClose} />
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, paddingVertical: 8 }, title: { color: Colors.ink, fontSize: 17, fontWeight: "700" },
  copy: { color: Colors.muted, fontSize: 14, lineHeight: 21 }, links: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  linkTarget: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  link: { color: Colors.basil, fontSize: 13, textDecorationLine: "underline" },
});
