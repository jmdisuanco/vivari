# jmwebcontainer (JWC) notes for this fork

This fork of [Vivari](https://github.com/maitrungduc1410/vivari) (MIT) is the runtime of **jmwebcontainer**, jmart-code's
in-browser Node runtime. Our own layers (client API, host page, project normaliser) live in a separate repo; this
fork carries only small patches, each one offered upstream.

## Upstream base

| | |
|---|---|
| Upstream | `maitrungduc1410/vivari` |
| Forked from | tag `v1.3.5`, commit `1c0de764c94503e9022cc8cfd60126cb66480149` (2026-11-20) |
| Our branch | `jwc1` (JWC1 patches below); pin consumers to an exact commit, never to the branch |

## Patches on `jwc1`

1. **Build scripts stay inside the repo** (`scripts/lib/scratch.mjs`). Every vendor and generator script works under
   `.vv-scratch/` (gitignored; `VV_SCRATCH_DIR` moves it), and every host `npm` it runs (`install`, `ci`, `pack`,
   `run`) gets `npmEnv()`, which puts npm's cache and logs in `.vv-scratch/npm-cache` instead of `~/.npm`. Each scratch
   install dir gets its own `package.json` and `--prefix .`: without it, npm in an empty directory climbs to the
   nearest parent `package.json` and installs there (during the spike it installed npm into the home directory's
   `node_modules`). Covers `vendor-{npm,yarn,pnpm,corepack,tsgo,pyodide,ruff,llhttp,sqlite}.mjs`, `gen-depcache.mjs`,
   `gen-template-locks.mjs`, `version-packages.mjs`, `lib/npm-target-platform.mjs` and `run-spikes.mjs`. Probes and
   spikes that only use a temp dir and clean it up are unchanged. `scripts/cloudflare-build*.sh` (upstream's
   Cloudflare Pages builds) install Rust, wasm-pack and Bun into `$HOME` and run `npm ci` / `bun install` with
   lifecycle scripts on, so they refuse to run unless `CI` or `CF_PAGES` is set (`scripts/lib/ci-only.sh`); build
   locally with the steps under Build below.
2. **Vendored downloads are locked and checked.** `npmInstallInto(dir, lock, specs)` installs only from a committed
   lock, `scripts/vendor-locks/<lock>/{package.json,package-lock.json}`, with `npm ci --ignore-scripts`: npm checks
   every tarball against the lock's `integrity` (sha512) and runs no install scripts. Specs must be exact versions
   and must equal the committed `package.json`, or it throws. Locks: `npm`, `yarn`, `pnpm`, `corepack`, `tsgo`,
   `pyodide`, `ruff` (vendor scripts) and `wsdemo`, `nbview` (run-spikes; their `^` ranges were pinned to what they
   resolved to on 2026-11-27). Regenerate after a version bump with `VV_UPDATE_VENDOR_LOCKS=1` (runs `npm install
   --package-lock-only --ignore-scripts` against registry.npmjs.org) and review the diff. Two locked packages have
   install scripts that `--ignore-scripts` skips, neither needed here: `yarn`'s `preinstall` (removes a Corepack
   shim on a global install) and `esbuild`'s `postinstall` (checks the platform binary, which npm installs as an
   optional dependency anyway; `transformSync` works without it). Downloads outside npm are checked against SHA-256
   digests committed in the scripts and fail closed: `vendor-llhttp.mjs` (undici tarball), `vendor-sqlite.mjs
   --refresh` (sqlite-wasm tarball), `vendor-pyodide.mjs` (each PyPI wheel's digest in `PYPI_PACKAGES`; each CDN
   wheel against the `sha256` in `pyodide-lock.json`, which comes from the locked pyodide package). The digests were
   computed on 2026-11-27 by downloading once; the two tarballs' sha512 matched the registry's `dist.integrity` and
   the wheels' digests matched PyPI's JSON API.
3. **Registry mirror, same-origin by default** (`packages/runtime/registry-mirror.js`, `BootOptions.registryMirror`).
   Requests to `https://registry.npmjs.org/` and `https://registry.yarnpkg.com/` go to `/_npm/` on the page's own
   origin, on both paths out of the VM: the Fetcher Worker (`http`/`https`, which npm uses) and the guest's global
   `fetch` (which Next.js uses for its wasm SWC). Guest tools keep the stock registry URL, so lockfiles and `.npmrc`
   stay portable. `registryMirror: "<url or path>"` points elsewhere; `false` restores upstream behaviour (direct).
   Probe: `npm run probe:registry-mirror` (offline, in CI).
4. **Pinned dependencies.** Direct dependencies of the root, `packages/core`, `packages/react` and `examples/basic`
   are exact versions (from the lockfile), `.npmrc` has `save-exact=true`, Vite is 8.3.8 (8.2.0 had four high
   advisories), the unpinned vendor installs are pinned (`tsgo-wasm@7.0.2`, `pyodide@314.0.8`), and CI installs Rust
   1.98.1 instead of `stable`. Rust crates were already pinned by each `Cargo.lock`.
5. **`NOTICE`** for everything the runtime bundle redistributes, including the modification statement for the
   patched npm (Artistic-2.0) and the node-gyp files `stubNodeGyp()` replaces in it.
6. **e2e egress test** (`e2e/jwc/`, `scripts/jwc-e2e.mjs`): a cold `npm install` and dev server in Chrome with every
   outside host refused; fails if the page, a worker or the service worker asks for any host but its own origin.

### Default external URLs

Found by grep over the shipped packages and by running with a logging proxy (spike §2; re-run for JWC1).

| URL | Used by | Now |
|---|---|---|
| `https://registry.npmjs.org/`, `https://registry.yarnpkg.com/` | npm/pnpm/yarn in the VM, Next.js SWC download | rewritten to `registryMirror` (default `/_npm/`) |
| `registry.npmmirror.com`, any other registry | only if a project names it | untouched; the runtime origin's CSP (`connect-src 'self'`) blocks it |
| `previewOrigin`, `previewWildcardDomain` | preview modes B and C | already options with no default host; set them to our domain |
| `cdn.jsdelivr.net/pyodide`, `pypi.org` | `scripts/vendor-pyodide.mjs` | build time only; Python is not shipped |
| `api.github.com`, `raw.githubusercontent.com`, `esm.sh` | studio IDE | studio is not shipped |
| telemetry, analytics | none in the code | |

## Build

Linux is the supported build and test host (upstream CI). Windows works for the steps below (used for JWC1).

Prerequisites: Node >= 22.15, Rust 1.98.1 with `wasm32-unknown-unknown`, `wasm-pack` (0.13.1 in CI).

```sh
npm ci --ignore-scripts                                     # lifecycle scripts off: nothing runs from packages
npm run build:vfs && npm run build:codec && npm run build:crypto                     # Wasm for the browser
npm run build:vfs:node && npm run build:codec:node && npm run build:crypto:node      # Wasm for headless tests
npm run vendor:npm                                          # packages/studio/public/vendor/npm-pack.bin (2.8 MB)
npm run build:core                                          # packages/core/dist: the SDK
```

Everything the scripts download lands in `.vv-scratch/` (and `node_modules/`, `packages/*/pkg*`, the vendor dir).
To prove a build stays inside the repo, give it a contained home and compare before and after:
`HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `npm_config_cache`, `npm_config_prefix`, `CARGO_HOME`
and `WASM_PACK_CACHE` pointed into a scratch directory (JWC1 did this and diffed the home `node_modules`).

## Test

```sh
npm run probe:registry-mirror     # offline, pure logic
npm run probe:egress-headers      # offline
npm run verify                    # headless Node checks (needs the :node Wasm builds)
npm run spikes:offline            # upstream's offline gate (Linux)
# e2e, needs Chrome and playwright-core (PLAYWRIGHT_CORE=<dir> if it does not resolve):
node scripts/jwc-e2e.mjs vite-plain --mirror http://127.0.0.1:18088/_npm --build
node scripts/jwc-e2e.mjs next --mirror http://127.0.0.1:18088/_npm
```

`--mirror` is the npm mirror to forward `/_npm/` to; jmart-code's `infra/npm-mirror` (nginx) runs locally with its
`local-test.sh`. Without `--mirror`, the test server forwards to registry.npmjs.org itself (server side; the browser
still sees only its own origin). Results: `.vv-scratch/jwc-e2e/jwc-e2e-<project>.json`.

## Self-hosting (jmwebcontainer)

The runtime origin is `vm-<id>.<runtime domain>` (`jmart.digital` today), never the workbench origin: it needs
`unsafe-eval` and runs user code in its Workers.

- **Files**: a host page that boots `@vivari/core` (built with Vite from `packages/core`), plus, from
  `packages/studio/public`: `sw.js`, `__vv-bridge.html`, `__vv-preview-boot.html`, `vendor/npm-pack.bin`.
- **Headers on the host page**: `Document-Isolation-Policy: isolate-and-require-corp` (Chromium, framed) or
  `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`;
  `Content-Security-Policy` with `connect-src 'self'` and `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'`;
  `Service-Worker-Allowed: /` on `sw.js`.
- **`/_npm/`** on the same origin, served by the npm mirror (jmart-code `infra/npm-mirror`: nginx, one fixed upstream).
  Keep `registryMirror` at its default.

## Upstream-sync policy

1. `jwc1` (later `jmart`) = an upstream **release tag** plus our patches, kept small (target: five or fewer). Each
   patch is offered upstream as its own PR; once merged upstream, it is dropped here.
2. Consumers pin an **exact commit**. Nothing follows upstream automatically.
3. **Monthly review** (first week): rebase the patches onto the newest upstream release tag, run upstream's gate
   (`verify`, `spikes:offline`, the probes) on Linux and our e2e (`jwc-e2e.mjs` for vite-plain and next, egress
   included); move the pin only when all are green. Record the new base commit in the table above.
4. **Security fixes at once**: watch upstream releases and advisories (GitHub "Watch: releases + security"); when
   one lands, cherry-pick the fix onto the pinned base, run the same gate, and move the pin the same day.
5. `npm audit` and the e2e run on every sync; a high advisory in shipped code blocks the pin move.
6. If upstream stalls or relicenses, stay on the last MIT commit (released MIT code stays MIT) and maintain only
   the Node path.

## JWC1 measurements (2026-11-27)

Windows 11, Ryzen 7 PRO 6850H, Chrome (headless, Playwright 1.65.1), default boot options, the jmart-code nginx
mirror (`infra/npm-mirror`, production config) in a local container, every other host refused by the proxy.
`scripts/jwc-e2e.mjs`; spike numbers (WASM_CONTAINER_SPIKE.md §0, the spike's Node mirror) for comparison.

| | Vite 8 + React 19 (plain) | Next.js 16 (`--webpack` + wasm SWC) |
|---|---|---|
| `npm install`, cold mirror | 33.0 / 37.7 s (spike 35 s) | 41.4 s (spike 36 s) |
| `npm install`, warm mirror, with CSP | 18.6 s (spike 20 s) | 32.0 s |
| dev server ready / app visible after `npm run dev` | 1.8 / 2.7 s (spike 2.1 / 2.9 s) | 14.6 / 35.3 s (spike 14.5 / 36.0 s) |
| cold total, page open to app visible | 38.8 / 44.2 s (spike 25–41 s) | 79.9 s (spike 76 s) |
| edit to visible change | 0.09 s | 0.83 s |
| browser memory after preview (sum of working sets) | 1.33 GB | 2.17 GB |
| mirror requests / bytes | 177 / 39 MB | 85 / 78 MB |
| hosts the page, its workers or its service worker asked for | own origin only | own origin only |

The positive control (a guest `fetch('https://example.com/')`) was seen by both detectors without CSP and never
reached the network with `connect-src 'self'`. Chrome's own background requests (www.google.com, gstatic,
clients2.google.com) come from the browser process, not the page, and are reported apart. Plain Next.js
(`next dev`) now downloads its wasm SWC through the mirror, then stops: Turbopack has no Wasm build, so projects
still need `next dev --webpack` (the project normaliser's job).
