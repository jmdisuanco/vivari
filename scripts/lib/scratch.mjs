// Scratch space for the build and vendor scripts, kept INSIDE the repo.
//
// Every script that installs or packs from the registry works under one gitignored
// directory, `.vv-scratch/` at the repo root (override with VV_SCRATCH_DIR), with its
// own npm cache there too. Nothing they do writes outside the repo.
//
// Why `npmInstallInto` writes a package.json first: `npm install <pkg>` in a directory
// with no package.json climbs to the nearest parent that has one and installs THERE.
// A scratch dir under a home directory with a package.json therefore installed npm into
// `~/node_modules`. A stub package.json makes the scratch dir its own project root, and
// `--prefix` says the same thing explicitly.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

export const SCRATCH_ROOT = path.resolve(process.env.VV_SCRATCH_DIR || path.join(ROOT, ".vv-scratch"));

/** A path under the scratch root. */
export const scratchPath = (...parts) => path.join(SCRATCH_ROOT, ...parts);

/** A fresh, unique temp directory under the scratch root (stands in for os.tmpdir()). */
export function scratchTemp(prefix) {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(SCRATCH_ROOT, prefix));
}

/** The npm cache every script shares, inside the scratch root. */
export const NPM_CACHE = process.env.VV_NPM_CACHE || scratchPath("npm-cache");

/** Environment for a host `npm` run: cache inside the scratch root, no update check. */
export const npmEnv = (env = process.env) => ({
  ...env,
  npm_config_cache: NPM_CACHE,
  npm_config_update_notifier: "false",
});

/**
 * Empty `dir`, make it its own npm project, and `npm install` the given specs into
 * `dir/node_modules`. Throws if npm fails.
 */
export function npmInstallInto(dir, specs, stdio = ["ignore", "ignore", "inherit"]) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "vv-scratch", private: true }) + "\n");
  // Specs are quoted for the shell (`^` is an escape character in cmd.exe); `--prefix .` is `dir`.
  const args = specs.map((a) => JSON.stringify(a)).join(" ");
  execSync(`npm install ${args} --prefix . --no-save --no-audit --no-fund --loglevel=error`, { cwd: dir, stdio, env: npmEnv() });
}
