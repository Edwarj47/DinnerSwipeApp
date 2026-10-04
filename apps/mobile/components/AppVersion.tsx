import Constants from "expo-constants";
import { Platform, StyleSheet, Text } from "react-native";
import { Colors } from "./theme";

export function AppVersion() {
  const config = Constants.expoConfig;
  const build = Platform.OS === "android" ? config?.android?.versionCode : config?.ios?.buildNumber;
  return <Text accessibilityLabel="App version" style={styles.version}>
    Version {config?.version ?? "0.1.0"}{build ? ` - Build ${build}` : Platform.OS === "web" ? " - Web" : ""}
  </Text>;
}

const styles = StyleSheet.create({
  version: { color: Colors.muted, fontSize: 12, textAlign: "center", paddingVertical: 16 }
});
