const nextJest = require("next/jest");

const createJestConfig = nextJest({ dir: "./" });

/** @type {import("jest").Config} */
const customJestConfig = {
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  testPathIgnorePatterns: ["<rootDir>/.next/", "<rootDir>/epiphany-v2-prototype/"],
  modulePathIgnorePatterns: ["<rootDir>/.next/", "<rootDir>/epiphany-v2-prototype/"],
};

module.exports = createJestConfig(customJestConfig);
