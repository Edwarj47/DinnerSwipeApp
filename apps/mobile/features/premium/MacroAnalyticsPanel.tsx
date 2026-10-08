import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { useMeasurementUnits } from "@/services/measurementPreferences";
import { saveProfilePreferences } from "@/services/profilePreferences";
import { MacroAnalytics, UserProfile } from "@/services/types";
import { convertWeight, formatWeight } from "@/services/weightUnits";
import { analyticsDays, TrendBucket, trendBuckets } from "./analytics";
import { todayISO } from "./macroDates";
import { NutritionAttribution } from "./NutritionAttribution";
import { SummaryPeriod } from "./SummaryPeriod";

export function MacroAnalyticsPanel() {
  const client = useQueryClient();
  const units = useMeasurementUnits();
  const [selection, setSelection] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState(284);
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => apiFetch<UserProfile>("/api/v1/profile") });
  const days = selection ?? analyticsDays(profile.data?.notification_preferences?.macro_analytics_days);
  const end = todayISO();
  const analytics = useQuery({ queryKey: ["macro-analytics", "dashboard", days, end],
    queryFn: () => apiFetch<MacroAnalytics>(`/api/v1/macros/analytics?days=${days}&end_date=${end}`), enabled: !profile.isLoading });
  const save = useMutation({ mutationFn: (next: number) => saveProfilePreferences({ notification_preferences: { macro_analytics_days: next } }),
    onSuccess: data => client.setQueryData(["profile"], data), onError: () => setSelection(null) });
  const data = analytics.data;
  const series = trendBuckets(data?.daily_totals ?? [], Math.max(1, Math.min(21, Math.floor((chartWidth + 3) / 47))));
  const average = data?.averages;
  return <View style={styles.panel} onLayout={event => setChartWidth(event.nativeEvent.layout.width)}>
    <SummaryPeriod days={days} maxDays={366} disabled={save.isPending || profile.isLoading || profile.isError}
      onChange={next => { setSelection(next); save.mutate(next); }} />
    {data ? <Text style={styles.meta}>{data.start_date} to {data.end_date}</Text> : null}
    {save.isError ? <Text accessibilityRole="alert" style={styles.error}>Couldn't save the analytics period. Try again.</Text> : null}
    {profile.isError ? <Button label="Retry preferences" icon="refresh" onPress={() => { void profile.refetch(); }} /> : null}
    {analytics.isLoading ? <Text style={styles.meta}>Loading analytics...</Text> : analytics.isError ? <>
      <Text accessibilityRole="alert" style={styles.error}>Couldn't load your analytics.</Text><Button label="Retry analytics" icon="refresh" onPress={() => { void analytics.refetch(); }} />
    </> : data ? <>
      {data.nutrition_unavailable_count ? <Text accessibilityRole="alert" style={styles.error}>Some database nutrition is pending. Totals are incomplete.</Text> : null}
      <View style={styles.metrics}>
        <Metric label="Consumed" value={String(data.eaten_meals)} />
        <Metric label="Days logged" value={String(data.days_logged)} />
        <Metric label="Calories / logged day" value={String(average?.calories ?? 0)} />
      </View>
      {!data.days_logged ? <View style={styles.empty}><Text style={styles.heading}>No entries in this period</Text><Text style={styles.meta}>Your logged meals will appear here.</Text></View> : <>
        <TrendChart title="Calories" buckets={series} field="calories" color={Colors.tomato} unit="cal" />
        <TrendChart title="Protein" buckets={series.map(bucket => ({ ...bucket, protein_g: bucket.protein_g === null ? null : convertWeight(bucket.protein_g, "g", units.protein_g)! }))}
          field="protein_g" color={Colors.basil} unit={units.protein_g} />
        <View style={styles.section}><Text style={styles.heading}>Daily averages</Text><Text style={styles.meta}>Per logged day</Text>
          {(["calories", "protein_g", "carbs_g", "fat_g"] as const).map((field, index) => {
            const target = data.targets?.[(["daily_calories", "daily_protein_g", "daily_carbs_g", "daily_fat_g"] as const)[index]];
            const value = data.averages[field];
            const label = ["Calories", "Protein", "Carbs", "Fat"][index];
            const text = field === "calories" ? String(value) : `${formatWeight(convertWeight(value, "g", units[field])!, units[field])} ${units[field]}`;
            const targetText = field === "calories" ? target : target == null ? null : `${formatWeight(convertWeight(target, "g", units[field])!, units[field])} ${units[field]}`;
            return <View key={field} style={styles.average}><View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.number}>{text}</Text></View>
              {target != null && target > 0 ? <><View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, value / target * 100)}%`, backgroundColor: index === 0 ? Colors.tomato : Colors.basil }]} /></View>
                <Text style={styles.meta}>Daily target: {targetText}</Text></> : <Text style={styles.meta}>No target set</Text>}
            </View>;
          })}
        </View>
      </>}
      {data.temporary_nutrition ? <NutritionAttribution /> : null}
    </> : null}
  </View>;
}

function TrendChart({ title, buckets, field, color, unit }: {
  title: string; buckets: TrendBucket[]; field: "calories" | "protein_g"; color: string; unit: string;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const first = buckets[0]?.start, last = buckets[buckets.length - 1]?.end;
  useEffect(() => setPicked(null), [buckets.length, first, last]);
  const selected = picked === null ? null : buckets[picked];
  const maximum = Math.max(1, ...buckets.map(bucket => bucket[field] ?? 0));
  const grouped = buckets.some(bucket => bucket.days > 1);
  const format = (value: number | null) => value === null ? "Pending" : `${Math.round(value * 100) / 100} ${unit}`;
  return <View style={styles.section}>
    <View style={styles.row}><Text style={styles.heading}>{title}</Text><Text style={styles.meta}>{grouped ? "Daily averages by period" : "Daily totals"}</Text></View>
    <View style={styles.chart} testID={`analytics-chart-${field}`}>
      {buckets.map((bucket, index) => <Pressable key={bucket.start} accessibilityRole="button" accessibilityLabel={`${title}, ${bucket.start}${bucket.end !== bucket.start ? ` to ${bucket.end}` : ""}: ${format(bucket[field])}`}
        accessibilityState={{ selected: index === picked }} style={styles.column} onPress={() => setPicked(index)}>
        <View style={[styles.bar, { height: bucket[field] === null ? 2 : Math.max(2, (bucket[field] ?? 0) / maximum * 132), backgroundColor: color, opacity: picked === null || picked === index ? 1 : 0.4 }]} />
      </Pressable>)}
    </View>
    <View style={styles.row}><Text style={styles.meta}>{shortDate(buckets[0]?.start)}</Text><Text style={styles.meta}>{shortDate(buckets[buckets.length - 1]?.end)}</Text></View>
    <Text accessibilityLiveRegion="polite" style={styles.chartCaption}>{selected ? `${shortDate(selected.start)}${selected.end !== selected.start ? ` - ${shortDate(selected.end)}` : ""}: ${format(selected[field])}${selected.days > 1 ? " / day" : ""}` : `${title} over time`}</Text>
  </View>;
}
function shortDate(value?: string) { return value ? `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}` : ""; }
function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.meta}>{label}</Text></View>;
}
const styles = StyleSheet.create({
  panel: { gap: 12 }, meta: { color: Colors.muted, fontSize: 13, lineHeight: 19 }, error: { color: Colors.danger },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, metric: { flexGrow: 1, flexBasis: 90, minWidth: 0, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: 10, gap: 4 },
  metricValue: { fontSize: 20, fontWeight: "800", color: Colors.ink }, heading: { fontSize: 18, fontWeight: "800", color: Colors.ink, flexShrink: 1 },
  section: { borderTopWidth: 1, borderColor: Colors.border, paddingTop: 16, gap: 8 }, empty: { paddingVertical: 24, gap: 6 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  chart: { height: 148, flexDirection: "row", alignItems: "flex-end", gap: 3, borderBottomWidth: 1, borderColor: Colors.border },
  column: { flex: 1, minWidth: 0, height: "100%", justifyContent: "flex-end", paddingTop: 4 },
  bar: { width: "100%", borderTopLeftRadius: 3, borderTopRightRadius: 3 }, chartCaption: { minHeight: 20, color: Colors.ink, fontWeight: "600", fontSize: 13 },
  average: { gap: 6, paddingVertical: 8 }, label: { color: Colors.ink, fontWeight: "700" }, number: { color: Colors.ink, fontWeight: "700" },
  track: { height: 6, borderRadius: 3, backgroundColor: Colors.border, overflow: "hidden" }, fill: { height: "100%" }
});
