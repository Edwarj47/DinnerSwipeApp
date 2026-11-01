const expo = require("eslint-config-expo/flat");
const globals = require("globals");

module.exports = [
  ...expo,
  { ignores: ["dist/**", "node_modules/**", ".expo/**"] },
  { files: ["**/*.test.*", "jest.setup.js"], languageOptions: { globals: globals.jest } },
  { files: ["*.config.js", "**/*.cjs", "plugins/**/*.js"], languageOptions: { globals: globals.node } },
  { rules: {
    // Preserve non-compiler behavior during the native upgrade; retain optimization diagnostics.
    "react-hooks/refs": "warn",
    "react-hooks/set-state-in-effect": "warn",
    "react-hooks/purity": "warn",
    "react/no-unescaped-entities": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "import/no-unresolved": "off",
    "import/namespace": "off"
  } }
];
