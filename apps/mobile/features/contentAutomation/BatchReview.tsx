import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { useTransientMessage } from "@/components/useTransientMessage";
import { offlineOwner, useOfflineStatus } from "@/services/offlineStore";
import { automationKey, batchKey, decideCandidates, getBatch } from "./api";
import { CandidatePreview } from "./CandidatePreview";
import { Batch, Candidate, isPreparing, statusLabel } from "./types";
import { styles } from "./styles";

export function BatchReview({ owner, id, blocked, onBusyChange }: { owner: string; id: string; blocked: boolean; onBusyChange: (busy: boolean) => void }) {
  const client = useQueryClient();
  const offline = useOfflineStatus(state => state.offline);
  const [selection, setSelection] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [message, setMessage] = useTransientMessage();
  const lock = useRef(false);
  const query = useQuery<Batch>({
    queryKey: batchKey(owner, id), queryFn: ({ signal }) => getBatch(id, signal), retry: false,
    refetchInterval: offline ? false : query => isPreparing(query.state.data?.status ?? "") ? 5000 : 30000
  });
  const decision = useMutation({
    mutationFn: ({ action, ids }: { action: "approve" | "dismiss"; ids: string[] }) => decideCandidates(id, action, ids), retry: false,
    onMutate: async () => {
      setMessage("");
      await client.cancelQueries({ queryKey: batchKey(owner, id), exact: true });
    },
    onSuccess: async (data, variables) => {
      if (offlineOwner() !== owner) return;
      client.setQueryData(batchKey(owner, id), data);
      setSelection([]);
      setMessage(variables.action === "approve" ? "Approved additions saved." : "Selected additions dismissed.");
      await client.invalidateQueries({ queryKey: automationKey(owner), exact: true });
    },
    onError: async () => {
      if (offlineOwner() !== owner) return;
      await client.invalidateQueries({ queryKey: automationKey(owner) });
    },
    onSettled: async (_data, _error, variables) => {
      try {
        // A lost approval response may still have saved content on the server.
        if (variables.action === "approve" && offlineOwner() === owner) {
          await client.invalidateQueries({ queryKey: ["recipes"] });
          await client.invalidateQueries({ queryKey: ["workouts", owner, "templates"] });
        }
      } finally { lock.current = false; onBusyChange(false); }
    }
  });
  const data: Batch | undefined = query.data;
  const candidates = data ? [...data.recipes, ...data.workouts] : [];
  const pending = candidates.filter(item => item.status === "pending");
  const selected = pending.filter(item => selection.includes(item.id)).map(item => item.id);
  const busy = blocked || offline || query.isFetching || query.isError || decision.isPending || !data || isPreparing(data.status);
  const preview = candidates.find(item => item.id === previewId);
  function decide(action: "approve" | "dismiss", ids: string[]) {
    if (busy || lock.current || !ids.length) return;
    lock.current = true;
    onBusyChange(true);
    decision.mutate({ action, ids });
  }
  function toggle(candidate: Candidate) {
    if (busy || candidate.status !== "pending") return;
    setSelection(all => all.includes(candidate.id) ? all.filter(item => item !== candidate.id) : [...all, candidate.id]);
  }
  return <View style={styles.content}>
    <View style={styles.row}>
      <Text style={[styles.label, styles.copy]}>Batch additions</Text>
      <ActivityIndicator animating={query.isFetching} hidesWhenStopped accessibilityLabel={query.isFetching ? "Loading daily batch" : undefined} color={Colors.tomato} style={styles.loading} />
      <Button label="" icon="refresh" accessibilityLabel="Refresh daily batch" disabled={query.isFetching || offline || decision.isPending} onPress={() => { void query.refetch(); }} />
    </View>
    {query.isError ? <View style={styles.content}><Text accessibilityRole="alert" style={styles.error}>Couldn't load this batch.</Text>
      <Button label="Try again" accessibilityLabel="Retry daily batch" icon="refresh" disabled={query.isFetching || offline || decision.isPending} onPress={() => { void query.refetch(); }} />
    </View> : null}
    {data && !query.isError ? <>
      {isPreparing(data.status) ? <Text style={styles.meta}>{statusLabel(data.status)}...</Text> : null}
      {!candidates.length ? <Text style={styles.meta}>{isPreparing(data.status) ? "No additions available yet." : "No additions in this batch."}</Text> : null}
      {pending.length ? <>
        <View style={styles.wrap}>
          <SelectionCheckbox label="Select all pending additions" text="Select all" checked={selected.length === pending.length} mixed={selected.length > 0 && selected.length < pending.length}
            disabled={busy} onPress={() => setSelection(selected.length === pending.length ? [] : pending.map(item => item.id))} />
          <Text style={styles.meta}>{selected.length}/{pending.length} selected</Text>
        </View>
        <View style={styles.wrap}>
          <Button label="Approve selected" icon="checkmark" variant="primary" disabled={busy || !selected.length} onPress={() => decide("approve", selected)} />
          <Button label="Approve batch" icon="checkmark-done" disabled={busy || !pending.length} onPress={() => decide("approve", pending.map(item => item.id))} />
          <Button label="Dismiss selected" icon="close" variant="quiet-danger" disabled={busy || !selected.length} onPress={() => decide("dismiss", selected)} />
        </View>
      </> : null}
      {([["Recipes", data.recipes], ["Workouts", data.workouts]] as const).map(([label, items]) => items.length ? <View key={label} style={styles.content}>
        <Text style={styles.label}>{label} ({items.length})</Text>
        {items.map(candidate => <View key={candidate.id} style={styles.candidate}>
          {candidate.status === "pending" ? <SelectionCheckbox label={`Select ${candidate.title}`} checked={selected.includes(candidate.id)} disabled={busy} onPress={() => toggle(candidate)} />
            : <View style={styles.checkIcon}><Ionicons name={candidate.status === "approved" ? "checkmark-circle-outline" : candidate.status === "dismissed" ? "close-circle-outline" : "information-circle-outline"} size={22} color={candidate.status === "approved" ? Colors.basil : Colors.muted} /></View>}
          <View style={styles.copy}>
            <Text style={styles.label}>{candidate.title}</Text>
            <Text style={styles.meta}>{statusLabel(candidate.status)}{candidate.warnings.length ? ` | ${candidate.warnings.length} ${candidate.warnings.length === 1 ? "warning" : "warnings"}` : ""}</Text>
          </View>
          <Button label="" icon="eye-outline" accessibilityLabel={`Preview ${candidate.title}`} disabled={decision.isPending} onPress={() => setPreviewId(candidate.id)} />
        </View>)}
      </View> : null)}
    </> : null}
    {decision.isPending ? <Text accessibilityLiveRegion="polite" style={styles.meta}>Saving decisions...</Text> : null}
    {decision.isError ? <Text accessibilityRole="alert" style={styles.error}>Couldn't confirm the decision. Check the refreshed batch and try again.</Text> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.success}>{message}</Text> : null}
    {preview ? <CandidatePreview key={preview.id} candidate={preview} onClose={() => setPreviewId(null)} /> : null}
  </View>;
}

function SelectionCheckbox({ label, text, checked, mixed, disabled, onPress }: { label: string; text?: string; checked: boolean; mixed?: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: mixed ? "mixed" : checked, disabled }}
    aria-checked={mixed ? "mixed" : checked} aria-disabled={disabled}
    disabled={disabled} onPress={onPress} style={[styles.checkbox, disabled && styles.disabled]}>
    <View style={styles.checkIcon}><Ionicons name={checked ? "checkbox" : mixed ? "remove-circle-outline" : "square-outline"} size={24} color={checked || mixed ? Colors.basil : Colors.muted} /></View>
    {text ? <Text style={styles.label}>{text}</Text> : null}
  </Pressable>;
}
