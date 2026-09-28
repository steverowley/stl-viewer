// Drives the real page in headless Chrome over CDP: loads STLs through the app's
// own loadFiles() path (real File objects), then screenshots the WebGL canvas.
const http = require("http");
const fs = require("fs");
const { spawn } = require("child_process");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9333;
const BASE = "http://127.0.0.1:8731";
const OUT = path.resolve(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = url => new Promise((res, rej) => {
  http.get(url, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on("error", rej);
});

const profile = path.join(process.env.TMPDIR || ".", "cdp-stl-profile");
fs.rmSync(profile, { recursive: true, force: true });
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--headless=new", "--no-first-run", "--no-default-browser-check",
  "--window-size=1440,900", "--hide-scrollbars",
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  `${BASE}/index.html`,
], { stdio: "ignore" });

let ws, msgId = 0;
const pending = new Map();
const logs = [];
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression, awaitPromise = true) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  const p = path.join(OUT, name + ".png");
  fs.writeFileSync(p, Buffer.from(r.data, "base64"));
  console.log("   shot ->", p);
  return p;
}

(async () => {
  let target;
  for (let i = 0; i < 80; i++) {
    try {
      const list = await getJSON(`http://127.0.0.1:${PORT}/json/list`);
      target = list.find(t => t.type === "page" && t.url.includes("index.html"));
      if (target && target.webSocketDebuggerUrl) break;
    } catch {}
    await sleep(500);
  }
  if (!target) throw new Error("Chrome never exposed the page target");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    } else if (m.method === "Runtime.consoleAPICalled") {
      logs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value !== undefined ? a.value : (a.description || "")).join(" "));
    } else if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      logs.push("[EXCEPTION] " + ((d.exception && d.exception.description) || d.text));
    }
  });
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", () => j(new Error("ws connect failed"))); });

  await send("Runtime.enable");
  await send("Page.enable");
  await sleep(2500);

  const env = await evaluate(`(() => {
    const c = document.querySelector("canvas");
    const gl = c && (c.getContext("webgl2") || c.getContext("webgl"));
    return { three: window.THREE && THREE.REVISION, canvas: !!c,
      w: c && c.width, h: c && c.height,
      gl: gl ? gl.getParameter(gl.VERSION) : null };
  })()`);
  console.log("env:", JSON.stringify(env));
  if (!env.three) throw new Error("three.js did not load in the page");
  if (!env.gl) throw new Error("no WebGL context - cannot verify rendering");

  await evaluate(`window.__load = async (names) => {
    const files = [];
    for (const n of names) {
      const r = await fetch("/test/" + n);
      files.push(new File([await r.blob()], n, { type: "model/stl" }));
    }
    await loadFiles(files);
    return { count: models.length };
  }; "ok"`);

  await evaluate(`window.__coverage = () => {
    const c = document.querySelector("canvas");
    const t = document.createElement("canvas");
    t.width = 320; t.height = Math.round(320 * c.height / c.width);
    const x = t.getContext("2d");
    x.drawImage(c, 0, 0, t.width, t.height);
    const d = x.getImageData(0, 0, t.width, t.height).data;
    let lit = 0; const tot = t.width * t.height;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i]-21) + Math.abs(d[i+1]-23) + Math.abs(d[i+2]-28) > 24) lit++;
    }
    return +(100 * lit / tot).toFixed(2);
  }; "ok"`);

  const results = [];
  const check = (name, cond, detail) => {
    results.push({ name, ok: !!cond, detail });
    console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? "  - " + detail : ""}`);
  };

  const empty = await evaluate(`({ prompt: !document.getElementById("empty").classList.contains("gone"), cov: __coverage() })`);
  check("empty state shows drop prompt", empty.prompt, `canvas coverage ${empty.cov}% (grid only)`);
  await shot("01-empty");

  await evaluate(`__load(["sphere_binary.stl"])`);
  await sleep(800);
  const s1 = await evaluate(`({
    cov: __coverage(),
    tris: models[0].stats.tris,
    info: [...document.querySelectorAll("#info div")].map(d => d.textContent.trim()),
    hud: document.getElementById("hud").textContent,
    gone: document.getElementById("empty").classList.contains("gone"),
    listItems: document.querySelectorAll("#list .item").length,
    camDist: +Math.hypot(camera.position.x-target.x, camera.position.y-target.y, camera.position.z-target.z).toFixed(1),
    plateZ: +models[0].mesh.position.z.toFixed(3),
    halfH: +(models[0].size.z/2).toFixed(3)
  })`);
  check("binary STL renders geometry", s1.cov > 6, `${s1.tris} tris, canvas coverage ${s1.cov}%`);
  check("empty prompt hidden after load", s1.gone);
  check("model appears in sidebar list", s1.listItems === 1);
  check("measurements panel populated", s1.info.length >= 6, s1.info.join(" | "));
  check("auto-fit framed the model", s1.camDist > 30 && s1.camDist < 250, `camera distance ${s1.camDist}`);
  check("model sits on the plate", s1.plateZ === s1.halfH, `z offset ${s1.plateZ} = half height ${s1.halfH}`);
  await shot("02-sphere-iso");

  for (const pair of [["btnTop","top"],["btnFront","front"],["btnIso","iso"]]) {
    await evaluate(`document.getElementById("${pair[0]}").click(); "ok"`);
    await sleep(400);
    const cov = await evaluate(`__coverage()`);
    check(`${pair[1]} view renders`, cov > 5, `coverage ${cov}%`);
  }
  await shot("03-iso-after-presets");

  await evaluate(`(() => { const w=document.getElementById("cWire"); w.checked=true; w.onchange(); })(); "ok"`);
  await sleep(400);
  const wf = await evaluate(`({ cov: __coverage(), on: models.every(m=>m.mat.wireframe) })`);
  check("wireframe toggle applies", wf.on && wf.cov > 2, `coverage ${wf.cov}%`);
  await shot("04-wireframe");

  await evaluate(`(() => { const w=document.getElementById("cWire"); w.checked=false; w.onchange();
                  const e=document.getElementById("cEdge"); e.checked=true; e.onchange(); })(); "ok"`);
  await sleep(450);
  const ed = await evaluate(`({ cov: __coverage(), on: models.every(m=>m.edges.visible) })`);
  check("edge overlay applies", ed.on && ed.cov > 5, `coverage ${ed.cov}%`);
  await shot("05-edges");

  await evaluate(`__load(["cube_binary.stl","cube_ascii.stl","tricky_solid_header.stl"])`);
  await sleep(900);
  const s2 = await evaluate(`({ n: models.length, cov: __coverage(),
      items: document.querySelectorAll("#list .item").length,
      hud: document.getElementById("hud").textContent })`);
  check("multi-file drop loads all", s2.n === 4 && s2.items === 4, `${s2.n} models - ${s2.hud}`);
  check("scene still renders with 4 models", s2.cov > 6, `coverage ${s2.cov}%`);

  // every list entry must actually be visible inside the sidebar, not clipped away
  const vis = await evaluate(`(() => {
    const list = document.getElementById("list");
    const lr = list.getBoundingClientRect();
    const items = [...document.querySelectorAll("#list .item")];
    const fully = items.filter(it => {
      const r = it.getBoundingClientRect();
      return r.top >= lr.top - 1 && r.bottom <= lr.bottom + 1;
    }).length;
    return { total: items.length, fully, scrollable: list.scrollHeight > list.clientHeight + 1,
             reachable: items.length <= 0 ? 0 : (list.scrollHeight >= items.length * 40) };
  })()`);
  check("all model entries reachable in sidebar",
        vis.fully === vis.total || vis.scrollable,
        `${vis.fully}/${vis.total} fully visible${vis.scrollable ? ", list scrolls for the rest" : ""}`);

  // models must not interpenetrate: pairwise world-space AABB overlap
  const overlap = await evaluate(`(() => {
    const boxes = models.map(m => new THREE.Box3().copy(m.geom.boundingBox).translate(m.mesh.position));
    let hits = 0;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        if (boxes[i].intersectsBox(boxes[j])) hits++;
    return { hits, pairs: boxes.length * (boxes.length - 1) / 2 };
  })()`);
  check("models laid out without overlapping", overlap.hits === 0,
        `${overlap.hits} overlapping pairs of ${overlap.pairs}`);

  // nothing may spill outside the sidebar's width
  const spill = await evaluate(`(() => {
    const side = document.getElementById("side");
    const sr = side.getBoundingClientRect();
    const bad = [...side.querySelectorAll("*")].filter(e => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && (r.right > sr.right + 1 || r.left < sr.left - 1);
    }).map(e => e.className || e.tagName);
    return bad.slice(0, 5);
  })()`);
  check("no sidebar content overflows horizontally", spill.length === 0, spill.join(", ") || "clean");

  // the bottom controls and hint must stay inside the viewport, not clipped off
  const bottom = await evaluate(`(() => {
    const side = document.getElementById("side").getBoundingClientRect();
    const hint = document.querySelector(".hint").getBoundingClientRect();
    const btns = document.getElementById("btnClear").getBoundingClientRect();
    return { hintBottom: Math.round(hint.bottom), sideBottom: Math.round(side.bottom),
             btnsVisible: btns.bottom <= side.bottom + 1 && btns.top >= side.top,
             hintVisible: hint.bottom <= side.bottom + 1 };
  })()`);
  check("bottom buttons stay visible", bottom.btnsVisible);
  check("shortcut hint not clipped", bottom.hintVisible,
        `hint bottom ${bottom.hintBottom} vs sidebar ${bottom.sideBottom}`);
  await shot("06-four-models");

  // --- cramped window: layout must degrade gracefully, not clip controls ---
  await send("Emulation.setDeviceMetricsOverride",
    { width: 1024, height: 620, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  const small = await evaluate(`(() => {
    const side = document.getElementById("side").getBoundingClientRect();
    const hintEl = document.querySelector(".hint");
    const hintHidden = getComputedStyle(hintEl).display === "none";
    const hint = hintEl.getBoundingClientRect();
    const btns = document.getElementById("btnClear").getBoundingClientRect();
    const list = document.getElementById("list");
    return { ok: (hintHidden || hint.bottom <= side.bottom + 1) && btns.bottom <= side.bottom + 1
                 && list.clientHeight >= 60,
             hintHidden, listH: Math.round(list.clientHeight), cov: __coverage() };
  })()`);
  check("layout survives a 1024x620 window", small.ok,
        `list height ${small.listH}px, hint ${small.hintHidden ? "auto-hidden" : "shown"}, coverage ${small.cov}%`);
  await shot("09-small-window");
  await send("Emulation.clearDeviceMetricsOverride");
  await sleep(500);

  await evaluate(`document.querySelector("#list .item .eye").click(); "ok"`);
  await sleep(300);
  const hid = await evaluate(`({ vis: models[0].mesh.visible, cls: document.querySelector("#list .item").className })`);
  check("hide toggle works", hid.vis === false && hid.cls.includes("hid"));
  await evaluate(`document.querySelector("#list .item .eye").click(); "ok"`);
  await sleep(250);

  await evaluate(`document.querySelector("#list .item .del").click(); "ok"`);
  await sleep(350);
  const del = await evaluate(`({ n: models.length, items: document.querySelectorAll("#list .item").length })`);
  check("delete removes model", del.n === 3 && del.items === 3, `${del.n} remain`);

  const before = await evaluate(`models.length`);
  await evaluate(`__load(["corrupt_truncated.stl","not_an_stl.stl"])`);
  await sleep(700);
  const bad = await evaluate(`({ n: models.length,
      toasts: [...document.querySelectorAll(".tst")].map(t=>t.textContent.trim()),
      errs: document.querySelectorAll(".tst.err").length,
      cov: __coverage() })`);
  check("bad files rejected without adding models", bad.n === before, `still ${bad.n} models`);
  check("error toast shown for bad files", bad.errs >= 1, bad.toasts.join(" / "));
  check("scene alive after bad load", bad.cov > 5, `coverage ${bad.cov}%`);
  await shot("07-error-toasts");

  const cam0 = await evaluate(`[+camera.position.x.toFixed(2), +camera.position.z.toFixed(2)]`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 800, y: 450, button: "left", clickCount: 1, buttons: 1 });
  for (let i = 1; i <= 8; i++)
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 800 + i * 18, y: 450 + i * 6, button: "left", buttons: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 944, y: 498, button: "left", buttons: 0 });
  await sleep(400);
  const cam1 = await evaluate(`[+camera.position.x.toFixed(2), +camera.position.z.toFixed(2)]`);
  check("left-drag orbits the camera", cam0[0] !== cam1[0], `x ${cam0[0]} -> ${cam1[0]}`);

  const r0 = await evaluate(`+sphR.toFixed(2)`);
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 800, y: 450, deltaX: 0, deltaY: -240 });
  await sleep(350);
  const r1z = await evaluate(`+sphR.toFixed(2)`);
  check("wheel zooms", r1z < r0, `radius ${r0} -> ${r1z}`);
  await shot("08-after-orbit-zoom");

  await evaluate(`document.getElementById("btnClear").click(); "ok"`);
  await sleep(450);
  const cl = await evaluate(`({ n: models.length, prompt: !document.getElementById("empty").classList.contains("gone") })`);
  check("clear all empties the scene", cl.n === 0 && cl.prompt);

  await evaluate(`__load(["sphere_binary.stl"])`);
  await sleep(700);
  const png = await evaluate(`(() => { render();
    const d = document.querySelector("canvas").toDataURL("image/png");
    return { ok: d.startsWith("data:image/png") && d.length > 5000, bytes: d.length }; })()`);
  check("PNG export produces image data", png.ok, `${Math.round(png.bytes/1024)} KB data URL`);

  // Only genuinely UNCAUGHT errors count. The app deliberately console.error()s
  // diagnostics for files it rejects, which is correct behaviour, not a fault.
  const errs = logs.filter(l => /^\[EXCEPTION\]/.test(l));
  const expectedDiag = logs.filter(l => /^\[error\]/.test(l));
  check("no uncaught JS errors", errs.length === 0, errs.join(" | ") || "no uncaught exceptions");
  check("rejected files logged a diagnostic", expectedDiag.length === 2,
        `${expectedDiag.length} expected console.error entries (corrupt + non-STL)`);
  console.log("\npage console:"); logs.forEach(l => console.log("   " + l));

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  ws.close(); chrome.kill();
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error("HARNESS ERROR:", e.message);
  console.log(logs.join("\n"));
  try { if (ws) ws.close(); } catch {}
  chrome.kill(); process.exit(1);
});
