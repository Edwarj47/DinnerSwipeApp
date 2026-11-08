import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react-native";
import { NutritionRuntime } from "@/components/NutritionRuntime";

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-11-08T00:00:00Z"));
});
afterEach(() => jest.useRealTimers());

test("account navigation preserves nutrition expiry without triggering network refresh", () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  const invalidate = jest.spyOn(client, "invalidateQueries");
  const tree = (refresh: boolean) => <QueryClientProvider client={client}><NutritionRuntime refresh={refresh} /></QueryClientProvider>;
  const screen = render(tree(true));
  try {
    act(() => {
      client.setQueryData(["fixture-nutrition"], { temporary_nutrition: true, calories: 250 });
      client.setQueryData(["manual-nutrition"], { temporary_nutrition: false, calories: 100 });
      jest.advanceTimersByTime(10 * 60 * 1000);
    });
    screen.rerender(tree(false));
    act(() => jest.advanceTimersByTime(5 * 60 * 1000));
    expect(client.getQueryData(["fixture-nutrition"])).toMatchObject({ calories: null, nutrition_unavailable: true });
    expect(client.getQueryData(["manual-nutrition"])).toMatchObject({ calories: 100 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["fixture-nutrition"], exact: true, refetchType: "none" });
  } finally { screen.unmount(); client.clear(); }
});

test("active nutrition views retain their normal expiry and refresh behavior", () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  const invalidate = jest.spyOn(client, "invalidateQueries");
  const screen = render(<QueryClientProvider client={client}><NutritionRuntime /></QueryClientProvider>);
  try {
    act(() => {
      client.setQueryData(["fixture-nutrition"], { temporary_nutrition: true, calories: 250 });
      jest.advanceTimersByTime(15 * 60 * 1000);
    });
    expect(client.getQueryData(["fixture-nutrition"])).toMatchObject({ calories: null, nutrition_unavailable: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["fixture-nutrition"], exact: true, refetchType: "active" });
  } finally { screen.unmount(); client.clear(); }
});
