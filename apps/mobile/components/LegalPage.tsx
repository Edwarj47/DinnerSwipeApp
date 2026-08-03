import { StyleSheet, Text, View } from "react-native";

import { BrandLogo } from "@/components/BrandLogo";
import { Screen } from "@/components/Screen";
import { Colors } from "@/components/theme";

type Section = {
  title: string;
  body: string;
};

type Props = {
  eyebrow: string;
  title: string;
  effectiveDate: string;
  sections: Section[];
};

export function LegalPage({ eyebrow, title, effectiveDate, sections }: Props) {
  return (
    <Screen>
      <View style={styles.hero}>
        <BrandLogo size={52} />
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.date}>Effective {effectiveDate}</Text>
        </View>
      </View>
      {sections.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <Text style={styles.body}>{section.body}</Text>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: Colors.surface, borderColor: Colors.border, borderWidth: 1, borderRadius: 8, padding: 14, flexDirection: "row", gap: 12, alignItems: "center", marginBottom: 12 },
  eyebrow: { color: Colors.basil, fontWeight: "900", textTransform: "uppercase", fontSize: 12 },
  title: { color: Colors.ink, fontWeight: "900", fontSize: 28 },
  date: { color: Colors.muted, marginTop: 2 },
  section: { backgroundColor: Colors.surface, borderColor: Colors.border, borderWidth: 1, borderRadius: 8, padding: 14, gap: 8, marginBottom: 10 },
  sectionTitle: { color: Colors.ink, fontWeight: "900", fontSize: 18 },
  body: { color: Colors.muted, lineHeight: 22 }
});
