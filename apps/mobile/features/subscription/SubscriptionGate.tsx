import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { Link, usePathname } from "expo-router";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { addAuthChangeListener, apiFetch, clearAuthTokens, getToken } from "@/services/api";
import { PremiumStatus, SubscriptionPlanStatus, SubscriptionTier } from "@/services/types";

type Props = {
  children: ReactNode;
};

const PUBLIC_PATHS = new Set(["/privacy", "/terms"]);

export function SubscriptionGate({ children }: Props) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let mounted = true;
    async function refreshTokenState() {
      const token = await getToken();
      if (!mounted) return;
      setHasToken(Boolean(token));
      setReady(true);
    }
    void refreshTokenState();
    const unsubscribe = addAuthChangeListener(() => {
      void refreshTokenState();
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const shouldCheck = ready && hasToken && !PUBLIC_PATHS.has(pathname);
  const subscription = useQuery({
    queryKey: ["subscription-status"],
    queryFn: () => apiFetch<PremiumStatus>("/api/v1/subscription/status"),
    enabled: shouldCheck,
    retry: false
  });

  const applyCode = useMutation({
    mutationFn: () =>
      apiFetch<PremiumStatus>("/api/v1/subscription/waiver-code", {
        method: "POST",
        body: JSON.stringify({ code })
      }),
    onSuccess: async (data) => {
      setCode("");
      setStatus(data.premium_active ? "Premium access unlocked." : "Basic access unlocked.");
      await refreshSubscriptions(queryClient);
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : "Unable to apply code.")
  });

  const startCheckout = useMutation({
    mutationFn: (tier: SubscriptionTier) =>
      apiFetch<{ checkout_url: string }>("/api/v1/subscription/checkout-session", {
        method: "POST",
        body: JSON.stringify({ tier })
      }),
    onSuccess: async (data) => {
      setStatus("Opening checkout.");
      await Linking.openURL(data.checkout_url);
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : "Unable to start checkout.")
  });

  const basicPlan = useMemo(
    () => subscription.data?.plans.find((plan: SubscriptionPlanStatus) => plan.tier === "basic"),
    [subscription.data?.plans]
  );
  const premiumPlan = useMemo(
    () => subscription.data?.plans.find((plan: SubscriptionPlanStatus) => plan.tier === "premium"),
    [subscription.data?.plans]
  );

  if (PUBLIC_PATHS.has(pathname) || !ready || !hasToken) return children;
  if (subscription.isLoading) return children;
  if (subscription.isError || !subscription.data || subscription.data.basic_active) return children;

  return (
    <>
      {children}
      <SafeAreaView style={styles.overlay}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <BrandLogo size={88} framed />
            <Text style={styles.kicker}>Dinner Swipe</Text>
            <Text style={styles.title}>Keep planning dinners together.</Text>
            <Text style={styles.subtitle}>
              Start Basic with a card on file. Your first month is free; billing begins after
              the trial unless canceled.
            </Text>
          </View>
          <View style={styles.panel}>
            <PlanRow
              name="Basic"
              priceCents={basicPlan?.monthly_price_cents ?? subscription.data.basic_monthly_price_cents}
              detail="App access, recipe saving, group voting, weekly plans, and grocery lists."
              badge="Card required"
            />
            <PlanRow
              name="Premium"
              priceCents={premiumPlan?.monthly_price_cents ?? subscription.data.premium_monthly_price_cents}
              detail="Everything in Basic plus macro targets, meal confirmations, and summary totals."
              badge="Upgrade anytime"
            />
            <Button
              label="Subscribe Basic"
              icon="card"
              variant="primary"
              disabled={!subscription.data.basic_stripe_configured || startCheckout.isPending}
              onPress={() => startCheckout.mutate("basic")}
            />
            <Button
              label="Go Premium"
              icon="trending-up"
              disabled={!subscription.data.premium_stripe_configured || startCheckout.isPending}
              onPress={() => startCheckout.mutate("premium")}
            />
            <Text style={styles.nativeNote}>
              Terms acceptance alone does not authorize a card charge. Billing starts only through
              the Stripe Checkout flow.
            </Text>
            <View style={styles.codeBox}>
              <Text style={styles.codeTitle}>Testing access code</Text>
              <View style={styles.codeRow}>
                <TextInput
                  accessibilityLabel="Testing access code"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={code}
                  onChangeText={setCode}
                  placeholder="Access code"
                  placeholderTextColor="#9b928b"
                  style={styles.input}
                />
                <Button
                  label="Apply"
                  icon="ticket"
                  disabled={code.trim().length < 3 || applyCode.isPending}
                  onPress={() => applyCode.mutate()}
                />
              </View>
            </View>
            <View style={styles.footerRow}>
              <Button
                label="Sign out"
                icon="log-out"
                onPress={() => {
                  void clearAuthTokens().then(() => queryClient.clear());
                }}
              />
              <View style={styles.legalRow}>
                <Link href="/privacy" style={styles.legalLink}>
                  Privacy
                </Link>
                <Text style={styles.legalText}> and </Text>
                <Link href="/terms" style={styles.legalLink}>
                  Terms
                </Link>
              </View>
            </View>
            {Platform.OS !== "web" ? (
              <Text style={styles.nativeNote}>
                Public native purchases will use the app store billing flow before release.
              </Text>
            ) : null}
            {status ? (
              <View style={styles.statusRow}>
                {startCheckout.isPending || applyCode.isPending ? <ActivityIndicator color={Colors.tomato} /> : null}
                <Text style={styles.status}>{status}</Text>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

function PlanRow({
  name,
  priceCents,
  detail,
  badge
}: {
  name: string;
  priceCents: number;
  detail: string;
  badge: string;
}) {
  return (
    <View style={styles.planRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.planName}>{name}</Text>
        <Text style={styles.planDetail}>{detail}</Text>
      </View>
      <View style={styles.planPriceBox}>
        <Text style={styles.planPrice}>${(priceCents / 100).toFixed(2)}</Text>
        <Text style={styles.planPeriod}>/mo</Text>
        <Text style={styles.planBadge}>{badge}</Text>
      </View>
    </View>
  );
}

async function refreshSubscriptions(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["subscription-status"] }),
    queryClient.invalidateQueries({ queryKey: ["premium-status"] }),
    queryClient.invalidateQueries({ queryKey: ["macro-summary"] }),
    queryClient.invalidateQueries({ queryKey: ["macro-targets"] })
  ]);
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.tomato, zIndex: 15 },
  content: { flexGrow: 1, justifyContent: "center", padding: 20, gap: 20 },
  hero: { alignItems: "center", gap: 9 },
  kicker: { color: "#fff", fontWeight: "900", textTransform: "uppercase", fontSize: 12 },
  title: { color: "#fff", fontSize: 30, fontWeight: "900", textAlign: "center", lineHeight: 35 },
  subtitle: { color: "#ffe6e3", textAlign: "center", lineHeight: 22, maxWidth: 360 },
  panel: { backgroundColor: Colors.surface, borderColor: "#f7d3cf", borderWidth: 1, borderRadius: 8, padding: 16, gap: 12 },
  planRow: { flexDirection: "row", gap: 12, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 12 },
  planName: { color: Colors.ink, fontSize: 18, fontWeight: "900" },
  planDetail: { color: Colors.muted, lineHeight: 20, marginTop: 4 },
  planPriceBox: { alignItems: "flex-end", minWidth: 88 },
  planPrice: { color: Colors.ink, fontSize: 18, fontWeight: "900" },
  planPeriod: { color: Colors.muted, fontSize: 12, fontWeight: "700" },
  planBadge: { color: Colors.basil, fontSize: 11, fontWeight: "900", marginTop: 8, textAlign: "right" },
  codeBox: { backgroundColor: Colors.softRed, borderRadius: 8, padding: 12, gap: 8 },
  codeTitle: { color: Colors.ink, fontWeight: "900" },
  codeRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, backgroundColor: Colors.surface },
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  legalRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", flex: 1 },
  legalText: { color: Colors.muted },
  legalLink: { color: Colors.tomatoDark, fontWeight: "900" },
  nativeNote: { color: Colors.muted, lineHeight: 20, fontSize: 13 },
  statusRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  status: { color: Colors.basil, fontWeight: "700", flex: 1 }
});
