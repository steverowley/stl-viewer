// Smoke test for the file:// fallback path used when Python is absent.
// Loads index.html straight off disk and drives a real DataTransfer drop,
// which is exactly what happens when the user drags an STL onto the window.
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9334;
const root = path.resolve(__dirname, "..");
const fileUrl = "file:///" + path.join(root, "index.html").replace(/\\/g, "/");

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = url => new Promise((res, rej) => {
  http.get(url, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on("error", rej);
});

const profile = path.join(process.env.TMPDIR || ".", "cdp-stl-file-profile");
fs.rmSync(profile, { recursive: true, force: true });
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--headless=new", "--no-first-run", "--no-default-browser-check",
  "--window-size=1280,860", "--hide-scrollbars",
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--allow-file-access-from-files",
  fileUrl,
], { stdio: "ignore" });

let ws, msgId = 0;
const pending = new Map(); const logs = [];
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

(async () => {
  let target;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await getJSON(`http://127.0.0.1:${PORT}/json/list`);
      target = list.find(t => t.type === "page" && t.url.startsWith("file:"));
      if (target && target.webSocketDebuggerUrl) break;
    } catch {}
    await sleep(500);
  }
  if (!target) throw new Error("Chrome never exposed the file:// page");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method === "Runtime.consoleAPICalled") logs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value !== undefined ? a.value : "").join(" "));
    else if (m.method === "Runtime.exceptionThrown") logs.push("[EXCEPTION] " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", () => j(new Error("ws failed"))); });
  await send("Runtime.enable"); await send("Page.enable");
  await sleep(2500);

  const results = [];
  const check = (n, c, d) => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"} ${n}${d ? "  - " + d : ""}`); };

  const boot = await evaluate(`({ three: window.THREE && THREE.REVISION,
    gl: (() => { const c=document.querySelector("canvas");
      const g=c&&(c.getContext("webgl2")||c.getContext("webgl")); return !!g; })(),
    url: location.protocol })`);
  check("app boots from file://", boot.three && boot.gl, `three r${boot.three}, protocol ${boot.url}`);

  // Build a real File from raw bytes and fire a genuine drop event on window.
  const stlBytes = [...fs.readFileSync(path.join(root, "test", "cube_binary.stl"))];
  await evaluate(`window.__bytes = new Uint8Array(${JSON.stringify(stlBytes)}); "ok"`);
  const dropped = await evaluate(`(async () => {
    const f = new File([__bytes], "cube_binary.stl", { type: "model/stl" });
    const dt = new DataTransfer();
    dt.items.add(f);
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
    const overlayOn = document.getElementById("drop").classList.contains("on");
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 900));
    return { overlayOn,
             overlayOff: !document.getElementById("drop").classList.contains("on"),
             n: models.length,
             tris: models[0] && models[0].stats.tris,
             name: models[0] && models[0].name };
  })()`);
  check("drag-over shows the drop overlay", dropped.overlayOn);
  check("overlay clears after drop", dropped.overlayOff);
  check("dropped file loads a model", dropped.n === 1 && dropped.tris === 12,
        `${dropped.name}: ${dropped.tris} triangles`);

  const shot = await send("Page.captureScreenshot", { format: "png" });
  const out = path.join(__dirname, "shots", "10-file-protocol-drop.png");
  fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("   shot ->", out);

  const uncaught = logs.filter(l => /^\[EXCEPTION\]/.test(l));
  check("no uncaught errors under file://", uncaught.length === 0, uncaught.join(" | ") || "clean");

  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  ws.close(); chrome.kill(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error("HARNESS ERROR:", e.message); console.log(logs.join("\n")); try { ws?.close(); } catch {} chrome.kill(); process.exit(1); });
