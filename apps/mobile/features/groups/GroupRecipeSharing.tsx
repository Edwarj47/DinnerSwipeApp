import { Ionicons } from "@expo/vector-icons";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useMemo, useState } from "react";
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { useTransientMessage } from "@/components/useTransientMessage";
import { apiFetch, reconnectOffline } from "@/services/api";
import { deviceOffline } from "@/services/offlineStore";
import { GroupRecipeOption, GroupRecipeOptions, GroupRecipeShareResult, Household } from "@/services/types";

export function GroupRecipeSharing({ household }: { household: Household }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useTransientMessage();
  if (household.is_personal) return null;
  return <View style={styles.section}>
    <Button label="Share recipes" icon="share-social-outline" onPress={() => { setStatus(""); setOpen(true); }} />
    {status ? <Text accessibilityLiveRegion="polite" style={styles.success}>{status}</Text> : null}
    {open ? <GroupRecipePicker key={household.id} household={household} onClose={() => setOpen(false)} onShared={result => {
      setOpen(false);
      setStatus(result.shared_count ? `${result.shared_count} ${result.shared_count === 1 ? "recipe" : "recipes"} shared with ${household.name}.` : "Selected recipes are already shared.");
    }} /> : null}
  </View>;
}

function GroupRecipePicker({ household, onClose, onShared }: {
  household: Household; onClose: () => void; onShared: (result: GroupRecipeShareResult) => void;
}) {
  const client = useQueryClient();
  const { height } = useWindowDimensions();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const recipes = useInfiniteQuery({
    queryKey: ["group-recipe-options", household.id, search.trim()],
    queryFn: ({ pageParam }) => apiFetch<GroupRecipeOptions>(`/api/v1/households/${household.id}/recipes?limit=30&offset=${pageParam}&q=${encodeURIComponent(search.trim())}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.items.length, 0);
      return last.items.length && loaded < last.total ? loaded : undefined;
    }
  });
  const items = useMemo(() => Array.from(new Map((recipes.data?.pages.flatMap(page => page.items) ?? []).map(item => [item.recipe.id, item])).values()), [recipes.data]);
  const summary = recipes.data?.pages[0];
  const available = summary ? summary.total - summary.shared_count : 0;
  const count = selectAll ? Math.max(0, available - excluded.size) : selected.size;
  const clearSelection = () => { setSelected(new Set()); setExcluded(new Set()); setSelectAll(false); };
  const share = useMutation({
    mutationFn: async () => {
      if (deviceOffline()) await reconnectOffline();
      return apiFetch<GroupRecipeShareResult>(`/api/v1/households/${household.id}/recipes/share`, {
        method: "POST", body: JSON.stringify(selectAll ? { select_all: true, q: search.trim(), excluded_recipe_ids: [...excluded] } : { recipe_ids: [...selected] })
      });
    },
    onSuccess: result => {
      for (const key of ["group-recipe-options", "vote-options", "recipes", "votes"]) void client.invalidateQueries({ queryKey: [key] });
      onShared(result);
    }
  });
  const toggle = (id: string) => {
    share.reset();
    if (selectAll) setExcluded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    else setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const close = () => { if (!share.isPending) onClose(); };
  const more = () => {
    if (recipes.hasNextPage && !recipes.isFetchingNextPage && !share.isPending) void (async () => {
      if (deviceOffline()) await reconnectOffline();
      await recipes.fetchNextPage();
    })();
  };
  const renderItem = ({ item }: { item: GroupRecipeOption }) => {
    const { recipe, is_shared: shared } = item;
    const checked = shared || (selectAll ? !excluded.has(recipe.id) : selected.has(recipe.id));
    const disabled = shared || share.isPending || (selectAll ? checked && excluded.size >= 500 : !checked && selected.size >= 500);
    return <Pressable accessibilityRole="checkbox" accessibilityLabel={`${shared ? "Already shared:" : "Select"} ${recipe.name}`}
      accessibilityState={{ checked, disabled }} disabled={disabled} onPress={() => toggle(recipe.id)}
      style={[styles.row, checked && !shared && styles.selected]}>
      {recipe.photo_url ? <Image source={{ uri: recipe.photo_url }} style={styles.photo} contentFit="cover" /> : <View style={styles.photoPlaceholder}><Ionicons name="restaurant-outline" size={24} color={Colors.muted} /></View>}
      <View style={styles.copy}><Text style={styles.recipeName}>{recipe.name}</Text>
        <Text style={[styles.meta, shared && styles.shared]}>{shared ? "Already shared" : recipe.is_hidden ? "Hidden in your library" : recipe.total_minutes ? `${recipe.total_minutes} min` : "My recipe"}</Text>
      </View>
      <Ionicons name={checked ? "checkbox" : "square-outline"} size={24} color={shared ? Colors.basil : checked ? Colors.tomato : Colors.muted} />
    </Pressable>;
  };
  return <Modal visible transparent animationType="fade" onRequestClose={close}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.backdrop}>
      <View style={[styles.panel, { height: Math.min(height * 0.88, 720) }]} accessibilityViewIsModal>
        <View style={styles.header}>
          <View style={styles.copy}><Text style={styles.title}>Share recipes</Text><Text numberOfLines={2} style={styles.meta}>{household.name}</Text></View>
          <Button label="" icon="close" accessibilityLabel="Close recipe sharing" disabled={share.isPending} onPress={close} />
        </View>
        <View style={styles.search}>
          <Ionicons name="search-outline" size={20} color={Colors.muted} />
          <TextInput accessibilityLabel="Search your recipes" placeholder="Search your recipes" value={search} maxLength={200} editable={!share.isPending} onChangeText={value => {
            if (selectAll) clearSelection();
            share.reset(); setSearch(value);
          }} style={styles.input} />
        </View>
        <View style={styles.toolbar}>
          <Pressable accessibilityRole="checkbox" accessibilityLabel={search.trim() ? "Select all matching recipes" : "Select all recipes"}
            accessibilityState={{ checked: selectAll && !excluded.size ? true : count ? "mixed" : false, disabled: !available || recipes.isFetching || share.isPending }}
            disabled={!available || recipes.isFetching || share.isPending} style={styles.selectAll} onPress={() => {
              share.reset(); if (selectAll && !excluded.size) clearSelection(); else { setSelectAll(true); setSelected(new Set()); setExcluded(new Set()); }
            }}>
            <Ionicons name={selectAll && !excluded.size ? "checkbox" : count ? "remove-circle-outline" : "square-outline"} size={22} color={Colors.tomato} />
            <Text style={styles.selectLabel}>{search.trim() ? "Select all matches" : "Select all"}</Text>
          </Pressable>
          {count ? <Button label="" icon="close-circle-outline" accessibilityLabel="Clear selection" disabled={share.isPending} onPress={clearSelection} /> : <Text style={styles.meta}>{summary ? `${summary.total} ${summary.total === 1 ? "recipe" : "recipes"}` : ""}</Text>}
        </View>
        <FlatList testID="group-recipe-list" data={items} keyExtractor={item => item.recipe.id} renderItem={renderItem}
          style={styles.list} keyboardShouldPersistTaps="handled" onEndReached={more} onEndReachedThreshold={0.3}
          ListEmptyComponent={<View style={styles.empty}>
            <Text style={styles.meta}>{recipes.isLoading ? "Loading recipes..." : recipes.isError ? "Recipes couldn't be loaded." : search.trim() ? "No matching recipes." : "No saved recipes yet."}</Text>
            {recipes.isError ? <Button label="Retry" icon="refresh" onPress={() => { void (async () => {
              if (deviceOffline()) await reconnectOffline();
              await recipes.refetch();
            })(); }} /> : null}
          </View>}
          ListFooterComponent={recipes.hasNextPage ? <View style={styles.more}><Button label={recipes.isFetchingNextPage ? "Loading..." : "More recipes"} icon="chevron-down" disabled={recipes.isFetchingNextPage || share.isPending} onPress={more} />
            {recipes.isFetchNextPageError ? <Text accessibilityRole="alert" style={styles.error}>More recipes couldn't be loaded. Try again.</Text> : null}</View> : null} />
        <View style={styles.footer}>
          <Text accessibilityLiveRegion="polite" style={styles.selectionCount}>{count} selected</Text>
          {share.error ? <Text accessibilityRole="alert" style={styles.error}>{share.error.message}</Text> : null}
          <Button label={share.isPending ? "Sharing..." : `Share ${count === 1 ? "1 recipe" : `${count} recipes`}`} icon="share-social-outline" variant="primary"
            disabled={!count || share.isPending || (selectAll && (recipes.isFetching || recipes.isError))} onPress={() => share.mutate()} />
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  section: { gap: 8 }, success: { color: Colors.basil, fontWeight: "600", lineHeight: 22 },
  backdrop: { flex: 1, padding: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)" },
  panel: { width: "100%", maxWidth: 560, borderRadius: 8, backgroundColor: Colors.surface, overflow: "hidden" },
  header: { flexDirection: "row", gap: 12, alignItems: "center", padding: 18, paddingBottom: 12 },
  title: { fontSize: 20, fontWeight: "800", color: Colors.ink }, copy: { flex: 1, minWidth: 0 },
  meta: { color: Colors.muted, fontSize: 13, lineHeight: 20 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, marginHorizontal: 18, paddingHorizontal: 12, minHeight: 48 },
  input: { flex: 1, minWidth: 0, minHeight: 46, fontSize: 15, color: Colors.ink },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 18, minHeight: 52, gap: 8 },
  selectAll: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }, selectLabel: { color: Colors.ink, fontWeight: "600", fontSize: 14 },
  list: { flex: 1 }, row: { flexDirection: "row", gap: 12, alignItems: "center", minHeight: 80, paddingVertical: 14, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: Colors.border },
  selected: { backgroundColor: Colors.softRed }, recipeName: { color: Colors.ink, fontWeight: "700", fontSize: 15, lineHeight: 21 },
  photo: { width: 48, height: 48, borderRadius: 6 }, photoPlaceholder: { width: 48, height: 48, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: Colors.background },
  shared: { color: Colors.basil }, more: { padding: 16, gap: 8 }, empty: { padding: 18, gap: 12 },
  footer: { borderTopWidth: 1, borderColor: Colors.border, padding: 18, gap: 10 },
  selectionCount: { color: Colors.ink, fontSize: 14, fontWeight: "600" }, error: { color: Colors.danger, lineHeight: 20 }
});
