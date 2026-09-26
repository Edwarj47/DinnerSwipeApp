import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";

import { Colors } from "@/components/theme";
import { monthlyPrice, PlanPickerProps } from "./planOptions";

export function PlanPicker({ value, onChange, basicPrice, premiumPrice, disabled }: PlanPickerProps) {
  return (
    <View>
      <select
        aria-label="Subscription plan"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === "premium" ? "premium" : "basic")}
        style={{
          appearance: "none", width: "100%", minHeight: 56, borderRadius: 8,
          border: `1px solid ${Colors.border}`, backgroundColor: Colors.surface,
          color: Colors.ink, padding: "12px 42px 12px 16px",
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          fontWeight: 700, fontSize: 16, cursor: "pointer", opacity: disabled ? 0.5 : 1
        }}
      >
        <option value="basic">Basic - {monthlyPrice(basicPrice)}</option>
        <option value="premium">Premium - {monthlyPrice(premiumPrice)}</option>
      </select>
      <View pointerEvents="none" style={{ position: "absolute", right: 16, top: 18 }}>
        <Ionicons name="chevron-down" size={20} color={Colors.muted} />
      </View>
    </View>
  );
}
