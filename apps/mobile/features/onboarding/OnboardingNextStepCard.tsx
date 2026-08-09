import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { Recipe, UserProfile, WeeklyPlan } from "@/services/types";

import { TUTORIAL_VERSION } from "./OnboardingGuide";

type GroceryList = { items: { id: string; is_checked: boolean }[] };

export function OnboardingNextStepCard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const profile = useQuery<UserProfile>({
    queryKey: ["profile"],
    queryFn: () => apiFetch<UserProfile>("/api/v1/profile"),
    retry: false
  });
  const recipes = useQuery<Recipe[]>({
    queryKey: ["recipes"],
    queryFn: () => apiFetch<Recipe[]>("/api/v1/recipes"),
    retry: false
  });
  const plan = useQuery<WeeklyPlan>({
    queryKey: ["weekly-plan"],
    queryFn: () => apiFetch<WeeklyPlan>("/api/v1/weekly-plans/current"),
    retry: false
  });
  const grocery = useQuery<GroceryList>({
    queryKey: ["grocery"],
    queryFn: () => apiFetch<GroceryList>("/api/v1/grocery-lists/current"),
    retry: false
  });
  const complete = useMutation({
    mutationFn: () =>
      apiFetch<UserProfile>("/api/v1/profile/onboarding", {
        method: "PATCH",
        body: JSON.stringify({ action: "complete_onboarding", tutorial_version: TUTORIAL_VERSION })
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
    }
  });

  if (!profile.data || profile.data.onboarding_completed_at) return null;

  const plannedCount = plan.data?.slots.filter((slot: WeeklyPlan["slots"][number]) => slot.slot_type === "meal" && slot.recipe_id).length ?? 0;
  const groceryCount = grocery.data?.items.length ?? 0;
  const starterRecipeCount = recipes.data?.length ?? 0;
  const step = nextStep({
    hasCookPreference: Boolean(profile.data.max_cook_minutes),
    starterRecipeCount,
    plannedCount,
    groceryCount
  });

  return (
    <View style={styles.card}>
      <View style={styles.copy}>
        <Text style={styles.kicker}>Next step</Text>
        <Text numberOfLines={1} style={styles.title}>{step.title}</Text>
        <Text numberOfLines={2} style={styles.body}>{step.body}</Text>
      </View>
      <View style={styles.actions}>
        <Button label={step.cta} icon={step.icon} variant="primary" onPress={() => router.push(step.href as never)} />
        <Button label="Done" icon="checkmark" onPress={() => complete.mutate()} disabled={complete.isPending} />
      </View>
    </View>
  );
}

function nextStep({
  hasCookPreference,
  starterRecipeCount,
  plannedCount,
  groceryCount
}: {
  hasCookPreference: boolean;
  starterRecipeCount: number;
  plannedCount: number;
  groceryCount: number;
}) {
  if (!hasCookPreference) {
    return {
      title: "Set your dinner preferences",
      body: "Start with household size, weekly target, and max cook time so suggestions stay realistic.",
      cta: "Profile",
      href: "/profile",
      icon: "person-outline" as const
    };
  }
  if (starterRecipeCount <= 12) {
    return {
      title: "Add recipes you already like",
      body: "Starter meals are examples. Dinner Swipe gets better when your own links and manual recipes drive the deck.",
      cta: "Add recipe",
      href: "/recipes",
      icon: "add-circle-outline" as const
    };
  }
  if (plannedCount === 0) {
    return {
      title: "Swipe your first week",
      body: "Use Discover to pick dinners. Right plans, left skips, up favorites, and down hides.",
      cta: "Swipe",
      href: "/",
      icon: "flame-outline" as const
    };
  }
  if (groceryCount === 0) {
    return {
      title: "Generate your grocery list",
      body: "Review This Week, then regenerate groceries from the meals you selected.",
      cta: "Groceries",
      href: "/grocery",
      icon: "basket-outline" as const
    };
  }
  return {
    title: "You have the basic flow",
    body: "You can keep adding recipes, invite a group, or mark onboarding done.",
    cta: "Group",
    href: "/profile",
    icon: "people-outline" as const
  };
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderColor: "#f0b6b2", borderWidth: 1, borderRadius: 8, padding: 10, gap: 10, marginBottom: 10 },
  copy: { gap: 1 },
  kicker: { color: Colors.basil, fontWeight: "900", fontSize: 12, textTransform: "uppercase" },
  title: { color: Colors.ink, fontWeight: "900", fontSize: 16, lineHeight: 20 },
  body: { color: Colors.muted, lineHeight: 18, fontSize: 13 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 }
});
