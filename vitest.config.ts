import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/webview-ui.dom.test.ts",
      "test/acp-integration.test.ts",
      "test/acp.test.ts",
      "test/chips.test.ts",
      "test/cli-locator.test.ts",
      "test/sidebar-provider-auth.test.ts",
      "test/plan-review.test.ts",
    ],
    environment: "node",
  },
});
