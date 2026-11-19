const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { checkStoreConfig, preflight } = require("./store-build-preflight.cjs");
const config = require("../../apps/mobile/app.json").expo;
const eas = require("../../apps/mobile/eas.json");

function fixture() { return { config: structuredClone(config), eas: structuredClone(eas) }; }

test("sealed current configuration prepares AAB and device IPA without changing runtime", () => {
  const root = path.resolve(__dirname, "../..");
  assert.equal(preflight(root, "android").artifact, "aab");
  assert.equal(preflight(root, "ios").artifact, "ipa");
});

test("unknown platform and changed package identifiers fail closed", () => {
  assert.throws(() => checkStoreConfig(config, eas, "all"), /Choose/);
  for (const platform of ["android", "ios"]) {
    const f = fixture();
    f.config[platform][platform === "android" ? "package" : "bundleIdentifier"] = "example.wrong";
    assert.throws(() => checkStoreConfig(f.config, f.eas, platform), /identity/);
  }
});

test("development/internal/inherited production profiles are rejected", () => {
  for (const change of [{ developmentClient: true }, { distribution: "internal" }, { extends: "preview" }]) {
    const f = fixture(); Object.assign(f.eas.build.production, change);
    assert.throws(() => checkStoreConfig(f.config, f.eas, "ios"), /standalone store/);
  }
});

test("preview APK remains separate from Play AAB", () => {
  assert.equal(eas.build.preview.android.buildType, "apk");
  const f = fixture(); f.eas.build.production.android.buildType = "apk";
  assert.throws(() => checkStoreConfig(f.config, f.eas, "android"), /app-bundle/);
});

test("custom Gradle/archive paths cannot bypass the AAB profile", () => {
  for (const key of ["gradleCommand", "applicationArchivePath"]) {
    const f = fixture(); f.eas.build.production.android[key] = "override";
    assert.throws(() => checkStoreConfig(f.config, f.eas, "android"), /app-bundle/);
  }
});

test("TestFlight rejects simulator and debug configuration", () => {
  for (const change of [{ simulator: true }, { buildConfiguration: "Debug" }]) {
    const f = fixture(); f.eas.build.production.ios = change;
    assert.throws(() => checkStoreConfig(f.config, f.eas, "ios"), /release device/);
  }
});

test("cross-channel/environment store builds are rejected", () => {
  for (const key of ["channel", "environment"]) {
    const f = fixture(); f.eas.build.production[key] = "preview";
    assert.throws(() => checkStoreConfig(f.config, f.eas, "android"), /production channel/);
  }
});

test("remote numbering and automatic changes to sealed versions are rejected", () => {
  for (const change of [f => { f.eas.cli.appVersionSource = "remote"; },
    f => { f.eas.build.production.autoIncrement = true; }]) {
    const f = fixture(); change(f);
    assert.throws(() => checkStoreConfig(f.config, f.eas, "android"), /release numbers/);
  }
  for (const platform of ["android", "ios"]) {
    const f = fixture(); f.eas.build.production[platform] = { ...f.eas.build.production[platform], autoIncrement: true };
    assert.throws(() => checkStoreConfig(f.config, f.eas, platform), /Platform overrides/);
  }
});

test("malformed release and non-positive or unsafe build numbers are rejected", () => {
  const badVersion = fixture(); badVersion.config.version = "draft";
  assert.throws(() => checkStoreConfig(badVersion.config, badVersion.eas, "android"), /version/);
  for (const platform of ["android", "ios"]) {
    for (const value of [undefined, 0, -1, "1.5", "1e2", "9007199254740993"]) {
      const f = fixture(); f.config[platform][platform === "android" ? "versionCode" : "buildNumber"] = value;
      assert.throws(() => checkStoreConfig(f.config, f.eas, platform), /build number/);
    }
  }
});
