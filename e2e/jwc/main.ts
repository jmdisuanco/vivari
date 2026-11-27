// jmwebcontainer e2e harness: boots the SDK and exposes thin helpers for scripts/jwc-e2e.mjs.
// Boot options come from ?boot=<json>; the default is the fork's default (registryMirror "/_npm/").
import { Vivari } from "@vivari/core";

const w = window as any;
const t0 = performance.now();
w.servers = [];
w.procs = {};
w.vvReady = (async () => {
  const vv = await Vivari.boot(JSON.parse(new URLSearchParams(location.search).get("boot") || "{}"));
  w.vv = vv;
  w.bootMs = performance.now() - t0;
  vv.on("server-ready", (port: number, url: string) => w.servers.push({ port, url, at: performance.now() }));
  document.getElementById("log")!.textContent = "ready " + Math.round(w.bootMs) + " ms";
  return w.bootMs;
})();

// Start a process; output and exit code are collected on window.procs[id].
w.vvStart = async (id: string, cmd: string, args: string[], opts: any) => {
  const p = await w.vv.spawn(cmd, args, opts);
  const rec: any = { out: "", exit: null, startedAt: performance.now(), endedAt: null };
  w.procs[id] = rec;
  (async () => { for await (const c of p.output) rec.out += c; })();
  p.exit.then((code: number) => { rec.exit = code; rec.endedAt = performance.now(); });
  return true;
};

w.vvPreview = (port: number, path = "/") => {
  const frame = document.getElementById("preview") as HTMLIFrameElement;
  w.detach?.();
  w.detach = w.vv.attachPreview(frame);
  frame.src = w.vv.previewUrl(port, path);
  return frame.src;
};
