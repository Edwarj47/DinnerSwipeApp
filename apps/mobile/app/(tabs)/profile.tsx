import { useIsFocused } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { MacroAnalyticsPanel } from "@/features/premium/MacroAnalyticsPanel";
import { PremiumMacroPanel } from "@/features/premium/PremiumMacroPanel";
import { useSettingsMenu } from "@/features/settings/SettingsContext";
import { apiFetch } from "@/services/api";
import { openSettings } from "@/services/settingsMenu";
import { PremiumStatus } from "@/services/types";

// Keep the route name for existing password-reset, tour, and subscription links.
export default function MacrosScreen() {
  const params = useLocalSearchParams<{ section?: string; reset_token?: string; group_view?: string; tour?: string }>();
  const focused = useIsFocused();
  const settings = useSettingsMenu();
  const [view, setView] = useState<"tracking" | "analytics">("tracking");
  const handled = useRef("");
  const invited = useRef(false);
  const enteredSettings = useRef(Boolean(settings?.open));
  const subscription = useQuery({ queryKey: ["subscription-status"], queryFn: () => apiFetch<PremiumStatus>("/api/v1/subscription/status"), retry: false });
  const premium = !subscription.isError && Boolean(subscription.data?.premium_active ?? subscription.data?.active);
  const legacySettings = ["account", "meals", "group"].includes(params.section ?? "") || Boolean(params.reset_token);
  useEffect(() => {
    if (!focused) { invited.current = false; enteredSettings.current = false; return; }
    const signature = JSON.stringify([params.section, params.reset_token, params.group_view, params.tour]);
    if (handled.current === signature) return;
    handled.current = signature;
    if (legacySettings) {
      enteredSettings.current = true;
      if (params.tour) return;
      openSettings({ tab: params.section === "group" ? "group" : "user",
        section: params.section === "meals" ? "meals" : "account",
        focus: params.section === "account" && !params.tour ? "subscription" : undefined,
        resetToken: params.reset_token, groupView: params.group_view === "choices" ? "choices" : undefined });
    } else if (params.section) setView(params.section === "analytics" ? "analytics" : "tracking");
  }, [focused, legacySettings, params.section, params.reset_token, params.group_view, params.tour]);
  useEffect(() => {
    if (focused && !legacySettings && !enteredSettings.current && subscription.data && !subscription.isError && !premium && !invited.current) {
      invited.current = true; settings?.invitePremium();
    }
  }, [focused, legacySettings, subscription.data, subscription.isError, premium, settings]);

  return <Screen contentWidth={960} header={<Text accessibilityRole="header" style={styles.title}>Macros</Text>}>
    {subscription.isLoading ? <Text style={styles.meta}>Checking your subscription...</Text> : subscription.isError ? <View style={styles.state}>
      <Text accessibilityRole="alert" style={styles.meta}>Couldn't check your subscription.</Text>
      <Button label="Retry subscription" icon="refresh" onPress={() => { void subscription.refetch(); }} />
    </View> : !premium ? <View style={styles.state}>
      <Text style={styles.heading}>Macros is a Premium feature</Text>
      <Button label="View Premium" icon="card-outline" variant="primary" onPress={() => openSettings({ section: "account", focus: "subscription" })} />
    </View> : <>
      <SegmentedControl adaptive accessibilityLabel="Macros sections" value={view} onChange={setView} options={[
        { label: "Macro tracking", value: "tracking", icon: "speedometer-outline" },
        { label: "Analytics", value: "analytics", icon: "stats-chart-outline" }
      ]} />
      <View style={styles.content}>{view === "tracking" ? <PremiumMacroPanel /> : <MacroAnalyticsPanel />}</View>
    </>}
  </Screen>;
}
const styles = StyleSheet.create({
  title: { color: Colors.ink, fontSize: 28, fontWeight: "800", paddingVertical: 6 },
  heading: { color: Colors.ink, fontSize: 20, fontWeight: "800" },
  meta: { color: Colors.muted, fontSize: 15, lineHeight: 22 },
  state: { gap: 14, paddingVertical: 24 }, content: { marginTop: 14 }
});
