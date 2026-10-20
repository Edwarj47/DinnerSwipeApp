import { useRef, useState } from "react";
import { ActivityIndicator, Linking, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { deviceOffline, offlineOwner, useOfflineStatus } from "@/services/offlineStore";
import { dateLabel, DiscoveredSource, reportReason, sourceLink, statusLabel } from "./types";
import { styles } from "./styles";
import { useSourcesReview } from "./useSourcesReview";

const PAGE_SIZE = 10;

export function SourcesReview({ owner, review, blocked }: { owner: string; review: ReturnType<typeof useSourcesReview>; blocked: boolean }) {
  const offline = useOfflineStatus(state => state.offline);
  const [page, setPage] = useState(0);
  const { data, query, decision, dismiss, message } = review;
  const runs = [...(data?.runs ?? [])].sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date) || a.id.localeCompare(b.id));
  const all = runs.flatMap(run => run.sources);
  const pendingCount = all.filter(source => source.status === "pending").length;
  // Empty runs still carry discovery progress and shortfall reasons.
  const entries = runs.flatMap(run => {
    const pending = run.sources.filter(source => source.status === "pending");
    return (pending.length ? pending : [null]).map(source => ({ run, source }));
  });
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = entries.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const disabled = blocked || offline || query.isFetching || query.isError || decision.isPending;
  return <View style={styles.content}>
    <View style={styles.row}>
      <Text accessibilityRole="header" style={[styles.label, styles.copy]}>Needs source checks</Text>
      <ActivityIndicator animating={query.isFetching} hidesWhenStopped accessibilityLabel={query.isFetching ? "Loading discovered sources" : undefined} color={Colors.tomato} style={styles.loading} />
      <Button label="" icon="refresh" accessibilityLabel="Refresh discovered sources" disabled={blocked || offline || query.isFetching || decision.isPending} onPress={() => { void query.refetch(); }} />
    </View>
    {data ? <Text style={styles.meta}>{pendingCount} pending sources | {all.filter(source => source.status === "dismissed").length} dismissed</Text> : null}
    {offline ? <Text accessibilityRole="alert" style={styles.error}>Reconnect to check or dismiss sources.</Text> : null}
    {query.isError ? <Text accessibilityRole="alert" style={styles.error}>Couldn't load discovered sources. Refresh and try again.</Text> : null}
    {data && !runs.length ? <Text style={styles.meta}>No discovered sources yet.</Text> : null}
    {[...new Set(visible.map(entry => entry.run))].map(run => <View key={run.id} style={styles.batch}>
      <Text style={styles.label}>{dateLabel(run.scheduled_date)} - {statusLabel(run.status)}</Text>
      {run.reasons.map((reason, index) => <Text key={index} style={styles.meta}>{reportReason(reason)}</Text>)}
      {visible.filter(entry => entry.run.id === run.id).map(({ source }) => source ? <SourceRow key={source.id} owner={owner} source={source} disabled={disabled} onDismiss={() => dismiss(run.id, source.id)} />
        : <Text key="empty" style={styles.meta}>{run.status === "running" ? "Discovery in progress..." : "No pending sources."}</Text>)}
    </View>)}
    {pages > 1 ? <View style={styles.row}>
      <Button label="" icon="chevron-back" accessibilityLabel="Previous sources page" disabled={decision.isPending || currentPage === 0} onPress={() => setPage(currentPage - 1)} />
      <Text accessibilityLiveRegion="polite" style={[styles.meta, styles.copy]}>Page {currentPage + 1} of {pages}</Text>
      <Button label="" icon="chevron-forward" accessibilityLabel="Next sources page" disabled={decision.isPending || currentPage === pages - 1} onPress={() => setPage(currentPage + 1)} />
    </View> : null}
    {decision.isPending ? <Text accessibilityLiveRegion="polite" style={styles.meta}>Dismissing source...</Text> : null}
    {decision.isError ? <Text accessibilityRole="alert" style={styles.error}>Couldn't confirm dismissal. Check the refreshed sources and try again.</Text> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.success}>{message}</Text> : null}
  </View>;
}

function SourceRow({ owner, source, disabled, onDismiss }: { owner: string; source: DiscoveredSource; disabled: boolean; onDismiss: () => void }) {
  const [opening, setOpening] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const linkLock = useRef(false);
  const link = sourceLink(source.source_url);
  async function openSource() {
    if (disabled || !link || linkLock.current || offlineOwner() !== owner || deviceOffline()) return;
    linkLock.current = true;
    setOpening(true);
    setLinkError(false);
    try { await Linking.openURL(link); }
    catch { if (offlineOwner() === owner) setLinkError(true); }
    finally { linkLock.current = false; setOpening(false); }
  }
  return <View style={styles.divider}>
    <View style={styles.row}>
      <View style={styles.copy}>
        <Text style={styles.label}>{source.title}</Text>
        <Text style={styles.meta}>{source.kind === "recipe" ? "Recipe" : "Workout"} | {source.source_name || "Unknown publisher"}</Text>
      </View>
      <Button label="" icon="open-outline" accessibilityLabel={`Open source ${source.title}`} disabled={disabled || !link || opening} onPress={() => { void openSource(); }} />
      <Button label="" icon="close-outline" variant="quiet-danger" accessibilityLabel={`Dismiss source ${source.title}`} disabled={disabled || !/^[a-f0-9]{64}$/i.test(source.id)} onPress={onDismiss} />
    </View>
    {opening ? <Text accessibilityLiveRegion="polite" style={styles.meta}>Opening source...</Text> : null}
    {!link ? <Text style={styles.meta}>Source link unavailable.</Text> : null}
    {linkError ? <Text accessibilityRole="alert" style={styles.error}>Couldn't open the source.</Text> : null}
  </View>;
}
