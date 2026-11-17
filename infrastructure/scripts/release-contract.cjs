const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { parseEnv } = require("node:util");
const REPOSITORY = "ghcr.io/edwarj47/dinnerswipeapp";
const scopes = {
  web: ["dinner-swipe-web"],
  api: ["dinner-swipe-api"],
  "api-web": ["dinner-swipe-api", "dinner-swipe-web"],
  "api-worker-web": [
    "dinner-swipe-api",
    "dinner-swipe-worker",
    "dinner-swipe-web",
  ],
};
function command(value, permittedTier) {
  const match =
    /^release-v1 (staging|production) ([a-f0-9]{40}) ([a-f0-9]{64}) (web|api|api-web|api-worker-web)$/.exec(
      value || "",
    );
  if (!match || match[1] !== permittedTier)
    throw Error("Unauthorized release command");
  return { tier: match[1], sha: match[2], digest: match[3], scope: match[4] };
}
function privateFile(file) {
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== 0 ||
    stat.mode & 0o077 ||
    stat.size > 128 * 1024
  )
    throw Error("A private root-owned approval/configuration file is required");
  return fs.readFileSync(file);
}
function manifest(bytes, request) {
  if (
    crypto.createHash("sha256").update(bytes).digest("hex") !== request.digest
  )
    throw Error("Manifest digest mismatch");
  const m = JSON.parse(bytes);
  if (
    m.version !== 1 ||
    m.sha !== request.sha ||
    !/^[0-9]+$/.test(String(m.ciRun)) ||
    !/^[a-f0-9]{12}$/.test(m.schema || "") ||
    !m.api ||
    !m.web
  )
    throw Error("Invalid release manifest");
  for (const component of ["api", "web"])
    if (
      !new RegExp(`^${REPOSITORY}/${component}@sha256:[a-f0-9]{64}$`).test(
        m[component],
      )
    )
      throw Error("Unapproved image repository or mutable tag");
  return m;
}
function stagingEnvironment(env) {
  if (env.DEPLOYMENT_TIER !== "staging" || env.APP_ENV !== "production")
    throw Error("Staging must retain production security mode");
  const origin = new URL(env.APP_PUBLIC_URL);
  if (
    origin.protocol !== "https:" ||
    origin.hostname === "dinner.dcss.dev" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.hostname.endsWith(".invalid")
  )
    throw Error("Configure an approved separate HTTPS staging origin");
  if (
    env.PUBLIC_API_URL !== origin.origin ||
    env.ALLOWED_ORIGINS !== origin.origin
  )
    throw Error("Staging web/API must use the same isolated origin");
  for (const key of [
    "JWT_SECRET",
    "DINNER_STAGING_POSTGRES_PASSWORD",
    "DINNER_STAGING_RUNTIME_PASSWORD",
  ])
    if (
      !/^[A-Za-z0-9_-]{32,}$/.test(env[key] || "") ||
      /replace|change-me|development/i.test(env[key])
    )
      throw Error("Use fresh private staging credentials");
  if (
    new Set([
      env.JWT_SECRET,
      env.DINNER_STAGING_POSTGRES_PASSWORD,
      env.DINNER_STAGING_RUNTIME_PASSWORD,
    ]).size !== 3
  )
    throw Error("Staging credentials must be distinct");
  for (const [name, role, password] of [
    [
      "DINNER_STAGING_MIGRATION_URL",
      "dinner_swipe_staging_owner",
      env.DINNER_STAGING_POSTGRES_PASSWORD,
    ],
    [
      "DINNER_STAGING_RUNTIME_URL",
      "dinner_swipe_staging_runtime",
      env.DINNER_STAGING_RUNTIME_PASSWORD,
    ],
  ]) {
    const url = new URL(
      (env[name] || "").replace("postgresql+psycopg:", "postgresql:"),
    );
    if (
      url.hostname !== "postgres" ||
      url.port !== "5432" ||
      url.pathname !== "/dinner_swipe_staging" ||
      url.username !== role ||
      decodeURIComponent(url.password) !== password ||
      url.search ||
      url.hash
    )
      throw Error("A staging-only database/role is required");
  }
  for (const key of [
    "STRIPE_ENABLED",
    "FATSECRET_ENABLED",
    "FATSECRET_REFRESH_ENABLED",
    "AI_INGESTION_ENABLED",
    "AI_RECIPE_ENABLED",
    "NUTRITION_AI_ENABLED",
    "NUTRITION_VOICE_ENABLED",
    "MEDIA_CLEANUP_ENABLED",
  ])
    if (env[key] !== "false")
      throw Error(
        "External side effects must be explicitly disabled in staging",
      );
  for (const [key, value] of Object.entries(env))
    if (
      value &&
      /^(STRIPE_.*(KEY|SECRET)|FATSECRET_CLIENT_|OPENAI_API_KEY|EMAIL_SMTP_|AZURE_STORAGE_CONNECTION_STRING)/.test(
        key,
      )
    )
      throw Error("Provider credentials do not belong in default staging");
  if (
    !/^\d{4,5}$/.test(env.DINNER_STAGING_PORT || "") ||
    Number(env.DINNER_STAGING_PORT) < 1024 ||
    Number(env.DINNER_STAGING_PORT) > 65535
  )
    throw Error("Invalid private staging port");
  return env;
}
function loadStaging(file) {
  return stagingEnvironment(parseEnv(privateFile(file).toString()));
}
function acquireClaims(root, task) {
  const owned = [];
  try {
    for (const key of ["dinner-swipe", "vps-production"]) {
      const dir = path.join(root, `${key}.lock`);
      fs.mkdirSync(dir, { mode: 0o755 });
      owned.push(dir);
      fs.writeFileSync(
        path.join(dir, "owner.md"),
        `Owner: Dinner Swipe release executor PID ${process.pid}\nTask: ${task}\nRollback: recorded private release backup; no automatic database downgrade\n`,
        { mode: 0o644, flag: "wx" },
      );
    }
  } catch (error) {
    releaseClaims(owned);
    throw error;
  }
  return owned;
}
function releaseClaims(owned) {
  for (const dir of [...owned].reverse()) {
    try {
      fs.unlinkSync(path.join(dir, "owner.md"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    fs.rmdirSync(dir);
  }
}
function dockerEnvironment(extra = {}) {
  return {
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: "/root",
    DOCKER_HOST: "unix:///var/run/docker.sock",
    ...extra,
  };
}
function stagingResolved(resolved, env) {
  if (
    resolved.services?.api?.environment?.DATABASE_URL !==
      env.DINNER_STAGING_RUNTIME_URL ||
    resolved.services?.migrate?.environment?.DATABASE_URL !==
      env.DINNER_STAGING_MIGRATION_URL ||
    resolved.services?.postgres?.environment?.POSTGRES_DB !==
      "dinner_swipe_staging" ||
    resolved.services?.postgres?.environment?.POSTGRES_USER !==
      "dinner_swipe_staging_owner"
  )
    throw Error(
      "Resolved staging database boundaries do not match the validated environment",
    );
  for (const value of Object.values(resolved.volumes || {}))
    if (value.external || !/^dinner-swipe-staging_/.test(value.name || ""))
      throw Error("Staging cannot mount production or external volumes");
  for (const value of Object.values(resolved.networks || {}))
    if (
      value.external ||
      value.internal !== true ||
      !/^dinner-swipe-staging_/.test(value.name || "")
    )
      throw Error("Staging must use a separate internal network");
}
function readinessUrl(tier, resolved, env = {}) {
  const service = tier === "staging" ? "web" : "dinner-swipe-api",
    target = tier === "staging" ? 8080 : 8000,
    port = tier === "staging" ? String(env.DINNER_STAGING_PORT) : "8108";
  const ports = resolved.services?.[service]?.ports;
  if (
    !Array.isArray(ports) ||
    ports.length !== 1 ||
    ports[0].host_ip !== "127.0.0.1" ||
    String(ports[0].published) !== port ||
    Number(ports[0].target) !== target
  )
    throw Error("Readiness must match the exact isolated target binding");
  return `http://127.0.0.1:${port}/api/v1/health/ready`;
}
function webUrl(tier, resolved, env = {}) {
  const service = tier === "staging" ? "web" : "dinner-swipe-web",
    port = tier === "staging" ? String(env.DINNER_STAGING_PORT) : "8109";
  const ports = resolved.services?.[service]?.ports;
  if (
    !Array.isArray(ports) ||
    ports.length !== 1 ||
    ports[0].host_ip !== "127.0.0.1" ||
    String(ports[0].published) !== port ||
    Number(ports[0].target) !== 8080
  )
    throw Error("Web readiness must match the exact isolated target binding");
  return `http://127.0.0.1:${port}/`;
}
function assertCi(run, sha) {
  if (
    run.head_sha !== sha ||
    run.event !== "push" ||
    run.head_branch !== "main" ||
    run.name !== "CI" ||
    run.path !== ".github/workflows/ci.yml" ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    run.repository?.full_name !== "Edwarj47/DinnerSwipeApp"
  )
    throw Error("A successful exact-commit trusted main CI run is required");
}
module.exports = {
  command,
  manifest,
  stagingEnvironment,
  loadStaging,
  privateFile,
  acquireClaims,
  releaseClaims,
  assertCi,
  scopes,
  REPOSITORY,
  dockerEnvironment,
  stagingResolved,
  readinessUrl,
  webUrl,
};
