import * as Crypto from "expo-crypto";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppState, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { SearchField } from "@/components/SearchField";
import { Colors } from "@/components/theme";
import { apiFetch } from "@/services/api";
import { useOfflineStatus } from "@/services/offlineStore";
import { MacroChoice } from "./MacroChoice";
import { MacroCalculator } from "./MacroCalculator";
import { Calculation, CalculatorRow, objects, PROVIDER_VIEW_MS } from "./calculator";
import { MealDraft, ReviewedFood, reviewedRows, suggestedPortions } from "./mealAssistant";
import { NutritionAttribution } from "./NutritionAttribution";
import { useMealVoice } from "./useMealVoice";

export function MealAssistant({ voiceEnabled, onClose, onSaved }: {
  voiceEnabled: boolean; onClose: () => void; onSaved: (result: Calculation) => void;
}) {
  const client = useQueryClient();
  const offline = useOfflineStatus(state => state.offline);
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<MealDraft | null>(null);
  const [items, setItems] = useState<ReviewedFood[]>([]);
  const [rows, setRows] = useState<CalculatorRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
  const [resultsExpire, setResultsExpire] = useState(0);
  const request = useRef<{ description: string; id: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const voice = useMealVoice();
  const consent = useQuery({ queryKey: ["nutrition-consent"], queryFn: () =>
    apiFetch<{ accepted: boolean; terms_version: string; terms_url: string }>("/api/v1/nutrition/consent"), retry: false });
  const accept = useMutation({ mutationFn: () => apiFetch("/api/v1/nutrition/consent", {
    method: "POST", body: JSON.stringify({ terms_version: consent.data?.terms_version }) }),
    onSuccess: result => client.setQueryData(["nutrition-consent"], result), onError: reason => setError(message(reason)) });
  const accepted = consent.data?.accepted === true;
  useEffect(() => {
    alive.current = true;
    const background = () => {
      if (Platform.OS === "web" && !document.hidden) return;
      abort.current?.abort(); setBusy(false); setRows(null); setItems([]); setDraft(null); setResults(null);
    };
    const subscription = AppState.addEventListener("change", state => { if (state !== "active") background(); });
    if (Platform.OS === "web") document.addEventListener("visibilitychange", background);
    return () => {
      alive.current = false; abort.current?.abort(); subscription.remove();
      if (Platform.OS === "web") document.removeEventListener("visibilitychange", background);
      if (request.current) void apiFetch(`/api/v1/nutrition/ai/drafts/${request.current.id}`, { method: "DELETE" }).catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (resultsExpire && resultsExpire <= Date.now()) { setResults(null); setResultsExpire(0); }
      if (!items.some(item => item.expires <= Date.now() && (item.servings || item.food_name))) return;
      setItems(current => current.map(item => item.expires > Date.now() ? item : {
        key: item.key, name: item.name, search_term: item.search_term, quantity: item.quantity, unit: item.unit,
        food_id: item.food_id, serving_id: "", amount: "", expires: item.expires
      }));
      setDraft(current => current ? { ...current, items: [] } : null); setResults(null);
      setError("Database results expired. Start over to refresh them.");
    }, 30000);
    return () => clearInterval(timer);
  }, [items, resultsExpire]);
  function changeDescription(value: string) { setDescription(value); request.current = null; setError(""); }
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (busy || offline) return;
    abort.current = new AbortController(); const signal = abort.current.signal;
    setBusy(true); setError("");
    try { await action(signal); } catch (reason) { if (alive.current && !signal.aborted) setError(message(reason)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function describe(signal: AbortSignal) {
    const text = description.trim();
    if (!request.current || request.current.description !== text) request.current = { description: text, id: Crypto.randomUUID() };
    const result = await apiFetch<MealDraft>("/api/v1/nutrition/ai/drafts", {
      method: "POST", signal, body: JSON.stringify({ description: text, request_id: request.current.id }) });
    if (signal.aborted) return;
    if (result.status !== "ready") throw new Error("Your meal is still being prepared. Try again shortly.");
    setDraft({ ...result, items: [] }); setItems(result.items.map(item => ({ ...item, key: Crypto.randomUUID(),
      serving_id: "", amount: "", expires: Date.now() + PROVIDER_VIEW_MS })));
  }
  async function transcribe(signal: AbortSignal) {
    if (!voice.audio) return;
    const body = new FormData(); body.append("request_id", Crypto.randomUUID()); body.append("audio", voice.audio, "meal-recording");
    const result = await apiFetch<{ text: string }>("/api/v1/nutrition/ai/transcriptions", { method: "POST", signal, body });
    if (!signal.aborted) { changeDescription(result.text); voice.clear(); }
  }
  function updateItem(key: string, changes: Partial<ReviewedFood>) {
    setItems(current => current.map(item => item.key === key ? { ...item, ...changes } : item)); setError("");
  }
  async function search(signal: AbortSignal) {
    const result = await apiFetch<{ data: Record<string, unknown> }>(`/api/v1/nutrition/foods/search?query=${encodeURIComponent(query.trim())}`, { signal });
    if (!signal.aborted) { setResults(objects((result.data.foods as Record<string, unknown>)?.food)); setResultsExpire(Date.now() + PROVIDER_VIEW_MS); }
  }
  async function chooseFood(food: Record<string, unknown>, signal: AbortSignal) {
    const result = await apiFetch<{ data: Record<string, unknown> }>(`/api/v1/nutrition/foods/${food.food_id}`, { signal });
    if (signal.aborted || !searching) return;
    const detail = result.data.food as Record<string, unknown>;
    updateItem(searching, { food_id: String(food.food_id), food_name: String(detail.food_name),
      servings: objects((detail.servings as Record<string, unknown>)?.serving), serving_id: "", amount: "", expires: Date.now() + PROVIDER_VIEW_MS });
    setSearching(null); setResults(null); setQuery("");
  }
  function review() { try { setRows(reviewedRows(items)); setError(""); } catch (reason) { setError(message(reason)); } }
  if (rows && draft) return <MacroCalculator initialRows={rows} initialName={draft.name} initialMealLabel={draft.meal_label}
    onClose={onClose} onSaved={onSaved} />;
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.backdrop}>
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.header}><Text style={styles.title}>{draft ? "Review meal" : "Describe a meal"}</Text>
          <Button label="" icon="close" accessibilityLabel="Close meal assistant" variant="quiet" onPress={onClose} /></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {consent.isLoading ? <Text style={styles.meta}>Checking database access...</Text> : !accepted ? <View style={styles.section}>
            {consent.error ? <><Text accessibilityRole="alert" style={styles.error}>Couldn't check database terms.</Text>
              <Button label="Retry" icon="refresh-outline" onPress={() => { void consent.refetch(); }} /></> : null}
            <Text style={styles.meta}>Database results are provided by FatSecret.</Text>
            <Button label="Terms of Use" icon="open-outline" onPress={() => { void Linking.openURL(consent.data?.terms_url ?? "https://platform.fatsecret.com/terms"); }} />
            <Button label="Accept and continue" icon="checkmark" variant="primary" disabled={!consent.data || accept.isPending || offline} onPress={() => accept.mutate()} />
          </View> : !draft ? <>
            <Text style={styles.label}>What did you eat?</Text>
            <TextInput style={[styles.input, styles.description]} multiline maxLength={4000} accessibilityLabel="Meal description"
              placeholder="2 eggs and 150 g cooked rice" value={description} onChangeText={changeDescription} editable={!busy} />
            {voiceEnabled && voice.supported ? <View style={styles.section}>
              <Button label={voice.recording ? "Stop recording" : "Record meal"} icon={voice.recording ? "stop-circle-outline" : "mic-outline"}
                disabled={busy || offline} onPress={() => { if (voice.recording) voice.stop(); else void voice.start(); }} />
              <Text style={styles.meta}>Audio is sent to OpenAI for transcription. Up to 60 seconds.</Text>
              {voice.audio ? <View style={styles.row}><View style={styles.equal}><Button label="Transcribe" icon="text-outline" disabled={busy || offline} onPress={() => { void run(transcribe); }} /></View>
                <View style={styles.equal}><Button label="Discard recording" icon="trash-outline" disabled={busy} onPress={voice.clear} /></View></View> : null}
            </View> : null}
            <Text style={styles.meta}>Your description is sent to OpenAI; food searches are sent to FatSecret.</Text>
            <Button label={busy ? "Preparing..." : "Preview meal"} icon="sparkles-outline" variant="primary"
              disabled={busy || offline || voice.recording || description.trim().length < 3} onPress={() => { void run(describe); }} />
          </> : <>
            {items.map(item => <View key={item.key} style={styles.item}>
              <View style={styles.row}><Text style={[styles.label, styles.equal]}>{item.name}</Text>
                <Button label="" icon="trash-outline" accessibilityLabel={`Remove ${item.name}`} variant="quiet" disabled={busy} onPress={() => setItems(current => current.filter(row => row.key !== item.key))} /></View>
              {item.quantity != null ? <Text style={styles.meta}>Reported: {item.quantity} {item.unit}</Text> : <Text style={styles.meta}>Amount needed</Text>}
              <Text style={styles.meta}>{item.food_name ?? "Choose a database match"}</Text>
              <Button label="Change match" icon="search-outline" disabled={busy || offline} onPress={() => { setSearching(item.key); setQuery(item.search_term); setResults(null); }} />
              <MacroChoice label={`Serving size for ${item.name}`} value={item.serving_id} disabled={busy || !item.servings?.length}
                options={[{ value: "", label: "Choose serving size" }, ...(item.servings ?? []).map(serving => ({ value: String(serving.serving_id), label: String(serving.serving_description ?? "Serving") }))]}
                onChange={id => {
                  const serving = item.servings?.find(value => String(value.serving_id) === id);
                  const amount = serving ? suggestedPortions(item, serving) : null;
                  updateItem(item.key, { serving_id: id, amount: amount != null ? String(Math.round(amount * 10000) / 10000) : "" });
                }} />
              <Text style={styles.label}>Servings eaten</Text>
              <TextInput style={styles.input} keyboardType="decimal-pad" accessibilityLabel={`Servings eaten for ${item.name}`} value={item.amount}
                placeholder="Enter amount" editable={!busy} onChangeText={value => updateItem(item.key, { amount: value })} />
            </View>)}
            {searching ? <View style={styles.section}>
              <View style={styles.row}><Text style={[styles.label, styles.equal]}>Choose a food</Text><Button label="" icon="close" accessibilityLabel="Close food search" variant="quiet" onPress={() => setSearching(null)} /></View>
              <SearchField accessibilityLabel="Food search" placeholder="Search database" value={query} onChangeText={value => { setQuery(value); setResults(null); }} />
              <Button label="Search Database" icon="search-outline" disabled={busy || offline || query.trim().length < 2} onPress={() => { void run(search); }} />
              {results?.map(food => <Button key={String(food.food_id)} label={String(food.food_name)} disabled={busy} onPress={() => { void run(signal => chooseFood(food, signal)); }} />)}
              {results?.length === 0 ? <Text style={styles.meta}>No matching foods.</Text> : null}
            </View> : null}
            <Button label="Continue to calculator" icon="calculator-outline" variant="primary" disabled={busy || offline || !items.length || !!searching} onPress={review} />
            <Button label="Start over" icon="refresh-outline" disabled={busy} onPress={() => { setDraft(null); setItems([]); setSearching(null); setResults(null); request.current = null; }} />
            <NutritionAttribution />
          </>}
          {busy ? <Text accessibilityLiveRegion="polite" style={styles.meta}>Working...</Text> : null}
          {error || voice.error ? <Text accessibilityRole="alert" style={styles.error}>{error || voice.error}</Text> : null}
          {error && !draft && accepted ? <Button label="Try again" icon="refresh-outline" disabled={busy || offline || description.trim().length < 3}
            onPress={() => { request.current = null; void run(describe); }} /> : null}
          {offline ? <Text style={styles.error}>Connect to use the meal assistant.</Text> : null}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
function message(reason: unknown) { return reason instanceof Error ? reason.message : "Unable to prepare meal."; }
const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", alignItems: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { width: "100%", maxWidth: 560, maxHeight: "92%", backgroundColor: Colors.surface, borderRadius: 8, padding: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }, title: { flex: 1, minWidth: 0, color: Colors.ink, fontSize: 22, fontWeight: "800" },
  content: { gap: 12, paddingBottom: 12 }, label: { color: Colors.ink, fontSize: 15, fontWeight: "700" },
  input: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, padding: 12, color: Colors.ink, backgroundColor: Colors.surface },
  description: { minHeight: 100, textAlignVertical: "top" }, meta: { color: Colors.muted, fontSize: 13, lineHeight: 19 },
  error: { color: Colors.danger, fontSize: 14, lineHeight: 20 }, item: { borderBottomWidth: 1, borderColor: Colors.border, paddingVertical: 12, gap: 8 },
  section: { gap: 10, paddingVertical: 8 }, row: { flexDirection: "row", alignItems: "center", gap: 8 }, equal: { flex: 1, minWidth: 0 }
});
