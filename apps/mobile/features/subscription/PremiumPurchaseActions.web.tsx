import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { useThemeColors } from "@/components/theme";
import { addAuthChangeListener, apiFetch } from "@/services/api";
import { CouponResult, PremiumStatus } from "@/services/types";
import { SubscriptionDisclosures } from "./SubscriptionDisclosures";

export function PremiumPurchaseActions({ status }: { status?: PremiumStatus }) {
  const colors = useThemeColors();
  const queries = useQueryClient();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const epoch = useRef(0);
  useEffect(() => addAuthChangeListener(() => { epoch.current++; setCode(""); setMessage(""); }), []);
  useEffect(() => () => { epoch.current++; }, []);
  const web = useMutation({
    mutationFn: async (action: "buy" | "manage" | "coupon") => {
      const current = epoch.current;
      if (action === "coupon") {
        const result = await apiFetch<CouponResult>("/api/v1/subscription/coupon-code", {
          method: "POST", body: JSON.stringify({ tier: "premium", code })
        });
        if (current !== epoch.current) return;
        if (result.checkout_url) await Linking.openURL(result.checkout_url);
        return { current, text: result.message };
      }
      const result = await apiFetch<{ checkout_url?: string; portal_url?: string }>(action === "buy"
        ? "/api/v1/subscription/checkout-session" : "/api/v1/premium/billing-portal-session", {
        method: "POST", ...(action === "buy" ? { body: JSON.stringify({ tier: "premium" }) } : {})
      });
      if (current !== epoch.current) return;
      const url = result.checkout_url ?? result.portal_url;
      if (!url) throw new Error("Billing is unavailable.");
      await Linking.openURL(url);
      return { current, text: "" };
    },
    onSuccess: async result => {
      if (!result || result.current !== epoch.current) return;
      setMessage(result.text); setCode("");
      await queries.invalidateQueries({ queryKey: ["subscription-status"] });
      await queries.invalidateQueries({ queryKey: ["premium-status"] });
    },
    onError: error => setMessage(error instanceof Error ? error.message : "Billing is unavailable.")
  });
  const canBuy = !!status && !status.premium_active && !status.welcome_active && !status.welcome_eligible;
  return <View style={{ gap: 8 }}>
    <Text style={{ color: colors.ink }}>Premium USD {((status?.premium_monthly_price_cents ?? 999) / 100).toFixed(2)}/month</Text>
    <SubscriptionDisclosures />
    <Button label="Subscribe to Premium" icon="card" variant="primary"
      disabled={!canBuy || !status?.premium_stripe_configured || web.isPending} onPress={() => web.mutate("buy")} />
    {status?.billing_management_available ? <Button label="Manage billing" icon="card" disabled={web.isPending}
      onPress={() => web.mutate("manage")} /> : null}
    <TextInput accessibilityLabel="Premium coupon code" placeholder="Premium coupon code" value={code}
      onChangeText={setCode} autoCapitalize="none" autoCorrect={false}
      style={{ color: colors.ink, borderColor: colors.border, borderWidth: 1, borderRadius: 6, padding: 10 }} />
    <Button label="Apply Premium coupon" icon="ticket" disabled={code.trim().length < 3 || web.isPending}
      onPress={() => web.mutate("coupon")} />
    {message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.muted }}>{message}</Text> : null}
  </View>;
}
