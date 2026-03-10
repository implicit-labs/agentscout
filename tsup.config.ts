import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.tsx"],
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
