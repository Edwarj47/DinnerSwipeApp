const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { nativeContract, record, verify, checkEnvironment, PUBLIC_ENV, PROJECT_ID } = require("./check-ota-runtime.cjs");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dinner-ota-guard-"));
  fs.mkdirSync(path.join(root, "apps/mobile/modules/icons"), { recursive: true });
  fs.mkdirSync(path.join(root, "apps/mobile/assets"));
  fs.writeFileSync(path.join(root, "apps/mobile/app.json"), JSON.stringify({ expo: {
    version: "0.2.0", runtimeVersion: { policy: "appVersion" },
    android: { package: "dev.dcss.dinnerswipe" }, ios: { bundleIdentifier: "dev.dcss.dinnerswipe" },
    extra: { eas: { projectId: PROJECT_ID } },
    updates: { url: `https://u.expo.dev/${PROJECT_ID}`, enabled: true, checkAutomatically: "ON_LOAD", fallbackToCacheTimeout: 0 }
  } }));
  fs.writeFileSync(path.join(root, "apps/mobile/eas.json"), JSON.stringify({ build: Object.fromEntries(
    ["development", "preview", "production"].map(name => [name, { channel: name, environment: name, env: PUBLIC_ENV }])) }));
  fs.writeFileSync(path.join(root, "apps/mobile/modules/icons/Icons.kt"), "native module baseline");
  fs.writeFileSync(path.join(root, "apps/mobile/assets/icon.png"), "icon baseline");
  fs.writeFileSync(path.join(root, "apps/mobile/native-runtime.json"), JSON.stringify({ version: "0.2.0", ...nativeContract(root) }));
  return root;
}

test("compatible JS changes do not change the native runtime", () => {
  const root = fixture(), before = verify(root);
  fs.writeFileSync(path.join(root, "apps/mobile/Screen.tsx"), "UI-only change");
  assert.deepEqual(verify(root), before);
});
test("local Kotlin and icon changes cannot pass a same-version OTA gate", () => {
  for (const file of ["modules/icons/Icons.kt", "assets/icon.png"]) {
    const root = fixture(); fs.appendFileSync(path.join(root, "apps/mobile", file), "native change");
    assert.throws(() => verify(root), /Native inputs changed/);
  }
});
test("wrong project, cross-channel builds and disabled recovery are rejected", () => {
  for (const modify of [config => { config.updates.url = "https://untrusted.example/update"; },
    config => { config.updates.disableAntiBrickingMeasures = true; },
    config => { config.updates.useEmbeddedUpdate = false; }]) {
    const root = fixture(), target = path.join(root, "apps/mobile/app.json"), value = JSON.parse(fs.readFileSync(target));
    modify(value.expo); fs.writeFileSync(target, JSON.stringify(value)); assert.throws(() => verify(root));
  }
  const root = fixture(), target = path.join(root, "apps/mobile/eas.json"), value = JSON.parse(fs.readFileSync(target));
  value.build.preview.channel = "production"; fs.writeFileSync(target, JSON.stringify(value));
  assert.throws(() => verify(root), /separate/);
});
test("updates cannot accidentally bundle localhost, absent configuration or extra public secrets", () => {
  assert.doesNotThrow(() => checkEnvironment(PUBLIC_ENV));
  for (const env of [{}, { ...PUBLIC_ENV, EXPO_PUBLIC_API_URL: "http://localhost:8000" },
    { ...PUBLIC_ENV, EXPO_PUBLIC_PROVIDER_SECRET: "synthetic-not-a-real-secret" }]) assert.throws(() => checkEnvironment(env));
});
test("alternate configs, native directories, symlinks and malformed baselines fail closed", () => {
  for (const name of ["app.config.json", "app.config.mts", "app.config.cts", "android", "ios"]) {
    const root = fixture(); fs.writeFileSync(path.join(root, "apps/mobile", name), "override");
    assert.throws(() => verify(root), /unexpected/);
  }
  const root = fixture(), target = path.join(root, "apps/mobile/native-runtime.json");
  fs.writeFileSync(target, "broken"); assert.throws(() => verify(root));
  fs.unlinkSync(target); assert.throws(() => verify(root));
  fs.symlinkSync("Icons.kt", path.join(root, "apps/mobile/modules/icons/symlink.kt"));
  assert.throws(() => nativeContract(root), /symlinks/);
});
test("palette and test-named native sources are native inputs; older runtimes cannot be resealed", () => {
  for (const file of ["services/appearancePresets.json", "modules/icons/Native.test.kt"]) {
    const root = fixture(), target = path.join(root, "apps/mobile", file);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, "new native input");
    assert.throws(() => verify(root), /Native inputs changed/);
  }
  const root = fixture(), target = path.join(root, "apps/mobile/app.json"), config = JSON.parse(fs.readFileSync(target));
  config.expo.version = "0.2.1"; fs.writeFileSync(target, JSON.stringify(config)); record(root);
  config.expo.version = "0.2.0"; fs.writeFileSync(target, JSON.stringify(config)); assert.throws(() => record(root), /never reuse/);
});
