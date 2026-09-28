# STL Viewer

A fast, self-contained desktop STL viewer for Windows. Drag and drop `.stl`
files to inspect 3D models, with dimensions, volume and print-weight estimates.

**Proprietary software.** © 2026 Steve Rowley. All rights reserved.
See [LICENSE](LICENSE) — the source is visible, but no licence to use, copy or
distribute is granted.

![STL Viewer](docs/screenshot.png)

## Features

- **Drag and drop** — drop one or many `.stl` files onto the window
- **Binary and ASCII STL**, auto-detected by byte length rather than the
  unreliable `solid` keyword, so binary files with a misleading header still load
- **Measurements** — bounding box, triangle count, volume, surface area and an
  approximate PLA print weight
- **Multi-model** — files are laid out side by side on the plate so they never
  intersect; per-model colour, visibility and removal
- **Views** — orbit, pan, zoom; front/top/iso presets; wireframe and edge overlay
- **Single instance** — double-clicking another `.stl` loads it into the open
  window instead of spawning a second one
- **Save PNG** of the current view
- Fully offline. No telemetry, no network access.

## Install

Download the latest release, then run `install.bat`.

It installs per-user to `%LOCALAPPDATA%\Programs\STL Viewer`, adds a Start Menu
entry, and optionally associates `.stl` files. No admin rights required.
`uninstall.bat` reverses all of it.

You can also run `STL Viewer.exe` directly without installing.

> The executable is unsigned, so Windows SmartScreen may warn on first launch
> ("More info" → "Run anyway"). Silencing that requires a code-signing certificate.

## Controls

| Action | Control |
|---|---|
| Rotate | Left-drag |
| Pan | Right-drag |
| Zoom | Mouse wheel |
| Fit to view | `F` |
| Wireframe | `W` |
| Show edges | `E` |
| Front / Top / Iso | `1` / `2` / `3` |
| Remove selected | `Delete` |

## Architecture

A WinForms host embedding **WebView2**, with the entire UI (HTML/CSS/JS +
three.js) compiled into the executable as embedded resources and served from
memory over a virtual origin. The result is a single self-contained `.exe` with
no loose assets and no install-time dependencies.

STL parsing, geometry and measurement are hand-written — three.js is used only
for rendering.

```
index.html              the viewer UI (also runs standalone in a browser)
vendor/three.min.js     three.js r149, rendering only
app/src/Program.cs      WinForms + WebView2 host, single-instance IPC
app/src/StlViewer.csproj
test/                   parser, browser and file:// test suites
```

## Building

Requires the .NET 9 SDK.

```bash
cd app/src
dotnet publish -c Release -o ../out
```

Output is a single `STL Viewer.exe` (~47 MB self-contained).

## Tests

Serve the repository root on port 8731, then:

```bash
node test/harness.js     # parser + measurement vs exact known geometry
node test/cdp.js         # full UI in real WebGL: drag/drop, layout, controls
node test/file-mode.js   # file:// fallback
```

42 assertions total. Measurement accuracy is checked against analytically known
values (a 20 mm cube must measure exactly 8.000 cm³ and 24.00 cm²).

## Notes

- Measurements assume millimetres, the usual STL convention.
- Volume uses signed-tetrahedron summation — exact for closed meshes,
  approximate for open or non-manifold ones.
- PLA weight assumes 1.24 g/cm³ at 100% infill.

## Third-party components

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
