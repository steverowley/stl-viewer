// Attaches to the running native app's WebView2 and reports what the page sees.
const http = require("http");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = url => new Promise((res, rej) => {
  http.get(url, r => { let d=""; r.on("data",c=>d+=c); r.on("end",()=>{try{res(JSON.parse(d))}catch(e){rej(e)}}); }).on("error", rej);
});

(async () => {
  const list = await getJSON("http://127.0.0.1:9400/json/list");
  const page = list.find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const logs = [];
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p(m.result); }
    else if (m.method === "Runtime.consoleAPICalled")
      logs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value !== undefined ? a.value : (a.description||"")).join(" "));
    else if (m.method === "Runtime.exceptionThrown")
      logs.push("[EXC] " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  const send = (method, params={}) => new Promise(res => { const i=++id; pending.set(i,res); ws.send(JSON.stringify({id:i,method,params})); });
  await new Promise(r => ws.addEventListener("open", r));
  await send("Runtime.enable");
  await sleep(500);

  const ev = async expr => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }));

  const state = (await ev(`({
    hasHook: typeof window.__loadFromHost,
    HOST: typeof HOST !== "undefined" ? HOST : "undefined",
    hasWebview: !!(window.chrome && window.chrome.webview),
    models: typeof models !== "undefined" ? models.length : "n/a",
    href: location.href
  })`)).result.value;
  console.log("page state:", JSON.stringify(state, null, 2));

  // try the exact call the host makes, and report the real failure
  const probe = (await ev(`(async () => {
    try {
      const r = await fetch("https://stlopen.local/sphere_binary.stl");
      return { ok: r.ok, status: r.status };
    } catch (e) { return { error: e.message }; }
  })()`)).result.value;
  console.log("fetch probe (mapping may be released):", JSON.stringify(probe));

  console.log("\nconsole so far:");
  logs.forEach(l => console.log("  " + l));
  ws.close();
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
