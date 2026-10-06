import { ReactNode, useCallback, useRef } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Colors } from "@/components/theme";
import { OfflineStatusBar } from "@/components/OfflineStatusBar";
import { revealTourTarget, TourScrollContext, useGuidedTour } from "@/features/onboarding/TourContext";

type Props = {
  children: ReactNode;
  scroll?: boolean;
  contentWidth?: number;
};

export function Screen({ children, scroll = true, contentWidth }: Props) {
  const tour = useGuidedTour();
  const contentRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const canScroll = scroll;
  const reveal = useCallback((node: View) => revealTourTarget(node, contentRef.current, scrollRef.current), []);
  const content = <View ref={contentRef} testID="screen-content" collapsable={false} style={[styles.content, contentWidth !== undefined && { width: "100%", maxWidth: contentWidth, alignSelf: "center" }, !canScroll && { flex: 1, minHeight: 0, paddingBottom: 12 }]}>{children}</View>;
  return (
    <TourScrollContext.Provider value={reveal}>
      <SafeAreaView style={styles.root} edges={tour ? ["left", "right", "bottom"] : undefined}>
        <OfflineStatusBar />
        {canScroll ? <ScrollView ref={scrollRef} testID="screen-scroll" style={styles.scroll} contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={Platform.OS === "web"} keyboardShouldPersistTaps="handled">{content}</ScrollView> : content}
      </SafeAreaView>
    </TourScrollContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: Colors.background },
  scroll: { flex: 1, minHeight: 0 },
  content: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 96 }
});
