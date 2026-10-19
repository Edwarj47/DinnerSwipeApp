export function formatPortions(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (value === 0) return "0";
  const rounded = Math.abs(value) >= 0.0001
    ? Number(value.toFixed(4)) : Number(value.toPrecision(4));
  return String(rounded);
}
