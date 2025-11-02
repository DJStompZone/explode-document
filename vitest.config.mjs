/** @type {import('vitest').UserConfig} */
export default {
  test: {
    environment: "node",
    include: ["test/unit/**/*.test.ts"],
    reporters: ["default"],
    passWithNoTests: false
  }
};
