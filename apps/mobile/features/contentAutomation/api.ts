import { apiFetch } from "@/services/api";
import { Batch, ContentAutomation, SourceOverview } from "./types";

const ROOT = "/api/v1/content-automation";
export const automationKey = (owner: string | null) => ["content-automation", owner];
export const batchKey = (owner: string | null, id: string) => [...automationKey(owner), "batch", id];
export const sourcesKey = (owner: string | null) => [...automationKey(owner), "sources"];
export const getAutomation = (signal?: AbortSignal) => apiFetch<ContentAutomation>(ROOT, { signal });
export const getBatch = (id: string, signal?: AbortSignal) => apiFetch<Batch>(`${ROOT}/batches/${encodeURIComponent(id)}`, { signal });
export const setCampaignPaused = (paused: boolean) => apiFetch<ContentAutomation>(`${ROOT}/campaign`, { method: "PATCH", body: JSON.stringify({ paused }) });
export const decideCandidates = (id: string, action: "approve" | "dismiss", candidateIds: string[]) =>
  apiFetch<Batch>(`${ROOT}/batches/${encodeURIComponent(id)}/decisions`, { method: "POST", body: JSON.stringify({ action, candidate_ids: candidateIds }) });
export const getSources = (signal?: AbortSignal) => apiFetch<SourceOverview>(`${ROOT}/sources`, { signal });
export const dismissSources = (runId: string, sourceIds: string[]) =>
  apiFetch<SourceOverview>(`${ROOT}/sources/${encodeURIComponent(runId)}/dismiss`, { method: "POST", body: JSON.stringify({ source_ids: sourceIds }) });
