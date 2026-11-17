// Install this reviewed control plane outside the application checkout before enabling CD.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  cp = require("node:child_process"),
  http = require("node:http");
const contract = require("./release-contract.cjs");
const CONTROL = "/etc/dinner-swipe";
const run = (args, options = {}) =>
  cp
    .execFileSync("docker", args, {
      env: contract.dockerEnvironment(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    })
    .trim();
function approval(value, request, now = Date.now()) {
  if (
    value.tier !== request.tier ||
    value.sha !== request.sha ||
    value.digest !== request.digest ||
    value.scope !== request.scope ||
    value.approved !== true ||
    typeof value.migrations !== "boolean" ||
    (value.rollbackCompatible !== undefined &&
      typeof value.rollbackCompatible !== "boolean") ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    Date.parse(value.expiresAt) <= now ||
    Date.parse(value.expiresAt) > now + 86400000
  )
    throw Error("Missing, stale or mismatched operator approval");
  return value;
}
function snapshot(file, args) {
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    cp.execFileSync("docker", args, {
      env: contract.dockerEnvironment(),
      stdio: ["ignore", fd, "pipe"],
    });
  } finally {
    fs.closeSync(fd);
  }
}
async function hashFile(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
function stagingProof(proof, request, m, now = Date.now()) {
  if (
    proof.sha !== request.sha ||
    proof.digest !== request.digest ||
    proof.status !== "verified" ||
    proof.api !== m.api ||
    proof.web !== m.web ||
    !Number.isFinite(proof.verifiedAt) ||
    proof.verifiedAt > now ||
    now - proof.verifiedAt > 7 * 86400000
  )
    throw Error(
      "The exact manifest must pass staging before production promotion",
    );
}
function ready(url) {
  const address = new URL(url);
  if (
    address.protocol !== "http:" ||
    address.hostname !== "127.0.0.1" ||
    address.pathname !== "/api/v1/health/ready" ||
    address.search ||
    address.hash
  )
    throw Error("Only the validated loopback readiness endpoint is permitted");
  return new Promise((resolve) => {
    const request = http.get(address, { agent: false }, (response) => {
      let body = "",
        size = 0;
      if (response.statusCode !== 200) {
        response.resume();
        resolve(false);
        return;
      }
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 4096) {
          response.destroy();
          resolve(false);
        } else body += chunk;
      });
      response.on("error", () => resolve(false));
      response.on("end", () => {
        try {
          resolve(JSON.parse(body).status === "ready");
        } catch {
          resolve(false);
        }
      });
    });
    request.setTimeout(5000, () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}
function localResponse(url, method = "GET") {
  const address = new URL(url);
  if (
    address.protocol !== "http:" ||
    address.hostname !== "127.0.0.1" ||
    address.username ||
    address.password ||
    address.hash
  )
    throw Error("Only a validated loopback web endpoint is permitted");
  return new Promise((resolve) => {
    const request = http.request(
      address,
      { method, agent: false },
      (response) => {
        let body = "",
          size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 131072) {
            response.destroy();
            resolve(null);
          } else body += chunk;
        });
        response.on("error", () => resolve(null));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            type: response.headers["content-type"] || "",
            body,
          }),
        );
      },
    );
    request.setTimeout(5000, () => {
      request.destroy();
      resolve(null);
    });
    request.on("error", () => resolve(null));
    request.end();
  });
}
async function webReady(url) {
  const index = await localResponse(url);
  if (
    index?.status !== 200 ||
    !index.type.includes("text/html") ||
    !/<div[^>]+id=["']root["']/.test(index.body)
  )
    return false;
  const asset = index.body.match(
    /<script[^>]+src=["'](\/_expo\/static\/js\/[A-Za-z0-9_./-]+\.js)["']/,
  )?.[1];
  if (!asset || asset.includes("..")) return false;
  const script = await localResponse(new URL(asset, url), "HEAD");
  return script?.status === 200 && /javascript/.test(script.type);
}
async function backup(config, dir, compose) {
  fs.mkdirSync(dir, { mode: 0o700 });
  const database = compose("ps", "-q", config.databaseService);
  const api = compose("ps", "-q", config.apiService);
  if (!/^[a-f0-9]{12,64}$/.test(database) || !/^[a-f0-9]{12,64}$/.test(api))
    throw Error(
      "Bootstrap and verify the isolated environment before releasing",
    );
  snapshot(path.join(dir, "database.dump"), [
    "exec",
    database,
    "pg_dump",
    "-Fc",
    "-U",
    config.databaseOwner,
    config.databaseName,
  ]);
  snapshot(path.join(dir, "media.tar"), [
    "exec",
    api,
    "tar",
    "-C",
    "/app/media",
    "-cf",
    "-",
    ".",
  ]);
  cp.execFileSync("tar", ["-tf", path.join(dir, "media.tar")], {
    env: contract.dockerEnvironment(),
    stdio: "ignore",
  });
  const dump = fs.openSync(path.join(dir, "database.dump"), "r");
  try {
    cp.execFileSync(
      "docker",
      ["exec", "-i", database, "pg_restore", "--list"],
      { env: contract.dockerEnvironment(), stdio: [dump, "ignore", "pipe"] },
    );
  } finally {
    fs.closeSync(dump);
  }
  for (const [index, file] of config.environmentFiles.entries())
    fs.writeFileSync(
      path.join(dir, `environment-${index}`),
      contract.privateFile(file),
      { mode: 0o600, flag: "wx" },
    );
  const hashes = {};
  for (const name of fs.readdirSync(dir))
    hashes[name] = await hashFile(path.join(dir, name));
  fs.writeFileSync(
    path.join(dir, "SHA256SUMS.json"),
    JSON.stringify(hashes, null, 2),
    { mode: 0o600, flag: "wx" },
  );
  for (const [name, hash] of Object.entries(hashes))
    if ((await hashFile(path.join(dir, name))) !== hash)
      throw Error("Backup checksum mismatch");
  fs.writeFileSync(
    path.join(dir, "COMPLETE"),
    "Verified backup; never automatically restore over user changes.\n",
    { mode: 0o600, flag: "wx" },
  );
  return database;
}
async function execute(request) {
  if (process.getuid() !== 0)
    throw Error("Use the separately installed restricted operator entry point");
  const config = JSON.parse(
    contract.privateFile(path.join(CONTROL, `${request.tier}.json`)),
  );
  if (config.enabled !== true)
    throw Error("Deployment environment is not activated");
  const approved = approval(
    JSON.parse(
      contract.privateFile(
        path.join(CONTROL, "approvals", request.tier, `${request.sha}.json`),
      ),
    ),
    request,
  );
  const m = contract.manifest(
    contract.privateFile(
      path.join(CONTROL, "manifests", `${request.sha}.json`),
    ),
    request,
  );
  if (request.tier === "production") {
    const proof = JSON.parse(
      contract.privateFile(
        path.join(
          "/var/lib/dinner-swipe/verified-staging",
          `${request.digest}.json`,
        ),
      ),
    );
    stagingProof(proof, request, m);
  }
  contract.privateFile(config.composeFile);
  contract.privateFile(config.environmentFile);
  const stage = request.tier === "staging";
  if (config.project !== (stage ? "dinner-swipe-staging" : "dinner-swipe"))
    throw Error("Unexpected Compose project");
  const validated = stage ? contract.loadStaging(config.environmentFile) : {};
  const map = stage
    ? { "dinner-swipe-api": "api", "dinner-swipe-web": "web" }
    : Object.fromEntries(
        Object.keys(contract.scopes)
          .flatMap((k) => contract.scopes[k])
          .map((k) => [k, k]),
      );
  const services = contract.scopes[request.scope].map((name) => {
    if (!map[name]) throw Error("Unsupported staging service");
    return map[name];
  });
  if (
    config.databaseName !== (stage ? "dinner_swipe_staging" : "dinner_swipe") ||
    config.databaseOwner !==
      (stage ? "dinner_swipe_staging_owner" : "dinner_swipe_app") ||
    config.databaseService !== (stage ? "postgres" : "dinner-swipe-postgres") ||
    config.apiService !== (stage ? "api" : "dinner-swipe-api")
  )
    throw Error("Unexpected database boundary");
  const claims = contract.acquireClaims(
    "/home/codexvps/Desktop/.agents/locks",
    `${request.tier} ${request.sha} ${request.scope}`,
  );
  const dir = path.join(
    "/var/lib/dinner-swipe/releases",
    `${Date.now()}-${request.tier}-${request.sha.slice(0, 12)}`,
  );
  let changed = false,
    migrated = false,
    old = {},
    base;
  const environment = contract.dockerEnvironment({
    DINNER_API_IMAGE: m.api,
    DINNER_WEB_IMAGE: m.web,
    DINNER_STAGING_ENV_FILE: config.environmentFile,
  });
  const compose = (...args) => run([...base, ...args], { env: environment });
  try {
    base = [
      "compose",
      "--project-name",
      config.project,
      "--env-file",
      config.environmentFile,
      "-f",
      config.composeFile,
    ];
    const resolved = JSON.parse(
      compose("--profile", "bootstrap", "config", "--format", "json"),
    );
    if (stage) contract.stagingResolved(resolved, validated);
    const readyUrl = contract.readinessUrl(request.tier, resolved, validated);
    const web = services.some((service) => service.endsWith("web"))
      ? contract.webUrl(request.tier, resolved, validated)
      : null;
    if (
      !resolved.services?.migrate ||
      resolved.services.migrate.build ||
      resolved.services.migrate.image !== m.api
    )
      throw Error("Migration service must use the exact approved API digest");
    for (const service of services) {
      const value = resolved.services[service];
      if (
        !value ||
        value.build ||
        !value.image ||
        value.image !== (service.endsWith("web") ? m.web : m.api)
      )
        throw Error(
          "Compose must use approved immutable images, not build contexts",
        );
      const container = compose("ps", "-q", service);
      if (!container) throw Error("Bootstrap the environment first");
      old[service] = run(["inspect", container, "--format", "{{.Image}}"]);
    }
    const before = run(["ps", "--format", "{{json .}}"])
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    const allowed = new Set(
      services.map((service) =>
        run([
          "inspect",
          compose("ps", "-q", service),
          "--format",
          "{{.Name}}",
        ]).replace(/^\//, ""),
      ),
    );
    const database = await backup(config, dir, compose);
    const revision = run([
      "exec",
      database,
      "psql",
      "-U",
      config.databaseOwner,
      "-d",
      config.databaseName,
      "-Atc",
      "SELECT version_num FROM alembic_version",
    ]);
    fs.writeFileSync(
      path.join(dir, "recovery.json"),
      JSON.stringify(
        {
          sha: request.sha,
          tier: request.tier,
          scope: request.scope,
          previous: old,
          beforeSchema: revision,
          desiredSchema: m.schema,
          migrationsPermitted: approved.migrations,
          rollbackCompatible: approved.rollbackCompatible === true,
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    fs.writeFileSync(
      path.join(dir, "compose.yml"),
      contract.privateFile(config.composeFile),
      { mode: 0o600, flag: "wx" },
    );
    if (
      revision !== m.schema &&
      (approved.migrations !== true || request.scope === "web")
    )
      throw Error(
        "A schema upgrade requires explicit approval and an API release",
      );
    for (const image of new Set(
      services.map((service) => (service.endsWith("web") ? m.web : m.api)),
    )) {
      run(["pull", image]);
      if (
        run([
          "image",
          "inspect",
          image,
          "--format",
          '{{index .Config.Labels "org.opencontainers.image.revision"}}',
        ]) !== request.sha
      )
        throw Error("Image source label does not match the approved SHA");
    }
    if (revision !== m.schema) {
      compose(
        "--profile",
        "bootstrap",
        "run",
        "--rm",
        "--no-deps",
        "--pull",
        "never",
        "migrate",
      );
      migrated = true;
    }
    changed = true;
    compose(
      "up",
      "-d",
      "--no-build",
      "--no-deps",
      "--pull",
      "never",
      "--wait",
      "--wait-timeout",
      "120",
      ...services,
    );
    for (const service of services) {
      const image = service.endsWith("web") ? m.web : m.api;
      const expected = run(["image", "inspect", image, "--format", "{{.Id}}"]);
      if (
        run([
          "inspect",
          compose("ps", "-q", service),
          "--format",
          "{{.Image}}",
        ]) !== expected
      )
        throw Error(
          "Running container does not match the approved image digest",
        );
    }
    let healthy = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await ready(readyUrl)) && (!web || (await webReady(web)))) {
        healthy = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!healthy) throw Error("Database/schema or web-asset readiness failed");
    const after = run(["ps", "--format", "{{json .}}"])
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    for (const previous of before.filter((row) => !allowed.has(row.Names)))
      if (
        !after.some(
          (row) => row.ID === previous.ID && row.Names === previous.Names,
        )
      )
        throw Error("A protected container changed");
    fs.writeFileSync(
      path.join(dir, "release.json"),
      JSON.stringify(
        {
          sha: request.sha,
          scope: request.scope,
          tier: request.tier,
          api: m.api,
          web: m.web,
          previous: old,
          status: "verified",
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    if (stage && request.scope === "api-web") {
      const destination = "/var/lib/dinner-swipe/verified-staging";
      fs.mkdirSync(destination, { mode: 0o700, recursive: true });
      fs.writeFileSync(
        path.join(destination, `${request.digest}.json`),
        JSON.stringify({
          sha: request.sha,
          digest: request.digest,
          api: m.api,
          web: m.web,
          status: "verified",
          verifiedAt: Date.now(),
        }),
        { mode: 0o600 },
      );
    }
    console.log(
      "Scoped release completed; private backup and rollback images retained.",
    );
  } catch (error) {
    if (changed && (!migrated || approved.rollbackCompatible === true)) {
      const rollback = path.join(dir, "rollback.json");
      fs.writeFileSync(
        rollback,
        JSON.stringify({
          services: Object.fromEntries(
            Object.entries(old).map(([name, image]) => [name, { image }]),
          ),
        }),
        { mode: 0o600 },
      );
      run(
        [
          ...base,
          "-f",
          rollback,
          "up",
          "-d",
          "--no-build",
          "--no-deps",
          "--pull",
          "never",
          "--wait",
          "--wait-timeout",
          "120",
          ...services,
        ],
        { env: environment },
      );
    }
    throw error;
  } finally {
    try {
      if (fs.existsSync(dir))
        fs.writeFileSync(
          path.join(dir, "HANDOFF.txt"),
          `Release ${request.tier} ${request.sha}; inspect release.json and private backups. No database restore/downgrade performed.\n`,
          { mode: 0o600 },
        );
      fs.writeFileSync(
        path.join(
          "/home/codexvps/Desktop/.agents/handoffs",
          `${new Date().toISOString().replace(/[-:.]/g, "")}-dinner-swipe-release.md`,
        ),
        `Owner: restricted Dinner Swipe release executor\nTask: ${request.tier} ${request.sha} ${request.scope}\nVerification: inspect root-private ${dir}; successful release.json is required before reporting completion.\nRollback: retained images/private backups; no database restore/downgrade performed.\n`,
        { mode: 0o644, flag: "wx" },
      );
    } finally {
      contract.releaseClaims(claims);
    }
  }
}
if (require.main === module) {
  Promise.resolve()
    .then(() =>
      execute(
        contract.command(process.env.SSH_ORIGINAL_COMMAND, process.argv[2]),
      ),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
module.exports = {
  approval,
  execute,
  backup,
  hashFile,
  stagingProof,
  ready,
  webReady,
};
