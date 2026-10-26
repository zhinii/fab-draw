# Fab Draw

A simple bilingual 2D drawing workspace for a school fab lab: describe a design, answer the assistant's questions, edit the geometry directly, and export it for laser software.

[Open Fab Draw](https://zhinii.github.io/fab-draw/) · [GitHub repository](https://github.com/zhinii/fab-draw)

The drawing is stored as geometry in millimetres. Qwen interprets the request and proposes structured operations; the geometry layer validates and applies them. AI responses are not executable code.

## Try it

**Rounded five-hole bracket:** choose **Shapes → Bracket example** for the supplied drawing using its lower 40/75 mm dimension chain, or open [the editable bracket project](public/examples/rounded-bracket.fabdraw). The result is one part with four Ø15 holes, one Ø30 hole, three R15 fillets and one R20 fillet. SVG retains circular arcs; DXF uses polylines with at most 0.01 mm arc chord error for this builder.

For uploaded brackets, Qwen attempts a structured measurement reading. Conflicting, missing or inconsistent measurements block construction. Use **Measurements** beside the upload to review individual values and their reference lines; choose the dimension chain, confirm, then build locally. “Use the lower 40 and 75 mm dimensions” resolves that chain in chat without another provider request. The manual **Bracket measurements** button also works without Qwen. Changing reviewed measurements after keeping a reconstruction updates that part rather than adding another copy.

The live reader is still imperfect: the supplied image's lower labels were not all recovered in the two bounded Qwen tests. The app now exposes this uncertainty instead of inventing geometry. The successful browser reconstruction used reviewed measurements, not an unassisted image conversion. This measured builder supports the displayed 45° rounded-bracket family; it is not a general engineering-drawing solver.

1. Choose **Photo** and upload a clear dimensioned image of one flat part. Send the prefilled request to read its measurements. Check the readings in the conversation, then choose **Confirm readings** and **Send**.
2. Review the reconstructed preview and choose **Keep it**. For the plate example, check 80 × 40 mm, two Ø5 holes, 15 mm end offsets, square corners and vertically centred holes.
3. Ask **“Make the plate 100 mm wide, keeping the holes and end offsets unchanged.”** Keep the preview. The right hole moves to 85 mm from the left edge; the left hole remains at 15 mm.
4. Toggle **Dimensions** to show the separate annotation layer. Click an editable dimension label to change its value without an AI call. Move, rotate, copy or edit points with the existing tools.
5. Save an editable project, or export SVG/DXF. Leave **Include dimension layer** unchecked for laser geometry. Check it for a dimensioned reference drawing. In Fab Draw the dimensions update with edits; exports contain a static annotation snapshot.

For a conversation that starts with questions, try **“Make a bracket for my motor.”** For Chinese, select **中文** and try **“画一个80×40毫米的矩形。”**

## First release

- A compact top toolbar with Draw, Shapes and More menus, a full dark drawing grid, object/group cards and an always-visible conversation at the bottom. English and Chinese remain available.
- Manual shapes and paths, editable dimensions, selection, movement, rotation, copying, scaling and point editing.
- Millimetre project geometry, operation roles for cut, score, engrave and reference, undo/redo, browser recovery and editable project files.
- A Qwen connection for language and image requests, plus an optional offline command mode for supported simple requests. Choose offline mode in More → Connection.
- The current chat workflow focuses on measured plates, rectangles, circles and straight outlines. Artistic profiles and the experimental construction/visual-review loop are outside this prototype's active chat workflow.
- One relay request per user chat action, with local geometry validation and no automatic visual-review or repair loop. The relay may retry a malformed provider JSON response once. Missing measurements should prompt a question instead of an estimate.
- Separate generated dimensions for overall sizes, circle diameters, and plate hole diameters/end offsets/centre height. Plate parameters preserve hole relationships when the width changes; arbitrary paths do not have a general constraint solver.
- Photo-assisted interpretation of sketches. The assistant can ask for missing dimensions; an undimensioned photograph does not establish an accurate physical scale.
- SVG and DXF exports, with basic geometry checks before export.

This prototype starts with clear, single-view dimensioned images in millimetres. PDF import, complex assemblies, perspective correction and automatic dimensioning of every internal feature are deferred. Manual tools and offline examples remain available. Review the AI's readings and proposed geometry before choosing Keep it.

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

For a general object or a changed freeform outline, the browser renders a cropped, unlabelled image of the actual proposed geometry. The vision model describes the visible form and compares it with the request. Revisions receive that rendering and specific criticism, using the vision model too. The result retains the review assessment; a failed or uncertain final review cannot be accepted as a finished shape. Explicit simple geometry and verified matching built-in recipes can skip this check. Sketch measurement confirmation is a separate step and cannot be bypassed by a review image.

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

The grid fills the workspace; a subtle outline marks the material sheet used for export checks. Open the top menus for drawing and editing tools. Pan mode and the zoom/fit controls also work without a mouse wheel. The object cards above the conversation let you select individual pieces or saved groups.

Download an editable project for a durable copy. Browser recovery is local to that browser and device and can be cleared or evicted. There are no school accounts, collaborative sessions or server project backups in this release.

## Laser exports

Export SVG or DXF, import it into the school's laser software, and verify the overall size and at least one critical dimension. Export files contain drawing geometry and operation assignments, not machine power/speed settings or toolpaths.

Reference objects are excluded from manufacturing exports. Check that intended cut contours are closed, holes remain holes, shared edges are not duplicated, and the right operations are assigned. Avoid applying kerf compensation twice across applications. Only use materials and settings approved for the school's actual machine.

Photo attachments are interpretation references; they are not raster engraving output. The vector text tool produces single-line lettering for engraving or scoring. It supports Latin letters, digits and basic punctuation, maps lowercase letters to uppercase and rejects unsupported characters. It does not produce Chinese lettering, filled font outlines or stencil bridges.

SVG retains supported arcs and smooth curves. Smooth paths use bounded cubic interpolation through their editable points; arbitrary Bézier control handles are not exposed. DXF uses polylines with a target curve-flattening tolerance of 0.025 mm and CAD Y-up coordinates; its header declares millimetres. Boolean operations also flatten curves and record a 0.05 mm combined tolerance. Construction produces polygon contours; normalizing their outside size can enlarge the approximation, and their stored tolerance includes that scaling. Generated involute gears have no backlash or root fillet; low tooth counts can require undercut/profile-shift engineering. Test paired gears and material before using them in a loaded mechanism.

## Verification

The automated tests cover core geometry and assistant/server boundaries. The manual release checks are in [tests/ACCEPTANCE.md](tests/ACCEPTANCE.md). Browser interaction checks, real Qwen replies, export roundtrips and physical cutting are separate levels of evidence; record which were actually performed.

`node scripts/live-smoke.mjs` checks relay health without a model request; explicit `butterfly`, `plate`, `zh` or `photo` arguments make live Qwen requests. The `photo` case requires a local 900 × 600 PNG at `outputs/dimensioned-sketch.png`; this fixture and generated evidence are intentionally excluded from Git.

On 2026-10-24, 84 automated tests passed; the production build passed before the latest outline-repair refinement. The dependency audit reported zero vulnerabilities. The tests include visual rejection/revision, cancellation, existing-outline changes, request limits, photo-confirmation separation and specific crossing-segment diagnostics. Earlier live Qwen checks covered an exact mounting plate, Chinese rectangle, technical clarification, confirmed reconstruction of a dimensioned sketch and a visually reviewed butterfly recipe with an actual 100 × 75 mm outline and visible built-in attribution. Browser-exported SVG/DXF geometry was independently checked for dimensions, holes, units and excluded photo/credential data. The new automatic visual-review loop still needs its separate live browser acceptance; earlier recipe and sketch results do not establish that it works. Current layout checks are recorded in the acceptance plan. Roundtrips through the school's actual laser software and physical cutting remain pending.

## Project structure

- `src/main.mjs` and `src/style.css`: browser interface and interaction.
- `src/geometry.mjs`: document validation, geometry operations, generated parts, preflight and export.
- `src/assistant.mjs`: conversation client and supported local commands.
- `src/construction.mjs`: component-plan expansion into editable outline geometry.
- `src/review-render.mjs`: actual-geometry raster rendering for visual checks.
- `server/construction-schema.mjs`: shared bounded construction schema.
- `server/`: Qwen relay and static serving support.
- `tests/`: automated checks and manual acceptance plan.

Original Robot Lab files and secrets are not part of this repository.
