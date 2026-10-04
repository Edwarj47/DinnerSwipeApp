export type DaySelectionProps = {
  days: { iso: string; label: string; short: string }[];
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
};

export function daySelectionOptions(days: DaySelectionProps["days"]) {
  return [
    { value: "", label: "Any day" },
    ...days.map(day => ({ value: day.iso, label: `${day.label}, ${day.short}` }))
  ];
}
