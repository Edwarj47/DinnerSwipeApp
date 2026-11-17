import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "expo-router";
import { ReactNode, useEffect, useRef, useState } from "react";
import { BackHandler, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/Button";
import { useThemeColors, useThemedStyles, ThemeColors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { addTutorialListener } from "@/services/tutorial";
import { PremiumStatus, UserProfile } from "@/services/types";
import { useAuthSession } from "@/services/session";
import { listenTutorialEvidence, loadTutorialProgress, saveTutorialProgress, TutorialProgress, TutorialTask } from "@/services/tutorialProgress";
import { updateWorkoutPreferences, useWorkoutMode } from "@/services/workoutMode";
import { useSpace } from "@/features/groups/useSpace";
import { todayISO } from "@/features/premium/macroDates";
import { TourContext } from "./TourContext";
import { nextSectionIndex, TASK_LABELS, taskStepsFor, TOUR_SECTIONS, tourStepsFor, TourSection, TourStep, TUTORIAL_VERSION } from "./tourSteps";

export { TUTORIAL_VERSION } from "./tourSteps";
type FinishAction = "complete_tutorial" | "dismiss_tutorial";

export function OnboardingGuide({ children }: { children: ReactNode }) {
  const styles = useThemedStyles(createStyles);
  const Colors = useThemeColors();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { userId } = useAuthSession();
  const currentOwner = useRef(userId);
  currentOwner.current = userId;
  const restoredOwner = useRef<string | null>(null);
  const space = useSpace();
  const mode = useWorkoutMode(state => state.mode), workoutsEnabled = useWorkoutMode(state => state.enabled);
  const [fullTour, setFullTour] = useState(false);
  const [taskChoice, setTaskChoice] = useState<TutorialTask>("meals");
  const [progress, setProgress] = useState<TutorialProgress | null>(null);
  const [restored, setRestored] = useState(false);
  const [taskError, setTaskError] = useState("");
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
  const choices = TOUR_SECTIONS.filter(section => (section.id !== "macros" || premium)
    && (mode !== "workouts" || ["macros", "account", "groups"].includes(section.id)));
  const chosenSteps = tourStepsFor(selected.filter(id => choices.some(choice => choice.id === id)), premium);
  const step = steps[index];
  const expectedMode = progress?.task === "workouts" ? "workouts" : progress?.task === "meals" ? "nutrition" : mode;
  const contextChanged = Boolean(progress && (expectedMode !== mode || (progress.task === "meals" && progress.scope !== space.key)));
  useEffect(() => {
    let current = true;
    restoredOwner.current = null;
    setRestored(false);
    if (!userId) { setRestored(true); return; }
    void loadTutorialProgress(userId).then(value => { if (current) { restoredOwner.current = userId; setProgress(value); setRestored(true); } });
    return () => { current = false; };
  }, [userId]);
  useEffect(() => {
    if (userId && restored && restoredOwner.current === userId && progress) void saveTutorialProgress(userId, progress).catch(() => {
      if (currentOwner.current === userId) setTaskError("Walkthrough progress could not be saved on this device.");
    });
  }, [userId, restored, progress]);
  useEffect(() => listenTutorialEvidence(event => {
    if (!userId || restoredOwner.current !== userId || event.owner !== userId || !step?.action || event.action !== step.action || contextChanged) return;
    setProgress(current => current?.status === "active" && (current.task === "macros" || current.scope === event.scope)
      ? { ...current, completed: [...new Set([...current.completed, step.id])], skipped: current.skipped.filter(id => id !== step.id) } : current);
  }), [userId, step?.action, step?.id, contextChanged]);

  useEffect(() => {
    if (restored && profile.data && !suppressed && !profile.data.tutorial_completed_at && !profile.data.tutorial_dismissed_at && profile.data.tutorial_version_seen !== TUTORIAL_VERSION) {
      setWelcome(true); setSuppressed(true);
    }
  }, [profile.data, suppressed, restored]);
  useEffect(() => addTutorialListener(() => {
    generation.current += 1;
    setSteps([]); setSaveError(null); setSaving(false); setSuppressed(true); setWelcome(true); setFullTour(false);
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
    setProgress(current => current && steps.length ? { ...current, index,
      status: action === "dismiss_tutorial" ? "paused" : steps.every(item => current.completed.includes(item.id)) ? "complete" : "skipped" } : current);
    Keyboard.dismiss(); setSteps([]); setWelcome(false); setSuppressed(true);
    void save(action);
  }
  function showStep(target: TourStep) {
    Keyboard.dismiss(); setExpanded(true); setVisit(value => value + 1);
    router.navigate({ pathname: target.path, params: { ...target.params, tour: `${Date.now()}-${target.id}` } });
  }
  function move(position: number) {
    if (progress) setProgress(current => current ? { ...current, index: Math.min(position, steps.length - 1),
      skipped: step && !current.completed.includes(step.id) ? [...new Set([...current.skipped, step.id])] : current.skipped } : current);
    if (position >= steps.length) { finish("complete_tutorial"); return; }
    setIndex(position); showStep(steps[position]);
  }
  function start() {
    if (!chosenSteps.length) return;
    setProgress(null); setWelcome(false); setSteps(chosenSteps); setIndex(0); showStep(chosenSteps[0]);
  }
  async function startTask(resume = false) {
    const attempt = ++generation.current, owner = userId;
    const task = resume && progress ? progress.task : taskChoice;
    const requiredMode = task === "workouts" ? "workouts" : task === "meals" ? "nutrition" : mode;
    setTaskError("");
    try {
      if (requiredMode !== mode) await updateWorkoutPreferences({ mode: requiredMode });
      if (attempt !== generation.current || owner !== currentOwner.current) return;
      const next = taskStepsFor(task, todayISO());
      const position = resume && progress ? Math.min(progress.index, next.length - 1) : 0;
      setProgress(resume && progress ? { ...progress, status: "active" }
        : { version: 1, task, index: 0, scope: task === "meals" ? space.key : "personal", completed: [], skipped: [], status: "active" });
      setWelcome(false); setSteps(next); setIndex(position); showStep(next[position]);
    } catch (error) { if (attempt === generation.current && owner === currentOwner.current) setTaskError(error instanceof Error ? error.message : "Unable to open this walkthrough."); }
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

  const value = step ? { step, index, total: steps.length, visit, expanded: expanded && pathname === step.path && !contextChanged,
    expand: () => showStep(step), collapse: () => setExpanded(false), next: () => move(index + 1),
    skipSection: () => move(nextSectionIndex(steps, index)) } : null;

  return <TourContext.Provider value={value}>
    <View style={styles.root}>
      {step ? <SafeAreaView edges={["top"]} style={styles.barSafe}>
        <View style={styles.bar} testID="tour-toolbar">
          <Icon label="Previous tour step" name="chevron-back" disabled={index === 0} onPress={() => move(index - 1)} />
          <Pressable accessibilityRole="button" accessibilityLabel={`Show tour step: ${step.title}`} onPress={() => showStep(step)} style={styles.barTitle}>
            <Text style={styles.counter}>{progress?.completed.includes(step.id) ? "Action saved" : `Tour ${index + 1} / ${steps.length}`}</Text><Text numberOfLines={1} style={styles.barLabel}>{step.title}</Text>
          </Pressable>
          <Icon label="Skip tour section" name="play-skip-forward-outline" onPress={() => move(nextSectionIndex(steps, index))} />
          <Icon label={index === steps.length - 1 ? "Finish tour" : "Next tour step"} name={index === steps.length - 1 ? "checkmark" : "chevron-forward"} onPress={() => move(index + 1)} />
          <Icon label="End tour" name="close" onPress={() => finish("dismiss_tutorial")} />
        </View>
      </SafeAreaView> : null}
      {step && contextChanged ? <View style={styles.saveError}><Text style={styles.error}>Your experience or group changed. Continue with the current group?</Text>
        <Button label="Restart walkthrough here" icon="refresh" onPress={() => { setTaskChoice(progress!.task); setWelcome(true); setFullTour(false); }} />
      </View> : null}
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
          <Text style={styles.copy}>{fullTour ? "Choose what to explore." : "What would you like to do first?"}</Text>
          {!fullTour ? <>
            <View style={{ gap: 8 }}>
              {(["meals", ...(workoutsEnabled ? ["workouts"] : []), ...(premium ? ["macros"] : [])] as TutorialTask[]).map(task => <Button key={task}
                label={TASK_LABELS[task]} icon={task === "meals" ? "restaurant-outline" : task === "workouts" ? "barbell-outline" : "speedometer-outline"}
                variant={taskChoice === task ? "primary" : "secondary"} onPress={() => setTaskChoice(task)} />)}
            </View>
            <Button label={(taskChoice === "meals" && mode === "workouts") ? "Switch to Nutrition and start" : taskChoice === "workouts" && mode !== "workouts" ? "Switch to Workouts and start" : "Start walkthrough"}
              icon="play" variant="primary" disabled={!restored || space.isLoading || space.isError} onPress={() => { void startTask(); }} />
            {progress && ["active", "paused"].includes(progress.status) && (progress.task !== "macros" || premium)
              && (progress.task !== "meals" || progress.scope === space.key) ? <Button
              label={`${progress.task === "meals" && mode !== "nutrition" ? "Switch to Nutrition and resume" : progress.task === "workouts" && mode !== "workouts" ? "Switch to Workouts and resume" : "Resume"}: ${TASK_LABELS[progress.task]}`}
              icon="play-forward-outline" disabled={space.isLoading || space.isError}
              onPress={() => { void startTask(true); }} /> : null}
            <Button label="Explore all features" icon="compass-outline" onPress={() => setFullTour(true)} />
          </> : <><ScrollView style={styles.sections}>
            {choices.map(section => <Pressable key={section.id} accessibilityRole="checkbox" accessibilityLabel={`Tour ${section.label}`}
              accessibilityState={{ checked: selected.includes(section.id) }} style={styles.section}
              onPress={() => setSelected(current => current.includes(section.id) ? current.filter(id => id !== section.id) : [...current, section.id])}>
              <Ionicons name={section.icon} size={22} color={Colors.basil} /><Text style={styles.sectionLabel}>{section.label}</Text>
              <Ionicons name={selected.includes(section.id) ? "checkbox" : "square-outline"} size={24} color={selected.includes(section.id) ? Colors.accent : Colors.muted} />
            </Pressable>)}
          </ScrollView>
          <Button label="Start tour" icon="play" variant="primary" disabled={!chosenSteps.length} onPress={start} />
          </>}
          {taskError ? <Text accessibilityRole="alert" style={styles.error}>{taskError}</Text> : null}
          <Button label="Not now" icon="close" onPress={() => finish("dismiss_tutorial")} />
        </View>
      </SafeAreaView>
    </Modal>
  </TourContext.Provider>;
}

function Icon({ label, name, onPress, disabled = false }: { label: string; name: keyof typeof Ionicons.glyphMap; onPress: () => void; disabled?: boolean }) {
  const styles = useThemedStyles(createStyles);
  const Colors = useThemeColors();
  const [hover, setHover] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
    style={[styles.icon, disabled && { opacity: 0.35 }]}><Ionicons name={name} size={22} color={Colors.accentStrong} />
    {hover ? <View pointerEvents="none" style={[styles.tooltip, name === "chevron-back" && { left: 0, right: undefined }]}><Text style={styles.tooltipText}>{label}</Text></View> : null}
  </Pressable>;
}
const createStyles = (Colors: ThemeColors) => StyleSheet.create({
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
