import { RESET_DAYS } from "@/services/planningPreferences";
import { Colors } from "@/components/theme";
import type { ResetDayProps } from "./ResetDaySelection";

export function ResetDaySelection({ value, onChange, disabled }: ResetDayProps) {
  return <label style={{ display: "grid", gap: 6, color: Colors.muted, fontSize: 13, fontWeight: 700 }}>
    Reset day
    <select aria-label="Reset day" value={value} disabled={disabled} onChange={event => onChange(Number(event.target.value))}
      style={{ minHeight: 48, width: "100%", padding: 12, border: `1px solid ${Colors.border}`,
        borderRadius: 8, background: Colors.surface, color: Colors.ink, fontFamily: "inherit", fontSize: 16 }}>
      {RESET_DAYS.map((day, index) => <option value={index} key={day}>{day}</option>)}
    </select>
  </label>;
}
