// jmwebcontainer e2e: cold start of a real project in Chrome with every outside host refused.
//
//   node scripts/jwc-e2e.mjs <vite|vite-plain|next|next-plain> [--mirror <url>] [--csp] [--out <dir>] [--build]
//
// Boots the e2e harness (e2e/jwc, built into dist-jwc-e2e/; --build rebuilds it) with the fork's DEFAULT options,
// mounts a project, runs `npm install` and `npm run dev`, waits for the app in the preview iframe, edits a file and
// waits for HMR. The page is served on 127.0.0.1 with COOP/COEP; its same-origin /_npm/ is forwarded to --mirror
// (default: a plain server-side pass-through to https://registry.npmjs.org; pass the nginx mirror, e.g.
// http://127.0.0.1:18088/_npm). Chrome runs behind a logging proxy that REFUSES every non-loopback host.
//
// FAILS (exit 1) if any step fails, or if the page, its workers or the browser asked for any host other than the
// page's own origin. --csp adds the runtime origin's `connect-src 'self'` (the deployed boundary); without it, the
// test proves the patches alone keep every request same-origin.
// Timings, bytes and memory go to <out>/jwc-e2e-<project>.json.
//
// Needs Chrome and playwright-core: set PLAYWRIGHT_CORE to its directory if `playwright-core` does not resolve.
import { spawnSync, execFileSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args.splice(i, 2)[1]; };
const flag = (name) => { const i = args.indexOf(name); return i >= 0 && !!args.splice(i, 1); };
const mirror = new URL(opt("--mirror", "https://registry.npmjs.org").replace(/\/$/, ""));
const outDir = path.resolve(opt("--out", path.join(ROOT, ".vv-scratch", "jwc-e2e")));
const site = path.join(ROOT, "dist-jwc-e2e");
const csp = flag("--csp");
const build = flag("--build");
const project = args[0] || "vite-plain";
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
fs.mkdirSync(outDir, { recursive: true });

if (build || !fs.existsSync(path.join(site, "index.html"))) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "node_modules/vite/bin/vite.js"), "build", "--config", "e2e/jwc/vite.config.mjs"], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) process.exit(1);
}
if (!fs.existsSync(path.join(site, "vendor/npm-pack.bin"))) throw new Error("vendor/npm-pack.bin missing: run `npm run vendor:npm`, then --build");

// ── fixtures ────────────────────────────────────────────────────────────────
const file = (contents) => ({ file: { contents } });
const viteFiles = (plain) => ({
  "package.json": file(JSON.stringify({
    name: "jwc-vite-react", private: true, type: "module",
    scripts: { dev: "vite", build: "vite build" },
    dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
    // "plain" is what an LLM writes; the other adds the two wasm packages the fork's own template carries.
    devDependencies: { "@vitejs/plugin-react": "^5.0.0", vite: "^8.0.0", ...(plain ? {} : { "@rolldown/binding-wasm32-wasi": "~1.2.0", "@napi-rs/wasm-runtime": "1.2.5" }) },
  }, null, 2)),
  "vite.config.js": file("import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()] })\n"),
  "index.html": file('<!doctype html><html><head><meta charset="UTF-8"><title>jwc</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>\n'),
  src: { directory: {
    "main.jsx": file("import { createRoot } from 'react-dom/client'\nimport App from './App.jsx'\ncreateRoot(document.getElementById('root')).render(<App />)\n"),
    "App.jsx": file("import { useState } from 'react'\nexport default function App() {\n  const [n, setN] = useState(0)\n  return <main><h1 id=\"marker\">Hello jmwebcontainer</h1><button onClick={() => setN(n + 1)}>count {n}</button></main>\n}\n"),
  } },
});
// Next.js needs webpack (Turbopack has no Wasm build) and the wasm SWC, seeded where Next looks for it.
const SEED_SWC = "import fs from 'node:fs';import path from 'node:path';\ntry {\n  const src = path.resolve('node_modules/@next/swc-wasm-nodejs');\n  const dst = path.resolve('node_modules/next/wasm/@next/swc-wasm-nodejs');\n  if (fs.existsSync(src) && !fs.existsSync(dst)) {\n    const cp = (s, d) => { fs.mkdirSync(d, { recursive: true }); for (const e of fs.readdirSync(s, { withFileTypes: true })) { const sp = path.join(s, e.name), dp = path.join(d, e.name); if (e.isDirectory()) cp(sp, dp); else { try { fs.linkSync(sp, dp) } catch { fs.writeFileSync(dp, fs.readFileSync(sp)) } } } };\n    cp(src, dst); console.log('[seed-swc] seeded');\n  }\n} catch (e) { console.warn('[seed-swc] skipped:', e && e.message) }\n";
const nextFiles = (plain) => ({
  "package.json": file(JSON.stringify({
    name: "jwc-next", private: true,
    scripts: plain ? { dev: "next dev -p 3000" } : { dev: "next dev --webpack -p 3000", postinstall: "node scripts/seed-swc.mjs" },
    dependencies: { next: "^16.0.0", react: "^19.0.0", "react-dom": "^19.0.0", ...(plain ? {} : { "@next/swc-wasm-nodejs": "^16.0.0" }) },
  }, null, 2)),
  "next.config.mjs": file("export default {};\n"),
  scripts: { directory: { "seed-swc.mjs": file(SEED_SWC) } },
  app: { directory: {
    "layout.js": file("export const metadata = { title: 'jwc' };\nexport default function RootLayout({ children }) { return <html lang=\"en\"><body>{children}</body></html> }\n"),
    "page.js": file("export default function Home() { return <main><h1 id=\"marker\">Hello jmwebcontainer</h1></main> }\n"),
  } },
});
const P = {
  vite: { files: viteFiles(false), port: 5173, edit: "/app/src/App.jsx" },
  "vite-plain": { files: viteFiles(true), port: 5173, edit: "/app/src/App.jsx" },
  next: { files: nextFiles(false), port: 3000, edit: "/app/app/page.js" },
  "next-plain": { files: nextFiles(true), port: 3000, edit: "/app/app/page.js" },
}[project];
if (!P) throw new Error("project must be vite, vite-plain, next or next-plain");

// ── the site: static files + /_npm/ forwarded to the mirror ──────────────────
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml" };
const traffic = { static: 0, mirrorRequests: 0, mirrorBytes: 0, mirrorStatus: {} };
const forward = (req, res) => {
  const lib = mirror.protocol === "https:" ? https : http;
  // Everything but credentials goes on, as through Traefik; the nginx mirror decides what reaches the registry.
  const { host, cookie, authorization, ...headers } = req.headers;
  const up = lib.request(new URL(mirror.pathname + req.url.slice("/_npm".length), mirror), { method: req.method, headers }, (r) => {
    traffic.mirrorRequests++;
    traffic.mirrorStatus[r.statusCode] = (traffic.mirrorStatus[r.statusCode] || 0) + 1;
    r.on("data", (c) => (traffic.mirrorBytes += c.length));
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
    r.on("error", () => res.destroy());
  });
  up.on("error", () => (res.headersSent ? res.destroy() : res.writeHead(502).end()));
  res.on("error", () => up.destroy());
  req.pipe(up);
};
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/_npm/")) return forward(req, res);
  if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405).end();
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const f = path.join(site, rel);
  if (!f.startsWith(site + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return res.writeHead(404).end();
  const body = fs.readFileSync(f);
  traffic.static += body.length;
  res.writeHead(200, {
    "content-type": MIME[path.extname(f)] || "application/octet-stream",
    "cache-control": "no-store", // every run is a cold download
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "require-corp",
    "cross-origin-resource-policy": "same-origin",
    ...(rel === "/sw.js" ? { "service-worker-allowed": "/" } : {}),
    ...(csp ? { "content-security-policy": "connect-src 'self'" } : {}),
  }).end(req.method === "HEAD" ? undefined : body);
});
server.on("clientError", (_e, socket) => socket.destroy()); // a tab closing mid-response is not a test failure
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// ── a logging proxy: every non-loopback host Chrome asks for lands here, and is refused ──
const hosts = new Map();
const note = (h) => hosts.set(h, (hosts.get(h) || 0) + 1);
const proxy = http.createServer((req, res) => (note(new URL(req.url).host), res.writeHead(403).end()));
proxy.on("connect", (req, socket) => (socket.on("error", () => {}), note(req.url.replace(/:443$/, "")), socket.end("HTTP/1.1 403 Forbidden\r\n\r\n")));
proxy.on("clientError", (_e, socket) => socket.destroy());
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));

// ── the browser ─────────────────────────────────────────────────────────────
process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK = "1"; // loopback direct, everything else via the proxy
const profile = fs.mkdtempSync(path.join(outDir, "profile-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chrome", headless: true, viewport: { width: 1280, height: 800 },
  proxy: { server: `http://127.0.0.1:${proxy.address().port}` },
  // Chrome's own background traffic (component updates, hints) is not the page's: switch it off so the proxy log
  // stays a statement about the page.
  args: ["--disable-background-networking", "--disable-component-update", "--no-pings", "--disable-domain-reliability",
    "--disable-features=OptimizationHints,OptimizationGuideModelDownloading,MediaRouter,Translate,AutofillServerCommunication"],
});
const page = ctx.pages()[0] || (await ctx.newPage());
const foreign = new Set(); // requests the page, its workers or its service worker made to another origin
ctx.on("request", (r) => { const u = r.url(); if (!u.startsWith(ORIGIN) && /^(https?|wss?):/.test(u)) foreign.add(u.slice(0, 200)); });
const consoleErrors = [];
const push = (kind, text) => consoleErrors.length < 60 && consoleErrors.push(`${kind}: ${String(text).slice(0, 300)}`);
page.on("console", (m) => m.type() === "error" && push("console", m.text()));
page.on("pageerror", (e) => push("pageerror", e.message));

const memMB = () => {
  if (process.platform !== "win32") return null;
  // Sum of the working sets of this profile's Chrome processes (over-counts shared pages).
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${path.basename(profile)}*' } | Measure-Object WorkingSetSize -Sum).Sum`], { encoding: "utf8" });
    return Math.round(Number(out.trim()) / 2 ** 20);
  } catch { return null; }
};
const result = { project, mirror: mirror.href, csp, date: new Date().toISOString(), steps: {}, memoryMB: {} };
const run = async (id, cmd, argv, opts, timeoutMs) => {
  await page.evaluate(([id, cmd, argv, opts]) => window.vvStart(id, cmd, argv, opts), [id, cmd, argv, opts]);
  await page.waitForFunction((id) => window.procs[id].exit !== null, id, { timeout: timeoutMs, polling: 250 });
  return page.evaluate((id) => { const p = window.procs[id]; return { exit: p.exit, ms: Math.round(p.endedAt - p.startedAt), tail: p.out.slice(-600) }; }, id);
};

try {
  const nav0 = Date.now();
  await page.goto(ORIGIN + "/");
  result.steps.bootMs = Math.round(await page.evaluate(() => window.vvReady));
  result.isolated = await page.evaluate(() => crossOriginIsolated);
  result.memoryMB.afterBoot = memMB();
  result.steps.nodeVersion = await run("nodev", "node", ["-v"], {}, 60e3);

  await page.evaluate((files) => window.vv.mount(files, { mountPoint: "/app" }), P.files);
  result.steps.npmInstall = await run("install", "npm", ["install"], { cwd: "/app" }, 20 * 60e3);
  result.memoryMB.afterInstall = memMB();
  if (result.steps.npmInstall.exit !== 0) throw new Error("npm install failed: " + result.steps.npmInstall.tail);

  const dev0 = Date.now();
  await page.evaluate(() => window.vvStart("dev", "npm", ["run", "dev"], { cwd: "/app" }));
  await page.waitForFunction((port) => window.servers.some((s) => s.port === port) || window.procs.dev.exit !== null, P.port, { timeout: 15 * 60e3, polling: 250 });
  result.steps.serverReadyMs = Date.now() - dev0;
  if (await page.evaluate(() => window.procs.dev.exit !== null)) throw new Error("dev server exited: " + (await page.evaluate(() => window.procs.dev.out.slice(-1500))));
  await page.evaluate((port) => window.vvPreview(port), P.port);
  const frame = page.frameLocator("#preview");
  await frame.locator("#marker", { hasText: "Hello jmwebcontainer" }).waitFor({ timeout: 15 * 60e3 });
  result.steps.previewVisibleMs = Date.now() - dev0;
  result.steps.totalColdMs = Date.now() - nav0;
  result.memoryMB.afterPreview = memMB();
  await page.screenshot({ path: path.join(outDir, `jwc-e2e-${project}.png`) });

  const edit0 = Date.now();
  await page.evaluate(async (p) => { const src = await window.vv.fs.readFile(p, "utf-8"); await window.vv.fs.writeFile(p, src.replace("Hello jmwebcontainer", "Hello HMR")); }, P.edit);
  await frame.locator("#marker", { hasText: "Hello HMR" }).waitFor({ timeout: 5 * 60e3 });
  result.steps.editVisibleMs = Date.now() - edit0;

  // The guest's GLOBAL fetch (not the http/https path npm uses) must reach the mirror too.
  result.steps.globalFetch = await run("gfetch", "node", ["-e", "fetch('https://registry.npmjs.org/react/latest').then(r=>r.json()).then(j=>console.log('MIRROR', j.name, j.version)).catch(e=>console.log('FAILED', e.message))"], {}, 60e3);
  result.ok = result.steps.globalFetch.tail.includes("MIRROR react");
  if (!result.ok) throw new Error("global fetch did not reach the mirror: " + result.steps.globalFetch.tail);

  // Positive control, after the egress snapshot: a guest fetch to an outside host MUST show up in both detectors,
  // or a clean result above would mean nothing.
  result.egressSnapshot = { proxy: Object.fromEntries(hosts), page: [...foreign] };
  result.steps.control = await run("control", "node", ["-e", "fetch('https://example.com/').then(r=>console.log('REACHED',r.status)).catch(e=>console.log('BLOCKED'))"], {}, 60e3);
  await page.waitForTimeout(500);
  result.controlSeen = { proxy: hosts.has("example.com"), page: [...foreign].some((u) => u.startsWith("https://example.com/")) };
} catch (e) {
  result.ok = false;
  result.error = String(e.message || e).slice(0, 2000);
  result.devTail = await page.evaluate(() => window.procs?.dev?.out.slice(-2000)).catch(() => null);
} finally {
  result.hostsAskedOfProxy = Object.fromEntries(hosts);
  result.foreignRequests = [...foreign];
  result.traffic = traffic;
  result.consoleErrors = consoleErrors;
  fs.writeFileSync(path.join(outDir, `jwc-e2e-${project}${csp ? "-csp" : ""}.json`), JSON.stringify(result, null, 2));
  await ctx.close().catch(() => {});
  server.close();
  proxy.close();
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}

// Chrome's own services (variations, component and safe-browsing pings) reach the proxy from the browser process,
// never as a request of the page: report them, do not count them. Anything the page, a worker or the service worker
// asked for counts, whatever the host.
const CHROME_OWN = /^(www\.google\.com|clients\d*\.google\.com|www\.gstatic\.com)$/;
const snap = result.egressSnapshot || { proxy: Object.fromEntries(hosts), page: [...foreign] };
const offending = Object.keys(snap.proxy).filter((h) => !CHROME_OWN.test(h));
const egressOk = offending.length === 0 && snap.page.length === 0;
// Under --csp the same fetch must never leave the browser: CSP blocks it before the network.
const controlOk = !!result.controlSeen && (csp ? !result.controlSeen.proxy && result.steps.control.tail.includes("BLOCKED") : result.controlSeen.proxy && result.controlSeen.page);
console.log(JSON.stringify({ ...result, steps: Object.fromEntries(Object.entries(result.steps).map(([k, v]) => [k, typeof v === "object" ? { exit: v.exit, ms: v.ms } : v])), consoleErrors: consoleErrors.slice(0, 8) }, null, 1));
console.log(`${result.ok ? "PASS" : "FAIL"}  ${project}: install, dev server, preview, HMR, global fetch via the mirror`);
console.log(`${egressOk ? "PASS" : "FAIL"}  the page, its workers and its service worker contacted no host but ${ORIGIN}` +
  (egressOk ? "" : `: ${offending.join(" ")} ${snap.page.slice(0, 5).join(" ")}`));
console.log(`${controlOk ? "PASS" : "FAIL"}  control: a guest fetch to example.com is ${csp ? "blocked by the CSP and never reaches the network" : "seen by both detectors"}`);
console.log(`INFO  Chrome's own requests (not the page's): ${JSON.stringify(snap.proxy)}`);
process.exit(result.ok && egressOk && controlOk ? 0 : 1);
