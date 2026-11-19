const fs = require("node:fs");
const path = require("node:path");
const { verify } = require("./check-ota-runtime.cjs");

function checkStoreConfig(config, eas, platform) {
  if (!["android", "ios"].includes(platform)) throw new Error("Choose android or ios.");
  const profile = eas.build?.production;
  if (!profile || profile.extends || profile.developmentClient === true
      || ![undefined, "store"].includes(profile.distribution)) {
    throw new Error("Production must be a standalone store build, not internal distribution.");
  }
  if (profile.channel !== "production" || profile.environment !== "production") {
    throw new Error("Store builds require the production channel and environment.");
  }
  if (eas.cli?.appVersionSource !== "local" || profile.autoIncrement !== false) {
    throw new Error("Keep release numbers reviewed and sealed in source control.");
  }
  if (![undefined, false].includes(profile[platform]?.autoIncrement)) {
    throw new Error("Platform overrides must not change sealed release numbers.");
  }
  if (!/^\d+\.\d+\.\d+$/.test(config.version)) throw new Error("Invalid release version.");
  const identity = platform === "android" ? config.android?.package : config.ios?.bundleIdentifier;
  if (identity !== "dev.dcss.dinnerswipe") throw new Error("Do not change the installed app identity.");
  const build = platform === "android" ? config.android?.versionCode : config.ios?.buildNumber;
  if (!/^[1-9]\d*$/.test(String(build)) || !Number.isSafeInteger(Number(build))) {
    throw new Error("A positive, source-controlled build number is required.");
  }
  if (platform === "android" && (profile.android?.buildType !== "app-bundle"
      || profile.android?.gradleCommand || profile.android?.applicationArchivePath)) {
    throw new Error("Google Play requires the default signed app-bundle build path.");
  }
  if (platform === "ios" && (profile.ios?.simulator === true
      || profile.ios?.buildConfiguration && profile.ios.buildConfiguration !== "Release")) {
    throw new Error("TestFlight requires a release device archive, not a simulator build.");
  }
  return { platform, identity, version: config.version, build: String(build),
    artifact: platform === "android" ? "aab" : "ipa", channel: profile.channel };
}

function preflight(root, platform) {
  verify(root);
  const config = JSON.parse(fs.readFileSync(path.join(root, "apps/mobile/app.json"))).expo;
  const eas = JSON.parse(fs.readFileSync(path.join(root, "apps/mobile/eas.json")));
  return checkStoreConfig(config, eas, platform);
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: node store-build-preflight.cjs android|ios");
    const result = preflight(path.resolve(__dirname, "../.."), process.argv[2]);
    console.log(`${result.platform}: ${result.identity} ${result.version} (${result.build}), .${result.artifact}, ${result.channel}.`);
    console.log("Configuration verified only; signing, store processing and device acceptance remain separate checks.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { checkStoreConfig, preflight };
