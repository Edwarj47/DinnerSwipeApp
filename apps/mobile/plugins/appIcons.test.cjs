const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { PNG } = require("pngjs");
const { configureAndroidManifest, configureAppleProject, androidAssets, appleAssets } = require("./withAppIcons");
const palette = require("../services/appearancePresets.json");
const presets = ["red", "blue", "green", "teal", "purple", "orange"];
const root = path.resolve(__dirname, "..");
test("local native module source ships with its autolinking configuration", async () => {
  for (const file of ["android/build.gradle", "android/src/main/AndroidManifest.xml", "android/src/main/java/expo/modules/dinnerswipe/icons/DinnerSwipeAppIconsModule.kt", "ios/DinnerSwipeAppIcons.podspec", "ios/DinnerSwipeAppIconsModule.swift"]) {
    assert.ok((await fs.stat(path.join(root, "modules/app-icons", file))).isFile(), file);
  }
});
function manifest() {
  return { manifest: { application: [{ $: { "android:allowBackup": "false" }, activity: [{ $: { "android:name": ".MainActivity", "android:exported": "true" }, "intent-filter": [
    { action: [{ $: { "android:name": "android.intent.action.MAIN" } }], category: [{ $: { "android:name": "android.intent.category.LAUNCHER" } }] },
    { action: [{ $: { "android:name": "android.intent.action.VIEW" } }], data: [{ $: { "android:scheme": "dinnerswipe" } }] }
  ] }], "activity-alias": [{ $: { "android:name": "dev.example.UnrelatedAlias" } }] }] } };
}
test("launcher registration is idempotent, preserves deep links and enables exactly one default", () => {
  const input = manifest(), result = configureAndroidManifest(input, "dev.example");
  configureAndroidManifest(result, "dev.example");
  const app = result.manifest.application[0];
  assert.equal(app["activity-alias"].length, 7);
  const ours = app["activity-alias"].filter(entry => entry.$["android:targetActivity"]);
  assert.equal(ours.length, 6);
  assert.equal(ours.filter(entry => entry.$["android:enabled"] === "true").length, 1);
  assert.equal(ours.find(entry => entry.$["android:enabled"] === "true").$["android:name"], "dev.example.DSIconRed");
  assert.deepEqual(app.activity[0]["intent-filter"], [{ action: [{ $: { "android:name": "android.intent.action.VIEW" } }], data: [{ $: { "android:scheme": "dinnerswipe" } }] }]);
  assert.equal(app.$["android:allowBackup"], "false");
  assert.equal(app.activity[0].$["android:exported"], "true");
});
test("missing launch target aborts without changing the manifest", () => {
  const input = manifest(); input.manifest.application[0].activity[0].$["android:name"] = ".Other";
  const before = structuredClone(input);
  assert.throws(() => configureAndroidManifest(input, "dev.example"), /MainActivity not found/);
  assert.deepEqual(input, before);
});
test("iPhone alternate icons are registered idempotently only on the app target", () => {
  const configurations = {
    DEBUG: { isa: "XCBuildConfiguration", buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: "dev.example" } },
    RELEASE: { isa: "XCBuildConfiguration", buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: "dev.example" } },
    UNRELATED: { isa: "XCBuildConfiguration", buildSettings: { TEST_HOST: "keep-me" } }
  };
  const project = {
    getTarget: () => ({ target: { name: "DinnerSwipe", buildConfigurationList: "LIST" } }),
    pbxXCConfigurationList: () => ({ LIST: { buildConfigurations: [{ value: "DEBUG" }, { value: "RELEASE" }] } }),
    pbxXCBuildConfigurationSection: () => configurations
  };
  configureAppleProject(project, "DinnerSwipe"); configureAppleProject(project, "DinnerSwipe");
  for (const key of ["DEBUG", "RELEASE"]) {
    assert.deepEqual(configurations[key].buildSettings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES, ["DSIconBlue", "DSIconGreen", "DSIconTeal", "DSIconPurple", "DSIconOrange"]);
    assert.equal(configurations[key].buildSettings.ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS, "YES");
    assert.equal(configurations[key].buildSettings.PRODUCT_BUNDLE_IDENTIFIER, "dev.example");
  }
  assert.deepEqual(configurations.UNRELATED.buildSettings, { TEST_HOST: "keep-me" });
});
test("all native assets exist with correct densities, RGB PNGs and matching adaptive backgrounds", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dinner-icon-assets-"));
  await androidAssets(root, path.join(temp, "android"));
  await appleAssets(root, path.join(temp, "ios"), "DinnerSwipe");
  for (const preset of presets) {
    for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
      const png = PNG.sync.read(await fs.readFile(path.join(temp, `android/app/src/main/res/mipmap-${density}/ds_icon_${preset}.png`)));
      assert.equal(png.width, size); assert.equal(png.height, size);
      assert.deepEqual([...png.data.slice(0, 3)], [1, 3, 5].map(index => parseInt(palette[preset].color.slice(index, index + 2), 16)));
    }
    const adaptive = await fs.readFile(path.join(temp, `android/app/src/main/res/mipmap-anydpi-v26/ds_icon_${preset}.xml`), "utf8");
    assert.match(adaptive, new RegExp(`@color/ds_icon_${preset}_background`));
    if (preset !== "red") {
      const name = "DSIcon" + preset[0].toUpperCase() + preset.slice(1);
      const directory = path.join(temp, `ios/DinnerSwipe/Images.xcassets/${name}.appiconset`);
      const png = PNG.sync.read(await fs.readFile(path.join(directory, "icon.png")));
      assert.equal(png.width, 1024); assert.equal(png.colorType, 2);
      assert.equal(JSON.parse(await fs.readFile(path.join(directory, "Contents.json"), "utf8")).images[0].filename, "icon.png");
    }
  }
  console.log("Isolated generated native asset evidence:", temp);
});
