// Scratch space for the build and vendor scripts, kept INSIDE the repo.
//
// Every script that installs or packs from the registry works under one gitignored
// directory, `.vv-scratch/` at the repo root (override with VV_SCRATCH_DIR), with its
// own npm cache there too. Nothing they do writes outside the repo.
//
// Why `npmInstallInto` puts a package.json in the dir: npm in a directory with no
// package.json climbs to the nearest parent that has one and installs THERE. A scratch
// dir under a home directory with a package.json therefore installed npm into
// `~/node_modules`. The committed package.json makes the scratch dir its own project
// root, and `--prefix` says the same thing explicitly.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
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

/** Throw unless `bytes` hash to `want`, a SHA-256 (hex) committed in this repo. */
export function assertSha256(bytes, want, label) {
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== want) throw new Error(`${label}: sha256 is ${got}, the committed digest is ${want}; refusing to use it`);
}

/** Committed lockfiles for every vendored install: `scripts/vendor-locks/<name>/`. */
export const VENDOR_LOCKS = path.join(ROOT, "scripts", "vendor-locks");

const NPM_FLAGS = "--prefix . --ignore-scripts --no-audit --no-fund --loglevel=error";

/** `name@1.2.3` -> ["name", "1.2.3"]; only exact versions are accepted. */
function exactDeps(specs) {
  return Object.fromEntries(
    specs.map((s) => {
      const i = s.lastIndexOf("@");
      const [name, version] = [s.slice(0, i), s.slice(i + 1)];
      if (i <= 0 || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
        throw new Error(`vendor spec ${s} is not an exact version`);
      }
      return [name, version];
    }),
  );
}

/**
 * Empty `dir` and install `specs` (exact `name@version`s) into `dir/node_modules` from
 * the committed lock `scripts/vendor-locks/<lock>/`: `npm ci --ignore-scripts`, so npm
 * checks every tarball against the lock's `integrity` and runs no install scripts.
 * Throws if the lock is missing, its package.json does not name exactly `specs`, or npm fails.
 *
 * VV_UPDATE_VENDOR_LOCKS=1 regenerates the lock first (`npm install --package-lock-only
 * --ignore-scripts` against the public registry); review and commit the result.
 */
export function npmInstallInto(dir, lock, specs, stdio = ["ignore", "ignore", "inherit"]) {
  const lockDir = path.join(VENDOR_LOCKS, lock);
  const deps = exactDeps(specs);
  const files = ["package.json", "package-lock.json"];
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (process.env.VV_UPDATE_VENDOR_LOCKS) {
    const pj = { name: `vv-vendor-${lock.toLowerCase()}`, private: true, dependencies: deps };
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pj, null, 2) + "\n");
    execSync(`npm install --package-lock-only --registry=https://registry.npmjs.org/ ${NPM_FLAGS}`, { cwd: dir, stdio, env: npmEnv() });
    fs.mkdirSync(lockDir, { recursive: true });
    for (const f of files) fs.copyFileSync(path.join(dir, f), path.join(lockDir, f));
  }
  if (!files.every((f) => fs.existsSync(path.join(lockDir, f)))) {
    throw new Error(`no committed lock in ${path.relative(ROOT, lockDir)}; create it with VV_UPDATE_VENDOR_LOCKS=1`);
  }
  const committed = JSON.parse(fs.readFileSync(path.join(lockDir, "package.json"), "utf8")).dependencies;
  if (JSON.stringify(committed) !== JSON.stringify(deps)) {
    throw new Error(`${path.relative(ROOT, lockDir)} pins ${JSON.stringify(committed)}, not ${JSON.stringify(deps)}; regenerate it with VV_UPDATE_VENDOR_LOCKS=1`);
  }
  for (const f of files) fs.copyFileSync(path.join(lockDir, f), path.join(dir, f));
  execSync(`npm ci ${NPM_FLAGS}`, { cwd: dir, stdio, env: npmEnv() });
}
