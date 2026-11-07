import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AuthGate } from "@/components/AuthGate";
import { AppearanceProvider } from "@/components/AppearanceProvider";
import { AppearanceBootstrap } from "@/components/AppearanceBootstrap";
import { OfflineRuntime } from "@/components/OfflineRuntime";
import { PlanningRuntime } from "@/components/PlanningRuntime";
import { BiometricGate } from "@/components/BiometricGate";
import { Colors } from "@/components/theme";
import { NutritionRuntime } from "@/components/NutritionRuntime";
import { SubscriptionGate } from "@/features/subscription/SubscriptionGate";

const queryClient = new QueryClient({ defaultOptions: {
  queries: { networkMode: "always", retry: false }, mutations: { networkMode: "always", retry: false }
} });

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.background }}>
      <QueryClientProvider client={queryClient}>
        <AppearanceBootstrap>
        <BiometricGate>
          <AppearanceProvider>
          <AuthGate>
            <SubscriptionGate>
              <OfflineRuntime />
              <NutritionRuntime />
              <PlanningRuntime />
              <Stack screenOptions={{ headerShown: false }} />
            </SubscriptionGate>
            <StatusBar style="dark" />
          </AuthGate>
          </AppearanceProvider>
        </BiometricGate>
        </AppearanceBootstrap>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
