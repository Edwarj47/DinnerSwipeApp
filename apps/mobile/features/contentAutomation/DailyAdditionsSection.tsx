import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Colors } from "@/components/theme";
import { useTransientMessage } from "@/components/useTransientMessage";
import { SettingsSection } from "@/features/settings/SettingsSection";
import { offlineOwner, useOfflineStatus } from "@/services/offlineStore";
import { automationKey, getAutomation, setCampaignPaused } from "./api";
import { BatchReview } from "./BatchReview";
import { SourcesReview } from "./SourcesReview";
import { ContentAutomation, dateLabel, isPreparing, reportReason, statusLabel } from "./types";
import { styles } from "./styles";
import { useSourcesReview } from "./useSourcesReview";

type SectionControls = { expanded?: boolean; onToggle?: () => void };

export function DailyAdditionsSection({ expanded, onToggle }: SectionControls = {}) {
  const owner = useOfflineStatus(() => offlineOwner());
  return owner ? <CampaignSection key={owner} owner={owner} expanded={expanded} onToggle={onToggle} /> : null;
}

function CampaignSection({ owner, expanded: sectionOpen, onToggle }: { owner: string } & SectionControls) {
  const client = useQueryClient();
  const offline = useOfflineStatus(state => state.offline);
  const [localOpen, setOpen] = useState(false);
  const open = sectionOpen ?? localOpen;
  const [view, setView] = useState<"pending" | "history" | "sources">("pending");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [message, setMessage] = useTransientMessage();
  const pauseLock = useRef(false);
  const query = useQuery<ContentAutomation>({
    queryKey: automationKey(owner), queryFn: ({ signal }) => getAutomation(signal), retry: false,
    refetchInterval: open && !offline ? 30000 : false
  });
  const pause = useMutation({
    mutationFn: (paused: boolean) => setCampaignPaused(paused), retry: false,
    onMutate: async () => {
      setMessage("");
      await client.cancelQueries({ queryKey: automationKey(owner), exact: true });
    },
    onSuccess: (data) => {
      if (offlineOwner() !== owner) return;
      client.setQueryData(automationKey(owner), data);
      setMessage(data.campaign?.status === "paused" ? "Daily additions paused." : "Daily additions resumed.");
    },
    onError: () => {
      if (offlineOwner() === owner) void client.invalidateQueries({ queryKey: automationKey(owner), exact: true });
    },
    onSettled: () => { pauseLock.current = false; }
  });
  const data: ContentAutomation | undefined = query.data;
  const campaign = data?.campaign;
  const sourcesReview = useSourcesReview(owner, open && view === "sources" && !!campaign);
  if (!campaign) return null;
  const busy = pause.isPending || reviewBusy || sourcesReview.decision.isPending;
  const disabled = busy || query.isFetching || query.isError || offline;
  const terminal = ["completed", "cancelled", "canceled", "expired", "failed"].includes(campaign.status);
  const batches = data?.batches ?? [];
  const pending = batches.filter(batch => batch.pending_count > 0 || isPreparing(batch.status));
  const history = batches.filter(batch => !pending.includes(batch));
  const visible = [...(view === "pending" ? pending : history)].sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));
  const sourceCount = sourcesReview.data?.runs.reduce((count, run) => count + run.sources.filter(source => source.status === "pending").length, 0);
  return <SettingsSection title="Daily additions" icon="calendar-outline" expanded={open} onToggle={() => { if (!busy) { if (onToggle) onToggle(); else setOpen(value => !value); } }}>
    <View style={styles.content}>
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.label}>{statusLabel(campaign.status)} - {campaign.completed_days}/{campaign.days_total} days</Text>
          <Text style={styles.meta}>{campaign.pending_count} pending</Text>
        </View>
        <ActivityIndicator animating={query.isFetching} hidesWhenStopped accessibilityLabel={query.isFetching ? "Refreshing daily additions" : undefined} color={Colors.tomato} style={styles.loading} />
        <Button label="" icon="refresh" accessibilityLabel="Refresh daily additions" disabled={busy || query.isFetching || offline} onPress={() => { void query.refetch(); }} />
      </View>
      <Text style={styles.meta}>{dateLabel(campaign.start_date)} - {dateLabel(campaign.end_date)} | {campaign.time_zone}</Text>
      {!terminal ? <View style={styles.row}>
        <Text style={[styles.label, styles.copy]}>Paused</Text>
        <Switch accessibilityLabel="Pause daily additions" value={campaign.status === "paused"} disabled={disabled}
          thumbColor={campaign.status === "paused" ? Colors.tomato : Colors.surface} trackColor={{ false: Colors.border, true: "#f4aaa8" }}
          onValueChange={paused => {
            if (disabled || pauseLock.current) return;
            pauseLock.current = true;
            pause.mutate(paused);
          }} />
      </View> : null}
      {pause.isPending ? <Text accessibilityLiveRegion="polite" style={styles.meta}>Updating campaign...</Text> : null}
      {offline ? <Text accessibilityRole="alert" style={styles.error}>Reconnect to review daily additions.</Text> : null}
      {query.isError ? <Text accessibilityRole="alert" style={styles.error}>Couldn't refresh daily additions. Try again.</Text> : null}
      {pause.isError ? <Text accessibilityRole="alert" style={styles.error}>Couldn't update the campaign. Refresh and try again.</Text> : null}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.success}>{message}</Text> : null}
      <SegmentedControl value={view} adaptive accessibilityLabel="Daily addition views" disabled={busy}
        options={[{ value: "pending", label: `Pending (${pending.length})`, icon: "time-outline" }, { value: "history", label: `History (${history.length})`, icon: "archive-outline" }, { value: "sources", label: sourceCount == null ? "Sources" : `Sources (${sourceCount})`, icon: "link-outline" }]}
        onChange={value => { setView(value); setExpanded(null); }} />
      {view === "sources" ? <SourcesReview owner={owner} review={sourcesReview} blocked={disabled} /> : <>
      {!visible.length ? <Text style={styles.meta}>{view === "pending" ? "No pending batches." : "No batch history yet."}</Text> : null}
      {visible.map(batch => <View key={batch.id} style={styles.batch}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${expanded === batch.id ? "Collapse" : "Expand"} batch ${dateLabel(batch.scheduled_date)}`}
          accessibilityState={{ expanded: expanded === batch.id, disabled: busy }} disabled={busy}
          aria-expanded={expanded === batch.id} aria-disabled={busy}
          onPress={() => setExpanded(value => value === batch.id ? null : batch.id)} style={styles.heading}>
          <View style={styles.copy}>
            <Text style={styles.label}>{dateLabel(batch.scheduled_date)}</Text>
            <Text style={styles.meta}>{statusLabel(batch.status)}</Text>
          </View>
          <Ionicons name={expanded === batch.id ? "chevron-up" : "chevron-down"} size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.meta}>{batch.recipe_count} recipes | {batch.workout_count} workouts</Text>
        <Text style={styles.meta}>{batch.pending_count} pending | {batch.approved_count} approved | {batch.dismissed_count} dismissed</Text>
        {(batch.report?.reasons ?? []).map((reason, index) => <Text key={index} style={styles.error}>{reportReason(reason)}</Text>)}
        {expanded === batch.id ? <BatchReview key={batch.id} owner={owner} id={batch.id} blocked={disabled} onBusyChange={setReviewBusy} /> : null}
      </View>)}
      </>}
    </View>
  </SettingsSection>;
}
