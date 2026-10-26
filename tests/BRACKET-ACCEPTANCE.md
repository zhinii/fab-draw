# Rounded bracket acceptance

Confirmed source choice: lower left-column-to-central-hole offset 40 mm and lower hole-column spacing 75 mm. The conflicting upper 35/45 chain is retained as source evidence but not used for construction.

Local origin is the top-left of the 110 × 240 mm bounding box, with Y down:

| Hole | X | Y | Diameter |
|---|---:|---:|---:|
| Top left | 20 | 15 | 15 |
| Top right | 95 | 15 | 15 |
| Lower left | 20 | 105 | 15 |
| Lower right | 95 | 165 | 15 |
| Central | 60 | 90 | 30 |

Top holes share the upper arc-centre level. The bottom R15 arc centre is at Y225; the 60 mm dimension runs from lower-right hole Y165 to that level, not the lowest edge Y240. Three R15 fillets and the left R20 fillet are constructed analytically with a tangent 45° diagonal. The part is stored as one editable compound path with six contours.

Validation:
- 120 local tests passed, including conflicting dimension chains, correct centres/radii, actual-outline hole containment, six DXF contours, SVG arc preservation, save/reload and manual-node fallback.
- Browser preview checked at 1000 × 900. Measurement form filled with the source values; both conflicts were shown and no geometry created. Chat selection of the lower values allowed confirmation and local construction of one five-hole part.
- Dimensions include overall size, 40/75 horizontal relations, 90/75/75/60 vertical relations, left inset, diameters and all four radii. Auto-fit includes annotations.
- Exactly two successful relay/provider image-read requests were used. The first returned no structured packet; the second returned a packet but missed lower values and misread one vertical gap. Neither was accepted for construction. Local validation and the manual review workflow prevent guessing; unassisted vision reconstruction has not passed this example.
- Separate pre-provider failures (local request length and missing Origin header in the CLI harness) did not call Qwen. No automated paid retry loop was used.

Artifacts: `public/examples/rounded-bracket.fabdraw`, ignored `outputs/rounded-bracket.svg`, `outputs/rounded-bracket-cut.svg`, `outputs/rounded-bracket-cut.dxf`, and browser screenshot `outputs/rounded-bracket-preview.png`.
