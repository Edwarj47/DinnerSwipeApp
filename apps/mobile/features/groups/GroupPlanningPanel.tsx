import { Ionicons } from "@expo/vector-icons";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { useTransientMessage } from "@/components/useTransientMessage";
import { DaySelection } from "@/features/planner/DaySelection";
import { ResetDaySelection } from "@/features/preferences/ResetDaySelection";
import { RecipePhoto } from "@/features/recipes/RecipePhoto";
import { RecipePicker } from "@/features/recipes/RecipePicker";
import { RecipeDetailSheet } from "@/features/recipes/RecipeDetailSheet";
import { apiFetch } from "@/services/api";
import { deviceTimeZone } from "@/services/planningPreferences";
import { requestPlanningNotificationPermission } from "@/services/planningReminders";
import { Household, Recipe, WeeklyPlanningSettings } from "@/services/types";
import { GroupRecipeSharing } from "./GroupRecipeSharing";

type Library = { items: { recipe: Recipe; enabled: boolean; is_blocked: boolean; warning_labels: string[] }[]; total: number; enabled_count: number };
type Proposal = { id: string; recipe: Recipe; status: "pending" | "approved" | "declined"; proposer_count: number; is_proposer: boolean; extra_request: boolean; my_vote: "yes" | "maybe" | "no" | null; votes: Record<"yes" | "maybe" | "no", number> };
type Proposals = { week_start: string; items: Proposal[] };

export function GroupPlanningPanel({ household, initialView }: { household: Household; initialView?: "choices" }) {
  const [tab, setTab] = useState<"proposals" | "library" | "choices">("proposals");
  const owner = household.current_user_role === "owner";
  const { group_view } = useLocalSearchParams<{ group_view?: string }>();
  useEffect(() => { if (owner && (group_view === "choices" || initialView === "choices")) setTab("choices"); }, [owner, group_view, initialView]);
  useEffect(() => { if (!owner && tab === "choices") setTab("proposals"); }, [owner, tab]);
  return <View style={styles.section}>
    <SegmentedControl adaptive accessibilityLabel="Group planning view" value={tab} onChange={setTab} options={[
      { value: "proposals", label: "Proposals" }, { value: "library", label: "Shared recipes" }, ...(owner ? [{ value: "choices" as const, label: "Discover choices" }] : [])
    ]} />
    {tab === "proposals" ? <ProposalList household={household} /> : <GroupLibrary key={tab} household={household} editing={tab === "choices" && owner} />}
    {tab === "library" ? <GroupRecipeSharing household={household} /> : null}
    <GroupResetSettings household={household} />
  </View>;
}

function GroupLibrary({ household, editing }: { household: Household; editing: boolean }) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [changes, setChanges] = useState<Record<string, boolean>>({});
  const names = useRef(new Map<string, string>());
  const [bulk, setBulk] = useState<"enable" | "disable" | null>(null);
  const [detail, setDetail] = useState<Recipe | null>(null);
  const [status, setStatus] = useTransientMessage();
  const plan = useMutation({ mutationFn: (recipe: Recipe) => apiFetch(`/api/v1/households/${household.id}/${household.current_user_role === "owner" ? "weekly-plans/current/slots" : "proposals"}`, { method: "POST", body: JSON.stringify({ recipe_id: recipe.id }) }),
    onSuccess: async () => { setDetail(null); setStatus(household.current_user_role === "owner" ? "Added to group week." : "Recipe proposed."); await Promise.all([client.invalidateQueries({ queryKey: ["weekly-plan", household.id] }), client.invalidateQueries({ queryKey: ["group-proposals", household.id] }), client.invalidateQueries({ queryKey: ["grocery", household.id] })]); } });
  const recipes = useInfiniteQuery({ queryKey: ["group-library", household.id, search.trim()], initialPageParam: 0,
    queryFn: ({ pageParam }) => apiFetch<Library>(`/api/v1/households/${household.id}/library?limit=30&offset=${pageParam}&q=${encodeURIComponent(search.trim())}`),
    getNextPageParam: (last, pages) => pages.length * 30 < last.total ? pages.length * 30 : undefined,
    refetchInterval: bulk !== null || Object.keys(changes).length ? false : 30_000 });
  const save = useMutation({ mutationFn: () => apiFetch(`/api/v1/households/${household.id}/discover-choices`, { method: "PATCH", body: JSON.stringify({
    enable_ids: Object.keys(changes).filter(id => changes[id]), disable_ids: Object.keys(changes).filter(id => !changes[id]), bulk_action: bulk, q: search.trim()
  }) }), onSuccess: async () => { setChanges({}); setBulk(null); setStatus("Discover choices saved."); await client.invalidateQueries({ queryKey: ["group-library", household.id] }); await client.invalidateQueries({ queryKey: ["recipes", "discover", household.id] }); } });
  const items = recipes.data?.pages.flatMap(p => p.items) ?? [];
  for (const item of items) names.current.set(item.recipe.id, item.recipe.name);
  function selectMatches(action: "enable" | "disable") {
    const query = search.trim().toLowerCase();
    setBulk(action);
    setChanges(current => Object.fromEntries(Object.entries(current).filter(([id]) => !names.current.get(id)?.toLowerCase().includes(query))));
  }
  const dirty = bulk !== null || Object.keys(changes).length > 0;
  return <View style={styles.section}>
    <TextInput accessibilityLabel="Search group recipes" placeholder="Search group recipes" editable={!bulk && !save.isPending} value={search} onChangeText={setSearch} style={styles.input} />
    <View style={styles.row}><Text style={styles.meta}>{recipes.data?.pages[0]?.enabled_count ?? 0} enabled for Discover</Text>
      {editing ? <View style={styles.buttons}><Button label="Select all matches" icon="checkbox-outline" disabled={save.isPending} onPress={() => selectMatches("enable")} /><Button label="Clear" icon="close" disabled={save.isPending} onPress={() => selectMatches("disable")} /></View> : null}
    </View>
    {items.map(item => {
      const checked = changes[item.recipe.id] ?? (bulk ? bulk === "enable" : item.enabled);
      return <Pressable key={item.recipe.id} accessibilityRole={editing ? "checkbox" : "button"} accessibilityLabel={item.recipe.name} accessibilityState={editing ? { checked } : undefined} aria-checked={editing ? checked : undefined} disabled={save.isPending} onPress={() => editing ? setChanges(current => ({ ...current, [item.recipe.id]: !checked })) : setDetail(item.recipe)} style={styles.recipeRow}>
        {editing ? <Ionicons name={checked ? "checkbox" : "square-outline"} size={24} color={Colors.tomato} /> : null}
        <RecipePhoto photoUrl={item.recipe.photo_url} accessibilityLabel={`${item.recipe.name} photo`} style={styles.photo} />
        <View style={styles.copy}><Text style={styles.name}>{item.recipe.name}</Text>{item.is_blocked ? <Text style={styles.error}>Blocked by group safety</Text> : item.warning_labels.length ? <Text style={styles.meta}>{item.warning_labels.join(", ")}</Text> : null}</View>
        {!editing && item.enabled ? <Ionicons name="checkmark-circle" color={Colors.basil} size={20} /> : null}
      </Pressable>;
    })}
    {recipes.isLoading ? <Text style={styles.meta}>Loading recipes...</Text> : null}
    {!recipes.isLoading && !recipes.isError && !items.length ? <Text style={styles.meta}>No shared recipes found.</Text> : null}
    {recipes.hasNextPage ? <Button label="More recipes" icon="chevron-down" disabled={recipes.isFetchingNextPage} onPress={() => { void recipes.fetchNextPage(); }} /> : null}
    {editing ? <Button label="Save choices" icon="save-outline" variant="primary" disabled={!dirty || save.isPending} onPress={() => save.mutate()} /> : null}
    {status ? <Text accessibilityLiveRegion="polite" style={styles.success}>{status}</Text> : null}
    {save.error ? <Text accessibilityRole="alert" style={styles.error}>{save.error.message}</Text> : null}
    {recipes.error ? <Button label="Retry recipes" icon="refresh" onPress={() => { void recipes.refetch(); }} /> : null}
    {plan.error ? <Text accessibilityRole="alert" style={styles.error}>{plan.error.message}</Text> : null}
    <RecipeDetailSheet recipe={detail} visible={!!detail} onClose={() => setDetail(null)} planningAction={{ label: household.current_user_role === "owner" ? "Plan for group" : "Propose recipe", busy: plan.isPending, error: plan.error?.message, onPress: () => { if (detail) plan.mutate(detail); } }} />
  </View>;
}

function ProposalList({ household }: { household: Household }) {
  const client = useQueryClient();
  const base = `/api/v1/households/${household.id}`;
  const owner = household.current_user_role === "owner";
  const [requestOpen, setRequestOpen] = useState(false);
  const [decision, setDecision] = useState<Proposal | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [servings, setServings] = useState("1");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ pending: true });
  const [status, setStatus] = useTransientMessage();
  const proposals = useQuery<Proposals>({ queryKey: ["group-proposals", household.id], queryFn: () => apiFetch<Proposals>(`${base}/proposals`), refetchInterval: 30_000 });
  const mutate = useMutation({ mutationFn: ({ path, method = "POST", body }: { path: string; method?: string; body?: object }) => apiFetch(`${base}${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }),
    onSuccess: async () => { setDecision(null); setRequestOpen(false); setStatus("Saved."); await Promise.all([client.invalidateQueries({ queryKey: ["group-proposals", household.id] }), client.invalidateQueries({ queryKey: ["weekly-plan", household.id] }), client.invalidateQueries({ queryKey: ["grocery", household.id] })]); } });
  const days = proposals.data ? Array.from({ length: 7 }, (_, i) => { const date = new Date(`${proposals.data.week_start}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + i); return { iso: date.toISOString().slice(0, 10), label: date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }), short: `${date.getUTCMonth() + 1}/${date.getUTCDate()}` }; }) : [];
  return <View style={styles.section}>
    <Button label="Request another recipe" icon="add-outline" onPress={() => { mutate.reset(); setRequestOpen(true); }} />
    {(["pending", "approved", "declined"] as const).map(state => {
      const items: Proposal[] = proposals.data?.items.filter((p: Proposal) => p.status === state) ?? [];
      return <View key={state} style={styles.section}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: !!expanded[state] }} aria-expanded={!!expanded[state]} onPress={() => setExpanded(current => ({ ...current, [state]: !current[state] }))} style={[styles.row, styles.sectionToggle]}>
          <Text style={styles.heading}>{state === "pending" ? "Pending proposals" : state === "approved" ? "Approved" : "Declined"}</Text><Text style={styles.meta}>{items.length}</Text><Ionicons name={expanded[state] ? "chevron-up" : "chevron-down"} size={20} color={Colors.muted} />
        </Pressable>
        {expanded[state] ? items.map((p: Proposal) => <View key={p.id} style={styles.proposal}>
          <View style={styles.recipeRow}><RecipePhoto photoUrl={p.recipe.photo_url} accessibilityLabel={`${p.recipe.name} photo`} style={styles.photo} /><View style={styles.copy}><Text style={styles.name}>{p.recipe.name}</Text><Text style={styles.meta}>{p.proposer_count} requested{p.extra_request ? " - Extra request" : ""}</Text></View></View>
          {state === "pending" ? <>
            <View style={styles.buttons}>{(["yes", "maybe", "no"] as const).map(vote => <Button key={vote} label={`${vote[0].toUpperCase() + vote.slice(1)} ${p.votes[vote]}`} icon={vote === "yes" ? "heart" : vote === "maybe" ? "help-circle-outline" : "close-circle-outline"} variant={p.my_vote === vote ? "primary" : "quiet"} disabled={mutate.isPending} onPress={() => mutate.mutate({ path: `/proposals/${p.id}/vote`, body: { vote } })} />)}</View>
            {owner ? <View style={styles.buttons}><Button label="Approve" icon="checkmark" disabled={mutate.isPending} onPress={() => { setDecision(p); setDay(null); setServings("1"); mutate.reset(); }} /><Button label="Decline" icon="close" disabled={mutate.isPending} onPress={() => mutate.mutate({ path: `/proposals/${p.id}/decision`, body: { action: "decline" } })} /></View>
              : p.is_proposer ? <Button label="Withdraw my request" icon="arrow-undo-outline" disabled={mutate.isPending} onPress={() => mutate.mutate({ path: `/proposals/${p.id}/participation`, method: "DELETE" })} /> : null}
          </> : null}
        </View>) : null}
        {expanded[state] && !items.length ? <Text style={styles.meta}>{state === "pending" ? "No proposals this week." : "None yet."}</Text> : null}
      </View>;
    })}
    {proposals.error ? <Button label="Retry proposals" icon="refresh" onPress={() => { void proposals.refetch(); }} /> : null}
    {status ? <Text accessibilityLiveRegion="polite" style={styles.success}>{status}</Text> : null}
    {mutate.error && !decision && !requestOpen ? <Text accessibilityRole="alert" style={styles.error}>{mutate.error.message}</Text> : null}
    <RecipePicker householdId={household.id} title="Request a shared recipe" visible={requestOpen} busy={mutate.isPending} error={mutate.error?.message} onClose={() => setRequestOpen(false)} onSelect={recipe => mutate.mutate({ path: "/proposals", body: { recipe_id: recipe.id } })} />
    <Modal visible={!!decision} transparent animationType="fade" onRequestClose={() => { if (!mutate.isPending) setDecision(null); }}>
      <View style={styles.backdrop}><View style={styles.modal} accessibilityViewIsModal><ScrollView contentContainerStyle={styles.section} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Approve meal</Text><Text style={styles.name}>{decision?.recipe.name}</Text>
        <DaySelection days={days} value={day} disabled={mutate.isPending} onChange={setDay} />
        <Text style={styles.label}>Total group servings</Text><TextInput accessibilityLabel="Total group servings" keyboardType="number-pad" value={servings} onChangeText={setServings} style={styles.input} />
        <Button label="Add to group week" icon="checkmark" variant="primary" disabled={mutate.isPending || !/^\d+$/.test(servings) || Number(servings) < 1 || Number(servings) > 30} onPress={() => { if (decision) mutate.mutate({ path: `/proposals/${decision.id}/decision`, body: { action: "approve", slot_date: day, servings: Number(servings) } }); }} />
        <Button label="Cancel" icon="close" disabled={mutate.isPending} onPress={() => setDecision(null)} />
        {mutate.error ? <Text accessibilityRole="alert" style={styles.error}>{mutate.error.message}</Text> : null}
      </ScrollView></View></View>
    </Modal>
  </View>;
}

function GroupResetSettings({ household }: { household: Household }) {
  const owner = household.current_user_role === "owner";
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const query = useQuery<WeeklyPlanningSettings & { personal_notify: boolean }>({ queryKey: ["group-planning-settings", household.id], queryFn: () => apiFetch(`/api/v1/households/${household.id}/planning-settings`), enabled: open });
  const [settings, setSettings] = useState<WeeklyPlanningSettings>({ mode: "manual", reset_day: 0, notify: true, time_zone: deviceTimeZone() });
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useTransientMessage();
  useEffect(() => { if (query.data && !dirty) setSettings(query.data); }, [query.data, dirty]);
  function updateSettings(change: Partial<WeeklyPlanningSettings>) { setDirty(true); setSettings(current => ({ ...current, ...change })); }
  const save = useMutation({ mutationFn: () => apiFetch(`/api/v1/households/${household.id}/planning-settings`, { method: "PUT", body: JSON.stringify(settings) }), onSuccess: async () => { setStatus("Group reset settings saved."); await Promise.all([client.invalidateQueries({ queryKey: ["group-planning-settings", household.id] }), client.invalidateQueries({ queryKey: ["group-reminders"] }), client.invalidateQueries({ queryKey: ["weekly-plan", household.id] })]); setDirty(false); } });
  const reminder = useMutation({ mutationFn: async (notify: boolean) => {
    if (notify) await requestPlanningNotificationPermission();
    return apiFetch(`/api/v1/households/${household.id}/planning-reminder`, { method: "PATCH", body: JSON.stringify({ notify }) });
  }, onSuccess: async () => { await client.invalidateQueries({ queryKey: ["group-planning-settings", household.id] }); await client.invalidateQueries({ queryKey: ["group-reminders"] }); } });
  return <View style={styles.section}><Button label={open ? "Close weekly reset" : "Group weekly reset"} icon="calendar-outline" onPress={() => setOpen(!open)} />
    {open ? <View style={styles.section}>
      <SegmentedControl accessibilityLabel="Group reset mode" value={settings.mode} disabled={!owner || save.isPending || !query.data} options={[{ value: "manual", label: "Manual only" }, { value: "automatic", label: "Automatic" }]} onChange={mode => updateSettings({ mode })} />
      <Text style={styles.meta}>{settings.mode === "manual" ? "Meals carry over each week." : "Start fresh on the reset day."}</Text>
      {settings.mode === "automatic" ? <ResetDaySelection value={settings.reset_day} disabled={!owner || save.isPending} onChange={reset_day => updateSettings({ reset_day })} /> : null}
      <Text style={styles.meta}>{settings.time_zone.replace(/_/g, " ")}</Text>
      {owner ? <><Button label="Use device time zone" icon="time-outline" disabled={save.isPending} onPress={() => updateSettings({ time_zone: deviceTimeZone() })} /><View style={styles.row}><Text style={[styles.copy, styles.label]}>Weekly reminders</Text><Switch accessibilityLabel="Group weekly reminders" value={settings.notify} onValueChange={notify => updateSettings({ notify })} disabled={save.isPending} /></View><Button label="Save group reset" icon="save-outline" disabled={save.isPending || !query.data} onPress={() => save.mutate()} /></> : null}
      {settings.mode === "automatic" ? <View style={styles.row}><Text style={[styles.copy, styles.label]}>Remind me on this phone</Text><Switch accessibilityLabel="My group reminder" disabled={reminder.isPending || !query.data} value={query.data?.personal_notify ?? true} onValueChange={notify => reminder.mutate(notify)} /></View> : null}
      {reminder.error ? <Text accessibilityRole="alert" style={styles.error}>{reminder.error.message}</Text> : null}
      {status ? <Text style={styles.success}>{status}</Text> : null}{save.error ? <Text accessibilityRole="alert" style={styles.error}>{save.error.message}</Text> : null}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 8 }, sectionToggle: { minHeight: 44 }, input: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, color: Colors.ink },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 }, buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  recipeRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: Colors.border },
  photo: { width: 48, height: 48, borderRadius: 6 }, copy: { flex: 1, minWidth: 0 }, name: { color: Colors.ink, fontWeight: "700", fontSize: 16 },
  heading: { color: Colors.ink, fontWeight: "800", fontSize: 18, flex: 1 }, meta: { color: Colors.muted, lineHeight: 20, fontSize: 14 }, label: { color: Colors.ink, fontWeight: "700" },
  proposal: { gap: 10, paddingBottom: 14, borderBottomWidth: 1, borderColor: Colors.border }, success: { color: Colors.basil }, error: { color: Colors.danger },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", padding: 20, alignItems: "center", justifyContent: "center" }, modal: { width: "100%", maxWidth: 480, maxHeight: "90%", padding: 20, borderRadius: 8, backgroundColor: Colors.surface }
});
