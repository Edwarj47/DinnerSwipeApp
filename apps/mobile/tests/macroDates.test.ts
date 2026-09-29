import { calendarDays, isISODate, macroRangeQuery, shiftISODate } from "@/features/premium/macroDates";
import { MacroDayTotal } from "@/services/types";

test("date navigation handles leap days and rejects partial or impossible dates", () => {
  expect(isISODate("2024-02-29")).toBe(true);
  expect(isISODate("2025-02-29")).toBe(false);
  expect(isISODate("2026-09-")).toBe(false);
  expect(shiftISODate("2024-02-28", 1)).toBe("2024-02-29");
  expect(shiftISODate("2026-12-31", 1)).toBe("2027-01-01");
  expect(shiftISODate("2026-01-01", -1)).toBe("2025-12-31");
});

test("calendar filtering and calorie sorting preserve source data and zero-calorie entries", () => {
  const days = [
    { meal_date: "2026-09-27", calories: 0, entry_count: 0 },
    { meal_date: "2026-09-28", calories: 0, entry_count: 1 },
    { meal_date: "2026-09-29", calories: 500, entry_count: 1 }
  ] as MacroDayTotal[];
  expect(calendarDays(days, true, "oldest").map(day => day.meal_date)).toEqual(["2026-09-28", "2026-09-29"]);
  expect(calendarDays(days, false, "calories_high")[0].calories).toBe(500);
  expect(calendarDays(days, false, "calories_low")[0].calories).toBe(0);
  expect(days[0].meal_date).toBe("2026-09-27");
  expect(macroRangeQuery("365")).toBe("days=365");
  expect(macroRangeQuery("all")).toBe("all_time=true");
});
