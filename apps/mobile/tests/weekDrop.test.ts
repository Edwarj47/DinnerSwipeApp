import { dragScrollOffset, findDropDay, findDropPosition, reorderDaySlots } from "@/features/planner/weekDrop";

const viewport = { x: 10, y: 100, width: 300, height: 500 };
test("drop targets use full day sections and ignore clipped or off-screen positions", () => {
  const days = new Map([
    ["monday", { x: 10, y: 50, width: 300, height: 200 }],
    ["tuesday", { x: 10, y: 260, width: 300, height: 300 }],
    ["", { x: 10, y: 560, width: 300, height: 200 }]
  ]);
  expect(findDropDay(days, viewport, 150, 150)).toBe("monday");
  expect(findDropDay(days, viewport, 150, 500)).toBe("tuesday");
  expect(findDropDay(days, viewport, 150, 580)).toBe("");
  expect(findDropDay(days, viewport, 150, 80)).toBeNull();
  expect(findDropDay(days, viewport, 150, 650)).toBeNull();
  expect(findDropDay(days, viewport, 320, 150)).toBeNull();
});
test("edge scrolling is bounded and stationary in the middle", () => {
  expect(dragScrollOffset(200, 590, viewport, 1600)).toBe(218);
  expect(dragScrollOffset(200, 110, viewport, 1600)).toBe(182);
  expect(dragScrollOffset(200, 300, viewport, 1600)).toBe(200);
  expect(dragScrollOffset(0, 110, viewport, 1600)).toBe(0);
  expect(dragScrollOffset(1100, 590, viewport, 1600)).toBe(1100);
});

test("drop above a meal targets insertion before it; bottom targets the end", () => {
  const days = new Map([["mon", { x: 10, y: 100, width: 300, height: 400 }]]);
  const meals = new Map([
    ["first", { x: 10, y: 180, width: 300, height: 80, day: "mon" }],
    ["second", { x: 10, y: 270, width: 300, height: 80, day: "mon" }]
  ]);
  expect(findDropPosition(days, meals, viewport, 100, 200, "second")).toEqual({ day: "mon", beforeId: "first" });
  expect(findDropPosition(days, meals, viewport, 100, 400, "first")).toEqual({ day: "mon", beforeId: null });
  expect(findDropPosition(days, meals, viewport, 400, 200, "second")).toBeNull();
});

test("same-day reordering preserves other days and unused slots", () => {
  const slots = [
    { id: "a", slot_date: "mon", recipe_id: "pasta", slot_type: "meal" },
    { id: "b", slot_date: "tue", recipe_id: "soup", slot_type: "meal" },
    { id: "empty", slot_date: "mon", recipe_id: null, slot_type: "flexible" },
    { id: "c", slot_date: "mon", recipe_id: "salad", slot_type: "meal" }
  ];
  expect(reorderDaySlots(slots, "c", "a")).toEqual(["c", "b", "empty", "a"]);
  expect(reorderDaySlots(slots, "a", null)).toEqual(["c", "b", "empty", "a"]);
  expect(reorderDaySlots(slots, "a", "c")).toBeNull();
  expect(reorderDaySlots(slots, "c", "b")).toBeNull();
  expect(reorderDaySlots(slots, "empty", "a")).toBeNull();
});
