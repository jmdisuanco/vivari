// Registry mirror: where the VM's package downloads actually go (jmwebcontainer).
//
// Guest tools (npm, pnpm, yarn, Next's SWC loader …) keep the stock public registry
// URLs, so lockfiles and `.npmrc` stay portable. On the wire, every request to a
// public registry is sent to ONE mirror instead, by default the same-origin path
// `/_npm/`, so a page served with `connect-src 'self'` installs packages without
// contacting a third-party host. BootOptions.registryMirror sets it; `false` sends
// requests straight to the public registry (upstream Vivari behaviour).
//
// One instance per Worker: the Fetcher Worker (http/https egress) and each Process
// Worker (the guest's global fetch) set it from their init message. Headless (no
// `location`) it stays off.

export const DEFAULT_REGISTRY_MIRROR = "/_npm/";

// Same package namespace as the npm registry, so one mirror of registry.npmjs.org
// answers for both. Any other registry is left alone (and a strict CSP blocks it).
export const PUBLIC_REGISTRIES = ["https://registry.npmjs.org/", "https://registry.yarnpkg.com/"];

let mirror = null;

/**
 * Resolve and remember the mirror base. `value`: a URL or path (relative to `base`,
 * normally the worker's own location), `undefined` for the default, `false`/`""` off.
 * Returns the absolute base (always ending in `/`) or null.
 */
export function setRegistryMirror(value, base) {
  mirror = null;
  if (value === false || value === "" || value === null) return null;
  try {
    const u = new URL(value === undefined ? DEFAULT_REGISTRY_MIRROR : String(value), base);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.search = "";
    u.hash = "";
    mirror = u.href.endsWith("/") ? u.href : u.href + "/";
  } catch {
    mirror = null; // no base (headless) or a malformed value: leave requests untouched
  }
  return mirror;
}

export const registryMirror = () => mirror;

/** `url` with a public-registry prefix replaced by the mirror; anything else unchanged. */
export function toRegistryMirror(url) {
  if (!mirror || typeof url !== "string") return url;
  for (const registry of PUBLIC_REGISTRIES) {
    if (url.startsWith(registry)) return mirror + url.slice(registry.length);
  }
  return url;
}
