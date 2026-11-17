const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const r = require("../scripts/release-contract.cjs");
const {
  approval,
  stagingProof,
  hashFile,
  ready,
  webReady,
} = require("../scripts/release-executor.cjs");
const { tmuxCommand } = require("../scripts/release-ssh.cjs");
const { jobRequest } = require("../scripts/release-job.cjs");
const sha = "a".repeat(40),
  digest = "b".repeat(64);
test("SSH grammar rejects shell syntax, arbitrary refs, extra fields and wrong tier", () => {
  assert.equal(
    r.command(`release-v1 staging ${sha} ${digest} api-web`, "staging").sha,
    sha,
  );
  for (const value of [
    `release-v1 production ${sha} ${digest} api-web`,
    `release-v1 staging main ${digest} api-web`,
    `release-v1 staging ${sha} ${digest} api-web; id`,
    `release-v1 staging ${sha} ${digest} postgres`,
    `release-v1 staging ${sha} ${digest} web extra`,
  ])
    assert.throws(() => r.command(value, "staging"));
});
test("manifest requires immutable images from fixed repositories and the exact approved source", () => {
  const value = {
    version: 1,
    sha,
    ciRun: "123",
    schema: "fa617db329a0",
    api: `${r.REPOSITORY}/api@sha256:${digest}`,
    web: `${r.REPOSITORY}/web@sha256:${digest}`,
  };
  const bytes = Buffer.from(JSON.stringify(value)),
    request = {
      sha,
      digest: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  assert.equal(r.manifest(bytes, request).sha, sha);
  assert.throws(() => r.manifest(bytes, { ...request, digest }));
  for (const override of [
    { api: "postgres:latest" },
    { sha: "c".repeat(40) },
    { schema: "head;id" },
  ]) {
    const raw = Buffer.from(JSON.stringify({ ...value, ...override }));
    assert.throws(() =>
      r.manifest(raw, {
        ...request,
        digest: crypto.createHash("sha256").update(raw).digest("hex"),
      }),
    );
  }
});
test("host claims never take over an occupied or partial claim", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dinner-release-claims-"));
  try {
    fs.mkdirSync(path.join(dir, "vps-production.lock"));
    assert.throws(() => r.acquireClaims(dir, "test"));
    assert(!fs.existsSync(path.join(dir, "dinner-swipe.lock")));
    fs.rmdirSync(path.join(dir, "vps-production.lock"));
    const owned = r.acquireClaims(dir, "test");
    assert.equal(owned.length, 2);
    r.releaseClaims(owned);
  } finally {
    fs.rmdirSync(dir);
  }
});
test("failed claim metadata never leaves an occupied partial claim owned by the executor", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dinner-claim-failure-"));
  const original = fs.writeFileSync;
  try {
    fs.writeFileSync = () => {
      throw Error("synthetic metadata write failure");
    };
    assert.throws(() => r.acquireClaims(dir, "test"), /synthetic/);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.writeFileSync = original;
    fs.rmdirSync(dir);
  }
});
test("CI source evidence cannot be PR-only, skipped, stale or from another repository", () => {
  const value = {
    head_sha: sha,
    event: "push",
    head_branch: "main",
    name: "CI",
    path: ".github/workflows/ci.yml",
    status: "completed",
    conclusion: "success",
    repository: { full_name: "Edwarj47/DinnerSwipeApp" },
  };
  r.assertCi(value, sha);
  for (const override of [
    { event: "pull_request" },
    { head_sha: "c".repeat(40) },
    { conclusion: "skipped" },
    { repository: { full_name: "attacker/repo" } },
  ])
    assert.throws(() => r.assertCi({ ...value, ...override }, sha));
});
test("operator approval is scoped, short-lived and cannot silently authorize migrations", () => {
  const request = { tier: "production", sha, digest, scope: "web" },
    now = Date.now();
  const value = {
    ...request,
    approved: true,
    expiresAt: new Date(now + 3600000).toISOString(),
    migrations: false,
  };
  assert.equal(approval(value, request, now).migrations, false);
  for (const change of [
    { tier: "staging" },
    { scope: "api-worker-web" },
    { approved: false },
    { migrations: "false" },
    { rollbackCompatible: "false" },
    { expiresAt: new Date(now - 1).toISOString() },
    { expiresAt: new Date(now + 90000000).toISOString() },
  ])
    assert.throws(() => approval({ ...value, ...change }, request, now));
});
function env() {
  return {
    DEPLOYMENT_TIER: "staging",
    APP_ENV: "production",
    APP_PUBLIC_URL: "https://stage.example.com",
    PUBLIC_API_URL: "https://stage.example.com",
    ALLOWED_ORIGINS: "https://stage.example.com",
    JWT_SECRET: "a".repeat(40),
    DINNER_STAGING_POSTGRES_PASSWORD: "b".repeat(40),
    DINNER_STAGING_RUNTIME_PASSWORD: "c".repeat(40),
    DINNER_STAGING_MIGRATION_URL: `postgresql+psycopg://dinner_swipe_staging_owner:${"b".repeat(40)}@postgres:5432/dinner_swipe_staging`,
    DINNER_STAGING_RUNTIME_URL: `postgresql+psycopg://dinner_swipe_staging_runtime:${"c".repeat(40)}@postgres:5432/dinner_swipe_staging`,
    DINNER_STAGING_PORT: "19341",
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
      ].map((k) => [k, "false"]),
    ),
  };
}
test("staging rejects production routing, databases, weaker security, credentials and provider side effects", () => {
  assert.equal(r.stagingEnvironment(env()).APP_ENV, "production");
  for (const override of [
    { APP_ENV: "staging" },
    { APP_PUBLIC_URL: "https://dinner.dcss.dev" },
    { PUBLIC_API_URL: "https://dinner.dcss.dev" },
    {
      DINNER_STAGING_RUNTIME_URL:
        "postgresql://owner:password@dinner-swipe-postgres:5432/dinner_swipe",
    },
    { STRIPE_ENABLED: "true" },
    { OPENAI_API_KEY: "not-permitted" },
    { JWT_SECRET: "change-me" },
  ])
    assert.throws(() => r.stagingEnvironment({ ...env(), ...override }));
});
test("resolved Compose and readiness are bound to the validated staging environment", () => {
  const value = env(),
    resolved = {
      services: {
        api: {
          environment: { DATABASE_URL: value.DINNER_STAGING_RUNTIME_URL },
        },
        migrate: {
          environment: { DATABASE_URL: value.DINNER_STAGING_MIGRATION_URL },
        },
        postgres: {
          environment: {
            POSTGRES_DB: "dinner_swipe_staging",
            POSTGRES_USER: "dinner_swipe_staging_owner",
          },
        },
        web: {
          ports: [{ host_ip: "127.0.0.1", published: "19341", target: 8080 }],
        },
      },
      volumes: { database: { name: "dinner-swipe-staging_database" } },
      networks: {
        private: { name: "dinner-swipe-staging_private", internal: true },
      },
    };
  r.stagingResolved(resolved, value);
  assert.equal(
    r.readinessUrl("staging", resolved, value),
    "http://127.0.0.1:19341/api/v1/health/ready",
  );
  assert.equal(r.webUrl("staging", resolved, value), "http://127.0.0.1:19341/");
  for (const change of [
    () => (resolved.services.api.environment.DATABASE_URL = "production"),
    () => (resolved.volumes.database.external = true),
    () => (resolved.networks.private.internal = false),
    () => (resolved.services.web.ports[0].published = "8109"),
    () => (resolved.services.web.ports[0].host_ip = "0.0.0.0"),
  ]) {
    const copy = structuredClone(resolved);
    change();
    assert.throws(() => {
      r.stagingResolved(resolved, value);
      r.readinessUrl("staging", resolved, value);
    });
    Object.assign(resolved, copy);
  }
});
test("Docker commands cannot inherit ambient provider, Compose, proxy or database variables", () => {
  const clean = r.dockerEnvironment({ DINNER_API_IMAGE: "approved" });
  assert.deepEqual(Object.keys(clean).sort(), [
    "DINNER_API_IMAGE",
    "DOCKER_HOST",
    "HOME",
    "PATH",
  ]);
  assert.equal(clean.DOCKER_HOST, "unix:///var/run/docker.sock");
});
test("staging proof must be recent, finite and exactly match the promoted images", () => {
  const now = Date.now(),
    request = { sha, digest },
    m = { api: "api", web: "web" },
    proof = { ...request, ...m, status: "verified", verifiedAt: now };
  stagingProof(proof, request, m, now);
  for (const change of [
    { verifiedAt: undefined },
    { verifiedAt: "now" },
    { verifiedAt: now + 1 },
    { verifiedAt: now - 8 * 86400000 },
    { api: "other" },
    { status: "pending" },
  ])
    assert.throws(() => stagingProof({ ...proof, ...change }, request, m, now));
});
test("backup hashing is streaming and matches a known checksum", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dinner-hash-")),
    file = path.join(directory, "archive");
  try {
    const bytes = Buffer.alloc(5 * 1024 * 1024, 17);
    fs.writeFileSync(file, bytes);
    assert.equal(
      await hashFile(file),
      crypto.createHash("sha256").update(bytes).digest("hex"),
    );
  } finally {
    fs.unlinkSync(file);
    fs.rmdirSync(directory);
  }
});
test("durable job commands accept only generated paths, never SSH input", () => {
  assert.match(
    tmuxCommand("a".repeat(32)),
    /release-job\.cjs \/var\/lib\/dinner-swipe\/jobs\/a{32}\/request\.json/,
  );
  for (const id of ["a; id", "../../tmp", "a".repeat(31)])
    assert.throws(() => tmuxCommand(id));
  assert.throws(() => tmuxCommand("a".repeat(32), "/tmp"));
  assert.throws(() => jobRequest("/tmp/request.json"));
});
test("readiness rejects redirects, oversized bodies and wrong status without following proxies", async () => {
  const http = require("node:http");
  let response = 0;
  const server = http.createServer((req, res) => {
    if (response === 1) {
      res.writeHead(302, { Location: "/other" });
      res.end();
    } else if (response === 2) res.end("x".repeat(5000));
    else if (response === 3) res.end('{"status":"not_ready"}');
    else res.end('{"status":"ready"}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/v1/health/ready`;
    assert.equal(await ready(url), true);
    for (response = 1; response < 4; response++)
      assert.equal(await ready(url), false);
    assert.throws(() => ready("https://example.com/api/v1/health/ready"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test("web verification requires a real index and available same-origin JavaScript, not API health alone", async () => {
  const http = require("node:http");
  let broken = false;
  const server = http.createServer((req, res) => {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<div id="root"></div><script src="/_expo/static/js/web/entry-test.js"></script>',
      );
    } else {
      res.setHeader(
        "Content-Type",
        broken ? "text/html" : "application/javascript",
      );
      res.end("");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    assert.equal(await webReady(url), true);
    broken = true;
    assert.equal(await webReady(url), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
