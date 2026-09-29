import { MacroDayTotal } from "@/services/types";

export function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function isISODate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function shiftISODate(value: string, days: number) {
  const current = new Date(`${isISODate(value) ? value : todayISO()}T12:00:00Z`);
  current.setUTCDate(current.getUTCDate() + days);
  return current.toISOString().slice(0, 10);
}

export type CalendarSort = "newest" | "oldest" | "calories_high" | "calories_low";
export function calendarDays(days: MacroDayTotal[], loggedOnly: boolean, sort: CalendarSort) {
  return days.filter(day => !loggedOnly || day.entry_count > 0).sort((a, b) => {
    if (sort === "oldest") return a.meal_date.localeCompare(b.meal_date);
    if (sort === "calories_high" && a.calories !== b.calories) return b.calories - a.calories;
    if (sort === "calories_low" && a.calories !== b.calories) return a.calories - b.calories;
    return b.meal_date.localeCompare(a.meal_date);
  });
}

export function macroRangeQuery(range: string) {
  return range === "all" ? "all_time=true" : `days=${range}`;
}
