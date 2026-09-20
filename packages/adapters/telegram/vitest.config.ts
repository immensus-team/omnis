import { defineConfig } from "vitest/config";
import { omnisAlias } from "../../../vitest.shared.js";

export default defineConfig({
  resolve: { alias: omnisAlias },
  test: { environment: "node" },
});
