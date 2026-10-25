# Fab Draw release acceptance

This is a test plan with a dated release-evidence section below. Only checks recorded in that section have execution evidence; the rest remain planned. Record the build/commit, browser, viewport, relay/model, date and result when executing it. Do not include keys, authorization headers, personal images or private conversations in evidence.

## Automated gate

Run `npm test` and `npm run build`. Geometry checks should include finite-value validation, invalid-operation rollback, stable IDs, locked objects, parameter-preserving edits, dimensioned SVG, millimetre DXF, compound holes and curve approximation. Assistant checks should include malformed JSON, unknown operations, oversized requests/images, provider failure, cancellation and safe errors without secrets.

## Browser and conversation checks

| Check | Action | Acceptance |
| --- | --- | --- |
| First use | Open a fresh project at desktop and tablet widths. | Canvas, conversation and primary tools are understandable; essential controls remain reachable without overlapping the drawing. |
| Language | Switch English/中文, send a request, then reload. | Visible controls and new assistant replies follow the selection; selection persists; existing names and measurements are preserved. |
| Basic outline | Request a butterfly profile. | A recognizable, editable recipe outline appears with exact stated outside dimensions and visible built-in attribution. Estimated details and physical-fit limits remain apparent. |
| Technical clarification | Request a bracket for a motor without dimensions. | Assistant asks about required dimensions or uses clearly stated assumptions; it does not claim that an unspecified mounting pattern fits. |
| Exact part | Request an 80 × 40 mm plate, two 5 mm holes, centres 15 mm from each end and on the horizontal centreline. | Geometry and export match the confirmed dimensions. |
| Conversational edit | Select the plate and request width 100 mm with unchanged hole diameters and end offsets. | Intended object changes; hole diameter is 5 mm; offsets remain 15 mm; unrelated objects do not change. |
| Explicit units | Request 8 cm, 80 mm, 8 厘米 and 80 毫米 examples. | Equivalent lengths produce equivalent geometry. Ambiguous mixed-unit instructions prompt clarification. |
| Selection context | Select one of several shapes and say “make this twice as wide.” | The selected object is the target; effect on holes or generated part parameters is explicit and geometrically valid. |
| Local fallback | Disable the relay and use a supported simple local command; then request something beyond it. | Supported local operation works; unsupported request is identified honestly; manual tools remain usable. |
| Provider errors | Test unavailable relay, invalid route, timeout and cancelled request. | Actionable error, no frozen UI, no duplicate insertion, and no partial drawing mutation. |
| Response race | While a slow request is pending, edit the design or change project. | A stale response cannot silently overwrite newer geometry or apply to the wrong project. |
| Proposed deletion | Ask for a change that proposes removing an existing object. | Preview names the objects to remove; Keep it remains disabled until the user explicitly acknowledges those removals. |

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

Recorded **2026-10-24** for the first release at [zhinii.github.io/fab-draw](https://zhinii.github.io/fab-draw/). These checks establish the outcomes below, not completion of every scenario in this plan. Provider calls used the shared CAD relay; vision was tested with `qwen3.7-plus`.

| Check | Recorded result | Evidence |
| --- | --- | --- |
| Automated tests | **Passed:** 80 tests, including profile recipes, strict shape schemas, path dimensions, geometry preflight, group metadata and the review pipeline. | `tests/geometry.test.mjs`, `tests/assistant.test.mjs`, `tests/assistant-server.test.mjs`, `tests/assistant-review.test.mjs`; release test run. |
| Production build and dependency audit | **Passed:** production build; audit reported 0 vulnerabilities at the time checked. | Release `npm run build` and audit run. |
| Desktop editing | **Passed:** actual browser drag, exact 110 × 40 mm sizing, 90° rotation and copy preserved 5 mm hole diameters and 15 mm end offsets. | Release browser interaction check. |
| Point editing and persistence | **Passed:** rotated compound-path node editing and persistence across reload. | Release browser interaction check. |
| Tablet layout before rewrite | **Passed:** 768 × 1024 viewport had no horizontal overflow; conversation remained accessible. | Earlier release browser viewport check; current dark-layout results are recorded below. |
| Phone/language before rewrite | **Passed:** 390-pixel viewport had no horizontal overflow; Chinese selection persisted across reload. | Earlier release browser viewport/persistence check; current dark-layout results are recorded below. |
| Deletion acknowledgement | **Passed:** proposed removals were named in the preview and Keep it remained disabled until acknowledgement. | Release browser interaction check before layout rewrite. |
| Earlier tool-card/bottom-chat layout | **Passed:** desktop 1440 × 960, tablet 768 × 1024 and phone 390 × 844 showed top tool cards, central canvas, thumbnail object cards and an always-visible bottom conversation without horizontal page overflow. | Earlier browser snapshots; this layout was subsequently replaced by the dark layout below. |
| Current dark layout and responsive tools | **Passed:** phone 390 × 844 had zero horizontal overflow and a 145 px conversation body with 19.8 px line height (about 7.3 text lines); input remained visible. Tablet 768 × 1024 menus fit the viewport. Desktop 1440 × 960 exposed the full set of responsive shortcuts. | Current browser screenshots and DOM measurements after the typography update. |
| Current menu and manual-edit flow | **Passed:** Pan, Fit, Shapes → Rectangle drag, More → Rotate 90°, and Undo twice worked in the browser. | Current browser interaction check. |
| Small phone and menu Escape | **Passed:** at 320 × 740, document client width and scroll width were both 320 px; the toolbar fit and the conversation body measured 143 px. Escape from the open More panel closed it and restored focus to the More toggle. | Current browser DOM measurements and keyboard interaction check. |
| Grid, camera and export independence | **Passed:** independent runtime review confirmed that pan/zoom keeps the grid anchored in drawing coordinates and leaves material bounds and shape coordinates unchanged. Dark display styling did not change the red cut color in SVG export. | Independent VM-rendered canvas/camera and geometry-export review; this is not a laser-software roundtrip. |
| Persistent groups | **Passed:** two object cards were grouped into one named card, rotated about the shared centre, dragged together by the same offset, and retained after reload. | Browser check plus independent transform review for rotated paths and odd-tooth gears; locks prevent partial group transforms. |
| Live Qwen plate | **Passed:** 80 × 40 mm plate, two 5 mm holes, 15 mm end offsets; no preflight issues. | Local `outputs/live-smoke-plate.json` and `outputs/live-smoke-plate.svg`. |
| Live Qwen Chinese | **Passed:** Chinese reply and 80 × 40 mm rectangle. | Local `outputs/live-smoke-zh.json` and `outputs/live-smoke-zh.svg`. |
| Technical clarification | **Passed:** an underspecified motor-bracket request asked about the motor, mounting holes and material. | Release live browser conversation check. |
| Live vision and confirmation | **Passed:** `qwen3.7-plus` read an 80 × 40 mm plate, 5 mm holes, 15 mm end offsets and square corners. Initial response asked for confirmation with no operations. Confirmed reconstruction was previewed and accepted with Keep it. | Local `outputs/dimensioned-sketch.png`; release live browser conversation check. |
| Browser export files | **Passed:** accepted photo reconstruction exported to SVG/DXF with 80 × 40 mm outline, two 5 mm holes at 15 mm end offsets and three closed contours. SVG declares physical millimetres; DXF declares INSUNITS=4 and uses Y-up coordinates. DXF hole polylines use 24 vertices with radial approximation error below 0.025 mm. No photo payload or credentials found. | Read-only artifact check of local `outputs/browser-photo-plate.svg` and `outputs/browser-photo-plate.dxf`; this is not a laser-software roundtrip. |
| Live butterfly recipe | **Passed:** deployed relay v22 returned one successful actual-client request in 6.9 seconds. Qwen selected the built-in butterfly recipe; a visible assumption identified the built-in outline. The expanded path has 30 editable points and actual 100 × 75 mm bounds. Rendered SVG visual review confirmed four wings and a body; preflight had no errors, only the expected estimated-profile warning. | Local `outputs/live-smoke-butterfly.json`, `outputs/live-smoke-butterfly.svg`, and visually reviewed `outputs/live-smoke-butterfly.png`. |
| Arbitrary profile appearance | **Not certified:** general editable paths remain supported, but mathematical validity does not verify object recognition. An earlier raw-coordinate butterfly passed geometry checks yet failed visual review; standard named outlines now use explicit recipes. | Treat new arbitrary profiles as drafts requiring visual review. |
| New visual AI review loop | **Pending:** the new render-and-review AI loop has not yet completed live end-to-end acceptance. Earlier successful vision reconstruction and butterfly recipe checks do not establish this new loop's behavior. | Record a separate live review result before claiming verification. |
| School laser software roundtrip | **Pending:** exported files have not been accepted in the school's actual laser software. | School-machine check required. |
| Physical cut and measured fit | **Pending:** no physical cut or measured-fit acceptance claimed. | School-machine test piece required. |

`outputs/` contains ignored local test artifacts and is deliberately excluded from the public repository. Do not interpret the local filenames above as files available from GitHub. Replace pending results only with the actual check outcome and evidence; keep unavailable checks visible.

Read-only layout and keyboard review on the same date: the 320 px toolbar budgets 44 px for each of its five main buttons, plus 34 px language and 30 px export controls, gaps and padding. Popovers are clamped to viewport width minus 16 px; the object shelf scrolls internally, and the composer can shrink its text area. The subsequent 320 × 740 browser check confirmed no page-width overflow. Menu Escape is handled in the capture phase, stops the canvas Escape handler, and has now been verified to close More and restore toggle focus. Open modal dialogs retain native Escape handling; Enter and Space on buttons retain native activation in source review, without additional recorded interaction tests for those paths.
