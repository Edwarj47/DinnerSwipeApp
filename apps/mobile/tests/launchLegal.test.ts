import { privacySections, termsSections } from "@/features/legal/legalContent";

test("published deletion text describes fulfillment without promising backup expiry", () => {
  const text = privacySections.find(section => section.title === "Account Data And Deletion")?.body ?? "";
  expect(text).toContain("original recipes and workouts you shared");
  expect(text).toContain("independently owned copies and personal logs remain");
  expect(text).toContain("a pending receipt is not confirmation");
  expect(text).toContain("no automatic backup-expiry period is currently promised");
  expect(text).not.toContain("Requests currently require manual review");
});

test("subscription terms keep free Basic and no-card welcome distinct from paid renewal", () => {
  const text = termsSections.find(section => section.title === "Subscriptions")?.body ?? "";
  expect(text).toContain("Basic is free");
  expect(text).toContain("expires without an automatic charge");
  expect(text).toContain("USD 9.99 per month");
  expect(text).toContain("actual localized price");
  expect(text).toContain("mandatory consumer rights are not excluded");
});
