# Fab Draw release acceptance

This is a test plan, not a record that the checks passed. Record the build/commit, browser, viewport, relay/model, date and result when executing it. Do not include keys, authorization headers, personal images or private conversations in evidence.

## Automated gate

Run `npm test` and `npm run build`. Geometry checks should include finite-value validation, invalid-operation rollback, stable IDs, locked objects, parameter-preserving edits, dimensioned SVG, millimetre DXF, compound holes and curve approximation. Assistant checks should include malformed JSON, unknown operations, oversized requests/images, provider failure, cancellation and safe errors without secrets.

## Browser and conversation checks

| Check | Action | Acceptance |
| --- | --- | --- |
| First use | Open a fresh project at desktop and tablet widths. | Canvas, conversation and primary tools are understandable; essential controls remain reachable without overlapping the drawing. |
| Language | Switch English/中文, send a request, then reload. | Visible controls and new assistant replies follow the selection; selection persists; existing names and measurements are preserved. |
| Basic outline | Request a butterfly profile. | Recognizable editable geometry appears; suggested size and assumptions are apparent. It is not described as dimensionally verified. |
| Technical clarification | Request a bracket for a motor without dimensions. | Assistant asks about required dimensions or uses clearly stated assumptions; it does not claim that an unspecified mounting pattern fits. |
| Exact part | Request an 80 × 40 mm plate, two 5 mm holes, centres 15 mm from each end and on the horizontal centreline. | Geometry and export match the confirmed dimensions. |
| Conversational edit | Select the plate and request width 100 mm with unchanged hole diameters and end offsets. | Intended object changes; hole diameter is 5 mm; offsets remain 15 mm; unrelated objects do not change. |
| Explicit units | Request 8 cm, 80 mm, 8 厘米 and 80 毫米 examples. | Equivalent lengths produce equivalent geometry. Ambiguous mixed-unit instructions prompt clarification. |
| Selection context | Select one of several shapes and say “make this twice as wide.” | The selected object is the target; effect on holes or generated part parameters is explicit and geometrically valid. |
| Local fallback | Disable the relay and use a supported simple local command; then request something beyond it. | Supported local operation works; unsupported request is identified honestly; manual tools remain usable. |
| Provider errors | Test unavailable relay, invalid route, timeout and cancelled request. | Actionable error, no frozen UI, no duplicate insertion, and no partial drawing mutation. |
| Response race | While a slow request is pending, edit the design or change project. | A stale response cannot silently overwrite newer geometry or apply to the wrong project. |

## Editing and persistence

1. Create each visible manual primitive. Drag, rotate, resize and copy it. Compare displayed measurements with saved geometry. Undo then redo each edit; one gesture should be one undo action.
2. Edit points on an open path, closed path and smooth path. Rotate the object first and repeat. Dragged points must remain under the pointer and export in the displayed position.
3. Multi-select, move and duplicate objects. Verify relative placement and unique object IDs. Test grid snapping at two zoom levels; visible snap and geometry must agree.
4. Lock a shape. Attempt drag, field edit, deletion and an assistant change. Each path must honour the lock or ask to unlock it.
5. Try zero, negative, non-numeric, non-finite and excessively large dimensions. The application must reject invalid input without corrupting the drawing or losing history.
6. Save an editable project, reload, reopen it and compare geometry, roles, names, parameters and provenance. Opening invalid JSON or a different file format must retain the current drawing.
7. Refresh after an edit and recover the local draft. Start a new project, use undo and reopen a saved project; document which history boundaries are intentionally reset.
8. Type in chat and numeric fields while testing keyboard shortcuts. Delete/Backspace must not remove drawing objects while typing; Undo must not unexpectedly target the canvas.

## Sketch interpretation

| Input | Acceptance |
| --- | --- |
| Clear rectangle with all dimensions | Reconstructed geometry uses written dimensions, even if the sketch proportions are inaccurate. |
| One missing hole dimension | Assistant asks for it or clearly marks the proposed value as estimated. |
| Blurred “6”/“8” label | Assistant asks for confirmation rather than asserting a reading. |
| Undimensioned drawing | Assistant requests a scale/reference or visibly proposes an estimated size. |
| Oblique photograph | Perspective uncertainty is acknowledged; there is no claim of full dimensional recovery from appearance alone. |
| Conflicting dimensions | Conflict is surfaced before a supposedly accurate result is accepted. |
| Cancel/change photo | Subsequent conversation does not unintentionally reuse a removed image. |

Record the exact model used for vision. A successful text-only request does not verify image support.

## Export roundtrip

1. Export the dimensioned plate to both SVG and DXF. Open each in the school's actual laser software. Verify 80 × 40 mm overall size, 5 mm holes and 15 mm end offsets. A browser preview alone is insufficient.
2. Export a rotated part, compound outline with holes, curve and generated gear. Compare orientation, physical dimensions and hole preservation. Document any polyline approximation.
3. Add cut, score, engrave and reference geometry. Verify operation separation and exclusion of reference geometry. Inspect open cuts, tiny shapes, duplicate paths and self-intersections against the reported preflight findings.
4. Export text and unsupported characters. Verify only supported lettering is produced, and unsupported content produces an explicit error or clear limitation. Stroke lettering must not be described as filled cut lettering.
5. Inspect SVG for explicit millimetre dimensions and DXF for units. Check that exported artifacts contain no photo payloads, provider credentials or chat history.
6. Make a small test cut using approved school material/settings. Measure the result and record kerf/fit separately from the exported dimensions. Physical fit is pending until this step is performed.

## Release evidence

- Automated tests/build: pending.
- Desktop/tablet browser interactions: pending.
- Live Qwen text requests: pending.
- Live Qwen photo requests: pending.
- School laser software roundtrip: pending.
- Physical cut and measured fit: pending.

Replace “pending” only with the actual check result and an evidence pointer. Keep unavailable checks visible rather than treating them as passed.
