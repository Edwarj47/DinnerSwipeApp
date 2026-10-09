import decode from "@dinner-swipe/uri-decoder";

test("malformed encoded URI runs do not recurse or block navigation", () => {
  const started = Date.now();
  expect(decode("%FF".repeat(100000))).toHaveLength(300000);
  expect(decode("%C2".repeat(100000))).toHaveLength(100000);
  expect(Date.now() - started).toBeLessThan(2000);
});

test("normal query strings and mixed UTF-8 keep the existing contract", () => {
  expect(decode("Eggs+and+toast")).toBe("Eggs and toast");
  expect(decode("cr%C3%A8me%20br%C3%BBl%C3%A9e")).toBe("cr\u00e8me br\u00fbl\u00e9e");
  expect(decode("%FFok%C3%A5")).toBe("%FFok\u00e5");
});
