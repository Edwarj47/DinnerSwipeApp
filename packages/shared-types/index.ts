export type SourceType =
  | "manual"
  | "csv"
  | "xlsx"
  | "url_structured_data"
  | "url_html"
  | "onenote"
  | "ai_generated"
  | "migrated";

export type JobState = "queued" | "running" | "succeeded" | "partially_succeeded" | "failed" | "cancelled";

