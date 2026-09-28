// Harness: extracts the ACTUAL parsing code out of index.html and runs it
// against the generated test STLs using the real vendored three.js.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
global.self = global;
global.window = global;
const THREE = require(path.join(root, "vendor", "three.min.js"));
global.THREE = THREE;

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = html.split("<script>")[1].split("</script>")[0];

// take exactly the parsing + measurement section of the shipped source
const start = script.indexOf("function isBinarySTL");
const end = script.indexOf("/* ---------- 2. Scene");
if (start < 0 || end < 0) throw new Error("could not locate parsing section in index.html");
const src = script.slice(start, end);

const mod = new Function("THREE", src + `
  return { isBinarySTL, parseBinarySTL, parseAsciiSTL, buildGeometry, measure };`)(THREE);

const dir = path.join(root, "test");
const cases = [
  { f: "cube_binary.stl",         expect: { kind: "binary", tris: 12,   vol: 8000,      area: 2400 } },
  { f: "cube_ascii.stl",          expect: { kind: "ascii",  tris: 12,   vol: 8000,      area: 2400 } },
  { f: "tricky_solid_header.stl", expect: { kind: "binary", tris: 12,   vol: 1000,      area: 600  } },
  { f: "sphere_binary.stl",       expect: { kind: "binary", tris: 9216, vol: 14137.167, area: 2827.433, tol: 0.01 } },
  { f: "corrupt_truncated.stl",   expect: { throws: /truncated/i } },
  { f: "not_an_stl.stl",          expect: { throws: /no complete triangles/i } },
];

let pass = 0, fail = 0;
const near = (a, b, tol) => Math.abs(a - b) <= Math.abs(b) * (tol ?? 0.0005) + 1e-6;

for (const c of cases) {
  const buf = fs.readFileSync(path.join(dir, c.f));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const e = c.expect;
  try {
    const t0 = Date.now();
    const geom = mod.buildGeometry(ab);
    const ms = Date.now() - t0;
    if (e.throws) { console.log(`FAIL ${c.f}: expected an error, got a mesh`); fail++; continue; }

    const st = mod.measure(geom);
    const kind = mod.isBinarySTL(ab) ? "binary" : "ascii";
    const bb = geom.boundingBox;
    const size = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
    const checks = [
      ["format",   kind === e.kind,                    `${kind} (want ${e.kind})`],
      ["tris",     st.tris === e.tris,                 `${st.tris} (want ${e.tris})`],
      ["volume",   near(st.volume, e.vol, e.tol),      `${st.volume.toFixed(3)} (want ${e.vol})`],
      ["area",     near(st.area,  e.area, e.tol),      `${st.area.toFixed(3)} (want ${e.area})`],
      ["normals",  !!geom.attributes.normal,           geom.attributes.normal ? "computed" : "MISSING"],
      ["finite",   geom.attributes.position.array.every(Number.isFinite), "no NaN/Inf"],
    ];
    const bad = checks.filter(x => !x[1]);
    if (bad.length) { fail++; console.log(`FAIL ${c.f}`); bad.forEach(b => console.log(`       ${b[0]}: ${b[2]}`)); }
    else {
      pass++;
      console.log(`PASS ${c.f.padEnd(24)} ${kind.padEnd(6)} ${String(st.tris).padStart(5)} tris  ` +
        `bbox ${size.map(v => v.toFixed(1)).join("×")}  vol ${(st.volume/1000).toFixed(3)} cm³  ${ms}ms`);
    }
  } catch (err) {
    if (e.throws && e.throws.test(err.message)) { pass++; console.log(`PASS ${c.f.padEnd(24)} rejected: "${err.message}"`); }
    else { fail++; console.log(`FAIL ${c.f}: unexpected error "${err.message}"`); }
  }
}

// stress: large file parse throughput
const big = path.join(dir, "sphere_binary.stl");
const bb = fs.readFileSync(big);
const bab = bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength);
const t = Date.now(); for (let i = 0; i < 20; i++) mod.buildGeometry(bab);
console.log(`\nthroughput: 9,216-triangle mesh parsed+normalled in ${((Date.now()-t)/20).toFixed(1)}ms avg`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
