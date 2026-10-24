# Fab Draw

A simple bilingual 2D drawing workspace for a school fab lab: describe a design, answer the assistant's questions, edit the geometry directly, and export it for laser software.

The drawing is stored as geometry in millimetres. Qwen interprets the request and proposes structured operations; the geometry layer validates and applies them. AI responses are not executable code.

## First release

- Conversation beside a large drawing canvas, with English and Chinese interface choices.
- Manual shapes and paths, editable dimensions, selection, movement, rotation, copying, scaling and point editing.
- Millimetre project geometry, operation roles for cut, score, engrave and reference, undo/redo, browser recovery and editable project files.
- A Qwen connection for language and image requests, plus a small local command assistant for supported requests when AI is unavailable.
- Photo-assisted interpretation of sketches. The assistant can ask for missing dimensions; an undimensioned photograph does not establish an accurate physical scale.
- SVG and DXF exports, with basic geometry checks before export.

This is a first release for simple 2D parts, outlines, signs and sketches. It is not a complete mechanical constraint solver, garment pattern system, assembly simulator or machine controller. Gears and mounting plates are generated from parameters where supported; a visually plausible arbitrary AI outline is not evidence that mating parts will work.

## Run locally

Use Node.js 22.13 or newer.

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:4248`. The browser editor runs independently of an AI connection. A network connection is needed for Qwen requests.

```powershell
npm test
npm run build
npm run preview
```

`dist/` is the static website build. It can be hosted separately from the Qwen relay. Do not open the source HTML using a `file:` URL.

## Qwen connection

The connection follows Robot Lab's server-side relay pattern and can use the same Qwen account and model endpoint. A CAD request needs the CAD-specific route and system prompt; the robot simulator's motion endpoint cannot interpret drawing operations.

The frontend sends the current drawing, selected object IDs, recent conversation and an attached image when supplied. The relay returns a reply and a bounded set of geometry operations. Invalid operations must leave the original drawing intact.

Keep the Qwen API key on the relay server, outside the repository. Never place a key in frontend source, a public environment variable, an exported project, a URL or a screenshot. If using the optional session-key connection, the key is held in memory for that browser session and sent only to the configured trusted bridge; it is not saved with the project or browser recovery.

### Local relay using the existing Robot Lab configuration

After building the site, run:

```powershell
npm run build
npm run serve
```

Open `http://127.0.0.1:4227` and set the connection URL to `http://127.0.0.1:4227/api/cad`. The server serves the built site and the CAD API together. `GET /api/cad` reports connection status; drawing requests use `POST /api/cad`.

If no environment key is configured, the server reads the existing `~/.config/bnta-robot-lab/server.json` configuration without modifying or copying it. `FAB_DRAW_CONFIG` selects a different existing configuration file. This keeps the robot simulator configuration in its original location.

| Server setting | Purpose |
| --- | --- |
| `ALIBABA_API_KEY` | Server-only Qwen credential, overriding the existing configuration key. |
| `ALIBABA_BASE_URL` | Qwen-compatible base URL; defaults to the Alibaba Token Plan endpoint. |
| `ALIBABA_MODEL` | Language model; default `qwen3.8-flash`. |
| `ALIBABA_VISION_MODEL` | Image model; default `qwen3.7-plus`. |
| `FAB_DRAW_CONFIG` | Optional path to the existing private Robot Lab JSON configuration. |
| `FAB_DRAW_PORT` | Local serving port; default `4227`. |

Model availability depends on the existing Qwen account. Use the application's connection check and test an actual image request to verify vision access. A successful language request alone does not prove vision support. A private server should use an appropriate origin/access policy before being exposed publicly; the local server binds to loopback by default.

## Measurements and sketches

The source of a dimension matters:

- **Specified:** supplied or confirmed by the user.
- **Calculated:** derived by geometry from known values.
- **Estimated:** chosen for appearance or inferred from an image.

Written dimensions should govern reconstruction even when a sketch is drawn out of proportion. Ask about unreadable labels and contradictory dimensions. One known length establishes a scale reference; it does not validate perspective, hidden features, every hole position or every curve in a photograph. Inspect and confirm the reconstruction before cutting.

Digital dimensions and physical fit are different. Material thickness, kerf, tool settings, sheet distortion and the fabrication process affect the actual part. Use measured stock thickness and a small test piece for fit-dependent work. Passing the export checks does not certify a design for a particular material or machine.

## Editing and saving

Click a shape to select it and use its dimensions to make a precise edit. Use direct manipulation for visual adjustments and the conversation for a named object or selected part. Undo/redo should cover both manual edits and accepted AI operations.

Download an editable project for a durable copy. Browser recovery is local to that browser and device and can be cleared or evicted. There are no school accounts, collaborative sessions or server project backups in this release.

## Laser exports

Export SVG or DXF, import it into the school's laser software, and verify the overall size and at least one critical dimension. Export files contain drawing geometry and operation assignments, not machine power/speed settings or toolpaths.

Reference objects are excluded from manufacturing exports. Check that intended cut contours are closed, holes remain holes, shared edges are not duplicated, and the right operations are assigned. Avoid applying kerf compensation twice across applications. Only use materials and settings approved for the school's actual machine.

Photo attachments are interpretation references; they are not raster engraving output. The vector text tool produces single-line lettering for engraving or scoring. It supports Latin letters, digits and basic punctuation, maps lowercase letters to uppercase and rejects unsupported characters. It does not produce Chinese lettering, filled font outlines or stencil bridges.

SVG retains supported arcs and smooth curves. DXF uses polylines with a target curve-flattening tolerance of 0.025 mm and CAD Y-up coordinates; its header declares millimetres. Boolean operations also flatten curves and record a 0.05 mm combined tolerance. Generated involute gears have no backlash or root fillet; low tooth counts can require undercut/profile-shift engineering. Test paired gears and material before using them in a loaded mechanism.

## Verification

The automated tests cover core geometry and assistant/server boundaries. The manual release checks are in [tests/ACCEPTANCE.md](tests/ACCEPTANCE.md). Browser interaction checks, real Qwen replies, export roundtrips and physical cutting are separate levels of evidence; record which were actually performed.

## Project structure

- `src/main.mjs` and `src/style.css`: browser interface and interaction.
- `src/geometry.mjs`: document validation, geometry operations, generated parts, preflight and export.
- `src/assistant.mjs`: conversation client and supported local commands.
- `server/`: Qwen relay and static serving support.
- `tests/`: automated checks and manual acceptance plan.

Original Robot Lab files and secrets are not part of this repository.
