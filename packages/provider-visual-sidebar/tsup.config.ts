import { defineConfig } from "tsup";

const isDev = process.env.NODE_ENV !== "production";

export default defineConfig({
  entry: {
    client: "src/client.ts",
  },
  format: ["esm", "cjs", "iife"],
  globalName: "ReactGrabVisualSidebar",
  dts: true,
  clean: true,
  minify: !isDev,
  sourcemap: isDev,
  esbuildOptions(options) {
    options.jsx = "preserve";
    options.jsxImportSource = "solid-js";
  },
  external: ["solid-js", "solid-js/web"],
  noExternal: ["react-grab"],
});
