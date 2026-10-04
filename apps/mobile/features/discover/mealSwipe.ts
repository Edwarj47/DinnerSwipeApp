export type MealAction = "add" | "skip" | "favorite" | "hide";

export function swipeActionForOffset(x: number, y: number, threshold = 22): MealAction | null {
  "worklet";
  const absX = Math.abs(x), absY = Math.abs(y);
  if (Math.max(absX, absY) <= threshold) return null;
  if (absX >= absY) return x > 0 ? "add" : "skip";
  return y < 0 ? "favorite" : "hide";
}
