module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  moduleNameMapper: { "^decode-uri-component$": "<rootDir>/../../packages/uri-decoder/index.cjs" },
  testMatch: ["**/tests/**/*.test.ts?(x)"]
};
