import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AuthGate } from "@/components/AuthGate";
import { BiometricGate } from "@/components/BiometricGate";
import { Colors } from "@/components/theme";
import { SubscriptionGate } from "@/features/subscription/SubscriptionGate";

const queryClient = new QueryClient();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.background }}>
      <QueryClientProvider client={queryClient}>
        <BiometricGate>
          <AuthGate>
            <SubscriptionGate>
              <Stack screenOptions={{ headerShown: false }} />
            </SubscriptionGate>
            <StatusBar style="dark" />
          </AuthGate>
        </BiometricGate>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
