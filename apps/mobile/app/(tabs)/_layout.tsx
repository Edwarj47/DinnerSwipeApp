import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { AdaptiveTabBar } from "@/components/AdaptiveTabBar";
import { Colors } from "@/components/theme";
import { OnboardingGuide } from "@/features/onboarding/OnboardingGuide";
import { useAppAccess, useAuthSession } from "@/services/session";
import { apiFetch } from "@/services/api";
import { PremiumStatus } from "@/services/types";
import { SettingsMenuProvider } from "@/features/settings/SettingsMenu";
import { useSettingsMenu } from "@/features/settings/SettingsContext";

const icons = {
  index: "flame-outline",
  week: "calendar-outline",
  grocery: "basket-outline",
  recipes: "book-outline",
  profile: "speedometer-outline"
} as const;

export default function TabLayout() {
  const canUseApp = useAppAccess();
  const { email } = useAuthSession();
  // Keep the root Stack mounted for public routes; defer protected screens and queries here.
  if (!canUseApp) return null;
  return (
    <OnboardingGuide key={email}>
      <SettingsMenuProvider><NavigationTabs /></SettingsMenuProvider>
    </OnboardingGuide>
  );
}

function NavigationTabs() {
  const settings = useSettingsMenu();
  const subscription = useQuery({ queryKey: ["subscription-status"], queryFn: () => apiFetch<PremiumStatus>("/api/v1/subscription/status") });
  const premium = Boolean(subscription.data?.premium_active ?? subscription.data?.active);
  return (
      <Tabs
        tabBar={props => <AdaptiveTabBar {...props} />}
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: Colors.tomato,
          tabBarInactiveTintColor: Colors.muted,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={icons[route.name as keyof typeof icons]} size={size} color={color} />
          )
        })}
      >
        <Tabs.Screen name="index" options={{ title: "Discover" }} />
        <Tabs.Screen name="week" options={{ title: "This Week" }} />
        <Tabs.Screen name="grocery" options={{ title: "Grocery" }} />
        <Tabs.Screen name="recipes" options={{ title: "Recipes" }} />
        <Tabs.Screen name="profile" options={{ title: "Macros" }} listeners={{ tabPress: event => {
          if (subscription.data && !subscription.isError && !premium) { event.preventDefault(); settings?.invitePremium(); }
        } }} />
      </Tabs>
  );
}
