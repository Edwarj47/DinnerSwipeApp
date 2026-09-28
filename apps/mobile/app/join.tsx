import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useState } from "react";

import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Colors } from "@/components/theme";
import { GroupJoinForm } from "@/features/groups/GroupJoinForm";
import { inviteCode } from "@/features/groups/groupAccess";

export default function JoinGroupScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = inviteCode(typeof params.code === "string" ? params.code : "");
  const router = useRouter();
  const [error, setError] = useState("");
  return <Screen><View style={styles.content}>
    <Text style={styles.title}>Dinner group invitation</Text>
    <GroupJoinForm key={code} initialCode={code} onJoined={() => router.replace({ pathname: "/profile", params: { section: "group" } })} />
    {Platform.OS === "web" && code ? <Button label="Open in Dinner Swipe app" icon="phone-portrait-outline" onPress={() => {
      void Linking.openURL(`dinnerswipe://join?code=${encodeURIComponent(code)}`).catch(() => setError("The app could not open. You can join here instead."));
    }} /> : null}
    <Button label="Not now" icon="arrow-back" onPress={() => router.replace("/profile")} />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View></Screen>;
}

const styles = StyleSheet.create({ content: { width: "100%", maxWidth: 480, alignSelf: "center", gap: 20 }, title: { fontSize: 26, fontWeight: "800", color: Colors.ink }, error: { color: Colors.danger } });
