import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { HouseholdPanel } from "@/features/groups/HouseholdPanel";
import { useSpace } from "@/features/groups/useSpace";
import { apiFetch } from "@/services/api";
import { Household } from "@/services/types";

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock("@/services/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/features/groups/useSpace", () => ({ useSpace: jest.fn() }));
jest.mock("@/features/groups/GroupManager", () => ({ GroupManager: () => null }));
jest.mock("@/features/groups/GroupPlanningPanel", () => ({ GroupPlanningPanel: () => null }));

const group: Household = {
  id: "family", name: "Family", is_personal: false, invite_code: "ABCDEFGH",
  current_user_role: "owner", members: [], allergen_filter_mode: "warn", dislike_filter_mode: "warn"
};

function mount(household: Household = group) {
  jest.mocked(useSpace).mockReturnValue({ key: household.id, group: household } as ReturnType<typeof useSpace>);
  jest.mocked(apiFetch).mockResolvedValue({});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}><HouseholdPanel /></QueryClientProvider>);
  return { ...screen, close: () => { screen.unmount(); client.clear(); } };
}

test("group safety starts collapsed with a hazard icon and preserves safety updates", async () => {
  const screen = mount();
  try {
    expect(screen.getByRole("button", { name: "Group safety settings" })).toBeTruthy();
    expect(screen.getByText("warning-outline")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Group settings" })).toBeNull();
    expect(screen.queryByText("Allergens")).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Group safety settings" }));
    expect(screen.getByText("Allergens")).toBeTruthy();
    expect(screen.getByText("Dislikes")).toBeTruthy();
    fireEvent.press(screen.getAllByLabelText("Block")[0]);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/v1/households/family/settings", {
      method: "PATCH", body: JSON.stringify({ allergen_filter_mode: "block", dislike_filter_mode: "warn" })
    }));
    await screen.findByText("Group safety settings saved.");
    fireEvent.press(screen.getByRole("button", { name: "Close group safety settings" }));
    expect(screen.queryByText("Allergens")).toBeNull();
  } finally { screen.close(); }
});

test.each([
  { ...group, current_user_role: "member" as const },
  { ...group, is_personal: true }
])("group safety remains owner-only for shared groups", household => {
  const screen = mount(household);
  try {
    expect(screen.queryByRole("button", { name: "Group safety settings" })).toBeNull();
  } finally { screen.close(); }
});
