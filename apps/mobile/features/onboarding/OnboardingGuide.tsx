import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/Button";
import { Colors, shadow } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { addTutorialListener } from "@/services/tutorial";
import { UserProfile } from "@/services/types";

export const TUTORIAL_VERSION = "2026-08-09";

const STEPS = [
  {
    title: "Start with your recipes",
    body: "Start with recipes you already enjoy. Add a link or enter a recipe by hand to build your collection."
  },
  {
    title: "Add from links or by hand",
    body: "Paste a public recipe URL for assisted import, or enter ingredients, instructions, and a photo manually."
  },
  {
    title: "Swipe to build the week",
    body: "Swipe right to plan, left to skip, up to favorite, and down to hide. Buttons are always available too."
  },
  {
    title: "Turn plans into groceries",
    body: "This Week controls dinner slots. Grocery List combines selected meals and keeps pantry exclusions separate."
  },
  {
    title: "Invite people to vote",
    body: "Groups can vote on weekly options. Owners can see vote counts and percentages without showing zero-vote choices."
  }
];

export function OnboardingGuide() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [visible, setVisible] = useState(false);
  const [manual, setManual] = useState(false);
  const [autoSuppressed, setAutoSuppressed] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [intro, setIntro] = useState(true);
  const [status, setStatus] = useState("");
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: () => apiFetch<UserProfile>("/api/v1/profile"),
    retry: false
  });
  const update = useMutation({
    mutationFn: (action: "complete_tutorial" | "dismiss_tutorial") =>
      apiFetch<UserProfile>("/api/v1/profile/onboarding", {
        method: "PATCH",
        body: JSON.stringify({ action, tutorial_version: TUTORIAL_VERSION })
      }),
    onSuccess: async (data) => {
      queryClient.setQueryData(["profile"], data);
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
    }
  });
  const shouldAutoShow = useMemo(() => {
    if (!profile.data || autoSuppressed) return false;
    if (profile.data.tutorial_completed_at || profile.data.tutorial_dismissed_at) return false;
    return profile.data.tutorial_version_seen !== TUTORIAL_VERSION;
  }, [autoSuppressed, profile.data]);

  useEffect(() => {
    return addTutorialListener(() => {
      setManual(true);
      setIntro(false);
      setStatus("");
      setStepIndex(0);
      setVisible(true);
    });
  }, []);

  useEffect(() => {
    if (!shouldAutoShow || visible) return;
    setManual(false);
    setIntro(true);
    setStepIndex(0);
    setVisible(true);
  }, [shouldAutoShow, visible]);

  const current = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  async function closeTutorial(action: "complete_tutorial" | "dismiss_tutorial" | "close", method = "web") {
    if (update.isPending) return;
    setStatus("");
    try {
      if (action !== "close") await update.mutateAsync(action);
      setAutoSuppressed(true);
      setVisible(false);
      if (!manual) router.push({ pathname: "/recipes", params: { mode: "add", method } });
    } catch {
      setStatus("Couldn't save your choice. Check your connection and try again.");
    }
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={() => closeTutorial(manual ? "close" : "dismiss_tutorial")}>
      <SafeAreaView style={styles.overlay}>
        <ScrollView contentContainerStyle={styles.modalContent}>
        <View style={styles.card}>
          <View style={styles.header}>
            <BrandLogo size={62} framed />
            <View style={{ flex: 1 }}>
              <Text style={styles.kicker}>{intro ? "Welcome to Dinner Swipe" : "Dinner Swipe tour"}</Text>
              {!intro ? <Text style={styles.count}>{stepIndex + 1} of {STEPS.length}</Text> : null}
            </View>
          </View>
          {intro ? (
            <>
              <Text style={styles.title}>Make it your menu.</Text>
              <Text style={styles.body}>Start with a recipe you love.</Text>
              <Button label="Add from a link" icon="link" variant="primary" disabled={update.isPending} onPress={() => { void closeTutorial("dismiss_tutorial"); }} />
              <Button label="Enter a recipe" icon="create-outline" disabled={update.isPending} onPress={() => { void closeTutorial("dismiss_tutorial", "manual"); }} />
              <Button label="Take a quick tour" icon="play-circle-outline" disabled={update.isPending} onPress={() => setIntro(false)} />
            </>
          ) : (
            <>
          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.body}>{current.body}</Text>
          <View style={styles.dots}>
            {STEPS.map((step) => (
              <View key={step.title} style={[styles.dot, step.title === current.title ? styles.dotActive : null]} />
            ))}
          </View>
          <View style={styles.actions}>
            <Button
              label={manual ? "Close" : "Skip tour"}
              icon="close"
              disabled={update.isPending}
              onPress={() => closeTutorial(manual ? "close" : "dismiss_tutorial")}
            />
            <Button
              label={isLast ? "Finish" : "Next"}
              icon={isLast ? "checkmark-circle" : "arrow-forward"}
              variant="primary"
              disabled={update.isPending}
              onPress={() => {
                if (isLast) {
                  closeTutorial("complete_tutorial");
                  return;
                }
                setStepIndex((value) => value + 1);
              }}
            />
          </View>
            </>
          )}
          {status ? <Text accessibilityRole="alert" style={styles.error}>{status}</Text> : null}
        </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(36, 33, 31, 0.58)" },
  modalContent: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: 18 },
  card: { width: "100%", maxWidth: 460, backgroundColor: Colors.surface, borderRadius: 8, padding: 18, gap: 14, ...shadow },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  kicker: { color: Colors.basil, fontWeight: "900", textTransform: "uppercase", fontSize: 12 },
  count: { color: Colors.muted, marginTop: 2, fontWeight: "800" },
  title: { color: Colors.ink, fontSize: 27, lineHeight: 32, fontWeight: "900" },
  body: { color: Colors.muted, fontSize: 16, lineHeight: 23 },
  dots: { flexDirection: "row", gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border },
  dotActive: { width: 22, backgroundColor: Colors.tomato },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 10 },
  error: { color: Colors.danger, lineHeight: 20 }
});
