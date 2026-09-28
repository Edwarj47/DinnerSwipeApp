import { dragScrollOffset, findDropDay } from "@/features/planner/weekDrop";

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
