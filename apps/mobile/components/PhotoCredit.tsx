import { useEffect, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { PhotoCredit as PhotoCreditData, photoCreditLink } from "@/services/photoCredit";
import { Button } from "./Button";
import { Colors } from "./theme";

export function PhotoCredit({ credit, onDetails }: { credit?: PhotoCreditData | null; onDetails?: () => void }) {
  const [error, setError] = useState("");
  const source = photoCreditLink(credit?.source_url);
  const license = photoCreditLink(credit?.license_url);
  useEffect(() => setError(""), [credit?.text, source, license]);
  if (!credit?.text?.trim()) return null;
  if (onDetails) return <Button label="" icon="information-circle-outline" accessibilityLabel="View photo credit" onPress={onDetails} />;
  function open(url: string, label: string) {
    setError("");
    void Linking.openURL(url).catch(() => setError(`Couldn't open the photo ${label}.`));
  }
  return <View style={styles.credit}>
    <Text style={styles.text}>{/^photo\s*:/i.test(credit.text.trim()) ? credit.text.trim() : `Photo: ${credit.text}`}</Text>
    {credit.license ? <Text style={styles.text}>{credit.license}</Text> : null}
    {source || license ? <View style={styles.links}>
      {source ? <Button label="Photo source" icon="open-outline" accessibilityLabel="Open photo source" onPress={() => open(source, "source")} /> : null}
      {license ? <Button label="License" icon="open-outline" accessibilityLabel="Open photo license" onPress={() => open(license, "license")} /> : null}
    </View> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  credit: { gap: 6, minWidth: 0 },
  text: { color: Colors.muted, fontSize: 13, lineHeight: 20, flexShrink: 1 },
  links: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  error: { color: Colors.danger, fontSize: 13, lineHeight: 20 }
});
