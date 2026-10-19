export type ApiErrorDetails = { message: string; code?: string; retryAfterSeconds?: number };

function validationMessage(issue: unknown): string {
  if (!issue || typeof issue !== "object") return "";
  const detail = issue as { loc?: unknown[]; msg?: unknown; type?: unknown };
  const field = Array.isArray(detail.loc) ? String(detail.loc[detail.loc.length - 1] ?? "") : "";
  const message = typeof detail.msg === "string" ? detail.msg : "";
  const type = typeof detail.type === "string" ? detail.type : "";
  if (field === "email") return "Enter a valid email address.";
  if (field === "password" && (type.includes("too_short") || message.includes("at least"))) return "Password must be at least 8 characters.";
  return message.replace(/^Value error,\s*/i, "");
}

export function apiErrorDetails(body: string, status: number, retryAfter?: string | null, now = Date.now()): ApiErrorDetails {
  const fallback = status === 429 ? "Too many requests. Please wait a moment and try again." : `Request failed with status ${status}.`;
  let message = fallback;
  let code: string | undefined;
  let bodyDelay: number | undefined;
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; message?: unknown };
    const detail = parsed.detail ?? parsed.message;
    if (typeof detail === "string" && detail.trim()) message = detail;
    else if (Array.isArray(detail)) {
      const messages = detail.map(validationMessage).filter(Boolean);
      if (messages.length) message = [...new Set(messages)].join(" ");
    } else if (detail && typeof detail === "object") {
      const value = detail as { message?: unknown; code?: unknown; retry_after_seconds?: unknown };
      if (typeof value.message === "string" && value.message.trim()) message = value.message;
      if (typeof value.code === "string" && /^[a-zA-Z0-9_:-]{1,80}$/.test(value.code)) code = value.code;
      if (typeof value.retry_after_seconds === "number" && Number.isFinite(value.retry_after_seconds) && value.retry_after_seconds >= 0) bodyDelay = value.retry_after_seconds;
    }
  } catch { /* Proxy HTML and raw provider response bodies are not user messages. */ }
  const retry = retryAfter?.trim();
  const headerDelay = retry ? /^\d+$/.test(retry) ? Number(retry) : Math.ceil((Date.parse(retry) - now) / 1000) : NaN;
  const seconds = Number.isFinite(headerDelay) && headerDelay >= 0 ? headerDelay : bodyDelay;
  const retryAfterSeconds = seconds == null ? undefined : Math.min(86400, Math.max(1, Math.ceil(seconds)));
  return { message, code, retryAfterSeconds };
}

export function lookupRetryDelay(reason: unknown): number {
  if (!reason || typeof reason !== "object") return 0;
  const value = reason as { status?: unknown; retryAfterSeconds?: unknown; code?: unknown };
  if (value.status !== 429 && !(value.status === 503 && ["paced", "busy", "rate_limited", "provider_paused"].includes(String(value.code)))) return 0;
  const seconds = typeof value.retryAfterSeconds === "number" && Number.isFinite(value.retryAfterSeconds) ? value.retryAfterSeconds : 3;
  return Math.min(86400, Math.max(1, seconds)) * 1000;
}
