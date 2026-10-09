import { useRef } from "react";
import { StyleProp, StyleSheet, TextInput, TextInputProps, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Button } from "./Button";
import { Colors } from "./theme";

type Props = TextInputProps & {
  value: string;
  onChangeText: (value: string) => void;
  containerStyle?: StyleProp<ViewStyle>;
  showSearchIcon?: boolean;
};

export function SearchField({ value, onChangeText, editable = true, containerStyle, style, showSearchIcon = false, ...props }: Props) {
  const input = useRef<TextInput>(null);
  return <View style={[styles.field, containerStyle]}>
    {showSearchIcon ? <Ionicons name="search-outline" size={20} color={Colors.muted} style={styles.searchIcon} /> : null}
    <TextInput {...props} ref={input} value={value} editable={editable} onChangeText={onChangeText}
      autoCapitalize={props.autoCapitalize ?? "none"} clearButtonMode="never" style={[styles.input, style]} />
    <View style={styles.clear}>
      {value.length ? <Button label="" icon="close" variant="quiet" accessibilityLabel="Clear search" disabled={!editable}
        onPress={() => { onChangeText(""); input.current?.focus(); }} /> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  field: { flexDirection: "row", alignItems: "center", minHeight: 48, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, backgroundColor: Colors.surface },
  input: { flex: 1, width: 0, minWidth: 0, minHeight: 46, paddingHorizontal: 12, fontSize: 15, color: Colors.ink },
  clear: { width: 44, height: 44, flexShrink: 0 }, searchIcon: { marginLeft: 12 }
});
