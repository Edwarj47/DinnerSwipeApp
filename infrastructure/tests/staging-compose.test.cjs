const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  cp = require("node:child_process");
const contract = require("../scripts/release-contract.cjs");

test("actual staging Compose renders isolated databases, secrets, ports and digest-only services", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "dinner-compose-check-"),
  );
  const file = path.join(directory, "synthetic.env"),
    digest = "a".repeat(64);
  const env = {
    DEPLOYMENT_TIER: "staging",
    APP_ENV: "production",
    APP_PUBLIC_URL: "https://stage.example.com",
    PUBLIC_API_URL: "https://stage.example.com",
    ALLOWED_ORIGINS: "https://stage.example.com",
    JWT_SECRET: "a".repeat(40),
    DINNER_STAGING_POSTGRES_PASSWORD: "b".repeat(40),
    DINNER_STAGING_RUNTIME_PASSWORD: "c".repeat(40),
    DINNER_STAGING_PORT: "19341",
    DINNER_STAGING_MIGRATION_URL: `postgresql+psycopg://dinner_swipe_staging_owner:${"b".repeat(40)}@postgres:5432/dinner_swipe_staging`,
    DINNER_STAGING_RUNTIME_URL: `postgresql+psycopg://dinner_swipe_staging_runtime:${"c".repeat(40)}@postgres:5432/dinner_swipe_staging`,
    ...Object.fromEntries(
      [
        "STRIPE_ENABLED",
        "FATSECRET_ENABLED",
        "FATSECRET_REFRESH_ENABLED",
        "AI_INGESTION_ENABLED",
        "AI_RECIPE_ENABLED",
        "NUTRITION_AI_ENABLED",
        "NUTRITION_VOICE_ENABLED",
        "MEDIA_CLEANUP_ENABLED",
      ].map((key) => [key, "false"]),
    ),
  };
  try {
    contract.stagingEnvironment(env);
    fs.writeFileSync(
      file,
      Object.entries(env)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join("\n") + "\n",
      { mode: 0o600 },
    );
    const api = `${contract.REPOSITORY}/api@sha256:${digest}`,
      web = `${contract.REPOSITORY}/web@sha256:${digest}`;
    const resolved = JSON.parse(
      cp.execFileSync(
        "docker",
        [
          "compose",
          "--project-name",
          "dinner-swipe-staging",
          "--env-file",
          file,
          "-f",
          path.resolve(__dirname, "../compose/staging.yml"),
          "--profile",
          "bootstrap",
          "config",
          "--format",
          "json",
        ],
        {
          encoding: "utf8",
          env: contract.dockerEnvironment({
            HOME: os.homedir(),
            DINNER_API_IMAGE: api,
            DINNER_WEB_IMAGE: web,
            DINNER_STAGING_ENV_FILE: file,
          }),
        },
      ),
    );
    contract.stagingResolved(resolved, env);
    assert.equal(
      contract.readinessUrl("staging", resolved, env),
      "http://127.0.0.1:19341/api/v1/health/ready",
    );
    assert.equal(
      contract.webUrl("staging", resolved, env),
      "http://127.0.0.1:19341/",
    );
    assert.equal(resolved.services.api.image, api);
    assert.equal(resolved.services.migrate.image, api);
    assert.equal(resolved.services.web.image, web);
    for (const name of ["api", "migrate", "web"])
      assert.equal(resolved.services[name].build, undefined);
    for (const key of [
      "MIGRATION_DATABASE_URL",
      "DINNER_STAGING_POSTGRES_PASSWORD",
      "DINNER_STAGING_RUNTIME_PASSWORD",
      "DINNER_STAGING_MIGRATION_URL",
    ])
      assert.equal(resolved.services.api.environment[key], "");
    assert.equal(resolved.services.api.read_only, true);
    assert.equal(resolved.services.postgres.ports, undefined);
    assert(!JSON.stringify(resolved.services).includes("/backups/"));
  } finally {
    fs.unlinkSync(file);
    fs.rmdirSync(directory);
  }
});
