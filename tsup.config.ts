import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.tsx", "src/analyzer/sdk-worker.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  external: ["react", "ink", "ink-spinner"],
  noExternal: [],
  splitting: false,
  sourcemap: false,
  dts: false,
});
