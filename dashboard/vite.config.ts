import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// `@clayver/core` is resolved from its TypeScript sources so the dashboard
// builds and hot-reloads without building the core package first.
const coreSrc = fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url));

// @firebase/database does not declare @firebase/app as a dependency, so in a
// pnpm workspace it can resolve to a different hoisted copy of @firebase/app
// than the `firebase` package uses (two app registries, and getDatabase()
// throws "Service database is not available"). Pin every import of
// @firebase/app to the copy that belongs to the dashboard's `firebase`.
const require = createRequire(import.meta.url);
const firebaseDir = dirname(require.resolve("firebase/package.json"));
const firebaseAppDir = dirname(
  createRequire(`${firebaseDir}/package.json`).resolve("@firebase/app/package.json"),
);

/**
 * Writes dist/build-info.json. `embeddedConfig` is true when VITE_* values
 * were inlined into this build; the `clayver` CLI refuses to bundle such a
 * build, because the dashboard it ships must load its configuration at
 * runtime (clayver.config.json) and must not carry anyone's project config.
 */
function buildInfo(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const embedded = Object.entries(env)
    .filter(([k, v]) => /^VITE_(FIREBASE|CLAYVER)_/.test(k) && v.trim() !== "")
    .map(([k]) => k)
    .sort();
  return {
    name: "clayver-build-info",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "build-info.json",
        source: `${JSON.stringify({ embeddedConfig: embedded.length > 0, embeddedVariables: embedded }, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), buildInfo(mode)],
  resolve: {
    alias: { "@clayver/core": coreSrc, "@firebase/app": firebaseAppDir },
    dedupe: ["firebase", "react", "react-dom"],
  },
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: [
            "firebase/app",
            "firebase/auth",
            "firebase/database",
            "firebase/storage",
            "firebase/functions",
            "firebase/app-check",
          ],
          react: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
}));
