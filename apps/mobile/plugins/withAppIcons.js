const fs = require("node:fs/promises");
const path = require("node:path");
const { withAndroidManifest, withDangerousMod, withXcodeProject, IOSConfig } = require("expo/config-plugins");
const { generateImageAsync } = require("@expo/image-utils");
const palette = require("../services/appearancePresets.json");
const presets = Object.keys(palette);
const defaultAccent = "black";
const name = accent => "DSIcon" + accent[0].toUpperCase() + accent.slice(1);
// Keep the installed default component stable when Android retains per-alias overrides.
const androidName = accent => accent === "black" ? "DSIconRed" : accent === "red" ? "DSIconRedSelected" : name(accent);
const source = (root, accent) => path.join(root, accent === "red" ? "assets/icon.png" : `assets/appearance/${accent}.png`);

function configureAndroidManifest(manifest, packageName) {
  const application = manifest.manifest.application[0];
  const activity = application.activity.find(entry => [".MainActivity", packageName + ".MainActivity"].includes(entry.$["android:name"]));
  if (!activity) throw new Error("MainActivity not found; refusing to change launcher entries.");
  const launcher = filter => filter.action?.some(entry => entry.$["android:name"] === "android.intent.action.MAIN")
    && filter.category?.some(entry => entry.$["android:name"] === "android.intent.category.LAUNCHER");
  activity["intent-filter"] = (activity["intent-filter"] || []).filter(filter => !launcher(filter));
  const ownNames = new Set(presets.map(accent => packageName + "." + androidName(accent)));
  const existing = (application["activity-alias"] || []).filter(entry => !ownNames.has(entry.$["android:name"]));
  application["activity-alias"] = [...existing, ...presets.map(accent => ({
    $: { "android:name": packageName + "." + androidName(accent), "android:targetActivity": activity.$["android:name"],
      "android:enabled": accent === defaultAccent ? "true" : "false", "android:exported": "true",
      "android:icon": `@mipmap/ds_icon_${accent}`, "android:label": "@string/app_name" },
    "intent-filter": [{ action: [{ $: { "android:name": "android.intent.action.MAIN" } }], category: [{ $: { "android:name": "android.intent.category.LAUNCHER" } }] }]
  }))];
  return manifest;
}

async function androidAssets(root, nativeRoot) {
  const resource = path.join(nativeRoot, "app/src/main/res");
  const values = path.join(resource, "values"); await fs.mkdir(values, { recursive: true });
  await fs.writeFile(path.join(values, "ds_icon_colors.xml"), `<resources>${presets.map(accent => `<color name="ds_icon_${accent}_background">${palette[accent].color}</color>`).join("")}</resources>\n`);
  for (const accent of presets) {
    for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
      const directory = path.join(resource, "mipmap-" + density); await fs.mkdir(directory, { recursive: true });
      const image = await generateImageAsync({ projectRoot: root, cacheType: "ds-icons" }, { src: source(root, accent), width: size, height: size, resizeMode: "contain", name: `ds-${accent}-${size}.png` });
      await fs.writeFile(path.join(directory, `ds_icon_${accent}.png`), image.source);
    }
    const drawables = path.join(resource, "drawable-nodpi"); await fs.mkdir(drawables, { recursive: true });
    await fs.copyFile(source(root, accent), path.join(drawables, `ds_icon_${accent}.png`));
    const adaptive = path.join(resource, "mipmap-anydpi-v26"); await fs.mkdir(adaptive, { recursive: true });
    await fs.writeFile(path.join(adaptive, `ds_icon_${accent}.xml`), `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ds_icon_${accent}_background"/><foreground android:drawable="@drawable/ds_icon_${accent}"/></adaptive-icon>\n`);
  }
}

async function appleAssets(root, nativeRoot, projectName) {
  for (const accent of presets.filter(value => value !== defaultAccent)) {
    const directory = path.join(nativeRoot, projectName, "Images.xcassets", name(accent) + ".appiconset");
    await fs.mkdir(directory, { recursive: true });
    const image = await generateImageAsync({ projectRoot: root, cacheType: "ds-apple-icons" }, {
      src: source(root, accent), width: 1024, height: 1024, resizeMode: "contain",
      backgroundColor: palette[accent].color, removeTransparency: true, name: `ds-${accent}-apple.png`
    });
    await fs.writeFile(path.join(directory, "icon.png"), image.source);
    await fs.writeFile(path.join(directory, "Contents.json"), JSON.stringify({ images: [{ filename: "icon.png", idiom: "universal", platform: "ios", size: "1024x1024" }], info: { version: 1, author: "xcode" } }, null, 2));
  }
}

function configureAppleProject(project, projectName) {
  const { target } = IOSConfig.XcodeUtils.getApplicationNativeTarget({ project, projectName });
  const configurations = IOSConfig.XcodeUtils.getBuildConfigurationsForListId(project, target.buildConfigurationList);
  for (const [, configuration] of configurations) {
    configuration.buildSettings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = presets.filter(accent => accent !== defaultAccent).map(name);
    configuration.buildSettings.ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS = "YES";
  }
  return project;
}

module.exports = function withAppIcons(config) {
  config = withAndroidManifest(config, entry => {
    entry.modResults = configureAndroidManifest(entry.modResults, entry.android.package);
    return entry;
  });
  config = withDangerousMod(config, ["android", async entry => { await androidAssets(entry.modRequest.projectRoot, entry.modRequest.platformProjectRoot); return entry; }]);
  config = withDangerousMod(config, ["ios", async entry => { await appleAssets(entry.modRequest.projectRoot, entry.modRequest.platformProjectRoot, IOSConfig.XcodeUtils.getProjectName(entry.modRequest.projectRoot)); return entry; }]);
  return withXcodeProject(config, entry => {
    entry.modResults = configureAppleProject(entry.modResults, IOSConfig.XcodeUtils.getProjectName(entry.modRequest.projectRoot));
    return entry;
  });
};
module.exports.configureAndroidManifest = configureAndroidManifest;
module.exports.configureAppleProject = configureAppleProject;
module.exports.androidAssets = androidAssets;
module.exports.appleAssets = appleAssets;
