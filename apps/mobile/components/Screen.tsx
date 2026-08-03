import { ReactNode } from "react";
import { SafeAreaView, ScrollView, StyleSheet, View } from "react-native";

import { Colors } from "@/components/theme";

type Props = {
  children: ReactNode;
  scroll?: boolean;
};

export function Screen({ children, scroll = true }: Props) {
  const content = <View style={styles.content}>{children}</View>;
  return (
    <SafeAreaView style={styles.root}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled">{content}</ScrollView> : content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 24 }
});

