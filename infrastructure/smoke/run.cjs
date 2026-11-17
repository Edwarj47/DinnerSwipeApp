const assert = require("node:assert/strict"),
  { chromium } = require("playwright"),
  { PNG } = require("pngjs");
const origin = process.env.SMOKE_ORIGIN || "http://127.0.0.1:19233";
const address = new URL(origin);
if (!["127.0.0.1", "localhost"].includes(address.hostname))
  throw Error(
    "Fixture browser smoke tests are restricted to local candidate images",
  );
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
      [320, 800],
    ]) {
      const context = await browser.newContext({
          viewport: { width, height },
          serviceWorkers: "block",
        }),
        page = await context.newPage(),
        errors = [];
      let showWelcome = false,
        verifyEmail = false;
      page.on("pageerror", (error) => errors.push(error.message));
      await context.addInitScript(() => {
        localStorage.setItem("dinnerSwipeWebSession", "1");
        localStorage.setItem("dinnerSwipeOfflineOwner", "smoke-user");
      });
      await context.route("**/*", (route) => {
        const req = route.request(),
          url = new URL(req.url()),
          p = url.pathname;
        if (!p.startsWith("/api/"))
          return url.origin === origin ? route.continue() : route.abort();
        assert.equal(
          url.origin,
          origin,
          "Web API requests must stay on staging/candidate origin",
        );
        const reply = (data) =>
          route.fulfill({
            contentType: "application/json",
            body: JSON.stringify(data),
          });
        if (req.method() !== "GET") {
          if (p === "/api/v1/profile/onboarding") {
            assert.equal(req.method(), "PATCH");
            showWelcome = false;
            return reply({
              email: "smoke@example.com",
              tutorial_dismissed_at: "2026-11-17",
              tutorial_version_seen: "2026-11-17",
            });
          }
          assert.equal(p, "/api/v1/profile/planning");
          return reply({
            mode: "manual",
            reset_day: 0,
            notify: false,
            time_zone: "UTC",
            time_zone_configured: true,
          });
        }
        if (p.endsWith("/auth/status"))
          return reply({
            user_id: "smoke-user",
            email: "smoke@example.com",
            email_verified: true,
            content_automation_enabled: false,
          });
        if (p === "/api/v1/profile")
          return reply({
            email: "smoke@example.com",
            household_size: 2,
            allergens: [],
            disliked_ingredients: [],
            notification_preferences: {},
            appearance_preferences: { accent: "black" },
            experience_preferences: { mode: "nutrition", weight_unit: "kg" },
            tutorial_completed_at: showWelcome ? null : "2026-11-17",
            tutorial_version_seen: showWelcome ? null : "2026-11-17",
          });
        if (p.endsWith("/subscription/status"))
          return reply(
            verifyEmail
              ? {
                  basic_active: false,
                  premium_active: false,
                  active: false,
                  current_tier: "none",
                  plans: [],
                  welcome_eligible: true,
                  welcome_requires_verification: true,
                }
              : {
                  basic_active: true,
                  premium_active: true,
                  active: true,
                  current_tier: "premium",
                  plans: [],
                  welcome_active: true,
                  welcome_ends_at: "2030-01-01T00:00:00Z",
                  welcome_days_remaining: 30,
                },
          );
        const group = {
          id: "personal",
          name: "Personal",
          is_personal: true,
          is_default: true,
          current_user_role: "owner",
        };
        if (p.endsWith("/households/current")) return reply(group);
        if (p.endsWith("/households")) return reply([group]);
        if (p.endsWith("/weekly-plans/current"))
          return reply({
            id: "smoke-plan",
            week_start: "2026-11-16",
            slots: [],
            meal_target: 2,
          });
        return reply([]);
      });
      await page.goto(origin + "/");
      await page
        .getByRole("button", { name: "Swiping for: Personal", exact: true })
        .waitFor();
      const logo = page
        .getByRole("img", { name: "Dinner Swipe logo", exact: true })
        .first();
      await logo.waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      const pixels = PNG.sync.read(await logo.screenshot());
      let dark = 0,
        white = 0,
        total = 0;
      for (
        let y = Math.floor(pixels.height / 4);
        y < (3 * pixels.height) / 4;
        y++
      )
        for (
          let x = Math.floor(pixels.width / 4);
          x < (3 * pixels.width) / 4;
          x++
        ) {
          const i = (y * pixels.width + x) * 4,
            r = pixels.data[i],
            g = pixels.data[i + 1],
            b = pixels.data[i + 2];
          total++;
          if (r < 70 && g < 70 && b < 70) dark++;
          if (r > 220 && g > 220 && b > 220) white++;
        }
      assert(
        dark > total * 0.04 && white > total * 0.15,
        "Brand asset pixels must render",
      );
      await page
        .getByRole("button", { name: "Open settings", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Expand Appearance", exact: true })
        .click();
      await page
        .getByRole("radio", { name: "Black accent", exact: true })
        .waitFor();
      assert.equal(await page.getByRole("radio").count(), 7);
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            'button,input,[role="button"],[role="radio"]',
          ),
        ]
          .filter((element) => {
            const r = element.getBoundingClientRect();
            return (
              r.width > 0 &&
              r.height > 0 &&
              (r.left < -1 || r.right > innerWidth + 1)
            );
          })
          .map(
            (element) =>
              element.getAttribute("aria-label") || element.textContent,
          ),
      );
      assert.deepEqual(overflow, []);
      assert.deepEqual(errors, []);
      if (process.env.SMOKE_SCREENSHOTS)
        await page.screenshot({
          path: `${process.env.SMOKE_SCREENSHOTS}/${width}-settings.png`,
        });
      await page
        .getByRole("button", { name: "Close settings", exact: true })
        .click();
      showWelcome = true;
      await page.reload();
      await page
        .getByText("What would you like to do first?", { exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Start walkthrough", exact: true })
        .click();
      await page
        .getByText("Explore Dinner Swipe", { exact: true })
        .waitFor({ state: "hidden" });
      await page.getByTestId("tour-callout").waitFor();
      assert.equal(
        (await page.getByText("Choose a meal", { exact: true }).count()) >= 1,
        true,
      );
      assert.equal(
        await page.getByText("Action saved", { exact: true }).count(),
        0,
      );
      if (process.env.SMOKE_SCREENSHOTS)
        await page.screenshot({
          path: `${process.env.SMOKE_SCREENSHOTS}/${width}-tutorial.png`,
        });
      await page.getByRole("button", { name: "Try it", exact: true }).click();
      await page.getByRole("button", { name: "End tour", exact: true }).click();
      await page.getByTestId("tour-toolbar").waitFor({ state: "hidden" });
      verifyEmail = true;
      await page.reload();
      await page
        .getByText("30 days of Premium, on us", { exact: true })
        .waitFor();
      await page
        .getByText("No card. No automatic charge.", { exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", {
            name: "Resend verification email",
            exact: true,
          })
          .count(),
        1,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Start Basic free trial", exact: true })
          .count(),
        0,
      );
      if (process.env.SMOKE_SCREENSHOTS)
        await page.screenshot({
          path: `${process.env.SMOKE_SCREENSHOTS}/${width}-welcome.png`,
        });
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`Browser smoke ${width}x${height}: passed`);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
