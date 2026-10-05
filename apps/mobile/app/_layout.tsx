import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AuthGate } from "@/components/AuthGate";
import { OfflineRuntime } from "@/components/OfflineRuntime";
import { PlanningRuntime } from "@/components/PlanningRuntime";
import { BiometricGate } from "@/components/BiometricGate";
import { Colors } from "@/components/theme";
import { SubscriptionGate } from "@/features/subscription/SubscriptionGate";

const queryClient = new QueryClient({ defaultOptions: {
  queries: { networkMode: "always", retry: false }, mutations: { networkMode: "always", retry: false }
} });

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.background }}>
      <QueryClientProvider client={queryClient}>
        <BiometricGate>
          <AuthGate>
            <SubscriptionGate>
              <OfflineRuntime />
              <PlanningRuntime />
              <Stack screenOptions={{ headerShown: false }} />
            </SubscriptionGate>
            <StatusBar style="dark" />
          </AuthGate>
        </BiometricGate>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
