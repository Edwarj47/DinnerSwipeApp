import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/Button";
import { Colors, shadow } from "@/components/theme";
import { SegmentedControl } from "@/components/SegmentedControl";
import { HouseholdPanel } from "@/features/groups/HouseholdPanel";
import { TourScrollContext, revealTourTarget, useGuidedTour } from "@/features/onboarding/TourContext";
import { TourTarget } from "@/features/onboarding/TourTarget";
import { apiFetch } from "@/services/api";
import { addSettingsListener, openSettings, SettingsRequest } from "@/services/settingsMenu";
import { addTutorialListener } from "@/services/tutorial";
import { PremiumStatus } from "@/services/types";
import { UserSettingsPanel } from "./UserSettingsPanel";
import { SettingsContext } from "./SettingsContext";

export function SettingsMenuProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<SettingsRequest | null>(null);
  const [tab, setTab] = useState<"user" | "group">("user");
  const [upgrade, setUpgrade] = useState(false);
  const [visit, setVisit] = useState(0);
  const tour = useGuidedTour();
  const wasSettingsTour = useRef(false);
  const content = useRef<View>(null);
  const scroll = useRef<ScrollView>(null);
  const reveal = useCallback((node: View) => revealTourTarget(node, content.current, scroll.current), []);
  const close = useCallback(() => setRequest(null), []);
  const subscription = useQuery({ queryKey: ["subscription-status"], queryFn: () => apiFetch<PremiumStatus>("/api/v1/subscription/status") });
  const premium = Boolean(subscription.data?.premium_active ?? subscription.data?.active);
  const tourStep = tour?.step.id;
  const tourVisit = tour?.visit;
  const settingsTour = !!tourStep && ["preferences", "groups", "account"].includes(tourStep);

  useLayoutEffect(() => addSettingsListener(next => {
    setRequest(next); setTab(next.tab ?? "user"); setVisit(value => value + 1); setUpgrade(false);
  }), []);
  useEffect(() => addTutorialListener(close), [close]);
  useEffect(() => {
    if (settingsTour) openSettings(tourStep === "groups" ? { tab: "group" } : {
      section: tourStep === "preferences" ? "meals" : "account", focus: tourStep === "account" ? "planning" : undefined
    });
    else if (wasSettingsTour.current) close();
    wasSettingsTour.current = settingsTour;
  }, [settingsTour, tourVisit, tourStep, close]);
  useEffect(() => { if (premium) setUpgrade(false); }, [premium]);

  return <SettingsContext.Provider value={{ open: request !== null, close, invitePremium: () => { if (!premium) setUpgrade(true); } }}>
    {children}
    <Modal visible={request !== null} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Dismiss settings" onPress={close} />
        <SafeAreaView edges={["top", "bottom"]} style={styles.safe} pointerEvents="box-none">
          <View accessibilityViewIsModal style={styles.sheet}>
            <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>Settings</Text>
              {settingsTour ? <Button label="" icon="chevron-forward" accessibilityLabel="Continue settings tour" onPress={() => tour?.next()} /> : null}
              <Button label="" icon="close" accessibilityLabel="Close settings" onPress={close} /></View>
            <SegmentedControl adaptive accessibilityLabel="Settings views" value={tab} onChange={setTab} options={[
              { label: "User settings", value: "user" },
              { label: "Group settings", value: "group" }
            ]} />
            <TourScrollContext.Provider value={reveal}><ScrollView ref={scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={Platform.OS === "web"} style={styles.scroll} contentContainerStyle={styles.body}>
              <View ref={content} collapsable={false} key={visit}>
                {request ? tab === "user" ? <UserSettingsPanel initialSection={request.section} initialFocus={request.focus} initialResetToken={request.resetToken} onExit={close} />
                  : <TourTarget id="groups"><HouseholdPanel initialView={request.groupView} /></TourTarget> : null}
              </View>
            </ScrollView></TourScrollContext.Provider>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
    <Modal visible={upgrade && !premium} transparent animationType="fade" onRequestClose={() => setUpgrade(false)}>
      <View style={styles.upgradeBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Dismiss Premium invitation" onPress={() => setUpgrade(false)} />
        <View style={styles.upgrade} accessibilityViewIsModal>
          <View style={styles.header}><Ionicons name="speedometer-outline" size={28} color={Colors.basil} /><Text style={styles.title}>Unlock Macros</Text>
            <Button label="" icon="close" accessibilityLabel="Close Premium invitation" onPress={() => setUpgrade(false)} /></View>
          <Text style={styles.copy}>Track your meals, calculate nutrition, and see your trends with Premium.</Text>
          <Button label="View Premium" icon="card-outline" variant="primary" onPress={() => openSettings({ section: "account", focus: "subscription" })} />
          <Button label="Not now" icon="close" variant="quiet" onPress={() => setUpgrade(false)} />
        </View>
      </View>
    </Modal>
  </SettingsContext.Provider>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(36,33,31,0.4)", alignItems: "flex-end" },
  safe: { width: "100%", maxWidth: 720, flex: 1, padding: 12 },
  sheet: { flex: 1, minHeight: 0, maxHeight: "100%", borderRadius: 8, backgroundColor: Colors.surface, padding: 16, gap: 12, ...shadow },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 22, fontWeight: "800", color: Colors.ink, flex: 1, minWidth: 0 },
  scroll: { flex: 1, minHeight: 0 }, body: { paddingBottom: 20 },
  upgradeBackdrop: { flex: 1, backgroundColor: "rgba(36,33,31,0.4)", justifyContent: "center", alignItems: "center", padding: 18 },
  upgrade: { width: "100%", maxWidth: 420, borderRadius: 8, backgroundColor: Colors.surface, padding: 18, gap: 12 },
  copy: { fontSize: 15, lineHeight: 22, color: Colors.muted }
});
