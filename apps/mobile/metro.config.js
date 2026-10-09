const path = require("path");
const fs = require("fs");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

function resolveWorkspaceNodeModule(moduleName) {
  if (typeof moduleName !== "string") return null;
  const normalized = moduleName.replace(/^\.\//, "");
  if (!normalized.startsWith("node_modules/")) return null;

  try {
    return require.resolve(path.resolve(workspaceRoot, normalized));
  } catch {
    return null;
  }
}

config.watchFolders = [workspaceRoot];
// Private release snapshots are not app sources and may be readable only by root.
const upstreamBlockList = config.resolver.blockList;
const backupPath = path.resolve(workspaceRoot, "backups").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
config.resolver.blockList = [
  ...(Array.isArray(upstreamBlockList) ? upstreamBlockList : upstreamBlockList ? [upstreamBlockList] : []),
  new RegExp(`^${backupPath}(?:[/\\\\]|$)`)
];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules")
];
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = new Proxy(
  {},
  {
    get: (_target, moduleName) => {
      if (typeof moduleName !== "string") {
        return undefined;
      }

      const appModulePath = path.resolve(projectRoot, "node_modules", moduleName);
      return fs.existsSync(appModulePath)
        ? appModulePath
        : path.resolve(workspaceRoot, "node_modules", moduleName);
    }
  }
);

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "decode-uri-component") {
    return { type: "sourceFile", filePath: path.resolve(workspaceRoot, "packages/uri-decoder/index.cjs") };
  }
  const workspaceNodeModule = resolveWorkspaceNodeModule(moduleName);
  if (workspaceNodeModule) {
    return { type: "sourceFile", filePath: workspaceNodeModule };
  }

  if (upstreamResolveRequest) {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
