import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
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
    body: "Dinner Swipe includes a few starter meals, but the best experience comes from adding recipes your household already likes."
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
  const queryClient = useQueryClient();
  const [visible, setVisible] = useState(false);
  const [manual, setManual] = useState(false);
  const [autoSuppressed, setAutoSuppressed] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
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
    onSuccess: async () => {
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
      setStepIndex(0);
      setVisible(true);
    });
  }, []);

  useEffect(() => {
    if (!shouldAutoShow || visible) return;
    setManual(false);
    setStepIndex(0);
    setVisible(true);
  }, [shouldAutoShow, visible]);

  const current = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  function closeTutorial(action: "complete_tutorial" | "dismiss_tutorial" | "close") {
    setVisible(false);
    setAutoSuppressed(true);
    if (action !== "close") update.mutate(action);
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={() => closeTutorial(manual ? "close" : "dismiss_tutorial")}>
      <SafeAreaView style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <BrandLogo size={62} framed />
            <View style={{ flex: 1 }}>
              <Text style={styles.kicker}>Dinner Swipe tour</Text>
              <Text style={styles.count}>{stepIndex + 1} of {STEPS.length}</Text>
            </View>
          </View>
          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.body}>{current.body}</Text>
          <View style={styles.dots}>
            {STEPS.map((step) => (
              <View key={step.title} style={[styles.dot, step.title === current.title ? styles.dotActive : null]} />
            ))}
          </View>
          <View style={styles.actions}>
            <Button
              label={manual ? "Close" : "Skip"}
              icon="close"
              onPress={() => closeTutorial(manual ? "close" : "dismiss_tutorial")}
            />
            <Button
              label={isLast ? "Finish" : "Next"}
              icon={isLast ? "checkmark-circle" : "arrow-forward"}
              variant="primary"
              onPress={() => {
                if (isLast) {
                  closeTutorial("complete_tutorial");
                  return;
                }
                setStepIndex((value) => value + 1);
              }}
            />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(36, 33, 31, 0.58)", justifyContent: "center", padding: 18 },
  card: { backgroundColor: Colors.surface, borderRadius: 8, padding: 18, gap: 14, ...shadow },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  kicker: { color: Colors.basil, fontWeight: "900", textTransform: "uppercase", fontSize: 12 },
  count: { color: Colors.muted, marginTop: 2, fontWeight: "800" },
  title: { color: Colors.ink, fontSize: 27, lineHeight: 32, fontWeight: "900" },
  body: { color: Colors.muted, fontSize: 16, lineHeight: 23 },
  dots: { flexDirection: "row", gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border },
  dotActive: { width: 22, backgroundColor: Colors.tomato },
  actions: { flexDirection: "row", justifyContent: "space-between", gap: 10 }
});
