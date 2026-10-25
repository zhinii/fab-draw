# Dimensioned drawing prototype acceptance — 2026-10-26

- All 112 automated tests passed. Production build passed; the focused 5 dimension/workflow tests also passed after the final export-layer adjustment.
- Browser test used the existing hosted Qwen relay, with three user chat actions: read uploaded plate image, confirm/reconstruct, resize width to 100 mm. No client review or repair loop ran.
- Uploaded example: square-corner plate, 80 × 40 mm, two Ø5 holes, centres 15 mm from each end and vertically centred. Qwen read all values correctly and produced an editable plate.
- After chat resize, actual rendered path was a 100 × 40 rectangle with radius-2.5 circles at local (15,20) and (85,20). Dimension labels were 100, 40, 15, 15, 20 and 2 × Ø5.
- Clicking the 100 dimension and entering 110 changed the geometry. Undo restored 100 and the linked labels.
- Phone 390 × 844 and desktop 1100 × 900 layouts checked. Compact tools, object cards and persistent bottom chat remained usable. The canvas now fits the drawing after layout changes.
- Reload preserved the drawing and regenerated its dimensions.
- Browser-downloaded SVG files parsed successfully: cutting export declared mm and omitted DIMENSIONS; annotated export contained GEOMETRY and DIMENSIONS, with the correct labels. DXF layer/units/annotation checks are automated.
- Local evidence: `outputs/dimensioned-plate-phone.png`, `outputs/dimensioned-plate-desktop.png`, `outputs/plate-cut.svg`, `outputs/plate-dimensions.svg`. Outputs are intentionally ignored by Git.

Scope: clear single-view images of simple measured parts. The plate's hole relationships are parametric. General paths are editable geometry, not a complete mechanical constraint system. No guarantee is made for unreadable dimensions, perspective photographs or arbitrary object illustration.
