import { apiErrorDetails, lookupRetryDelay } from "@/services/apiErrors";
import { formatPortions } from "@/features/premium/portions";

test("structured nutrition errors retain the explanation, code and retry delay", () => {
  expect(apiErrorDetails(JSON.stringify({ detail: { message: "Please wait before searching again.", code: "rate_limited" } }), 429, "30"))
    .toEqual({ message: "Please wait before searching again.", code: "rate_limited", retryAfterSeconds: 30 });
});

test("structured retry delays survive missing headers, while valid headers take priority", () => {
  const body = JSON.stringify({ detail: { message: "Please wait.", retry_after_seconds: 12.2 } });
  expect(apiErrorDetails(body, 429).retryAfterSeconds).toBe(13);
  expect(apiErrorDetails(body, 429, "invalid").retryAfterSeconds).toBe(13);
  expect(apiErrorDetails(body, 429, "30").retryAfterSeconds).toBe(30);
  expect(apiErrorDetails('{"detail":{"retry_after_seconds":"999999"}}', 429).retryAfterSeconds).toBeUndefined();
  expect(lookupRetryDelay({ status: 503, code: "rate_limited", retryAfterSeconds: 60 })).toBe(60000);
  expect(lookupRetryDelay({ status: 503, code: "busy", retryAfterSeconds: 3 })).toBe(3000);
  expect(lookupRetryDelay({ status: 503, code: "other" })).toBe(0);
});

test("proxy responses do not expose HTML or directory details", () => {
  expect(apiErrorDetails("<html>/srv/private/app.py traceback</html>", 502).message).toBe("Request failed with status 502.");
  expect(apiErrorDetails("", 429).message).toMatch(/wait a moment/i);
});

test("existing string and validation explanations are preserved", () => {
  expect(apiErrorDetails('{"detail":"Verify your email."}', 403).message).toBe("Verify your email.");
  expect(apiErrorDetails('{"detail":[{"loc":["body","email"],"msg":"bad"}]}', 422).message).toBe("Enter a valid email address.");
});

test("retry dates are supported and untrusted delay values are bounded", () => {
  expect(apiErrorDetails("", 429, "Mon, 19 Oct 2026 12:00:30 GMT", Date.UTC(2026, 9, 19, 12)).retryAfterSeconds).toBe(30);
  expect(apiErrorDetails("", 429, "9999999999999").retryAfterSeconds).toBe(86400);
  expect(apiErrorDetails("", 429, "invalid").retryAfterSeconds).toBeUndefined();
  expect(lookupRetryDelay({ status: 429, retryAfterSeconds: 12 })).toBe(12000);
  expect(lookupRetryDelay({ status: 429 })).toBe(3000);
  expect(lookupRetryDelay({ status: 503, code: "paced", retryAfterSeconds: 1 })).toBe(1000);
  expect(lookupRetryDelay(new Error("Other failure"))).toBe(0);
});

test("portion labels stay compact without losing tiny positive amounts", () => {
  expect(formatPortions(1.999999999998)).toBe("2");
  expect(formatPortions(1.2149795625)).toBe("1.215");
  expect(formatPortions(0.5669904625)).toBe("0.567");
  expect(Number(formatPortions(1e-11))).toBeGreaterThan(0);
});
