// Probe (offline, Wasm-free): where package downloads go (runtime/registry-mirror.js).
//
// Public-registry URLs must be sent to the mirror (same-origin `/_npm/` by default),
// everything else must be left alone, and `false` must restore direct access.
//
// Run: npm run probe:registry-mirror

import { setRegistryMirror, toRegistryMirror } from "../packages/runtime/registry-mirror.js";

let failed = 0;
const check = (name, actual, expected) => {
  if (actual === expected) console.log(`  ok    ${name}`);
  else (failed++, console.log(`  FAIL  ${name}\n          expected ${expected}\n          actual   ${actual}`));
};
const PAGE = "https://vm-abc.example.dev/index.html";

check("default is same-origin /_npm/", setRegistryMirror(undefined, PAGE), "https://vm-abc.example.dev/_npm/");
check("packument", toRegistryMirror("https://registry.npmjs.org/react"), "https://vm-abc.example.dev/_npm/react");
check("scoped packument", toRegistryMirror("https://registry.npmjs.org/@types%2fnode"), "https://vm-abc.example.dev/_npm/@types%2fnode");
check("tarball", toRegistryMirror("https://registry.npmjs.org/react/-/react-19.0.0.tgz"), "https://vm-abc.example.dev/_npm/react/-/react-19.0.0.tgz");
check("yarn registry", toRegistryMirror("https://registry.yarnpkg.com/react"), "https://vm-abc.example.dev/_npm/react");
check("other host untouched", toRegistryMirror("https://example.com/registry.npmjs.org/x"), "https://example.com/registry.npmjs.org/x");
check("look-alike host untouched", toRegistryMirror("https://registry.npmjs.org.evil.dev/x"), "https://registry.npmjs.org.evil.dev/x");
check("other registry untouched", toRegistryMirror("https://registry.npmmirror.com/react"), "https://registry.npmmirror.com/react");
check("relative path resolves on the page origin", setRegistryMirror("/mirror", PAGE), "https://vm-abc.example.dev/mirror/");
check("absolute mirror", setRegistryMirror("https://npm.example.dev/r/?q=1#x", PAGE), "https://npm.example.dev/r/");
check("false = direct", setRegistryMirror(false, PAGE), null);
check("direct leaves the registry URL", toRegistryMirror("https://registry.npmjs.org/react"), "https://registry.npmjs.org/react");
check("headless (no base) = off", setRegistryMirror(undefined, undefined), null);
check("non-http scheme refused", setRegistryMirror("javascript:alert(1)", PAGE), null);

console.log(failed ? `\n${failed} FAILED` : "\nall registry-mirror checks passed");
process.exit(failed ? 1 : 0);
