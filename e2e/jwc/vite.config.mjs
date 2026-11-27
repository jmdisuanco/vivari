// Builds the e2e harness against the SDK source. The runtime's static files (sw.js, bridge pages, vendor/npm-pack.bin)
// come straight from packages/studio/public, where the vendor scripts write them.
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
export default {
  root: here,
  publicDir: path.join(root, "packages/studio/public"),
  resolve: { alias: { "@vivari/core": path.join(root, "packages/core/src/index.ts") } },
  build: { outDir: process.env.JWC_OUT || path.join(root, "dist-jwc-e2e"), emptyOutDir: true, target: "es2022", minify: true },
  worker: { format: "es" },
};
