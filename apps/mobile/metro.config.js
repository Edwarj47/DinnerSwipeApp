const path = require("path");
const fs = require("fs");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
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

module.exports = config;
