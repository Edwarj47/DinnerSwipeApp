import { swipeActionForOffset } from "@/features/discover/mealSwipe";

test.each([
  [150, 110, "add"], [-150, 110, "skip"], [110, -150, "favorite"], [110, 150, "hide"],
  [110, 110, "add"], [-110, -110, "skip"], [0, 0, null], [15, -15, null]
])("only the dominant direction previews an action (%s,%s)", (x, y, action) => {
  expect(swipeActionForOffset(Number(x), Number(y))).toBe(action);
});

test("previewing does not commit; releasing below the existing threshold does nothing", () => {
  expect(swipeActionForOffset(80, 60)).toBe("add");
  expect(swipeActionForOffset(80, 60, 90)).toBeNull();
  expect(swipeActionForOffset(90, 90, 90)).toBeNull();
  expect(swipeActionForOffset(91, 60, 90)).toBe("add");
  expect(swipeActionForOffset(91, 150, 90)).toBe("hide");
});
