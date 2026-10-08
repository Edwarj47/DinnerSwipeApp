import { MacroDayTotal } from "@/services/types";

export type TrendBucket = {
  start: string; end: string; days: number;
  calories: number | null; protein_g: number | null;
};
export function trendBuckets(daily: MacroDayTotal[], limit = 21): TrendBucket[] {
  const ordered = [...daily].sort((a, b) => a.meal_date.localeCompare(b.meal_date));
  const size = Math.max(1, Math.ceil(ordered.length / Math.max(1, limit)));
  const buckets: TrendBucket[] = [];
  for (let offset = 0; offset < ordered.length; offset += size) {
    const rows = ordered.slice(offset, offset + size);
    const pending = rows.some(row => !!row.nutrition_unavailable_count);
    buckets.push({ start: rows[0].meal_date, end: rows[rows.length - 1].meal_date, days: rows.length,
      calories: pending ? null : rows.reduce((sum, row) => sum + row.calories, 0) / rows.length,
      protein_g: pending ? null : rows.reduce((sum, row) => sum + row.protein_g, 0) / rows.length });
  }
  return buckets;
}
export function analyticsDays(value: unknown) {
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 366 ? days : 30;
}
