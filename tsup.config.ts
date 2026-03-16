import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    target: "node18",
    outDir: "dist",
    clean: true,
    banner: {
      js: "#!/usr/bin/env node",
    },
    splitting: false,
    sourcemap: false,
    dts: false,
  },
  {
    entry: ["src/analyzer/sdk-worker.ts"],
    format: ["esm"],
    target: "node18",
    outDir: "dist/analyzer",
    clean: false,
    splitting: false,
    sourcemap: false,
    dts: false,
  },
]);
