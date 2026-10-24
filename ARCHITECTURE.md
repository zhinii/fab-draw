# Architecture

The browser owns the editable drawing. All physical coordinates are millimetres. AI operations and direct manipulation use the same validated model; proposals are atomic and undoable.

## Data

A version 1 document contains its name, units, material sheet and shapes. Shapes have stable IDs, names, local dimensions, position, rotation, fabrication role, lock state and provenance. Supported types are rectangles, ellipses, lines, paths, vector text, mounting plates and involute gears. Paths can contain multiple contours for holes. Rotation is clockwise about the local box centre in the browser's Y-down coordinate system.

Plate parameters retain hole diameter and centre-to-end distances when outside dimensions change. Gear dimensions are derived from tooth count and module. There is no general constraint solver; arbitrary path points are direct geometry. Converting a generated shape to a path explicitly removes its parameter relationships.

Optional group IDs and names organize related shapes into object cards. Group selection acts on the member shapes; grouping itself does not change their coordinates. Project files preserve these memberships, while duplicated shapes start outside their original groups.

## Conversation

`src/assistant.mjs` sends a bounded document snapshot, current selection, recent conversation and an optional image to `/api/cad`. The server owns the CAD system prompt and provider configuration. Qwen proposes typed add, update, delete, duplicate and sheet operations. Browser-side validation runs against the current document before a preview is shown. A failed proposal can be repaired once; failures never partly mutate a drawing.

Manual edits cancel an outstanding proposal request, and a revision check prevents late replies from replacing newer edits. Photo confirmation is tied to an image that the vision endpoint reports as seen. Unmeasured features remain estimated. Source images are session references, excluded from exported project/manufacturing geometry.

For common starter objects, Qwen can select a butterfly, heart, tree or fish recipe. The validator expands it into a deterministic editable outline at the requested size and adds a visible attribution. Other objects may use freeform paths; geometric validation does not establish that a freeform outline accurately depicts its subject. Proposed deletions require a separate visible acknowledgement before the user can keep the proposal.

## Connection

The hosted CAD route is separate from Robot Lab's robot-action route and reuses the existing server environment. No account secret is included in this repository or the static build. An optional personal key is held only in browser memory and forwarded only through the trusted bridge or localhost. Health checks show service availability; the first real message verifies provider access.

This is a shared demonstration connection with bounded per-instance request limits. Origin checking prevents casual browser embedding but is not user authentication. For a larger school deployment, add authenticated student access and provider budget controls. The local server binds to loopback unless an explicit host is configured.

## Export

SVG declares physical dimensions and preserves supported curves; DXF uses millimetre units and Y-up polylines. Curve flattening has a target maximum chord error of 0.025 mm. Boolean operations use polygon clipping and record a 0.05 mm combined approximation tolerance. Reference shapes and photos are excluded. Preflight checks are advisory geometric checks, not fabrication or structural certification.

## Development

Plain ES modules with a Vite production build. `npm test` covers the geometry, state boundaries, Qwen request validation and local connection server. The shared hosted relay is deployed independently; GitHub Pages serves only the browser app.
