import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { Colors } from "@/components/theme";
import { DaySelectionProps, daySelectionOptions } from "./daySelectionOptions";

export function DaySelection({ days, value, onChange, disabled = false }: DaySelectionProps) {
  return <View style={{ gap: 6 }}>
    <Text style={{ color: Colors.muted, fontSize: 13, fontWeight: "700" }}>Day selection</Text>
    <View>
      <select aria-label="Day selection" value={value ?? ""} disabled={disabled}
        onChange={event => { if (event.target.value !== (value ?? "")) onChange(event.target.value || null); }}
        style={{ appearance: "none", boxSizing: "border-box", width: "100%", minHeight: 48, borderRadius: 8,
          border: `1px solid ${Colors.border}`, backgroundColor: Colors.surface, color: Colors.ink,
          padding: "10px 38px 10px 42px", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', fontSize: 16, fontWeight: 700,
          cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1 }}>
        {daySelectionOptions(days).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <View pointerEvents="none" style={{ position: "absolute", left: 12, top: 14 }}>
        <Ionicons name="calendar-outline" size={20} color={Colors.muted} />
      </View>
      <View pointerEvents="none" style={{ position: "absolute", right: 12, top: 15 }}>
        <Ionicons name="chevron-down" size={18} color={Colors.muted} />
      </View>
    </View>
  </View>;
}
