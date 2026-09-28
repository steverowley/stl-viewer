// STL Viewer
// Copyright (c) 2026 Steve Rowley. All rights reserved.
// Proprietary and confidential. See LICENSE.
//
// Generates the test fixtures used by the suites in this folder.
// Run once after cloning:  node test/make-fixtures.js
//
// Shapes have analytically known volume/area so the parser can be checked
// against exact values rather than against itself.

const fs = require("fs");
const path = require("path");

const dir = __dirname;

function cubeTris(s) {
  const v = [[0,0,0],[s,0,0],[s,s,0],[0,s,0],[0,0,s],[s,0,s],[s,s,s],[0,s,s]];
  const f = [[0,3,2],[0,2,1],[4,5,6],[4,6,7],[0,1,5],[0,5,4],
             [1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return f.map(([a,b,c]) => [v[a], v[b], v[c]]);
}

function sphereTris(r, n) {
  const t = [];
  const P = (p, th) => [r*Math.sin(p)*Math.cos(th), r*Math.sin(p)*Math.sin(th), r*Math.cos(p)];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n*2; j++) {
      const p0 = Math.PI*i/n, p1 = Math.PI*(i+1)/n;
      const t0 = 2*Math.PI*j/(n*2), t1 = 2*Math.PI*(j+1)/(n*2);
      const a = P(p0,t0), b = P(p0,t1), c = P(p1,t1), e = P(p1,t0);
      t.push([a,b,c], [a,c,e]);
    }
  return t;
}

const norm = (a, b, c) => {
  const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
  const v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
  const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
  const L = Math.hypot(...n) || 1;
  return n.map(x => x/L);
};

function writeBinary(file, tris, header = "binary test") {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.write(header.padEnd(80, "\0"), 0, 80, "ascii");
  buf.writeUInt32LE(tris.length, 80);
  let o = 84;
  for (const [a,b,c] of tris) {
    for (const x of norm(a,b,c)) { buf.writeFloatLE(x, o); o += 4; }
    for (const v of [a,b,c]) for (const x of v) { buf.writeFloatLE(x, o); o += 4; }
    buf.writeUInt16LE(0, o); o += 2;
  }
  fs.writeFileSync(file, buf);
}

function writeAscii(file, tris, name = "ascii_test") {
  const L = [`solid ${name}`];
  for (const [a,b,c] of tris) {
    const n = norm(a,b,c);
    L.push(`  facet normal ${n.map(x => x.toExponential(6)).join(" ")}`);
    L.push("    outer loop");
    for (const v of [a,b,c]) L.push(`      vertex ${v.map(x => x.toExponential(6)).join(" ")}`);
    L.push("    endloop", "  endfacet");
  }
  L.push(`endsolid ${name}`);
  fs.writeFileSync(file, L.join("\n") + "\n");
}

const p = f => path.join(dir, f);

writeBinary(p("cube_binary.stl"), cubeTris(20));
writeAscii(p("cube_ascii.stl"), cubeTris(20));
writeBinary(p("sphere_binary.stl"), sphereTris(15, 48));
// binary file whose 80-byte header literally starts with "solid" — the classic
// trap for parsers that sniff the keyword instead of checking the byte length
writeBinary(p("tricky_solid_header.stl"), cubeTris(10), "solid this is actually binary");
// corrupt + non-STL, for error handling
const full = fs.readFileSync(p("sphere_binary.stl"));
fs.writeFileSync(p("corrupt_truncated.stl"), full.subarray(0, Math.floor(full.length / 2)));
fs.writeFileSync(p("not_an_stl.stl"), "hello world, this is not geometry\n");

console.log("Fixtures written to", dir);
console.log("  cube 20mm       : 12 tris, 8000 mm3 (8.000 cm3), 2400 mm2");
console.log("  sphere r15      :", (4/3*Math.PI*15**3).toFixed(3), "mm3,",
            (4*Math.PI*225).toFixed(3), "mm2");
