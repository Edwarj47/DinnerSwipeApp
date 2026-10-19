import * as Crypto from "expo-crypto";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppState, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { SearchField } from "@/components/SearchField";
import { Colors } from "@/components/theme";
import { ApiError, apiFetch } from "@/services/api";
import { useOfflineStatus } from "@/services/offlineStore";
import { MacroChoice } from "./MacroChoice";
import { MacroCalculator } from "./MacroCalculator";
import { Calculation, CalculatorRow, objects, PROVIDER_VIEW_MS } from "./calculator";
import { MealDraft, ReviewedFood, portionInput, prefillServing, reviewedRows, suggestedPortions } from "./mealAssistant";
import { NutritionAttribution } from "./NutritionAttribution";
import { NutritionConsent, NutritionConsentStatus } from "./NutritionConsent";
import { useMealVoice } from "./useMealVoice";
import { useLookupCooldown } from "./useLookupCooldown";

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
  const [transcribing, setTranscribing] = useState(false);
  const [voiceFailure, setVoiceFailure] = useState(false);
  const [error, setError] = useState("");
  const cooldown = useLookupCooldown();
  const [searching, setSearching] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
  const [resultsExpire, setResultsExpire] = useState(0);
  const request = useRef<{ description: string; id: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const autoAttempted = useRef(new WeakSet<Blob>());
  const transcription = useRef<{ audio: Blob; id: string } | null>(null);
  const voice = useMealVoice();
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const autoTranscribe = useRef<() => void>(() => undefined);
  autoTranscribe.current = () => { if (voice.audio) void run(signal => transcribe(voice.audio!, signal)); };
  const consent = useQuery({ queryKey: ["nutrition-consent"], queryFn: () =>
    apiFetch<NutritionConsentStatus>("/api/v1/nutrition/consent"), retry: false });
  const accept = useMutation({ mutationFn: () => apiFetch("/api/v1/nutrition/consent", {
    method: "POST", body: JSON.stringify({ terms_version: consent.data?.terms_version }) }),
    onSuccess: result => {
      client.setQueryData(["nutrition-consent"], result);
      void client.invalidateQueries({ predicate: item => String(item.queryKey[0]).startsWith("macro-") });
    }, onError: reason => setError(message(reason)) });
  const accepted = consent.data?.accepted === true;
  useEffect(() => {
    alive.current = true;
    const background = () => {
      if (Platform.OS === "web" && !document.hidden) return;
      abort.current?.abort(); inFlight.current = false; transcription.current = null; voiceRef.current.clear();
      setBusy(false); setTranscribing(false); setVoiceFailure(false); setRows(null); setItems([]); setDraft(null);
      setSearching(null); setQuery(""); setResults(null); setResultsExpire(0); setError("");
    };
    const subscription = AppState.addEventListener("change", state => { if (state !== "active") background(); });
    if (Platform.OS === "web") document.addEventListener("visibilitychange", background);
    return () => {
      alive.current = false; abort.current?.abort(); transcription.current = null; voiceRef.current.clear(); subscription.remove();
      if (Platform.OS === "web") document.removeEventListener("visibilitychange", background);
      if (request.current) void apiFetch(`/api/v1/nutrition/ai/drafts/${request.current.id}`, { method: "DELETE" }).catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (!accepted || !voiceEnabled || !voice.supported || !voice.audio || voice.recording || draft || busy || offline || inFlight.current) return;
    if (autoAttempted.current.has(voice.audio)) return;
    autoAttempted.current.add(voice.audio);
    autoTranscribe.current();
  }, [accepted, voiceEnabled, voice.supported, voice.audio, voice.recording, draft, busy, offline]);
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
    if (inFlight.current || offline || cooldown.waiting) return;
    inFlight.current = true;
    const controller = new AbortController(); abort.current = controller; const signal = controller.signal;
    setBusy(true); setError("");
    try { await action(signal); } catch (reason) { if (alive.current && !signal.aborted) { cooldown.recordFailure(reason); setError(message(reason)); } }
    finally { if (alive.current && abort.current === controller) { inFlight.current = false; setBusy(false); setTranscribing(false); } }
  }
  async function describe(signal: AbortSignal) {
    const text = description.trim();
    if (!request.current || request.current.description !== text) request.current = { description: text, id: Crypto.randomUUID() };
    const result = await apiFetch<MealDraft>("/api/v1/nutrition/ai/drafts", {
      method: "POST", signal, body: JSON.stringify({ description: text, request_id: request.current.id }) });
    if (signal.aborted) return;
    if (result.status !== "ready") throw new Error("Your meal is still being prepared. Try again shortly.");
    setDraft({ ...result, items: [] }); setItems(result.items.map(item => ({ ...item, key: Crypto.randomUUID(),
      ...prefillServing(item), recommended_food_id: item.food_id, expires: Date.now() + PROVIDER_VIEW_MS })));
  }
  async function transcribe(audio: Blob, signal: AbortSignal) {
    setTranscribing(true); setVoiceFailure(false);
    if (transcription.current?.audio !== audio) transcription.current = { audio, id: Crypto.randomUUID() };
    const body = new FormData(); body.append("request_id", transcription.current.id); body.append("audio", audio, "meal-recording");
    try {
      const result = await apiFetch<{ text: string }>("/api/v1/nutrition/ai/transcriptions", { method: "POST", signal, body });
      if (signal.aborted || !alive.current) return;
      const text = [description.trim(), result.text.trim()].filter(Boolean).join(" ");
      if (text.length > 4000) throw new Error("Shorten the meal description before retrying transcription.");
      changeDescription(text); transcription.current = null; voiceRef.current.clear();
    } catch (reason) {
      if (!signal.aborted && alive.current) setVoiceFailure(true);
      if (reason instanceof ApiError && [410, 422, 503].includes(reason.status)) transcription.current = null;
      throw reason;
    }
  }
  function discardRecording() {
    if (transcribing) { abort.current?.abort(); inFlight.current = false; setBusy(false); setTranscribing(false); }
    transcription.current = null; voice.clear(); setVoiceFailure(false); setError("");
  }
  function updateItem(key: string, changes: Partial<ReviewedFood>) {
    const next = "amount" in changes ? { precise_amount: undefined, ...changes } : changes;
    setItems(current => current.map(item => item.key === key ? { ...item, ...next } : item)); setError("");
  }
  function closeSearch() {
    abort.current?.abort(); abort.current = null; inFlight.current = false;
    setBusy(false); setSearching(null); setResults(null); setResultsExpire(0); setQuery(""); setError("");
  }
  async function search(signal: AbortSignal) {
    const result = await apiFetch<{ data: Record<string, unknown> }>(`/api/v1/nutrition/foods/search?query=${encodeURIComponent(query.trim())}`, { signal });
    if (!signal.aborted) { setResults(objects((result.data.foods as Record<string, unknown>)?.food)); setResultsExpire(Date.now() + PROVIDER_VIEW_MS); }
  }
  async function chooseFood(food: Record<string, unknown>, signal: AbortSignal) {
    const result = await apiFetch<{ data: Record<string, unknown> }>(`/api/v1/nutrition/foods/${food.food_id}`, { signal });
    if (signal.aborted || !searching) return;
    const detail = result.data.food as Record<string, unknown>;
    const item = items.find(value => value.key === searching);
    if (!item) return;
    const changes = { food_id: String(food.food_id), food_name: String(detail.food_name),
      servings: objects((detail.servings as Record<string, unknown>)?.serving) };
    updateItem(searching, { ...changes, ...prefillServing({ ...item, ...changes }), expires: Date.now() + PROVIDER_VIEW_MS });
    setSearching(null); setResults(null); setResultsExpire(0); setQuery("");
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
          {!accepted ? <NutritionConsent data={consent.data} loading={consent.isLoading} failed={consent.isError} pending={accept.isPending}
            offline={offline} onAccept={() => accept.mutate()} onRetry={() => { void consent.refetch(); }} onClose={onClose} /> : !draft ? <>
            <Text style={styles.label}>What did you eat?</Text>
            <TextInput style={[styles.input, styles.description]} multiline maxLength={4000} accessibilityLabel="Meal description"
              value={description} onChangeText={changeDescription} editable={!busy && !voice.recording} />
            {voiceEnabled && voice.supported ? <View style={styles.section}>
              <Button label={voice.recording ? "Stop recording" : "Record meal"} icon={voice.recording ? "stop-circle-outline" : "mic-outline"}
                disabled={busy || offline} onPress={() => { if (voice.recording) voice.stop(); else { transcription.current = null; setVoiceFailure(false); setError(""); void voice.start(); } }} />
              {voice.audio ? <View style={styles.row}>
                {voiceFailure && !busy ? <View style={styles.equal}><Button label="Retry transcription" icon="refresh-outline" disabled={offline}
                  onPress={() => { void run(signal => transcribe(voice.audio!, signal)); }} /></View> : null}
                <View style={styles.equal}><Button label={transcribing ? "Cancel transcription" : "Discard recording"} icon="trash-outline"
                  disabled={busy && !transcribing} onPress={discardRecording} /></View></View> : null}
            </View> : null}
            <Button label={busy && !transcribing ? "Preparing..." : "Preview meal"} icon="sparkles-outline" variant="primary"
              disabled={busy || offline || cooldown.waiting || voice.recording || !!voice.audio || description.trim().length < 3} onPress={() => { void run(describe); }} />
          </> : <>
            {items.map(item => <View key={item.key} testID="meal-review-item" style={styles.item}>
              <View style={styles.row}><Text style={[styles.label, styles.equal]}>{item.name}</Text>
                <Button label="" icon="trash-outline" accessibilityLabel={`Remove ${item.name}`} variant="quiet" disabled={busy} onPress={() => {
                  if (searching === item.key) closeSearch();
                  setItems(current => current.filter(row => row.key !== item.key));
                }} /></View>
              {item.quantity != null ? <Text style={styles.meta}>Reported: {item.quantity} {item.unit}</Text> : <Text style={styles.meta}>Amount needed</Text>}
              <Text style={styles.meta}>{item.food_name ? `${item.food_name}${item.food_id === item.recommended_food_id ? " (Recommended)" : ""}` : "Choose a database match"}</Text>
              {searching === item.key ? <View style={styles.section}>
                <View style={styles.row}><Text style={[styles.label, styles.equal]}>Choose a food</Text>
                  <Button label="" icon="close" accessibilityLabel="Close food search" variant="quiet" onPress={closeSearch} /></View>
                <SearchField accessibilityLabel="Food search" placeholder="Search database" value={query} editable={!busy && !offline}
                  returnKeyType="search" onSubmitEditing={() => { if (query.trim().length >= 2) void run(search); }}
                  onChangeText={value => { setQuery(value); setResults(null); setResultsExpire(0); setError(""); }} />
                <Button label={cooldown.waiting ? "Please wait" : "Search Database"} icon="search-outline" disabled={busy || offline || cooldown.waiting || query.trim().length < 2} onPress={() => { void run(search); }} />
                {results?.map(food => <Button key={String(food.food_id)}
                  label={`${String(food.food_name)}${String(food.food_id) === item.recommended_food_id ? " (Recommended)" : ""}`}
                  disabled={busy || offline || cooldown.waiting} onPress={() => { void run(signal => chooseFood(food, signal)); }} />)}
                {results?.length === 0 ? <Text style={styles.meta}>No matching foods.</Text> : null}
                {busy ? <Text accessibilityLiveRegion="polite" style={styles.meta}>Working...</Text> : null}
                {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              </View> : <>
              <Button label="Change match" icon="search-outline" disabled={busy || offline} onPress={() => { setSearching(item.key); setQuery(item.search_term); setResults(null); setResultsExpire(0); setError(""); }} />
              <MacroChoice label={`Serving size for ${item.name}`} value={item.serving_id} disabled={busy || !item.servings?.length}
                options={[{ value: "", label: "Choose serving size" }, ...(item.servings ?? []).map(serving => ({ value: String(serving.serving_id),
                  label: `${String(serving.serving_description ?? "Serving")}${String(serving.serving_id) === item.recommended_serving_id ? " (Recommended)" : ""}` }))]}
                onChange={id => {
                  const serving = item.servings?.find(value => String(value.serving_id) === id);
                  const amount = serving ? suggestedPortions(item, serving) : null;
                  updateItem(item.key, { serving_id: id, ...portionInput(amount) });
                }} />
              <Text style={styles.label}>Servings eaten</Text>
              <TextInput style={styles.input} keyboardType="decimal-pad" accessibilityLabel={`Servings eaten for ${item.name}`} value={item.amount}
                placeholder="Enter amount" editable={!busy} onChangeText={value => updateItem(item.key, { amount: value })} />
              </>}
            </View>)}
            <Button label="Continue to calculator" icon="calculator-outline" variant="primary" disabled={busy || offline || !items.length || !!searching} onPress={review} />
            <Button label="Start over" icon="refresh-outline" disabled={busy} onPress={() => { setDraft(null); setItems([]); setSearching(null); setResults(null); request.current = null; }} />
            <NutritionAttribution />
          </>}
          {busy && !searching ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{transcribing ? "Transcribing..." : "Working..."}</Text> : null}
          {(!searching && error) || voice.error ? <Text accessibilityRole="alert" style={styles.error}>{(!searching && error) || voice.error}</Text> : null}
          {error && !draft && accepted && !voice.audio ? <Button label="Try again" icon="refresh-outline" disabled={busy || offline || cooldown.waiting || description.trim().length < 3}
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
