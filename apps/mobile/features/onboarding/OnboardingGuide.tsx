import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "expo-router";
import { ReactNode, useEffect, useRef, useState } from "react";
import { BackHandler, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { addTutorialListener } from "@/services/tutorial";
import { PremiumStatus, UserProfile } from "@/services/types";
import { TourContext } from "./TourContext";
import { nextSectionIndex, TOUR_SECTIONS, tourStepsFor, TourSection, TourStep, TUTORIAL_VERSION } from "./tourSteps";

export { TUTORIAL_VERSION } from "./tourSteps";
type FinishAction = "complete_tutorial" | "dismiss_tutorial";

export function OnboardingGuide({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [welcome, setWelcome] = useState(false);
  const [suppressed, setSuppressed] = useState(false);
  const [selected, setSelected] = useState<TourSection[]>(TOUR_SECTIONS.map(section => section.id));
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [index, setIndex] = useState(0);
  const [visit, setVisit] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const [saveError, setSaveError] = useState<FinishAction | null>(null);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => apiFetch<UserProfile>("/api/v1/profile"), retry: false });
  const subscription = useQuery({ queryKey: ["subscription-status"], queryFn: () => apiFetch<PremiumStatus>("/api/v1/subscription/status"), retry: false });
  const premium = Boolean(subscription.data?.premium_active ?? subscription.data?.active);
  const choices = TOUR_SECTIONS.filter(section => section.id !== "macros" || premium);
  const chosenSteps = tourStepsFor(selected, premium);
  const step = steps[index];

  useEffect(() => {
    if (profile.data && !suppressed && !profile.data.tutorial_completed_at && !profile.data.tutorial_dismissed_at && profile.data.tutorial_version_seen !== TUTORIAL_VERSION) {
      setWelcome(true); setSuppressed(true);
    }
  }, [profile.data, suppressed]);
  useEffect(() => addTutorialListener(() => {
    generation.current += 1;
    setSteps([]); setSaveError(null); setSaving(false); setSuppressed(true); setWelcome(true);
    setSelected(TOUR_SECTIONS.map(section => section.id));
  }), []);
  useEffect(() => () => { generation.current += 1; }, []);

  async function save(action: FinishAction) {
    const current = ++generation.current;
    setSaving(true); setSaveError(null);
    try {
      const data = await apiFetch<UserProfile>("/api/v1/profile/onboarding", {
        method: "PATCH", body: JSON.stringify({ action, tutorial_version: TUTORIAL_VERSION })
      });
      if (generation.current === current) queryClient.setQueryData(["profile"], data);
    } catch {
      if (generation.current === current) setSaveError(action);
    } finally {
      if (generation.current === current) setSaving(false);
    }
  }
  function finish(action: FinishAction) {
    Keyboard.dismiss(); setSteps([]); setWelcome(false); setSuppressed(true);
    void save(action);
  }
  function showStep(target: TourStep) {
    Keyboard.dismiss(); setExpanded(true); setVisit(value => value + 1);
    router.navigate({ pathname: target.path, params: { ...target.params, tour: `${Date.now()}-${target.id}` } });
  }
  function move(position: number) {
    if (position >= steps.length) { finish("complete_tutorial"); return; }
    setIndex(position); showStep(steps[position]);
  }
  function start() {
    if (!chosenSteps.length) return;
    setWelcome(false); setSteps(chosenSteps); setIndex(0); showStep(chosenSteps[0]);
  }
  useEffect(() => {
    if (!step) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (expanded) setExpanded(false);
      else finish("dismiss_tutorial");
      return true;
    });
    return () => listener.remove();
  });

  const value = step ? { step, index, total: steps.length, visit, expanded: expanded && pathname === step.path,
    expand: () => showStep(step), collapse: () => setExpanded(false), next: () => move(index + 1),
    skipSection: () => move(nextSectionIndex(steps, index)) } : null;

  return <TourContext.Provider value={value}>
    <View style={styles.root}>
      {step ? <SafeAreaView edges={["top"]} style={styles.barSafe}>
        <View style={styles.bar} testID="tour-toolbar">
          <Icon label="Previous tour step" name="chevron-back" disabled={index === 0} onPress={() => move(index - 1)} />
          <Pressable accessibilityRole="button" accessibilityLabel={`Show tour step: ${step.title}`} onPress={() => showStep(step)} style={styles.barTitle}>
            <Text style={styles.counter}>Tour {index + 1} / {steps.length}</Text><Text numberOfLines={1} style={styles.barLabel}>{step.title}</Text>
          </Pressable>
          <Icon label="Skip tour section" name="play-skip-forward-outline" onPress={() => move(nextSectionIndex(steps, index))} />
          <Icon label={index === steps.length - 1 ? "Finish tour" : "Next tour step"} name={index === steps.length - 1 ? "checkmark" : "chevron-forward"} onPress={() => move(index + 1)} />
          <Icon label="End tour" name="close" onPress={() => finish("dismiss_tutorial")} />
        </View>
      </SafeAreaView> : null}
      {saveError ? <View style={styles.saveError} accessibilityRole="alert"><Text style={styles.error}>Tour preference not saved. You can keep using the app.</Text>
        <Button label="Retry" icon="refresh" disabled={saving} onPress={() => { void save(saveError); }} />
        <Icon label="Dismiss tour save error" name="close" onPress={() => setSaveError(null)} />
      </View> : null}
      <View style={styles.root}>{children}</View>
    </View>
    <Modal visible={welcome} transparent animationType="fade" onRequestClose={() => finish("dismiss_tutorial")}>
      <SafeAreaView style={styles.backdrop}>
        <View style={styles.welcome} accessibilityViewIsModal>
          <View style={styles.welcomeHeader}><BrandLogo size={44} /><Text accessibilityRole="header" style={styles.title}>Explore Dinner Swipe</Text>
            <Icon label="Decline tour" name="close" onPress={() => finish("dismiss_tutorial")} /></View>
          <Text style={styles.copy}>Choose what to explore. We'll open each screen so you can try it as you go.</Text>
          <ScrollView style={styles.sections}>
            {choices.map(section => <Pressable key={section.id} accessibilityRole="checkbox" accessibilityLabel={`Tour ${section.label}`}
              accessibilityState={{ checked: selected.includes(section.id) }} style={styles.section}
              onPress={() => setSelected(current => current.includes(section.id) ? current.filter(id => id !== section.id) : [...current, section.id])}>
              <Ionicons name={section.icon} size={22} color={Colors.basil} /><Text style={styles.sectionLabel}>{section.label}</Text>
              <Ionicons name={selected.includes(section.id) ? "checkbox" : "square-outline"} size={24} color={selected.includes(section.id) ? Colors.tomato : Colors.muted} />
            </Pressable>)}
          </ScrollView>
          <Button label="Start tour" icon="play" variant="primary" disabled={!chosenSteps.length} onPress={start} />
          <Button label="Not now" icon="close" onPress={() => finish("dismiss_tutorial")} />
        </View>
      </SafeAreaView>
    </Modal>
  </TourContext.Provider>;
}

function Icon({ label, name, onPress, disabled = false }: { label: string; name: keyof typeof Ionicons.glyphMap; onPress: () => void; disabled?: boolean }) {
  const [hover, setHover] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
    style={[styles.icon, disabled && { opacity: 0.35 }]}><Ionicons name={name} size={22} color={Colors.tomatoDark} />
    {hover ? <View pointerEvents="none" style={[styles.tooltip, name === "chevron-back" && { left: 0, right: undefined }]}><Text style={styles.tooltipText}>{label}</Text></View> : null}
  </Pressable>;
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  barSafe: { backgroundColor: Colors.surface, zIndex: 5 },
  bar: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderColor: Colors.border, paddingHorizontal: 4, minHeight: 56 },
  barTitle: { flex: 1, minWidth: 0, paddingVertical: 6 },
  counter: { color: Colors.basil, fontSize: 11, fontWeight: "800" },
  barLabel: { color: Colors.ink, fontSize: 13, fontWeight: "700" },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  tooltip: { position: "absolute", top: 42, right: 0, width: 112, padding: 6, borderRadius: 4, backgroundColor: Colors.ink, zIndex: 10 },
  tooltipText: { color: Colors.surface, fontSize: 12, lineHeight: 16 },
  backdrop: { flex: 1, backgroundColor: "rgba(36,33,31,0.5)", padding: 16, alignItems: "center", justifyContent: "center" },
  welcome: { maxWidth: 460, width: "100%", maxHeight: "100%", backgroundColor: Colors.surface, borderRadius: 8, padding: 16, gap: 12 },
  welcomeHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { flex: 1, fontSize: 22, fontWeight: "800", color: Colors.ink },
  copy: { fontSize: 14, lineHeight: 21, color: Colors.muted },
  sections: { flexShrink: 1 },
  section: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, borderBottomWidth: 1, borderColor: Colors.border },
  sectionLabel: { flex: 1, color: Colors.ink, fontWeight: "700" },
  saveError: { padding: 8, gap: 8, flexDirection: "row", alignItems: "center", backgroundColor: Colors.surface },
  error: { flex: 1, fontSize: 13, color: Colors.danger }
});
