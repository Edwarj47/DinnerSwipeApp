import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { Link, usePathname } from "expo-router";
import { ReactNode, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch, clearAuthTokens, reconnectOffline } from "@/services/api";
import { AppAccessContext, useAuthSession } from "@/services/session";
import { CouponResult, PremiumStatus, SubscriptionTier } from "@/services/types";
import { PlanPicker } from "./PlanPicker";
import { monthlyPrice, planFeatures } from "./planOptions";

type Props = {
  children: ReactNode;
};

const PUBLIC_PATHS = new Set(["/privacy", "/terms"]);

export function SubscriptionGate({ children }: Props) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const session = useAuthSession();
  const hadAccess = useRef(false);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [statusIsError, setStatusIsError] = useState(false);
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier>("basic");

  useEffect(() => {
    setCode("");
    setStatus("");
    setSelectedTier("basic");
    hadAccess.current = false;
  }, [session.email]);

  const shouldCheck = session.authenticated && !PUBLIC_PATHS.has(pathname);
  const subscription = useQuery({
    queryKey: ["subscription-status"],
    queryFn: () => apiFetch<PremiumStatus>("/api/v1/subscription/status"),
    enabled: shouldCheck,
    retry: false
  });
  const canUseApp = session.authenticated && Boolean(subscription.data?.basic_active) && !subscription.isError;

  useEffect(() => {
    if (canUseApp && !hadAccess.current) {
      // Retry any requests cached before access was granted, including old clients' 402 errors.
      void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "subscription-status" });
    }
    hadAccess.current = canUseApp;
  }, [canUseApp, queryClient]);

  useEffect(() => {
    if (!shouldCheck) return;
    const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["subscription-status"] }); };
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") refresh(); });
    const web = Platform.OS === "web" && typeof window !== "undefined";
    if (web) window.addEventListener("focus", refresh);
    return () => {
      listener.remove();
      if (web) window.removeEventListener("focus", refresh);
    };
  }, [queryClient, shouldCheck]);

  const applyCode = useMutation({
    onMutate: () => { setStatus(""); setStatusIsError(false); },
    mutationFn: () =>
      apiFetch<CouponResult>("/api/v1/subscription/coupon-code", {
        method: "POST",
        body: JSON.stringify({ code, tier: selectedTier })
      }),
    onSuccess: async (data) => {
      setCode("");
      setStatus(data.message);
      if (data.subscription) queryClient.setQueryData(["subscription-status"], data.subscription);
      if (data.checkout_url) await Linking.openURL(data.checkout_url);
      await refreshSubscriptions(queryClient);
    },
    onError: (error) => { setStatusIsError(true); setStatus(error instanceof Error ? error.message : "Unable to apply code."); }
  });

  const startCheckout = useMutation({
    onMutate: () => { setStatus(""); setStatusIsError(false); },
    mutationFn: (tier: SubscriptionTier) =>
      apiFetch<{ checkout_url: string }>("/api/v1/subscription/checkout-session", {
        method: "POST",
        body: JSON.stringify({ tier })
      }),
    onSuccess: async (data) => {
      setStatus("Opening checkout.");
      await Linking.openURL(data.checkout_url);
    },
    onError: (error) => { setStatusIsError(true); setStatus(error instanceof Error ? error.message : "Unable to start checkout."); }
  });

  const basicPrice = subscription.data?.basic_monthly_price_cents ?? 599;
  const premiumPrice = subscription.data?.premium_monthly_price_cents ?? 999;
  const isBasic = selectedTier === "basic";
  const hasTrial = isBasic && subscription.data?.basic_trial_eligible !== false;
  const checkoutConfigured = isBasic ? subscription.data?.basic_stripe_configured : subscription.data?.premium_stripe_configured;
  const busy = startCheckout.isPending || applyCode.isPending;

  const app = <AppAccessContext.Provider value={canUseApp}>{children}</AppAccessContext.Provider>;
  const switchAccount = async () => {
    await queryClient.cancelQueries();
    await clearAuthTokens();
    queryClient.clear();
  };
  if (!shouldCheck || canUseApp) return app;
  if (subscription.isPending || subscription.isError) {
    return (
      <>
        {app}
        <SafeAreaView style={styles.overlay}>
          <View style={styles.checking}>
            <BrandLogo size={72} framed />
            {subscription.isPending ? (
              <><ActivityIndicator color="#fff" /><Text style={styles.subtitle}>Checking your access...</Text></>
            ) : (
              <>
                <Text style={styles.title}>Unable to check your access</Text>
                <Text style={styles.subtitle}>{subscription.error instanceof Error ? subscription.error.message : "Check your connection and try again."}</Text>
                <Button label="Try again" icon="refresh" disabled={subscription.isFetching} onPress={async () => { await reconnectOffline(); await subscription.refetch(); }} />
                <Button label="Switch account" icon="swap-horizontal" onPress={() => { void switchAccount(); }} />
              </>
            )}
          </View>
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      {app}
      <SafeAreaView style={styles.overlay}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.container}>
            <View style={styles.hero}>
              <BrandLogo size={88} framed />
              <Text style={styles.kicker}>Dinner Swipe</Text>
              <Text style={styles.title}>Keep planning dinners together.</Text>
              <Text style={styles.subtitle}>
                Your recipes. Your people. A plan for every week.
              </Text>
            </View>
            <View style={styles.panel}>
              <View style={styles.accountRow}>
                <View style={styles.accountIdentity}>
                  <Text style={styles.nativeNote}>Signed in as</Text>
                  <Text style={styles.accountEmail}>{session.email}</Text>
                </View>
                <Button label="Switch account" icon="swap-horizontal" disabled={busy} onPress={() => { void switchAccount(); }} />
              </View>
              <Text style={styles.planLabel}>Choose your plan</Text>
              <PlanPicker
                value={selectedTier}
                onChange={(tier) => { setSelectedTier(tier); setStatus(""); }}
                basicPrice={basicPrice}
                premiumPrice={premiumPrice}
                disabled={busy}
              />
              <View style={styles.features}>
                {planFeatures[selectedTier].map((feature) => (
                  <View key={feature} style={styles.featureRow}>
                    <Ionicons name="checkmark" color={Colors.basil} size={19} />
                    <Text style={styles.featureText}>{feature}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.billingSummary}>
                <Text style={styles.billingTitle}>{hasTrial ? "First 30 days free" : monthlyPrice(isBasic ? basicPrice : premiumPrice)}</Text>
                <Text style={styles.nativeNote}>
                  {hasTrial
                    ? `Card required. Then ${monthlyPrice(basicPrice)} unless canceled. Upgrade anytime.`
                    : "Billed monthly from today. Cancel anytime."}
                </Text>
              </View>
              <Button
                label={startCheckout.isPending ? "Opening checkout..." : hasTrial ? "Start Basic free trial" : isBasic ? "Subscribe to Basic" : "Subscribe to Premium"}
                icon="card"
                variant="primary"
                disabled={!checkoutConfigured || busy}
                onPress={() => startCheckout.mutate(selectedTier)}
              />
              <Text style={styles.nativeNote}>
                Confirm your subscription securely with Stripe. Cancel in Manage billing.
              </Text>
              <View style={styles.codeBox}>
                <Text style={styles.codeTitle}>Coupon code</Text>
                <Text style={styles.nativeNote}>Discounts are confirmed in checkout. Free-access coupons apply immediately.</Text>
                <View style={styles.codeRow}>
                  <TextInput
                    accessibilityLabel="Coupon code"
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={code}
                    onChangeText={(value) => { setCode(value); setStatus(""); }}
                    onSubmitEditing={() => { if (code.trim().length >= 3 && !busy) applyCode.mutate(); }}
                    placeholder="Coupon code"
                    placeholderTextColor="#9b928b"
                    style={styles.input}
                  />
                  <Button
                    label="Apply"
                    icon="ticket"
                    disabled={code.trim().length < 3 || busy}
                    onPress={() => applyCode.mutate()}
                  />
                </View>
              </View>
              <View style={styles.footerRow}>
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
              {status ? (
                <View style={styles.statusRow}>
                  {startCheckout.isPending || applyCode.isPending ? <ActivityIndicator color={Colors.tomato} /> : null}
                  <Text accessibilityRole={statusIsError ? "alert" : undefined} accessibilityLiveRegion="polite" style={[styles.status, statusIsError && styles.error]}>{status}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
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
  checking: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  accountRow: { gap: 10, alignItems: "flex-start", paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  accountIdentity: { width: "100%", gap: 2 },
  accountEmail: { fontWeight: "700", color: Colors.ink, lineHeight: 21, flexShrink: 1 },
  content: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: 20, paddingVertical: 32 },
  container: { width: "100%", maxWidth: 520, gap: 24 },
  hero: { alignItems: "center", gap: 9 },
  kicker: { color: "#fff", fontWeight: "900", textTransform: "uppercase", fontSize: 12 },
  title: { color: "#fff", fontSize: 30, fontWeight: "900", textAlign: "center", lineHeight: 35 },
  subtitle: { color: "#ffe6e3", textAlign: "center", lineHeight: 22, maxWidth: 360 },
  panel: { backgroundColor: Colors.surface, borderColor: "#f7d3cf", borderWidth: 1, borderRadius: 8, padding: 20, gap: 12 },
  planLabel: { color: Colors.ink, fontSize: 18, fontWeight: "800" },
  features: { gap: 12, paddingVertical: 8 },
  featureRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  featureText: { flex: 1, color: Colors.ink, lineHeight: 21 },
  comingSoon: { color: Colors.muted, fontSize: 13, lineHeight: 20 },
  billingSummary: { gap: 4, paddingVertical: 8 },
  billingTitle: { color: Colors.ink, fontSize: 18, fontWeight: "800" },
  codeBox: { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 16, marginTop: 4, gap: 8 },
  codeTitle: { color: Colors.ink, fontWeight: "900" },
  codeRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, minWidth: 0, minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, backgroundColor: Colors.surface, color: Colors.ink },
  footerRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 },
  legalRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", flex: 1 },
  legalText: { color: Colors.muted },
  legalLink: { color: Colors.tomatoDark, fontWeight: "900" },
  nativeNote: { color: Colors.muted, lineHeight: 20, fontSize: 13 },
  statusRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  status: { color: Colors.basil, fontWeight: "700", flex: 1 },
  error: { color: Colors.danger }
});
