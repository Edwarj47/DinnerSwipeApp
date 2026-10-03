import { ReactNode, useCallback, useRef } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Colors } from "@/components/theme";
import { OfflineStatusBar } from "@/components/OfflineStatusBar";
import { revealTourTarget, TourScrollContext, useGuidedTour } from "@/features/onboarding/TourContext";

type Props = {
  children: ReactNode;
  scroll?: boolean;
};

export function Screen({ children, scroll = true }: Props) {
  const tour = useGuidedTour();
  const contentRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const reveal = useCallback((node: View) => revealTourTarget(node, contentRef.current, scrollRef.current), []);
  const content = <View ref={contentRef} collapsable={false} style={[styles.content, !scroll && tour && { flex: 1, minHeight: 0, paddingBottom: 12 }]}>{children}</View>;
  return (
    <TourScrollContext.Provider value={reveal}>
      <SafeAreaView style={styles.root} edges={tour ? ["left", "right", "bottom"] : undefined}>
        <OfflineStatusBar />
        {scroll ? <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled">{content}</ScrollView> : content}
      </SafeAreaView>
    </TourScrollContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 96 }
});
