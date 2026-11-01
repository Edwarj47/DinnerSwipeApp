const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PROJECT_ID = "fbe8bf7c-1e7e-4ace-9cd8-68f231173d90";
const PUBLIC_ENV = {
  EXPO_PUBLIC_APP_NAME: "Dinner Swipe",
  EXPO_PUBLIC_API_URL: "https://dinner.dcss.dev",
  EXPO_PUBLIC_FEATURE_AI_INGESTION: "true"
};
const INPUTS = ["package.json", "package-lock.json", "apps/mobile/package.json", "apps/mobile/app.json",
  "apps/mobile/eas.json", "apps/mobile/babel.config.js", "apps/mobile/metro.config.js",
  "apps/mobile/services/appearancePresets.json",
  "apps/mobile/plugins", "apps/mobile/modules", "apps/mobile/assets"];

function validateConfig(root) {
  for (const name of ["app.config.json", "app.config.js", "app.config.ts", "app.config.cjs", "app.config.mjs", "app.config.cts", "app.config.mts", "android", "ios"]) {
    if (fs.existsSync(path.join(root, "apps/mobile", name))) throw new Error(`CNG/static config required: unexpected ${name}`);
  }
  const config = JSON.parse(fs.readFileSync(path.join(root, "apps/mobile/app.json"))).expo;
  const eas = JSON.parse(fs.readFileSync(path.join(root, "apps/mobile/eas.json")));
  if (config.extra?.eas?.projectId !== PROJECT_ID || config.updates?.url !== `https://u.expo.dev/${PROJECT_ID}`) throw new Error("Wrong EAS Update project");
  if (config.runtimeVersion?.policy !== "appVersion" || !/^\d+\.\d+\.\d+$/.test(config.version)) throw new Error("Use a versioned native runtime");
  if (config.android.package !== "dev.dcss.dinnerswipe" || config.ios.bundleIdentifier !== "dev.dcss.dinnerswipe") throw new Error("Do not change the installed app identity");
  if (config.updates.enabled !== true || config.updates.checkAutomatically !== "ON_LOAD" || config.updates.fallbackToCacheTimeout !== 0 || config.updates.disableAntiBrickingMeasures === true || config.updates.useEmbeddedUpdate === false) throw new Error("Embedded/offline update fallback must remain enabled");
  for (const name of ["development", "preview", "production"]) {
    const profile = eas.build[name];
    if (profile.channel !== name || profile.environment !== name) throw new Error("Keep release channels and environments separate");
    for (const [key, value] of Object.entries(PUBLIC_ENV)) if (profile.env[key] !== value) throw new Error(`Incorrect public build configuration: ${key}`);
  }
  return config;
}

function nativeContract(root) {
  const inputs = {};
  function visit(relative) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) return;
    if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error("Native inputs must not be symlinks");
    if (fs.statSync(absolute).isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) {
        if (["build", ".gradle", "node_modules", "Pods"].includes(name)) continue;
        visit(path.posix.join(relative, name));
      }
    } else {
      inputs[relative] = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
    }
  }
  for (const relative of INPUTS) visit(relative);
  const sorted = Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b)));
  const hash = crypto.createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
  return { hash, inputs: sorted };
}

function record(root) {
  const config = validateConfig(root), current = nativeContract(root);
  const target = path.join(root, "apps/mobile/native-runtime.json");
  if (fs.existsSync(target)) {
    const previous = JSON.parse(fs.readFileSync(target));
    const compare = config.version.split(".").map(Number).reduce((result, value, index) => result || Math.sign(value - Number(previous.version.split(".")[index])), 0);
    if (compare < 0 || (compare === 0 && previous.hash !== current.hash)) throw new Error("Bump expo.version before recording changed native inputs; never reuse older runtimes");
  }
  fs.writeFileSync(target, JSON.stringify({ version: config.version, ...current }, null, 2) + "\n");
}

function verify(root) {
  const config = validateConfig(root);
  const recorded = JSON.parse(fs.readFileSync(path.join(root, "apps/mobile/native-runtime.json")));
  const current = nativeContract(root);
  if (recorded.version !== config.version || recorded.hash !== current.hash) throw new Error("Native inputs changed: bump expo.version and build a new APK before publishing OTA");
  return { version: config.version, hash: current.hash };
}

function checkEnvironment(env) {
  for (const [key, value] of Object.entries(PUBLIC_ENV)) if (env[key] !== value) throw new Error(`Refusing an update with missing or incorrect ${key}`);
  const unexpected = Object.keys(env).filter(key => key.startsWith("EXPO_PUBLIC_") && !(key in PUBLIC_ENV));
  if (unexpected.length) throw new Error(`Review unexpected public bundle variables: ${unexpected.join(", ")}`);
}

if (require.main === module) {
  const root = path.resolve(__dirname, "../..");
  try {
    if (process.argv.includes("--record")) {
      record(root);
    }
    const result = verify(root);
    if (process.argv.includes("--check-env")) checkEnvironment(process.env);
    process.stdout.write(`Native runtime ${result.version} verified (${result.hash.slice(0, 12)}).\n`);
  } catch (error) { process.stderr.write(error.message + "\n"); process.exitCode = 1; }
}

module.exports = { nativeContract, validateConfig, record, verify, checkEnvironment, PUBLIC_ENV, PROJECT_ID };
