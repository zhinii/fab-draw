# Architecture

The browser owns the editable drawing. All physical coordinates are millimetres. AI operations and direct manipulation use the same validated model; proposals are atomic and undoable.

## Data

A version 1 document contains its name, units, material sheet and shapes. Shapes have stable IDs, names, local dimensions, position, rotation, fabrication role, lock state and provenance. Supported types are rectangles, ellipses, lines, paths, vector text, mounting plates and involute gears. Paths can contain multiple contours for holes. Rotation is clockwise about the local box centre in the browser's Y-down coordinate system.

Plate parameters retain hole diameter and centre-to-end distances when outside dimensions change. Gear dimensions are derived from tooth count and module. There is no general constraint solver; arbitrary path points are direct geometry. Converting a generated shape to a path explicitly removes its parameter relationships.

Optional group IDs and names organize related shapes into object cards. Group selection acts on the member shapes; grouping itself does not change their coordinates. Project files preserve these memberships, while duplicated shapes start outside their original groups.

## Conversation

`src/assistant.mjs` sends a bounded document snapshot, current selection, recent conversation and an optional image to `/api/cad`. The server owns the CAD system prompt and provider configuration. Qwen proposes typed add, update, delete, duplicate, sheet and construct operations. Browser-side validation runs against the current document before a preview is shown. AI operations cannot change lock state or update a locked shape; unlocking is a manual action. One geometry repair is available across a proposal run; failures never partly mutate a drawing.

Manual edits cancel an outstanding proposal request, and a revision check prevents late replies from replacing newer edits. Photo confirmation is tied to an image that the vision endpoint reports as seen. Unmeasured features remain estimated. Source images are session references, excluded from exported project/manufacturing geometry.

For common starter objects, Qwen can select a butterfly, heart, tree or fish recipe. The validator expands it into a deterministic editable outline at the requested size and adds a visible attribution. Only exact recipe geometry with an unambiguous matching request can skip visual review. Freeform creation and outline-changing edits are checked regardless of their provenance label. An unknown-object request answered with ordinary primitives also goes through review.

For other everyday objects, Qwen can propose a `construct` operation: up to 20 named ellipses, rectangles or short closed paths in normalized profile coordinates. The relay validates the bounded construction schema without executing geometry. The browser uses `src/construction.mjs` and the existing boolean engine to unite positive parts and subtract cutouts. It normalizes the resulting outside bounds to the requested millimetres and produces an ordinary editable path. Internal proportions remain estimated. Disconnected outer pieces block acceptance but remain renderable for corrective feedback. The effective flattening tolerance accounts for the final resizing. Original construction operations accompany review and revision requests; component plans are not persisted as hidden constraints.

`src/review-render.mjs` renders the candidate's actual SVG export geometry to a cropped PNG with a filled silhouette and an outline view. It removes object labels and the editor grid; open, score and engrave paths remain strokes. The vision model must describe the visible form and compare it with the request. A passing review requires an explicit pass, confidence of at least 0.8 and no outstanding issues. This is a model judgment, not a calibrated quality guarantee.

Failed or uncertain visual reviews provide the image and critique to the vision model for a replacement proposal. Schema-valid, renderable drafts with crossing contours also receive this feedback; a visual pass never overrides a geometric error. There are at most three reviews, two visual revisions and seven relay requests in a run, with a shared three-minute deadline and cancellation throughout. The separate review/revision schema cannot act as confirmation of an uploaded photograph. An exhausted or unavailable review leaves the original drawing intact. A successful result still appears as a user-reviewed preview, with an explicit AI-check notice. Proposed deletions require a separate visible acknowledgement before the user can keep the proposal.

## Connection

The hosted CAD route is separate from Robot Lab's robot-action route and reuses the existing server environment. No account secret is included in this repository or the static build. An optional personal key is held only in browser memory and forwarded only through the trusted bridge or localhost. Health checks show service availability; the first real message verifies provider access.

This is a shared demonstration connection with bounded per-instance request limits. Origin checking prevents casual browser embedding but is not user authentication. For a larger school deployment, add authenticated student access and provider budget controls. The local server binds to loopback unless an explicit host is configured.

## Export

SVG declares physical dimensions and preserves supported curves; DXF uses millimetre units and Y-up polylines. Curve flattening has a target maximum chord error of 0.025 mm. Boolean operations use polygon clipping and record a 0.05 mm combined approximation tolerance; construction records the effective tolerance after its final scaling. Reference shapes and photos are excluded. Preflight errors block manufacturing exports in the editor, while warnings request inspection. These checks are not fabrication or structural certification.

## Development

Plain ES modules with a Vite production build. `npm test` covers the geometry, state boundaries, Qwen request validation and local connection server. The shared hosted relay is deployed independently; GitHub Pages serves only the browser app.
# Dimensioned drawing prototype (2026-10-26)

The UI now calls `askAssistant` with `workflow: 'dimensioned'`. This uses the existing Qwen relay with a focused reconstruction request, one HTTP request per chat action, strict local geometry checks and no client visual-review/revision loop. The broader experimental construction implementation below remains in source, outside this active UI workflow. No provider credentials or relay deployment were changed.

Images are read first, then explicitly confirmed before geometry is proposed. Keep/discard remains atomic. Once a confirmed reconstruction is kept, the image becomes reference-only and is not resent for later chat edits. Uploading/removing a photo invalidates an outstanding proposal.

`src/dimensions.mjs` derives vector dimension marks from shape IDs and geometry properties. No AI-generated label value is trusted or stored independently. Plate width changes preserve its `edgeInset` and `holeDiameter`; generated labels and positions update on every render, including undo and project reload. Supported editable annotations are overall width/height, circular diameter and plate parameters. Other displayed measurements are references.

`src/drawing-export.mjs` wraps existing cutting exports. Annotations are opt-in: SVG gets GEOMETRY and DIMENSIONS groups; DXF retains cutting operation layers and adds DIMENSIONS with LINE/TEXT entities. Exported annotations are snapshots, not native associative CAD constraints.
