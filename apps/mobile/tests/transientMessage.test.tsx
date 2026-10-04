import { act, renderHook } from "@testing-library/react-native";
import { useTransientMessage } from "@/components/useTransientMessage";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("success stays for five seconds and identical messages restart the timer", () => {
  const hook = renderHook(() => useTransientMessage());
  act(() => hook.result.current[1]("Saved."));
  act(() => jest.advanceTimersByTime(4999));
  expect(hook.result.current[0]).toBe("Saved.");
  act(() => hook.result.current[1]("Saved."));
  act(() => jest.advanceTimersByTime(4999));
  expect(hook.result.current[0]).toBe("Saved.");
  act(() => jest.advanceTimersByTime(1));
  expect(hook.result.current[0]).toBe("");
  hook.unmount();
});

test("persistent errors are not erased; changing back to success starts the timer", () => {
  const hook = renderHook(({ persistent }) => useTransientMessage(persistent), { initialProps: { persistent: true } });
  act(() => hook.result.current[1]("Try again."));
  act(() => jest.advanceTimersByTime(10000));
  expect(hook.result.current[0]).toBe("Try again.");
  hook.rerender({ persistent: false });
  act(() => hook.result.current[1]("Saved."));
  act(() => jest.advanceTimersByTime(5000));
  expect(hook.result.current[0]).toBe("");
  hook.unmount();
  expect(jest.getTimerCount()).toBe(0);
});
