import { fireEvent, render } from "@testing-library/react-native";
import { SummaryPeriod, summaryDays } from "@/features/premium/SummaryPeriod";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

test.each([1, 21, 501, 3650, "14"])("accepts custom day count %s", value => {
  expect(summaryDays(value)).toBe(Number(value));
});
test.each([0, -1, 3651, 1.5, "", "bad", "2.5", true, null, undefined])("rejects invalid day count %s", value => {
  expect(summaryDays(value)).toBeNull();
});

test("editing or cancelling does not query, and Apply submits a valid whole number once", () => {
  const change = jest.fn();
  const screen = render(<SummaryPeriod days={21} onChange={change} />);
  fireEvent.press(screen.getByLabelText("Summary period: Last 21 days"));
  expect(screen.getByText("Choose how many days to show, including today. Enter 1 for today only.")).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText("Summary days"), "0");
  expect(screen.getByLabelText("Apply summary period").props.accessibilityState.disabled).toBe(true);
  fireEvent.press(screen.getByLabelText("Apply summary period"));
  expect(change).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText("Dismiss summary period"));
  expect(change).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText("Summary period: Last 21 days"));
  expect(screen.getByLabelText("Summary days").props.value).toBe("21");
  fireEvent.changeText(screen.getByLabelText("Summary days"), "501");
  expect(change).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText("Apply summary period"));
  expect(change).toHaveBeenCalledTimes(1);
  expect(change).toHaveBeenCalledWith(501);
  expect(screen.queryByLabelText("Summary days")).toBeNull();
});
