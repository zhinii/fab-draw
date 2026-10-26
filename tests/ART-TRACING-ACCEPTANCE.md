# Artwork tracing acceptance — 2026-10-26

The original Kimi sample from the supplied ZIP was tested before publishing.

| Check | Result |
| --- | --- |
| Single-line Kimi trace | 4 editable paths: 1 closed outer loop and 3 open inner strokes. |
| Outline Kimi trace | 5 closed paths, including the outer stroke's inner border. |
| SVG and DXF | Both modes export; no geometry errors. Size remains in mm. |
| Chat | Group resize to 120 mm, rotation, translation and smoothing verified without provider calls. Resize/rotate/smooth also exercised through the browser conversation and Keep preview. |
| Dialog and layout | Desktop 1280 × 720 and phone 390 × 844 checked. Both modes and dimension-reading choice remain visible. |
| Local test suite | 128 tests pass, including line thickness, loops, holes, touching corners, shared junctions, invalid images, locked paths and Kimi regression. |
| Cost | Zero paid provider requests for tracing or these verification steps. |

Local evidence is in ignored `outputs/kimi-tracing-results.json`, `outputs/kimi-single-line-preview.png`, `outputs/kimi-outline-preview.png` and `outputs/art-trace-phone.png`.

Limits: tracing is approximate; the user chooses physical width. Light/overlapping pencil strokes, photos with shadows and dense drawings may need Ink/Simplify adjustments or cropping. This does not establish manufacturing accuracy or general interpretation of arbitrary art.
