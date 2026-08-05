const { withAppBuildGradle } = require("expo/config-plugins");

const SNIPPET = `// Dinner Swipe monorepo native module resolution.
def dinnerSwipeReactNativeDir = file("../../../../node_modules/react-native")
project.ext.REACT_NATIVE_NODE_MODULES_DIR = dinnerSwipeReactNativeDir
rootProject.ext.REACT_NATIVE_NODE_MODULES_DIR = dinnerSwipeReactNativeDir
`;

function addMonorepoGradlePaths(contents) {
  if (contents.includes("dinnerSwipeReactNativeDir")) {
    return contents;
  }

  const androidBlock = "\nandroid {";
  if (contents.includes(androidBlock)) {
    return contents.replace(androidBlock, `\n${SNIPPET}${androidBlock}`);
  }

  return `${SNIPPET}\n${contents}`;
}

module.exports = function withAndroidMonorepoGradlePaths(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === "groovy") {
      config.modResults.contents = addMonorepoGradlePaths(config.modResults.contents);
    }
    return config;
  });
};
